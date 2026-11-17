import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AxiosError, AxiosHeaders } from "axios";

import type {
  CommitSnapshotResponse,
  GameShop,
  PrepareSnapshotRequest,
  RemoteSnapshotSummary,
  RestoreManifestFile,
  RestoreManifestResponse,
  SnapshotFile,
  SnapshotVariant,
} from "@types";

import { PersonalCloud } from "../personal-cloud";

/*
 * The emulator cloud saves (RPCS3, shadPS4, RetroArch) used to keep their
 * snapshots on Hydra Cloud, a paid service Nacho can't sign in to. This keeps
 * the same snapshot model in the user's own Google Drive instead:
 *
 *   hydra/cloud-saves/<game>/snapshot.json       the game's active snapshot
 *   hydra/cloud-saves/<game>/blobs/<sha256>.blob  file contents, by hash
 *
 * Like Hydra's API there is one active snapshot per game, its id stays the
 * same and its version goes up by one on every commit. A commit whose base
 * version is stale is refused with a 409, which the sync code already
 * handles as "someone else uploaded first". Blobs the new snapshot no longer
 * uses go to the Drive bin.
 */

const ROOT = "hydra/cloud-saves";

interface StoredSnapshot {
  schemaVersion: 1;
  id: string;
  shop: GameShop;
  objectId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  hostname: string | null;
  platform: string;
  aggregateHash: string;
  customPathRawPaths: string[];
  variants: SnapshotVariant[];
  files: SnapshotFile[];
}

interface PendingSnapshot {
  shop: GameShop;
  objectId: string;
  request: PrepareSnapshotRequest;
  uploads: Map<string, SnapshotFile>;
  createdAt: number;
}

const PENDING_TTL_MS = 60 * 60 * 1000;
const pending = new Map<string, PendingSnapshot>();

const gameFolder = (shop: GameShop, objectId: string) =>
  `${ROOT}/${encodeURIComponent(shop)}/${encodeURIComponent(objectId).replaceAll(".", "%2E")}`;
const snapshotKey = (shop: GameShop, objectId: string) =>
  `${gameFolder(shop, objectId)}/snapshot.json`;
const blobKey = (shop: GameShop, objectId: string, hash: string) =>
  `${gameFolder(shop, objectId)}/blobs/${hash}.blob`;

/** Snapshot ids carry their game, so a manifest can be found from the id. */
export const driveSnapshotId = (shop: GameShop, objectId: string) =>
  Buffer.from(JSON.stringify([shop, objectId]), "utf8").toString("base64url");

const parseSnapshotId = (id: string): [GameShop, string] => {
  try {
    const parsed = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string"
    ) {
      return parsed as [GameShop, string];
    }
  } catch {
    // Falls through to the error below.
  }
  throw new Error("Unknown cloud save snapshot");
};

const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

const conflictError = () =>
  new AxiosError(
    "Request failed with status code 409",
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    {
      status: 409,
      statusText: "Conflict",
      data: { code: "game/cloud-save-snapshot-version-conflict" },
      headers: {},
      config: { headers: new AxiosHeaders() },
    }
  );

const readSnapshot = async (
  shop: GameShop,
  objectId: string
): Promise<StoredSnapshot | null> => {
  const raw = await PersonalCloud.readFile(snapshotKey(shop, objectId));
  if (!raw) return null;
  const parsed = JSON.parse(raw.toString("utf8")) as StoredSnapshot;
  if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.files)) {
    throw new Error("The cloud save in Google Drive is unreadable");
  }
  return parsed;
};

const toSummary = (snapshot: StoredSnapshot): RemoteSnapshotSummary => ({
  id: snapshot.id,
  version: snapshot.version,
  createdAt: snapshot.createdAt,
  updatedAt: snapshot.updatedAt,
  fileCount: snapshot.files.length,
  totalSizeBytes: snapshot.files.reduce((sum, file) => sum + file.sizeBytes, 0),
  aggregateHash: snapshot.aggregateHash,
});

export const listDriveSnapshots = async (
  shop: GameShop,
  objectId: string
): Promise<RemoteSnapshotSummary[]> => {
  const snapshot = await readSnapshot(shop, objectId);
  return snapshot ? [toSummary(snapshot)] : [];
};

export const getDriveRestoreManifest = async (
  snapshotId: string
): Promise<RestoreManifestResponse> => {
  const [shop, objectId] = parseSnapshotId(snapshotId);
  const snapshot = await readSnapshot(shop, objectId);
  if (!snapshot || snapshot.id !== snapshotId) {
    throw new Error("This cloud save is no longer in Google Drive");
  }
  return {
    snapshot: {
      id: snapshot.id,
      version: snapshot.version,
      shop: snapshot.shop,
      objectId: snapshot.objectId,
    },
    customPathRawPaths: snapshot.customPathRawPaths,
    variants: snapshot.variants,
    files: snapshot.files,
  } as RestoreManifestResponse;
};

/**
 * Works out which files need uploading. Files whose contents the active
 * snapshot already holds are skipped.
 */
