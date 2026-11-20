import fs from "node:fs";
import path from "node:path";
import { Notification } from "electron";
import { t } from "i18next";

import {
  downloadsSublevel,
  downloadSourcesSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import {
  DownloadError,
  findGameUpdate,
  findRepackByUri,
  toInstalledRepackInfo,
  type GameUpdateInfo,
  type InstalledRepackInfo,
} from "@shared";
import type { Download, Game, GameRepack } from "@types";
import {
  findSourceArchiveFile,
  listArchiveVolumes,
} from "@main/helpers/find-game-installer";

import { HydraApi } from "./hydra-api";
import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import { updateGameRecord } from "./game-record-updater";
import { isGameRunning } from "./game-running-state";
import { PersonalCloud } from "./personal-cloud";
import { LocalNotificationManager } from "./notifications/local-notifications";

// Soon after start-up, so a short session on a handheld still gets a check.
const FIRST_CHECK_DELAY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DELAY_BETWEEN_GAMES_MS = 500;
const LISTING_DATE_SLACK_MS = 24 * 60 * 60 * 1000;

const PREVIOUS_SUFFIX = " (previous version)";

const isInside = (target: string, folder: string) => {
  const relative = path.relative(folder, target);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

/** Re-points a path inside `from` to the same place inside `to`. */
const moveInto = (
  target: string | null | undefined,
  from: string | null,
  to: string | null
) => {
  if (!target) return null;
  if (!from || !to || !isInside(target, from)) return target;
  return path.join(to, path.relative(from, target));
};

/** The path itself, or the path with a number added when it's taken. */
const freePath = async (target: string) => {
  let candidate = target;
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = `${target} ${n}`;
  }
  return candidate;
};

const deleteSourceArchives = async (download: Download) => {
  const archive = await findSourceArchiveFile(download).catch(() => null);
  if (!archive) return;
  const volumes = await listArchiveVolumes(archive).catch(() => []);
  await Promise.all(
    volumes.map((volume) =>
      fs.promises
        .rm(volume, { force: true })
        .catch((error) =>
          logger.error("[Game Updates] Could not remove old archive", error)
        )
    )
  );
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const hostOf = (uri: string) => {
  try {
    return new URL(uri).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
};

/**
 * Stand-ins for the listing a game was installed from, when that listing is
 * gone: one per source that shares the download's host (or the only source
 * listing the game), dated when the download started, so any listing
 * uploaded after it counts as newer.
 */
const inferInstalledRepacks = (
  game: Game,
  download: Download,
  repacks: GameRepack[]
): InstalledRepackInfo[] => {
  if (!download.timestamp || repacks.length === 0) return [];

  const host = hostOf(download.uri);
  const matching = host
    ? repacks.filter((repack) =>
        [...repack.uris, ...(repack.uriGroups ?? []).flat()].some(
          (uri) => hostOf(uri) === host
        )
      )
    : [];
  const sourceIds = new Set(repacks.map((repack) => repack.downloadSourceId));
  const fromSources =
    matching.length > 0 ? matching : sourceIds.size === 1 ? repacks : [];

  const sources = new Map<string, string>();
  for (const repack of fromSources) {
    sources.set(repack.downloadSourceId, repack.downloadSourceName);
  }

  return [...sources].map(([downloadSourceId, downloadSourceName]) =>
    installedAsOfDownload(game, download, downloadSourceId, downloadSourceName)
  );
};

/** A download started at this time, as a stand-in for its listing. */
const installedAsOfDownload = (
  game: Game,
  download: Download,
  downloadSourceId: string,
  downloadSourceName: string
): InstalledRepackInfo => {
  const downloadedAt = new Date(download.timestamp).toISOString();
  return {
    id: "",
    title: game.title,
    downloadSourceId,
    downloadSourceName,
    uploadDate: downloadedAt,
    createdAt: downloadedAt,
    // Left out on purpose: the listing that still carries this link was
    // changed after the download, so it's a newer version, not a re-listing.
    uri: null,
  };
};

/**
 * Whether a listing was uploaded after the download started. The download
 * can't be that version: the source changed the listing (often keeping the
 * same link) after the game was downloaded.
 */
const listedAfterDownload = (
  listing: { uploadDate: string | null; createdAt?: string | null },
  download: Download | undefined
) => {
  if (!download?.timestamp) return false;
  const listedAt = Date.parse(listing.uploadDate ?? listing.createdAt ?? "");
  // A day's slack, since sources often give dates without a time zone.
  return (
    !Number.isNaN(listedAt) &&
    listedAt > download.timestamp + LISTING_DATE_SLACK_MS
  );
};

const catalogueIdentity = (game: Game) =>
  game.catalogueGame ?? { shop: game.shop, objectId: game.objectId };

/**
 * Watches the download sources installed games came from and flags a game
 * when its source lists a newer version, so it can be updated in place.
 */
export class GameUpdates {
  private static timer: NodeJS.Timeout | null = null;
  private static checking: Promise<void> | null = null;

  public static start() {
    if (this.timer) return;
    setTimeout(() => void this.checkAll(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => void this.checkAll(), CHECK_INTERVAL_MS);
  }

  private static async fetchRepacks(game: Game, downloadSourceIds: string[]) {
    const { shop, objectId } = catalogueIdentity(game);
    const repacks = await HydraApi.get<GameRepack[]>(
      `/games/${shop}/${objectId}/download-sources`,
      { take: 100, skip: 0, downloadSourceIds }
    );
    return Array.isArray(repacks) ? repacks : [];
  }

  /**
   * Works out which listing an older install came from, by its link. When
   * the source has already replaced that listing with a newer one, the link
   * is nowhere to be found, so this falls back to what the download itself
   * tells us: which source shares its host, and when it was downloaded. That
   * guess is used for this check only and is never saved.
   */
  private static async findInstalledRepack(
    game: Game,
    download: Download | undefined,
    sourceIds: string[]
  ): Promise<InstalledRepackInfo[]> {
    const gameKey = levelKeys.game(game.shop, game.objectId);
    if (game.installedRepack) {
      if (
        game.installedRepack.chosenAtDownload ||
        !listedAfterDownload(game.installedRepack, download)
      ) {
        return [game.installedRepack];
      }
      // Saved by an earlier check that matched a listing the source had
      // already moved on to a newer version, so it names a version that
      // isn't the one installed.
      logger.info(
        "[Game Updates] Dropping a newer listing saved as installed",
        {
          shop: game.shop,
          objectId: game.objectId,
          title: game.installedRepack.title,
        }
      );
      await updateGameRecord(gameKey, { installedRepack: null });
    }
    if (!download?.uri) return [];

    const repacks = await this.fetchRepacks(game, sourceIds);
    const repack = findRepackByUri(repacks, download.uri);
    if (repack && listedAfterDownload(repack, download)) {
      return [
        installedAsOfDownload(
          game,
          download,
          repack.downloadSourceId,
          repack.downloadSourceName
        ),
      ];
    }
    if (repack) {
      const installedRepack = toInstalledRepackInfo(repack, download.uri);
      await updateGameRecord(gameKey, { installedRepack });
      return [installedRepack];
    }

    return inferInstalledRepacks(game, download, repacks);
  }

  private static isInstalled(game: Game, download: Download | undefined) {
    if (game.isDeleted || game.shop === "custom") return false;
    if (download) {
      return download.status === "complete" || download.status === "seeding";
    }
    return Boolean(game.installedRepack && game.executablePath);
  }

  /** Checks one game and returns the update it found, if it's a new one. */
  private static async checkGame(
    game: Game,
    sourceIds: string[]
  ): Promise<GameUpdateInfo | null> {
    const gameKey = levelKeys.game(game.shop, game.objectId);
    const download = await downloadsSublevel.get(gameKey).catch(() => null);
    if (!this.isInstalled(game, download ?? undefined)) return null;

    const candidates = (
      await this.findInstalledRepack(game, download ?? undefined, sourceIds)
    ).filter((installed) => sourceIds.includes(installed.downloadSourceId));

    let repack: GameRepack | null = null;
    for (const installed of candidates) {
      const repacks = await this.fetchRepacks(game, [
        installed.downloadSourceId,
      ]);
      repack = findGameUpdate(installed, repacks);
      if (repack) break;
    }

    const isSkipped =
      repack !== null &&
      repack.id === game.skippedUpdateRepackId &&
      (!game.skippedUpdateTitle || repack.title === game.skippedUpdateTitle);

    if (!repack || isSkipped) {
      if (game.availableUpdate) {
        await updateGameRecord(gameKey, { availableUpdate: null });
      }
      return null;
    }

    if (
      game.availableUpdate?.id === repack.id &&
      game.availableUpdate.title === repack.title
    ) {
      return null;
    }

    const update: GameUpdateInfo = {
      ...toInstalledRepackInfo(repack),
      fileSize: repack.fileSize,
      detectedAt: new Date().toISOString(),
    };
    await updateGameRecord(gameKey, { availableUpdate: update });
    return update;
  }

  public static checkAll(): Promise<void> {
    this.checking ??= (async () => {
      try {
        const sources = await downloadSourcesSublevel.values().all();
        const sourceIds = sources.map((source) => source.id);
        if (sourceIds.length === 0) return;

        const games = await gamesSublevel.values().all();
        const found: { game: Game; update: GameUpdateInfo }[] = [];

        for (const game of games) {
          try {
            const update = await this.checkGame(game, sourceIds);
            if (update) {
              found.push({ game, update });
              logger.info("[Game Updates] Newer version found", {
                shop: game.shop,
                objectId: game.objectId,
                installed: game.installedRepack?.title,
                available: update.title,
              });
            }
          } catch (error) {
            logger.warn("[Game Updates] Check failed", {
              shop: game.shop,
              objectId: game.objectId,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          await wait(DELAY_BETWEEN_GAMES_MS);
        }

        if (found.length > 0) {
          WindowManager.sendToAppWindows("on-library-batch-complete");
          await this.notify(found);
        }
      } catch (error) {
        logger.error("[Game Updates] Check failed", error);
      } finally {
        this.checking = null;
      }
    })();
    return this.checking;
  }

  /**
   * Adds each update to the in-app notifications, but shows a single desktop
   * notification for the whole check so several updates don't pile up.
   */
  private static async notify(found: { game: Game; update: GameUpdateInfo }[]) {
    for (const { game, update } of found) {
      await LocalNotificationManager.createNotification(
        "GAME_UPDATE_AVAILABLE",
        t("game_update_available", {
          ns: "notifications",
          title: game.title,
        }),
        t("game_update_available_description", {
          ns: "notifications",
          version: update.title,
          source: update.downloadSourceName,
        }),
        {
          pictureUrl: game.iconUrl,
          url: `/game/${game.shop}/${game.objectId}`,
        }
      );
    }

    if (found.length === 1) {
      const [{ game, update }] = found;
      const url = `/game/${game.shop}/${game.objectId}`;
      new Notification({
        title: t("game_update_available", {
          ns: "notifications",
          title: game.title,
        }),
        body: t("game_update_available_description", {
          ns: "notifications",
          version: update.title,
          source: update.downloadSourceName,
        }),
      })
        .on("click", () => WindowManager.redirect(url))
        .show();
      return;
    }

    new Notification({
      title: t("game_updates_available", {
        ns: "notifications",
        count: found.length,
      }),
      body: found.map(({ game }) => game.title).join(", "),
    })
      .on("click", () => WindowManager.redirect("/library"))
      .show();
  }

  /** The listing for the update a game has waiting, if it's still listed. */
  public static async getUpdateRepack(
    shop: Game["shop"],
    objectId: string
  ): Promise<GameRepack | null> {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    const update = game?.availableUpdate;
    if (!game || !update) return null;
    const repacks = await this.fetchRepacks(game, [update.downloadSourceId]);
    return repacks.find((repack) => repack.id === update.id) ?? null;
  }

  /** Stops offering this version. A later one is still offered. */
  public static async skipUpdate(shop: Game["shop"], objectId: string) {
    await updateGameRecord(levelKeys.game(shop, objectId), (game) => ({
      skippedUpdateRepackId: game.availableUpdate?.id ?? null,
      skippedUpdateTitle: game.availableUpdate?.title ?? null,
      availableUpdate: null,
    }));
  }

  /**
   * Backs up the game's saves to Google Drive, then moves the installed
   * version's folder aside so the new one can be downloaded without touching
   * it. The old version stays playable until the new one has finished, and
   * comes back if the update is cancelled. Saves that live outside the game
   * folder are never touched.
   */
  public static async setAsideInstalledVersion(
    shop: Game["shop"],
    objectId: string
  ): Promise<boolean> {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey);
    if (!game) return false;

    if (isGameRunning(objectId, shop)) {
      throw new Error(DownloadError.UpdateGameRunning);
    }

    if (game.executablePath && (await PersonalCloud.isSyncing())) {
      try {
        const result = await PersonalCloud.syncNow(shop, objectId);
        logger.info("[Game Updates] Saves backed up before update", {
          shop,
          objectId,
          result,
        });
      } catch (error) {
        logger.error("[Game Updates] Save backup failed, not updating", error);
        throw new Error(DownloadError.UpdateSaveBackupFailed);
      }
    }

    // An earlier update that never finished already holds the version that
    // is actually playable, so keep that one.
    if (game.previousInstall) return false;

    const download = await downloadsSublevel.get(gameKey).catch(() => null);
    const originalFolderPath =
      download?.folderName && download.downloadPath
        ? path.join(download.downloadPath, download.folderName)
        : null;

    let folderPath: string | null = null;
    if (originalFolderPath && fs.existsSync(originalFolderPath)) {
      folderPath = await freePath(`${originalFolderPath}${PREVIOUS_SUFFIX}`);
      await fs.promises.rename(originalFolderPath, folderPath);
      // The old archive isn't needed to play, and a new archive with the
      // same name would otherwise look already downloaded.
      await deleteSourceArchives(download!);
    }

    await updateGameRecord(gameKey, (current) => ({
      previousInstall: {
        folderPath,
        originalFolderPath,
        download: download ?? null,
        installedRepack: current.installedRepack ?? null,
        executablePath: current.executablePath ?? null,
      },
      executablePath: moveInto(
        current.executablePath,
        originalFolderPath,
        folderPath
      ),
    }));
    logger.info("[Game Updates] Kept the installed version aside", {
      shop,
      objectId,
      folderPath,
    });
    return true;
  }

  /**
   * Once the new version is in place, removes the old one and points the
   * game at the new files. Waits while the old version is being played.
   */
  public static async finishUpdate(shop: Game["shop"], objectId: string) {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    const previous = game?.previousInstall;
    if (!game || !previous) return;
    if (isGameRunning(objectId, shop)) return;

    const download = await downloadsSublevel.get(gameKey).catch(() => null);
    const newFolderPath =
      download?.folderName && download.downloadPath
        ? path.join(download.downloadPath, download.folderName)
        : null;

    if (previous.folderPath && previous.folderPath !== newFolderPath) {
      await fs.promises
        .rm(previous.folderPath, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        })
        .catch((error) =>
          logger.error("[Game Updates] Could not remove the old version", error)
        );
    }

    await updateGameRecord(gameKey, (current) => {
      const executableWasMoved =
        previous.folderPath !== null &&
        current.executablePath !== null &&
        current.executablePath !== undefined &&
        isInside(current.executablePath, previous.folderPath);

      let executablePath = current.executablePath ?? null;
      if (executableWasMoved) {
        // Same file name in the new version's folder, when it has one.
        const candidate = moveInto(
          current.executablePath,
          previous.folderPath,
          newFolderPath
        );
        executablePath =
          candidate &&
          candidate !== current.executablePath &&
          fs.existsSync(candidate)
            ? candidate
            : null;
      }

      return { previousInstall: null, executablePath };
    });
    logger.info("[Game Updates] Update finished", { shop, objectId });
  }

  /** Puts the old version back when its update is cancelled. */
  public static async restorePreviousVersion(
    shop: Game["shop"],
    objectId: string
  ) {
    const gameKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(gameKey).catch(() => null);
    const previous = game?.previousInstall;
    if (!game || !previous) return;

    let restoredFolderPath = previous.folderPath;
    if (
      previous.folderPath &&
      previous.originalFolderPath &&
      fs.existsSync(previous.folderPath) &&
      !fs.existsSync(previous.originalFolderPath)
    ) {
      await fs.promises
        .rename(previous.folderPath, previous.originalFolderPath)
        .then(() => {
          restoredFolderPath = previous.originalFolderPath;
        })
        .catch((error) =>
          logger.error(
            "[Game Updates] Could not move the old version back",
            error
          )
        );
    }

    if (previous.download) {
      await downloadsSublevel.put(gameKey, {
        ...previous.download,
        folderName:
          restoredFolderPath && previous.download.downloadPath
            ? path.relative(previous.download.downloadPath, restoredFolderPath)
            : previous.download.folderName,
        queued: false,
        pinnedToHero: false,
      });
    }

    await updateGameRecord(gameKey, {
      previousInstall: null,
      installedRepack: previous.installedRepack,
      executablePath: moveInto(
        previous.executablePath,
        previous.originalFolderPath,
        restoredFolderPath
      ),
    });
    WindowManager.sendDownloadsUpdated();
    logger.info("[Game Updates] Update cancelled, old version restored", {
      shop,
      objectId,
    });
  }

  /** Finishes updates that completed while their old version was running. */
  public static async finishCompletedUpdates() {
    const games = await gamesSublevel.values().all();
    for (const game of games) {
      if (!game.previousInstall) continue;
      const download = await downloadsSublevel
        .get(levelKeys.game(game.shop, game.objectId))
        .catch(() => null);
      if (download?.status === "complete" && !download.extracting) {
        try {
          await this.finishUpdate(game.shop, game.objectId);
          const { GameFilesManager } = await import("./game-files-manager");
          await new GameFilesManager(
            game.shop,
            game.objectId
          ).searchAndBindExecutable();
        } catch (error) {
          logger.error("[Game Updates] Could not finish update", error);
        }
      }
    }
  }

  /** Remembers which listing a new download came from. */
  public static async recordInstalledRepack(
    shop: Game["shop"],
    objectId: string,
    repack: InstalledRepackInfo
  ) {
    await updateGameRecord(levelKeys.game(shop, objectId), {
      installedRepack: { ...repack, chosenAtDownload: true },
      availableUpdate: null,
      skippedUpdateRepackId: null,
      skippedUpdateTitle: null,
    });
  }
}
