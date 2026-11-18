import { randomUUID } from "node:crypto";
import os from "node:os";

import { PersonalCloud } from "../personal-cloud";
import type {
  EmulationCloudSave,
  EmulationSaveMetadata,
  EmulationSaveEmulator,
  EmulationSavePlatform,
  EmulatorBinary,
} from "@types";

/*
 * Emulator save backups, kept in the user's own Google Drive next to their PC
 * game saves (the Cloud Save Manager folder). Upstream Hydra sent these to its
 * paid `/profile/emulation-saves` API, which Nacho can't sign in to.
 *
 * Drive layout, all under the folder's `Nacho/` area:
 *   Nacho/emulation-saves/index.json      every save's record (EmulationCloudSave[])
 *   Nacho/emulation-saves/files/<id>.bin  the save bytes (.psu, .mcs, zip, .gci …)
 *
 * The index is small and read whole. Each save keeps its newest few versions;
 * older ones go to the Drive bin, so a mistaken overwrite can still be undone.
 */

const ROOT = "Nacho/emulation-saves";
const INDEX_FILE = `${ROOT}/index.json`;
const blobKey = (id: string) => `${ROOT}/files/${id}.bin`;
const SAVE_KIND = "game_save" as const;
const VERSIONS_KEPT = 5;

export const EMULATION_SAVES_SIGN_IN_ERROR =
  "Sign in with Google in Settings to back up emulator saves to your Drive";

interface EmulationSaveIndex {
  version: 1;
  saves: EmulationCloudSave[];
}

export const toEmulationSaveEmulator = (
  binary: EmulatorBinary
): EmulationSaveEmulator => {
  if (
    binary !== "duckstation" &&
    binary !== "pcsx2" &&
    binary !== "ppsspp" &&
    binary !== "dolphin" &&
    binary !== "xenia"
  ) {
    throw new Error(`Emulator "${binary}" has no emulator save backups`);
  }
  return binary;
};

const requireSignedIn = async () => {
  const status = await PersonalCloud.status().catch(() => null);
  if (!status?.signedIn) throw new Error(EMULATION_SAVES_SIGN_IN_ERROR);
};

const readIndex = async (): Promise<EmulationSaveIndex> => {
  const raw = await PersonalCloud.readFile(INDEX_FILE);
  if (!raw) return { version: 1, saves: [] };
  try {
    const parsed = JSON.parse(
      raw.toString("utf8")
    ) as Partial<EmulationSaveIndex>;
    return {
      version: 1,
      saves: Array.isArray(parsed.saves) ? parsed.saves : [],
    };
  } catch {
    throw new Error("The emulator save list in Google Drive is unreadable");
  }
};

const writeIndex = (index: EmulationSaveIndex) =>
  PersonalCloud.writeFile(
    INDEX_FILE,
    Buffer.from(JSON.stringify(index, null, 2), "utf8")
  );

// Index edits on this device run one at a time so they can't overwrite each
// other's read-modify-write.
let indexQueue: Promise<unknown> = Promise.resolve();
const editIndex = <T>(
  edit: (index: EmulationSaveIndex) => Promise<T> | T
): Promise<T> => {
  const run = indexQueue.then(async () => {
    const index = await readIndex();
    const result = await edit(index);
    await writeIndex(index);
    return result;
  });
  indexQueue = run.catch(() => undefined);
  return run;
};

const sameSlot = (a: EmulationCloudSave, b: EmulationCloudSave) =>
  a.platform === b.platform &&
  a.emulator === b.emulator &&
  a.saveIdentity === b.saveIdentity &&
  (a.objectId ?? null) === (b.objectId ?? null);

const byNewest = (a: EmulationCloudSave, b: EmulationCloudSave) =>
  (b.lastUploadedAt ?? b.createdAt).localeCompare(
    a.lastUploadedAt ?? a.createdAt
  );

export interface UploadEmulationSaveInput {
  platform: EmulationSavePlatform;
  emulator: EmulationSaveEmulator;
  /** "launchbox" when the save matched a game; null (with objectId) otherwise. */
  shop: "launchbox" | null;
  objectId: string | null;
  /** Stable per-game slot id — the on-card folder name / save identifier. */
  saveIdentity: string;
  fileName: string;
  label: string;
  localLastModifiedAt: string; // ISO 8601
  buffer: Buffer;
  metadata?: EmulationSaveMetadata;
}

/** Uploads the bytes, then records the save in the Drive index. */
export const uploadEmulationSave = async (
  input: UploadEmulationSaveInput
): Promise<EmulationCloudSave> => {
  await requireSignedIn();

  const id = randomUUID();
  await PersonalCloud.writeFile(blobKey(id), input.buffer);

  const now = new Date().toISOString();
  const hasShop = Boolean(input.shop && input.objectId);
  const save: EmulationCloudSave = {
    id,
    platform: input.platform,
    emulator: input.emulator,
    saveKind: SAVE_KIND,
    saveIdentity: input.saveIdentity,
    artifactLengthInBytes: input.buffer.length,
    fileName: input.fileName,
    hostname: os.hostname(),
    localLastModifiedAt: input.localLastModifiedAt,
    label: input.label,
    metadata: input.metadata ?? null,
    shop: hasShop ? input.shop : null,
    objectId: hasShop ? input.objectId : null,
    lastUploadedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const dropped = await editIndex((index) => {
    const versions = [save, ...index.saves.filter((s) => sameSlot(s, save))]
      .sort(byNewest)
      .slice(VERSIONS_KEPT);
    const droppedIds = new Set(versions.map((s) => s.id));
    index.saves = [save, ...index.saves.filter((s) => !droppedIds.has(s.id))];
    return versions;
  });

  for (const old of dropped) {
    await PersonalCloud.deleteFile(blobKey(old.id)).catch(() => undefined);
  }

  return save;
};

export const listEmulationSaves = async (
  platform: EmulationSavePlatform,
  emulator: EmulationSaveEmulator,
  objectId?: string | null
): Promise<EmulationCloudSave[]> => {
  const status = await PersonalCloud.status().catch(() => null);
  if (!status?.signedIn) return [];
  const { saves } = await readIndex();
  return saves
    .filter(
      (save) =>
        save.platform === platform &&
        save.emulator === emulator &&
        (!objectId || save.objectId === objectId)
    )
    .sort(byNewest);
};

/** Fetches a save's raw bytes from Drive. */
export const downloadEmulationSaveBytes = async (
  id: string
): Promise<Buffer> => {
  await requireSignedIn();
  const bytes = await PersonalCloud.readFile(blobKey(id));
  if (!bytes) throw new Error("This save is no longer in Google Drive");
  return bytes;
};

export const deleteEmulationSave = async (id: string): Promise<void> => {
  await requireSignedIn();
  await editIndex((index) => {
    index.saves = index.saves.filter((save) => save.id !== id);
  });
  await PersonalCloud.deleteFile(blobKey(id));
};

export const updateEmulationSave = async (
  id: string,
  body: { label?: string | null; metadata?: Record<string, unknown> | null }
): Promise<EmulationCloudSave> => {
  await requireSignedIn();
  return editIndex((index) => {
    const save = index.saves.find((s) => s.id === id);
    if (!save) throw new Error("This save is no longer in Google Drive");
    if (body.label !== undefined) save.label = body.label;
    if (body.metadata !== undefined) save.metadata = body.metadata;
    save.updatedAt = new Date().toISOString();
    return save;
  });
};