export const prepareDriveSnapshot = async (
  shop: GameShop,
  objectId: string,
  request: PrepareSnapshotRequest
): Promise<{
  pendingSnapshotId: string;
  uploadFiles: SnapshotFile[];
  skipFiles: SnapshotFile[];
}> => {
  const current = await readSnapshot(shop, objectId);
  if ((current?.version ?? 0) !== request.baseVersion) throw conflictError();

  const stored = new Set(current?.files.map((file) => file.hash) ?? []);
  const uploadFiles = request.files.filter((file) => !stored.has(file.hash));
  const skipFiles = request.files.filter((file) => stored.has(file.hash));

  for (const [id, entry] of pending) {
    if (Date.now() - entry.createdAt > PENDING_TTL_MS) pending.delete(id);
  }
  const pendingSnapshotId = `drive-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pending.set(pendingSnapshotId, {
    shop,
    objectId,
    request,
    uploads: new Map(uploadFiles.map((file) => [file.hash, file])),
    createdAt: Date.now(),
  });
  return { pendingSnapshotId, uploadFiles, skipFiles };
};

/** Uploads one local file's contents, checking it still matches its hash. */
export const uploadDriveBlob = async (
  pendingSnapshotId: string,
  file: Pick<SnapshotFile, "hash" | "sizeBytes">,
  absolutePath: string
) => {
  const entry = pending.get(pendingSnapshotId);
  if (!entry) throw new Error("cloud_save_upload_url_expired");
  const data = await fs.readFile(absolutePath);
  if (data.length !== file.sizeBytes || sha256(data) !== file.hash) {
    throw new Error("A save file changed while it was being uploaded");
  }
  await PersonalCloud.writeFile(
    blobKey(entry.shop, entry.objectId, file.hash),
    data
  );
};

export const commitDriveSnapshot = async (
  pendingSnapshotId: string
): Promise<CommitSnapshotResponse> => {
  const entry = pending.get(pendingSnapshotId);
  if (!entry) throw new Error("cloud_save_upload_url_expired");
  const { request, shop, objectId } = entry;

  const current = await readSnapshot(shop, objectId);
  if ((current?.version ?? 0) !== request.baseVersion) throw conflictError();

  const now = new Date().toISOString();
  const next: StoredSnapshot = {
    schemaVersion: 1,
    id: driveSnapshotId(shop, objectId),
    shop,
    objectId,
    version: request.baseVersion + 1,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    hostname: request.hostname ?? os.hostname() ?? null,
    platform: request.platform,
    aggregateHash: request.snapshotHash,
    customPathRawPaths: request.customPathRawPaths,
    variants: request.variants,
    files: request.files,
  };
  await PersonalCloud.writeFile(
    snapshotKey(shop, objectId),
    Buffer.from(JSON.stringify(next), "utf8")
  );
  pending.delete(pendingSnapshotId);

  const kept = new Set(next.files.map((file) => file.hash));
  const unused = new Set(
    (current?.files ?? [])
      .map((file) => file.hash)
      .filter((hash) => !kept.has(hash))
  );
  for (const hash of unused) {
    await PersonalCloud.deleteFile(blobKey(shop, objectId, hash)).catch(
      () => undefined
    );
  }

  const summary = toSummary(next);
  return {
    snapshotId: next.id,
    version: next.version,
    fileCount: summary.fileCount,
    totalSizeBytes: summary.totalSizeBytes,
    aggregateHash: next.aggregateHash,
  };
};

/**
 * Downloads one blob to the same temp location the native restore code uses,
 * so its cleanup still applies, and checks its hash.
 */
export const downloadDriveBlobToTemp = async (
  snapshotId: string,
  tempSnapshotId: string,
  file: Pick<RestoreManifestFile, "hash" | "sizeBytes">,
  tempRoot: string
): Promise<string> => {
  const [shop, objectId] = parseSnapshotId(snapshotId);
  const data = await PersonalCloud.readFile(blobKey(shop, objectId, file.hash));
  if (!data) throw new Error("A cloud save file is missing from Google Drive");
  if (data.length !== file.sizeBytes || sha256(data) !== file.hash) {
    throw new Error("A cloud save file in Google Drive is damaged");
  }
  const directory = path.join(tempRoot, "hydra-cloud-saves", tempSnapshotId);
  await fs.mkdir(directory, { recursive: true });
  const finalPath = path.join(directory, `${file.hash}.blob`);
  const partialPath = `${finalPath}.part`;
  await fs.writeFile(partialPath, data);
  await fs.rename(partialPath, finalPath);
  return finalPath;
};

/** Removes a game's cloud save from Drive (to the bin). */
export const deleteDriveSnapshots = async (
  shop: GameShop,
  objectId: string
): Promise<void> => {
  const current = await readSnapshot(shop, objectId);
  if (!current) return;
  await PersonalCloud.deleteFile(snapshotKey(shop, objectId));
  for (const hash of new Set(current.files.map((file) => file.hash))) {
    await PersonalCloud.deleteFile(blobKey(shop, objectId, hash)).catch(
      () => undefined
    );
  }
};
