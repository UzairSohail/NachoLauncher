import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

/*
 * Reads the bits of Xbox 360 game dumps that ROM import needs: the title ID
 * (the 8 hex digit id every Xbox 360 game carries, e.g. 4D5307E6 for Halo 3)
 * and, where the dump has one, the game's display name.
 *
 * Supported layouts:
 * - XDVDFS disc images (.iso), including XGD2/XGD3 game partitions
 * - extracted games, booted through their default.xex
 * - Games on Demand packages (an STFS "CON "/"LIVE"/"PIRS" file inside a
 *   <TitleID>/00007000 folder)
 */

const SECTOR_SIZE = 2048;
const XDVDFS_HEADER_OFFSET = 0x10000;
const XDVDFS_MAGIC = "MICROSOFT*XBOX*MEDIA";
// Offsets of the game partition in the different disc layouts: plain XISO,
// XGD3, XGD2 and the original Xbox XGD1 layout.
const XDVDFS_PARTITION_OFFSETS = [0, 0x2080000, 0xfd90000, 0x18300000];
const MAX_DIRECTORY_BYTES = 1024 * 1024;
const MAX_XEX_HEADER_BYTES = 1024 * 1024;

const XEX2_MAGIC = "XEX2";
const XEX_EXECUTION_INFO_KEY = 0x00040006;

const STFS_MAGICS = new Set(["CON ", "LIVE", "PIRS"]);
const STFS_TITLE_ID_OFFSET = 0x360;
const STFS_DISPLAY_NAME_OFFSET = 0x411;
const STFS_DISPLAY_NAME_BYTES = 0x80;
const STFS_HEADER_BYTES = STFS_DISPLAY_NAME_OFFSET + STFS_DISPLAY_NAME_BYTES;

export const GOD_CONTENT_DIRECTORY = "00007000";

const TITLE_ID_RE = /^[0-9A-F]{8}$/;

export const formatXbox360TitleId = (value: number): string | null => {
  if (value === 0 || value === 0xffffffff) return null;
  return value.toString(16).toUpperCase().padStart(8, "0");
};

export const isXbox360TitleId = (value: string): boolean =>
  TITLE_ID_RE.test(value.toUpperCase());

const readAt = async (
  file: FileHandle,
  position: number,
  length: number
): Promise<Buffer | null> => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return bytesRead === length ? buffer : null;
};

/** Title ID from an XEX2 header, or null when the data is not one. */
export const parseXex2TitleId = (header: Buffer): string | null => {
  if (header.length < 0x18) return null;
  if (header.subarray(0, 4).toString("latin1") !== XEX2_MAGIC) return null;

  const optionalHeaderCount = header.readUInt32BE(0x14);
  for (let i = 0; i < optionalHeaderCount; i++) {
    const entryOffset = 0x18 + i * 8;
    if (entryOffset + 8 > header.length) return null;
    const key = header.readUInt32BE(entryOffset);
    if (key !== XEX_EXECUTION_INFO_KEY) continue;

    const infoOffset = header.readUInt32BE(entryOffset + 4);
    // media id, version, base version, then the title id
    if (infoOffset + 16 > header.length) return null;
    return formatXbox360TitleId(header.readUInt32BE(infoOffset + 12));
  }
  return null;
};

/** Title ID and display name from an STFS package header. */
export const parseStfsHeader = (
  header: Buffer
): { titleId: string | null; displayName: string | null } | null => {
  if (header.length < STFS_HEADER_BYTES) return null;
  if (!STFS_MAGICS.has(header.subarray(0, 4).toString("latin1"))) return null;

  const titleId = formatXbox360TitleId(
    header.readUInt32BE(STFS_TITLE_ID_OFFSET)
  );
  const nameBytes = Buffer.from(
    header.subarray(
      STFS_DISPLAY_NAME_OFFSET,
      STFS_DISPLAY_NAME_OFFSET + STFS_DISPLAY_NAME_BYTES
    )
  );
  // UTF-16BE -> UTF-16LE so Node can decode it.
  nameBytes.swap16();
  const displayName = nameBytes.toString("utf16le").split("\0")[0].trim();
  return { titleId, displayName: displayName || null };
};

const readXexTitleIdAt = async (
  file: FileHandle,
  position: number,
  available: number
): Promise<string | null> => {
  const probe = await readAt(file, position, Math.min(0x18, available));
  if (!probe || probe.length < 0x18) return null;
  if (probe.subarray(0, 4).toString("latin1") !== XEX2_MAGIC) return null;

  // Offset 8 is where the PE data starts, so every header is before it.
  const headerSize = Math.min(
    probe.readUInt32BE(8),
    MAX_XEX_HEADER_BYTES,
    available
  );
  const header = await readAt(file, position, headerSize);
  return header ? parseXex2TitleId(header) : null;
};

interface XdvdfsEntry {
  sector: number;
  size: number;
}

const findXdvdfsPartition = async (
  file: FileHandle
): Promise<{ base: number; rootSector: number; rootSize: number } | null> => {
  for (const base of XDVDFS_PARTITION_OFFSETS) {
    const header = await readAt(file, base + XDVDFS_HEADER_OFFSET, 28).catch(
      () => null
    );
    if (!header) continue;
    if (header.subarray(0, 20).toString("latin1") !== XDVDFS_MAGIC) continue;
    return {
      base,
      rootSector: header.readUInt32LE(20),
      rootSize: header.readUInt32LE(24),
    };
  }
  return null;
};

