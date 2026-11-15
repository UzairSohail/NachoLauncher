import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  downloadParallelRanges,
  getIfRangeHeader,
  getRangeValidator,
  planDownloadSegments,
  splitLargestSegment,
} from "./parallel-range-download.ts";
import {
  configureRangeStateDirectory,
  readRangeState,
} from "./range-download-state.ts";

const MB = 1024 * 1024;

describe("planDownloadSegments", () => {
  it("gives each connection one large segment", () => {
    const segments = planDownloadSegments([[0, 80 * MB]], 8, 4 * MB);
    assert.equal(segments.length, 8);
    assert.deepEqual(segments[0], { start: 0, next: 0, end: 10 * MB - 1 });
    assert.equal(segments.at(-1)!.end, 80 * MB - 1);
  });

  it("does not leave a tiny trailing segment", () => {
    const segments = planDownloadSegments([[0, 10 * MB + 1]], 2, 4 * MB);
    assert.equal(segments.length, 2);
    assert.equal(segments[1].end, 10 * MB);
  });

  it("covers every gap and respects the request budget", () => {
    const segments = planDownloadSegments(
      [
        [0, 5 * MB],
        [20 * MB, 40 * MB],
      ],
      4,
      4 * MB
    );
    const covered = segments.reduce((sum, s) => sum + s.end - s.start + 1, 0);
    assert.equal(covered, 25 * MB);
    assert.equal(
      planDownloadSegments([[0, 100 * MB]], 16, 4 * MB, 3).length,
      3
    );
  });
});

describe("splitLargestSegment", () => {
  it("takes the back half of the segment with the most left", () => {
    const small = { start: 0, next: 5 * MB, end: 10 * MB - 1 };
    const big = { start: 10 * MB, next: 10 * MB, end: 30 * MB - 1 };
    const stolen = splitLargestSegment([small, big], 4 * MB)!;
    assert.deepEqual(stolen, {
      start: 20 * MB,
      next: 20 * MB,
      end: 30 * MB - 1,
    });
    assert.equal(big.end, 20 * MB - 1);
  });

  it("leaves small remainders alone", () => {
    const segment = { start: 0, next: 0, end: 7 * MB };
    assert.equal(splitLargestSegment([segment], 4 * MB), null);
  });
});

/** Serves one file with byte ranges, each connection capped at a fixed speed. */
function startServer(
  body: Buffer,
  {
    bytesPerSecond,
    maxConnections = Infinity,
    sendEtag = true,
  }: { bytesPerSecond: number; maxConnections?: number; sendEtag?: boolean }
) {
  const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
  let open = 0;
  const stats = { requests: 0, refused: 0, peak: 0 };
  const server = http.createServer((request, response) => {
    stats.requests++;
    if (open >= maxConnections) {
      stats.refused++;
      response.writeHead(429).end();
      return;
    }
    const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2]
      ? Math.min(Number(match[2]), body.length - 1)
      : body.length - 1;
    response.writeHead(match ? 206 : 200, {
      ...(sendEtag ? { ETag: etag } : {}),
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      ...(match
        ? { "Content-Range": `bytes ${start}-${end}/${body.length}` }
        : {}),
    });
    open++;
    stats.peak = Math.max(stats.peak, open);
    let offset = start;
    const tick = 20;
    const perTick = Math.max(1, Math.floor((bytesPerSecond * tick) / 1000));
    const timer = setInterval(() => {
      if (response.destroyed) return finish();
      const next = Math.min(offset + perTick, end + 1);
      response.write(body.subarray(offset, next));
      offset = next;
      if (offset > end) {
        response.end();
        finish();
      }
    }, tick);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      open--;
    };
    response.on("close", finish);
  });
  return new Promise<{
    url: string;
    stats: typeof stats;
    close: () => Promise<void>;
  }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/game.bin`,
        stats,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    })
  );
}

async function download(
  url: string,
  filePath: string,
  size: number,
  connectionCount: number,
  onConnectionsChange?: (count: number) => void
) {
  const firstResponse = await fetch(url, {
    headers: { Range: `bytes=0-${8 * MB - 1}` },
  });
  fs.writeFileSync(filePath, "");
  const controller = new AbortController();
  const started = Date.now();
  const complete = await downloadParallelRanges({
    url,
    headers: {},
    firstResponse,
    filePath,
    startByte: 0,
    total: size,
    connectionCount,
    signal: controller.signal,
    abort: () => controller.abort(),
    beforeChunk: async () => undefined,
    afterChunk: () => undefined,
    onReadPending: () => undefined,
    onConnectionsChange,
  });
  return { complete, seconds: (Date.now() - started) / 1000 };
}

describe("downloadParallelRanges", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nacho-ranges-"));
  const size = 24 * MB;
  const body = randomBytes(size);

  before(() => configureRangeStateDirectory(path.join(directory, "state")));
  after(() => fs.rmSync(directory, { recursive: true, force: true }));

  it("downloads faster over more connections and keeps the bytes intact", async () => {
    const server = await startServer(body, { bytesPerSecond: 8 * MB });
    try {
      const single = path.join(directory, "single.bin");
      const multi = path.join(directory, "multi.bin");
      const one = await download(server.url, single, size, 1);
      const eight = await download(server.url, multi, size, 8);
      assert.equal(one.complete, true);
      assert.equal(eight.complete, true);
      assert.ok(fs.readFileSync(single).equals(body));
      assert.ok(fs.readFileSync(multi).equals(body));
      assert.equal(readRangeState(multi), null);
      assert.ok(
        eight.seconds * 3 < one.seconds,
        `8 connections took ${eight.seconds}s, 1 took ${one.seconds}s`
      );
    } finally {
      await server.close();
    }
  });

  it("splits hosts that send no ETag, checking the size instead", async () => {
    const server = await startServer(body, {
      bytesPerSecond: 16 * MB,
      sendEtag: false,
    });
    try {
      const target = path.join(directory, "no-etag.bin");
      let peak = 0;
      const result = await download(server.url, target, size, 8, (count) => {
        peak = Math.max(peak, count);
      });
      assert.equal(result.complete, true);
      assert.ok(peak >= 4, `only ${peak} connections`);
      assert.ok(fs.readFileSync(target).equals(body));
    } finally {
      await server.close();
    }
  });

  it("carries on with fewer connections when the host refuses extra ones", async () => {
    const server = await startServer(body, {
      bytesPerSecond: 16 * MB,
      maxConnections: 3,
    });
    try {
      const target = path.join(directory, "limited.bin");
      const result = await download(server.url, target, size, 8);
      assert.equal(result.complete, true);
      assert.ok(server.stats.refused > 0);
      assert.ok(server.stats.peak <= 3);
      assert.ok(fs.readFileSync(target).equals(body));
    } finally {
      await server.close();
    }
  });
});

describe("getRangeValidator", () => {
  const partial = (headers: Record<string, string>) =>
    new Response("ab", {
      status: 206,
      headers: { "Content-Range": "bytes 0-1/10", ...headers },
    });

  it("prefers a strong ETag and sends it as If-Range", () => {
    const validator = getRangeValidator(partial({ ETag: '"abc"' }));
    assert.equal(validator, '"abc"');
    assert.deepEqual(getIfRangeHeader(validator), { "If-Range": '"abc"' });
  });

  it("falls back to the file size without sending If-Range", () => {
    const validator = getRangeValidator(partial({ ETag: 'W/"weak"' }));
    assert.equal(validator, "nacho-size:10");
    assert.deepEqual(getIfRangeHeader(validator), {});
    assert.equal(getRangeValidator(new Response("x")), null);
  });
});
