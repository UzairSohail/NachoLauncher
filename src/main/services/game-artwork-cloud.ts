import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { fileTypeFromFile } from "file-type";

import type { ArtworkAssetType, Game, GameShop } from "@types";

import { ASSETS_PATH } from "@main/constants";
import {
  db,
  gamesArtworkSelectionSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { logger } from "./logger";
import { PersonalCloud } from "./personal-cloud";

/*
 * Custom artwork used to sync through the Hydra account, for subscribers
 * only. It now syncs through the user's Google Drive with the rest of the
 * settings:
 *
 * - An uploaded image goes to `hydra/artwork/<sha256>.<ext>` in Drive.
 * - A SteamGridDB pick is just its URL.
 * - Each game's choice per artwork type is an entry in the Drive settings
 *   file (see settings-sync), so the latest change wins.
 *
 * This device's own choices are kept under `artworkSync` so settings sync can
 * tell what changed here.
 */

const MAX_ARTWORK_SIZE_IN_BYTES = 1024 * 1024 * 20;
const ALLOWED_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;
type AllowedImageExtension = (typeof ALLOWED_IMAGE_EXTENSIONS)[number];

const EXTENSION_BY_MIME: Record<string, AllowedImageExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type SyncedArtwork =
  | { source: "upload"; hash: string; ext: AllowedImageExtension }
  | { source: "steamgriddb"; url: string; artworkId: number | null };

/** Keyed by `<game key>/<type>`; null means cleared on this device. */
export type ArtworkSyncStore = Record<string, SyncedArtwork | null>;

type CustomAssetField =
  | "customIconUrl"
  | "customLogoImageUrl"
  | "customHeroImageUrl"
  | "customCoverImageUrl";

type CustomOriginalField =
  | "customOriginalIconPath"
  | "customOriginalLogoPath"
  | "customOriginalHeroPath"
  | "customOriginalCoverPath";

const FIELDS: Record<
  ArtworkAssetType,
  { url: CustomAssetField; original: CustomOriginalField }
> = {
  icon: { url: "customIconUrl", original: "customOriginalIconPath" },
  logo: { url: "customLogoImageUrl", original: "customOriginalLogoPath" },
  hero: { url: "customHeroImageUrl", original: "customOriginalHeroPath" },
  grid: { url: "customCoverImageUrl", original: "customOriginalCoverPath" },
};

const ARTWORK_TYPES = Object.keys(FIELDS) as ArtworkAssetType[];

export const artworkSyncKey = (gameKey: string, type: ArtworkAssetType) =>
  `${gameKey}/${type}`;

const parseArtworkSyncKey = (
  key: string
): [gameKey: string, type: ArtworkAssetType] | null => {
  const slash = key.lastIndexOf("/");
  if (slash < 0) return null;
  const type = key.slice(slash + 1) as ArtworkAssetType;
  return ARTWORK_TYPES.includes(type) ? [key.slice(0, slash), type] : null;
};

const blobKey = (hash: string, ext: string) => `hydra/artwork/${hash}.${ext}`;

export const readArtworkSyncStore = (): Promise<ArtworkSyncStore> =>
  db
    .get<string, ArtworkSyncStore | null>(levelKeys.artworkSync, {
      valueEncoding: "json",
    })
    .then((store) => store ?? {})
    .catch(() => ({}));

let storeQueue: Promise<unknown> = Promise.resolve();
const editStore = (edit: (store: ArtworkSyncStore) => void) => {
  const run = storeQueue.then(async () => {
    const store = await readArtworkSyncStore();
    edit(store);
    await db.put<string, ArtworkSyncStore>(levelKeys.artworkSync, store, {
      valueEncoding: "json",
    });
  });
  storeQueue = run.catch(() => undefined);
  return run;
};

const recordChoice = async (
  shop: GameShop,
  objectId: string,
  type: ArtworkAssetType,
  value: SyncedArtwork | null
) => {
  await editStore((store) => {
    store[artworkSyncKey(levelKeys.game(shop, objectId), type)] = value;
  });
  const { SettingsSync } = await import("./settings-sync");
  SettingsSync.scheduleSync();
};

const resolveImageExtension = async (
  localPath: string
): Promise<AllowedImageExtension | null> => {
  const rawExtension = path.extname(localPath).slice(1).toLowerCase();
  if ((ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(rawExtension)) {
    return rawExtension as AllowedImageExtension;
  }
  const fileType = await fileTypeFromFile(localPath);
  return fileType?.mime ? (EXTENSION_BY_MIME[fileType.mime] ?? null) : null;
};

const isSignedIn = async () =>
  (await PersonalCloud.status().catch(() => null))?.signedIn === true;

/** Uploads an image the user picked from their files. */
export const uploadCustomArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType,
  localUrl: string
): Promise<void> => {
  try {
    if (!(await isSignedIn())) return;
    const localPath = localUrl.startsWith("local:")
      ? localUrl.slice("local:".length)
      : null;
    if (!localPath) return;

    const stats = await fs.promises.stat(localPath).catch(() => null);
    if (!stats || stats.size <= 0 || stats.size > MAX_ARTWORK_SIZE_IN_BYTES) {
      return;
    }
    const ext = await resolveImageExtension(localPath);
    if (!ext) return;

    const data = await fs.promises.readFile(localPath);
    const hash = createHash("sha256").update(data).digest("hex");
    const key = blobKey(hash, ext);
    if (!(await PersonalCloud.readFile(key).catch(() => null))) {
      await PersonalCloud.writeFile(key, data);
    }
    await recordChoice(shop, objectId, assetType, {
      source: "upload",
      hash,
      ext,
    });
  } catch (error) {
    logger.error(
      `Failed to sync custom artwork for ${shop}/${objectId}:`,
      error
    );
  }
};

/** Records a SteamGridDB pick. Returns true once it is recorded. */
export const saveSteamGridDbArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType,
  url: string,
  artworkId: number | null = null
): Promise<boolean> => {
  try {
    await recordChoice(shop, objectId, assetType, {
      source: "steamgriddb",
      url,
      artworkId,
    });
    return true;
  } catch (error) {
    logger.error(
      `Failed to sync SteamGridDB artwork for ${shop}/${objectId}:`,
      error
    );
    return false;
  }
};

