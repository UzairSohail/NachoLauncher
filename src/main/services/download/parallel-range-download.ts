import fs from "node:fs";
import {
  markSavedRange,
  missingRanges,
  rangeResourceId,
  readRangeState,
  removeRangeState,
  saveRangeState,
  type RangeDownloadState,
} from "./range-download-state.js";

const PARALLEL_RANGE_FAILURE_LIMIT = 2;
export const MAX_PARALLEL_CONNECTIONS = 16;
const RANGE_CHECKPOINT_INTERVAL_MS = 3000;
const STRONG_LAST_MODIFIED_AGE_MS = 60_000;

export const PARALLEL_RANGE_SIZE = 8 * 1024 * 1024;
export const PARALLEL_RANGE_COUNT = 8;
export const MAX_PARALLEL_RANGE_SIZE = 256 * 1024 * 1024;

export function getRangeSizeForRequestBudget(
  totalBytes: number,
  maxRanges: number
): number {
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
    return PARALLEL_RANGE_SIZE;
  }
  const units = Math.ceil(totalBytes / (maxRanges * PARALLEL_RANGE_SIZE));
  return Math.min(
    MAX_PARALLEL_RANGE_SIZE,
    Math.max(PARALLEL_RANGE_SIZE, units * PARALLEL_RANGE_SIZE)
  );
}

export class ParallelRangeUnsupportedError extends Error {
  readonly retryable = true;
}

export class ParallelRangeHttpStatusError extends Error {
  constructor(
    readonly statusCode: number,
    readonly retryAfter: string | null
  ) {
    super(`Byte range server returned HTTP ${statusCode}`);
  }
}

export function shouldDowngradeParallelRanges(
  error: unknown,
  failureCount: number
): boolean {
  return (
    error instanceof ParallelRangeUnsupportedError ||
    failureCount >= PARALLEL_RANGE_FAILURE_LIMIT
  );
}

export function getRangeTotal(
  response: Response,
  start: number,
  end: number
): number | null {
  if (response.status !== 206) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(
    response.headers.get("content-range") ?? ""
  );
  if (!match) return null;

  const [, actualStart, actualEnd, totalValue] = match;
  const total = Number(totalValue);
  const encoding = response.headers.get("content-encoding")?.toLowerCase();
  if (
    Number(actualStart) !== start ||
    Number(actualEnd) !== Math.min(end, total - 1) ||
    !Number.isSafeInteger(total) ||
    total <= start ||
    (encoding && encoding !== "identity")
  ) {
    return null;
  }

  const length = response.headers.get("content-length");
  if (length && Number(length) !== Number(actualEnd) - start + 1) {
    return null;
  }
  return total;
}

export function getStrongRangeValidator(response: Response): string | null {
  const etag = response.headers.get("etag");
  if (etag !== null) {
    return /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) ? etag : null;
  }
  const modified = response.headers.get("last-modified");
  const date = response.headers.get("date");
  // RFC 9110 8.8.2.2 permits a date validator when the clocks are far enough
  // apart. Keep the conservative 60-second margin used by older HTTP specs.
  return modified &&
    date &&
    Number.isFinite(Date.parse(modified)) &&
    Number.isFinite(Date.parse(date)) &&
    Date.parse(date) - Date.parse(modified) >= STRONG_LAST_MODIFIED_AGE_MS
    ? modified
    : null;
}

const SIZE_VALIDATOR_PREFIX = "nacho-size:";

/**
 * The strong validator when the host sends one. Otherwise, like IDM, fall back
 * to the file size from Content-Range so hosts without an ETag still get
 * multiple connections. Every range must then report that same total size.
 */
export function getRangeValidator(response: Response): string | null {
  const strong = getStrongRangeValidator(response);
  if (strong) return strong;
  const range = parseContentRange(response);
  return range ? `${SIZE_VALIDATOR_PREFIX}${range.total}` : null;
}

