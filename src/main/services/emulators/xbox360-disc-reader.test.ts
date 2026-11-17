import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  classifyXbox360Iso,
  extractXbox360TitleId,
  findXdvdfsEntry,
  parseStfsHeader,
  parseXex2TitleId,
  readXbox360DisplayName,
} from "./xbox360-disc-reader.js";

const SECTOR = 2048;

const buildXex = (titleId: number): Buffer => {
  const header = Buffer.alloc(0x200);
  header.write("XEX2", 0, "latin1");
  header.writeUInt32BE(0x200, 8); // PE data offset
  header.writeUInt32BE(2, 0x14); // optional header count
  header.writeUInt32BE(0x000183ff, 0x18); // some other header
  header.writeUInt32BE(0, 0x1c);
  header.writeUInt32BE(0x00040006, 0x20); // execution info
  header.writeUInt32BE(0x100, 0x24);
  header.writeUInt32BE(titleId, 0x100 + 12);
  return header;
};

const directoryEntry = (name: string, sector: number, size: number) => {
  const entry = Buffer.alloc(14 + name.length);
  entry.writeUInt16LE(0, 0);
  entry.writeUInt16LE(0, 2);
  entry.writeUInt32LE(sector, 4);
  entry.writeUInt32LE(size, 8);
  entry.writeUInt8(0x80, 12);
  entry.writeUInt8(name.length, 13);
  entry.write(name, 14, "latin1");
  return entry;
};

/** A tiny XDVDFS image whose root directory holds a single file. */
const buildIso = (fileName: string, file: Buffer): Buffer => {
  const rootSector = 40;
  const fileSector = 41;
  const iso = Buffer.alloc((fileSector + 1) * SECTOR);
  iso.write("MICROSOFT*XBOX*MEDIA", 0x10000, "latin1");
  iso.writeUInt32LE(rootSector, 0x10000 + 20);
  iso.writeUInt32LE(SECTOR, 0x10000 + 24);
  directoryEntry(fileName, fileSector, file.length).copy(
    iso,
    rootSector * SECTOR
  );
  file.copy(iso, fileSector * SECTOR);
  return iso;
};

const buildStfs = (titleId: number, displayName: string): Buffer => {
  const header = Buffer.alloc(0x1000);
  header.write("LIVE", 0, "latin1");
  header.writeUInt32BE(titleId, 0x360);
  const name = Buffer.from(displayName, "utf16le");
  name.swap16();
  name.copy(header, 0x411);
  return header;
};

describe("xbox 360 disc reader", () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "nacho-x360-"));
  });

  after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("reads the title id from an XEX2 header", () => {
    assert.equal(parseXex2TitleId(buildXex(0x4d5307e6)), "4D5307E6");
    assert.equal(parseXex2TitleId(Buffer.from("not a xex")), null);
  });

  it("reads the title id and name from an STFS package header", () => {
    assert.deepEqual(parseStfsHeader(buildStfs(0x4d5307e6, "Halo 3")), {
      titleId: "4D5307E6",
      displayName: "Halo 3",
    });
  });

  it("finds files in an XDVDFS directory case-insensitively", () => {
    const entry = findXdvdfsEntry(
      directoryEntry("default.xex", 7, 99),
      "DEFAULT.XEX"
    );
    assert.deepEqual(entry, { sector: 7, size: 99 });
  });

  it("identifies Xbox 360 and original Xbox disc images", async () => {
    const x360 = path.join(root, "Halo 3 (USA).iso");
    await fs.writeFile(x360, buildIso("default.xex", buildXex(0x4d5307e6)));
    const ogXbox = path.join(root, "Halo (USA).iso");
    await fs.writeFile(ogXbox, buildIso("default.xbe", Buffer.from("XBEH")));
    const other = path.join(root, "Some PS2 Game.iso");
    await fs.writeFile(other, Buffer.alloc(0x20000));

    assert.equal(await classifyXbox360Iso(x360), "xbox360");
    assert.equal(await classifyXbox360Iso(ogXbox), "xbox");
    assert.equal(await classifyXbox360Iso(other), "unknown");
    assert.equal(await extractXbox360TitleId(x360), "4D5307E6");
  });

  it("handles extracted games and Games on Demand folders", async () => {
    const extracted = path.join(root, "Gears of War", "default.xex");
    await fs.mkdir(path.dirname(extracted), { recursive: true });
    await fs.writeFile(extracted, buildXex(0x4d5307d5));
    assert.equal(await extractXbox360TitleId(extracted), "4D5307D5");
    assert.equal(await readXbox360DisplayName(extracted), "Gears of War");

    const god = path.join(root, "4D530877", "00007000");
    await fs.mkdir(god, { recursive: true });
    await fs.writeFile(
      path.join(god, "ABCDEF0123456789"),
      buildStfs(0x4d530877, "Fable II")
    );
    assert.equal(await extractXbox360TitleId(god), "4D530877");
    assert.equal(await readXbox360DisplayName(god), "Fable II");
  });
});