export const deleteCustomArtwork = async (
  shop: GameShop,
  objectId: string,
  assetType: ArtworkAssetType
): Promise<void> => {
  try {
    await recordChoice(shop, objectId, assetType, null);
  } catch (error) {
    logger.error(
      `Failed to clear custom artwork for ${shop}/${objectId}:`,
      error
    );
  }
};

const downloadArtwork = async (hash: string, ext: string, type: string) => {
  const data = await PersonalCloud.readFile(blobKey(hash, ext));
  if (!data) throw new Error("This artwork is no longer in Google Drive");
  if (createHash("sha256").update(data).digest("hex") !== hash) {
    throw new Error("Artwork in Google Drive is damaged");
  }
  const directory = path.join(ASSETS_PATH, "custom-games");
  await fs.promises.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${type}-${randomUUID()}.${ext}`);
  await fs.promises.writeFile(destination, data);
  return destination;
};

/**
 * Applies the synced artwork choices that differ from what this device has
 * recorded. A choice for a game that isn't here yet stays different, so it
 * is applied by a later sync once the game is added.
 */
export const applySyncedArtwork = async (
  changes: Record<string, SyncedArtwork | null>
): Promise<boolean> => {
  let updated = false;

  for (const [key, value] of Object.entries(changes)) {
    const parsed = parseArtworkSyncKey(key);
    if (!parsed) continue;
    const [gameKey, type] = parsed;
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    if (!game || game.isDeleted) continue;

    try {
      const fields = FIELDS[type];
      const previous = game[fields.url];
      const nextGame: Game = { ...game };
      const selection = await gamesArtworkSelectionSublevel
        .get(gameKey)
        .catch(() => null);
      const selected = { ...selection?.selected };

      if (value?.source === "upload") {
        const localPath = await downloadArtwork(value.hash, value.ext, type);
        nextGame[fields.url] = `local:${localPath}`;
        nextGame[fields.original] = null;
        delete selected[type];
      } else {
        nextGame[fields.url] = null;
        nextGame[fields.original] = null;
        if (value?.source === "steamgriddb") {
          selected[type] = { url: value.url, artworkId: value.artworkId ?? 0 };
        } else {
          delete selected[type];
        }
      }

      const batch = db.batch();
      batch.put(gameKey, nextGame, { sublevel: gamesSublevel });
      if (Object.keys(selected).length > 0) {
        batch.put(
          gameKey,
          {
            shop: game.shop,
            objectId: game.objectId,
            selected,
            updatedAt: Date.now(),
          },
          { sublevel: gamesArtworkSelectionSublevel }
        );
      } else {
        batch.del(gameKey, { sublevel: gamesArtworkSelectionSublevel });
      }
      await batch.write();

      if (
        typeof previous === "string" &&
        previous.startsWith("local:") &&
        previous !== nextGame[fields.url]
      ) {
        await fs.promises
          .unlink(previous.slice("local:".length))
          .catch(() => undefined);
      }

      await editStore((store) => {
        store[key] = value;
      });
      updated = true;
    } catch (error) {
      logger.warn(`Settings sync could not apply artwork ${key}`, error);
    }
  }

  return updated;
};
