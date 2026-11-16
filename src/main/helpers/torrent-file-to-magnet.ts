import { createHash } from "node:crypto";

type BValue = number | Buffer | BValue[] | Map<string, BValue>;

interface Parsed {
  value: BValue;
  end: number;
  /** Byte span of the top-level "info" dictionary, for the info hash. */
  info?: { start: number; end: number };
}

const parse = (data: Buffer, start: number, topLevel = false): Parsed => {
  const type = data[start];
  if (type === undefined) throw new Error("Unexpected end of torrent file");

  if (type === 0x69 /* i */) {
    const end = data.indexOf(0x65 /* e */, start);
    if (end === -1) throw new Error("Unterminated integer in torrent file");
    return {
      value: Number(data.toString("ascii", start + 1, end)),
      end: end + 1,
    };
  }

  if (type === 0x6c /* l */) {
    const list: BValue[] = [];
    let position = start + 1;
    while (data[position] !== 0x65) {
      const item = parse(data, position);
      list.push(item.value);
      position = item.end;
    }
    return { value: list, end: position + 1 };
  }

  if (type === 0x64 /* d */) {
    const dict = new Map<string, BValue>();
    let info: Parsed["info"];
    let position = start + 1;
    while (data[position] !== 0x65) {
      const key = parse(data, position);
      if (!Buffer.isBuffer(key.value))
        throw new Error("Torrent file has a non-string key");
      const name = key.value.toString("utf8");
      const item = parse(data, key.end);
      if (topLevel && name === "info") info = { start: key.end, end: item.end };
      dict.set(name, item.value);
      position = item.end;
    }
    return { value: dict, end: position + 1, info };
  }

  if (type >= 0x30 && type <= 0x39) {
    const colon = data.indexOf(0x3a /* : */, start);
    if (colon === -1) throw new Error("Malformed string in torrent file");
    const length = Number(data.toString("ascii", start, colon));
    const end = colon + 1 + length;
    if (!Number.isSafeInteger(length) || end > data.length)
      throw new Error("Torrent file is truncated");
    return { value: data.subarray(colon + 1, end), end };
  }

  throw new Error("Not a torrent file");
};

const text = (value: BValue | undefined) =>
  Buffer.isBuffer(value) ? value.toString("utf8") : null;

/**
 * Turns a .torrent file into a magnet link (info hash, name and trackers), so
 * it can go to a debrid service the same way as any other magnet.
 */
export const torrentFileToMagnet = (data: Buffer): string => {
  const parsed = parse(data, 0, true);
  if (!(parsed.value instanceof Map) || !parsed.info) {
    throw new Error("Not a torrent file");
  }

  const infoHash = createHash("sha1")
    .update(data.subarray(parsed.info.start, parsed.info.end))
    .digest("hex");

  const params = [`xt=urn:btih:${infoHash}`];
  const info = parsed.value.get("info");
  const name = info instanceof Map ? text(info.get("name")) : null;
  if (name) params.push(`dn=${encodeURIComponent(name)}`);

  const trackers = new Set<string>();
  const announce = text(parsed.value.get("announce"));
  if (announce) trackers.add(announce);
  const announceList = parsed.value.get("announce-list");
  if (Array.isArray(announceList)) {
    for (const tier of announceList) {
      for (const tracker of Array.isArray(tier) ? tier : [tier]) {
        const url = text(tracker);
        if (url) trackers.add(url);
      }
    }
  }
  for (const tracker of trackers)
    params.push(`tr=${encodeURIComponent(tracker)}`);

  return `magnet:?${params.join("&")}`;
};