/** If-Range only works with a real validator, never the size fallback. */
export function getIfRangeHeader(
  validator: string | null | undefined
): Record<string, string> {
  return validator && !validator.startsWith(SIZE_VALIDATOR_PREFIX)
    ? { "If-Range": validator }
    : {};
}

export function getRangeResumeCapability(
  response: Response,
  requestedRange: string | undefined,
  ifRange?: string
): "unknown" | "supported" | "unsupported" {
  const range = /^bytes=(\d+)-(\d*)$/.exec(requestedRange ?? "");
  if (!range) return "unknown";
  if (
    /^(text\/html|application\/xhtml)/i.test(
      response.headers.get("content-type") ?? ""
    )
  ) {
    return "unknown";
  }
  // A changed If-Range validator legitimately returns the entire resource.
  if (response.status === 200) return ifRange ? "unknown" : "unsupported";
  const start = Number(range[1]);
  const end = range[2] ? Number(range[2]) : Number.MAX_SAFE_INTEGER;
  return getRangeTotal(response, start, end) !== null ? "supported" : "unknown";
}

export interface ParallelRangeDownloadOptions {
  url: string;
  headers: Record<string, string>;
  firstResponse: Response;
  filePath: string;
  startByte: number;
  total: number;
  rangeSize?: number;
  connectionCount?: number;
  maxRanges?: number;
  resourceId?: string;
  signal: AbortSignal;
  abort: () => void;
  beforeChunk: (length: number) => Promise<void>;
  beforeComplete?: () => Promise<void>;
  afterChunk: (length: number) => void;
  onReadPending: (offset: number, pending: boolean) => void;
  /** Called with the number of connections currently downloading. */
  onConnectionsChange?: (count: number) => void;
}

/** A slice of the file one connection is responsible for. `end` is inclusive
 * and can shrink while the slice downloads, when an idle connection takes over
 * the back half of it. `next` is the first byte nobody has claimed yet. */
export interface DownloadSegment {
  start: number;
  next: number;
  end: number;
}

/** Splitting off less than this is not worth a new HTTP request. */
export const MIN_SEGMENT_SPLIT_SIZE = 4 * 1024 * 1024;

const RETIRE_STATUSES = new Set([429, 503]);

/**
 * Spread the missing bytes over roughly one large segment per connection, like
 * IDM does, instead of many small fixed-size requests. Each request then streams
 * for a long time over one warmed-up connection.
 */
export function planDownloadSegments(
  gaps: [start: number, end: number][],
  connectionCount: number,
  minSegmentSize: number,
  maxSegments = Infinity
): DownloadSegment[] {
  const missing = gaps.reduce((sum, [start, end]) => sum + end - start, 0);
  const segmentSize = Math.max(
    minSegmentSize,
    Math.ceil(missing / Math.max(1, connectionCount))
  );
  const segments: DownloadSegment[] = [];
  for (const [start, end] of gaps) {
    for (let offset = start; offset < end && segments.length < maxSegments; ) {
      // Fold a small leftover into this segment rather than making a tiny one.
      let next = Math.min(offset + segmentSize, end);
      if (end - next < minSegmentSize) next = end;
      segments.push({ start: offset, next: offset, end: next - 1 });
      offset = next;
    }
    if (segments.length >= maxSegments) break;
  }
  return segments;
}

/**
 * Give an idle connection the back half of whichever active segment has the
 * most bytes left. Returns null when nothing is big enough to be worth it.
 */
export function splitLargestSegment(
  active: Iterable<DownloadSegment>,
  minSplitSize = MIN_SEGMENT_SPLIT_SIZE
): DownloadSegment | null {
  let victim: DownloadSegment | null = null;
  for (const segment of active) {
    if (!victim || segment.end - segment.next > victim.end - victim.next)
      victim = segment;
  }
  if (!victim) return null;
  const remaining = victim.end - victim.next + 1;
  if (remaining < minSplitSize * 2) return null;
  const middle = victim.next + Math.ceil(remaining / 2);
  const stolen = { start: middle, next: middle, end: victim.end };
  victim.end = middle - 1;
  return stolen;
}

