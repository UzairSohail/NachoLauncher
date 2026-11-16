import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { torrentFileToMagnet } from "./torrent-file-to-magnet.js";

describe("torrentFileToMagnet", () => {
  it("hashes the info dictionary and keeps the name and trackers", () => {
    const str = (value: string) => `${value.length}:${value}`;
    const a = str("udp://a.example:80");
    const b = str("udp://b.example:80");
    const info = `d6:lengthi42e4:name${str("Game Demo")}12:piece lengthi16384e6:pieces0:e`;
    const torrent = Buffer.from(
      `d8:announce${a}13:announce-listll${a}el${b}ee4:info${info}e`
    );
    const hash = createHash("sha1").update(info).digest("hex");
    assert.equal(
      torrentFileToMagnet(torrent),
      `magnet:?xt=urn:btih:${hash}&dn=Game%20Demo&tr=udp%3A%2F%2Fa.example%3A80&tr=udp%3A%2F%2Fb.example%3A80`
    );
  });

  it("rejects files that aren't torrents", () => {
    assert.throws(() => torrentFileToMagnet(Buffer.from("<html></html>")));
    assert.throws(() => torrentFileToMagnet(Buffer.from("d3:fooi1ee")));
  });
});