/** Walks the XDVDFS directory tree for a file name (case-insensitive). */
export const findXdvdfsEntry = (
  directory: Buffer,
  fileName: string
): XdvdfsEntry | null => {
  const wanted = fileName.toLowerCase();
  const pending = [0];
  const visited = new Set<number>();

  while (pending.length > 0) {
    const offset = pending.pop()!;
    if (visited.has(offset) || offset + 14 > directory.length) continue;
    visited.add(offset);

    const left = directory.readUInt16LE(offset);
    const right = directory.readUInt16LE(offset + 2);
    if (left === 0xffff && right === 0xffff) continue;

    const nameLength = directory.readUInt8(offset + 13);
    if (offset + 14 + nameLength > directory.length) continue;
    const name = directory
      .subarray(offset + 14, offset + 14 + nameLength)
      .toString("latin1");

    if (name.toLowerCase() === wanted) {
      return {
        sector: directory.readUInt32LE(offset + 4),
        size: directory.readUInt32LE(offset + 8),
      };
    }

    if (left !== 0 && left !== 0xffff) pending.push(left * 4);
    if (right !== 0 && right !== 0xffff) pending.push(right * 4);
  }
  return null;
};

export type Xbox360IsoKind = "xbox360" | "xbox" | "unknown";

const inspectIso = async (
  isoPath: string
): Promise<{ kind: Xbox360IsoKind; titleId: string | null }> => {
  let file: FileHandle | null = null;
  try {
    file = await fs.open(isoPath, "r");
    const partition = await findXdvdfsPartition(file);
    if (!partition) return { kind: "unknown", titleId: null };

    const directorySize = Math.min(partition.rootSize, MAX_DIRECTORY_BYTES);
    const directory = await readAt(
      file,
      partition.base + partition.rootSector * SECTOR_SIZE,
      directorySize
    );
    if (!directory) return { kind: "unknown", titleId: null };

    const xex = findXdvdfsEntry(directory, "default.xex");
    if (!xex) {
      return findXdvdfsEntry(directory, "default.xbe")
        ? { kind: "xbox", titleId: null }
        : { kind: "unknown", titleId: null };
    }

    const titleId = await readXexTitleIdAt(
      file,
      partition.base + xex.sector * SECTOR_SIZE,
      xex.size
    );
    return { kind: "xbox360", titleId };
  } catch {
    return { kind: "unknown", titleId: null };
  } finally {
    await file?.close();
  }
};

/**
 * Whether an .iso is an Xbox 360 game, an original Xbox game (which Xenia
 * cannot run) or something else entirely.
 */
export const classifyXbox360Iso = async (
  isoPath: string
): Promise<Xbox360IsoKind> => (await inspectIso(isoPath)).kind;

const readXexFileTitleId = async (xexPath: string): Promise<string | null> => {
  let file: FileHandle | null = null;
  try {
    file = await fs.open(xexPath, "r");
    const { size } = await file.stat();
    return await readXexTitleIdAt(file, 0, size);
  } catch {
    return null;
  } finally {
    await file?.close();
  }
};

/** The first file in a Games on Demand folder, which is what Xenia boots. */
export const findGodContainerFile = async (
  godDirectory: string
): Promise<string | null> => {
  const entries = await fs
    .readdir(godDirectory, { withFileTypes: true })
    .catch(() => null);
  if (!entries) return null;
  const container = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()[0];
  return container ? path.join(godDirectory, container) : null;
};

const readGodHeader = async (godDirectory: string) => {
  const container = await findGodContainerFile(godDirectory);
  if (!container) return null;
  let file: FileHandle | null = null;
  try {
    file = await fs.open(container, "r");
    const header = await readAt(file, 0, STFS_HEADER_BYTES);
    return header ? parseStfsHeader(header) : null;
  } catch {
    return null;
  } finally {
    await file?.close();
  }
};

const isGodDirectory = (primaryPath: string) =>
  path.basename(primaryPath) === GOD_CONTENT_DIRECTORY;

export const extractXbox360TitleId = async (
  primaryPath: string
): Promise<string | null> => {
  if (isGodDirectory(primaryPath)) {
    const header = await readGodHeader(primaryPath);
    if (header?.titleId) return header.titleId;
    const folderName = path.basename(path.dirname(primaryPath)).toUpperCase();
    return isXbox360TitleId(folderName) ? folderName : null;
  }

  const extension = path.extname(primaryPath).toLowerCase();
  if (extension === ".iso") return (await inspectIso(primaryPath)).titleId;
  if (extension === ".xex") return readXexFileTitleId(primaryPath);
  return null;
};

/** A dump's name without its .iso/.xex/.zar extension. */
export const stripXbox360Extension = (fileName: string) => {
  const extension = path.extname(fileName).toLowerCase();
  return [".iso", ".xex", ".zar"].includes(extension)
    ? fileName.slice(0, -extension.length)
    : fileName;
};

/**
 * The name a dump is shown and searched by. Games on Demand packages carry
 * their own display name; extracted games are named after their folder
 * (every one of them boots a file called default.xex); everything else
 * goes by its file name (extension included, like the other consoles).
 */
export const readXbox360DisplayName = async (
  primaryPath: string
): Promise<string> => {
  if (isGodDirectory(primaryPath)) {
    const header = await readGodHeader(primaryPath);
    if (header?.displayName) return header.displayName;
    const titleFolder = path.dirname(primaryPath);
    const parentName = path.basename(path.dirname(titleFolder));
    return isXbox360TitleId(path.basename(titleFolder)) && parentName
      ? parentName
      : path.basename(titleFolder);
  }

  const fileName = path.basename(primaryPath);
  if (fileName.toLowerCase() === "default.xex") {
    return path.basename(path.dirname(primaryPath));
  }
  return fileName;
};