function parseContentRange(
  response: Response
): { start: number; end: number; total: number } | null {
  if (response.status !== 206) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(
    response.headers.get("content-range") ?? ""
  );
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number);
  const encoding = response.headers.get("content-encoding")?.toLowerCase();
  const length = response.headers.get("content-length");
  if (
    ![start, end, total].every(Number.isSafeInteger) ||
    end < start ||
    end >= total ||
    (encoding && encoding !== "identity") ||
    (length && Number(length) !== end - start + 1)
  )
    return null;
  return { start, end, total };
}

class RetireConnection extends Error {}

export async function downloadParallelRanges({
  url,
  headers,
  firstResponse,
  filePath,
  startByte,
  total,
  rangeSize = PARALLEL_RANGE_SIZE,
  connectionCount = PARALLEL_RANGE_COUNT,
  maxRanges = Infinity,
  resourceId,
  signal,
  abort,
  beforeChunk,
  beforeComplete,
  afterChunk,
  onReadPending,
  onConnectionsChange,
}: ParallelRangeDownloadOptions): Promise<boolean> {
  const validator = getRangeValidator(firstResponse);
  if (!validator) {
    await firstResponse.body?.cancel();
    throw new ParallelRangeUnsupportedError(
      "The download server did not provide a byte-range validator"
    );
  }
  const saved = readRangeState(filePath);
  if (
    saved &&
    (saved.total !== total ||
      saved.validator !== validator ||
      saved.resourceId !== rangeResourceId(resourceId))
  ) {
    await firstResponse.body?.cancel();
    throw new Error(
      "The download resource changed. Keeping the saved partial file."
    );
  }
  if (
    !Number.isSafeInteger(rangeSize) ||
    rangeSize <= 0 ||
    !Number.isSafeInteger(connectionCount) ||
    connectionCount < 1 ||
    connectionCount > MAX_PARALLEL_CONNECTIONS ||
    !(
      maxRanges === Infinity ||
      (Number.isSafeInteger(maxRanges) && maxRanges > 0)
    )
  ) {
    await firstResponse.body?.cancel();
    throw new Error("Invalid parallel download limits");
  }
  const state: RangeDownloadState = saved ?? {
    version: 1,
    total,
    validator,
    resourceId: rangeResourceId(resourceId),
    ranges: startByte > 0 ? [[0, startByte]] : [],
  };
  const pool = planDownloadSegments(
    missingRanges(state),
    connectionCount,
    Math.min(rangeSize, MIN_SEGMENT_SPLIT_SIZE),
    maxRanges
  );
  let requestCount = pool.length;
  const active = new Set<DownloadSegment>();
  const firstRange = parseContentRange(firstResponse);
  const file = await fs.promises.open(filePath, "r+");
  let lastCheckpoint = Date.now();
  let checkpoint: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    // Snapshot before sync so the map never claims bytes that sync did not see.
    const snapshot = {
      ...state,
      ranges: state.ranges.map(([start, end]): [number, number] => [
        start,
        end,
      ]),
    };
    checkpoint = checkpoint.then(async () => {
      await file.sync();
      await saveRangeState(filePath, snapshot);
    });
    return checkpoint;
  };
  let firstUsed = false;

  const openRange = async (segment: DownloadSegment): Promise<Response> => {
    if (
      !firstUsed &&
      firstRange?.total === total &&
      firstRange.start === segment.next
    ) {
      firstUsed = true;
      return firstResponse;
    }
    onReadPending(segment.start, true);
    try {
      return await fetch(url, {
        headers: {
          ...headers,
          Range: `bytes=${segment.next}-${segment.end}`,
          ...getIfRangeHeader(validator),
        },
        signal,
      });
    } catch (error) {
      // Another connection is still going, so drop this one and let the
      // others take its share instead of failing the whole download.
      if (!signal.aborted && active.size > 1) throw new RetireConnection();
      throw error;
    } finally {
      onReadPending(segment.start, false);
    }
  };

  const runSegment = async (segment: DownloadSegment): Promise<void> => {
    while (segment.next <= segment.end) {
      signal.throwIfAborted();
      const response = await openRange(segment);
      const range = parseContentRange(response);
      if (
        range?.start !== segment.next ||
        range.total !== total ||
        getRangeValidator(response) !== validator
      ) {
        await response.body?.cancel();
        if (RETIRE_STATUSES.has(response.status) && active.size > 1) {
          // The host limits connections per link; carry on with fewer.
          throw new RetireConnection();
        }
        if (response.status >= 400) {
          throw new ParallelRangeHttpStatusError(
            response.status,
            response.headers.get("retry-after")
          );
        }
        throw new ParallelRangeUnsupportedError(
          "The download server stopped serving matching byte ranges"
        );
      }
      if (!response.body) throw new Error("Range response body is null");
      const reader = response.body.getReader();
      try {
        const chunks: AsyncIterable<Uint8Array> = {
          [Symbol.asyncIterator]: () => ({
            next: async () => {
              onReadPending(segment.start, true);
              try {
                return await reader.read();
              } finally {
                onReadPending(segment.start, false);
              }
            },
          }),
        };
        for await (const received of chunks) {
          await beforeChunk(received.length);
          signal.throwIfAborted();
          // Another connection may have taken over the rest of this segment.
          const length = Math.min(
            received.length,
            segment.end - segment.next + 1
          );
          if (length <= 0) break;
          const offset = segment.next;
          segment.next += length;
          for (let written = 0; written < length; ) {
            const result = await file.write(
              received,
              written,
              length - written,
              offset + written
            );
            if (!result.bytesWritten)
              throw new Error("Could not write the downloaded byte range");
            markSavedRange(
              state,
              offset + written,
              offset + written + result.bytesWritten
            );
            written += result.bytesWritten;
            afterChunk(result.bytesWritten);
          }
          if (Date.now() - lastCheckpoint >= RANGE_CHECKPOINT_INTERVAL_MS) {
            lastCheckpoint = Date.now();
            await persist();
          }
          signal.throwIfAborted();
          if (segment.next > segment.end) break;
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      // Stopping early because the segment shrank is fine; the server
      // closing the response before the bytes it promised is not.
      if (segment.next <= Math.min(segment.end, range.end)) {
        const error = new Error(
          "Byte range ended before its expected size"
        ) as Error & { retryable: boolean };
        error.retryable = true;
        throw error;
      }
    }
  };

  const nextSegment = (): DownloadSegment | undefined => {
    const queued = pool.shift();
    if (queued) return queued;
    if (requestCount >= maxRanges) return undefined;
    const stolen = splitLargestSegment(active);
    if (stolen) requestCount++;
    return stolen ?? undefined;
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      signal.throwIfAborted();
      const segment = nextSegment();
      if (!segment) return;
      active.add(segment);
      onConnectionsChange?.(active.size);
      try {
        await runSegment(segment);
      } catch (error) {
        if (!(error instanceof RetireConnection)) throw error;
        pool.unshift(segment);
        return;
      } finally {
        active.delete(segment);
        onConnectionsChange?.(active.size);
      }
    }
  };

  let workers: Promise<void>[] = [];
  try {
    await persist();
    // Connections beyond the planned segments start by splitting one.
    workers = Array.from({ length: connectionCount }, () => worker());
    try {
      await Promise.all(workers);
    } catch (error) {
      abort();
      await Promise.allSettled(workers);
      throw error;
    }
    return missingRanges(state).length === 0;
  } finally {
    try {
      await persist();
    } finally {
      await file.close();
      if (!firstUsed) await firstResponse.body?.cancel().catch(() => undefined);
    }
    if (missingRanges(state).length === 0) {
      await beforeComplete?.();
      removeRangeState(filePath);
    }
  }
}
