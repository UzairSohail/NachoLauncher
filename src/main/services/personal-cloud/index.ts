import path from "node:path";

import { shell } from "electron";

import { db, gamesSublevel, levelKeys } from "@main/level";
import {
  isCloudSaveBackupDue,
  normalizeCloudSaveBackupInterval,
} from "@shared";
import type {
  Game,
  GameShop,
  PersonalCloudDeviceCode,
  PersonalCloudLastSync,
  PersonalCloudGameState,
  PersonalCloudLinkResult,
  PersonalCloudStatus,
  PersonalCloudSyncEvent,
  PersonalCloudSyncResult,
  UserPreferences,
} from "@types";

import { isGameRunning } from "../game-running-state";
import { logger } from "../logger";
import { NativeAddon } from "../native-addon";
import { Wine } from "../wine";
import { WindowManager } from "../window-manager";

import { createAppFolderGate } from "./app-folder";
import {
  getPersonalCloudLinkInput,
  PRE_LAUNCH_SYNC_TIMEOUT_MS,
  PRE_LAUNCH_TIMEOUT_ERROR,
} from "./policy";

export * from "./policy";

const native = () => NativeAddon.personalCloud();

const ensureAppFolder = createAppFolderGate(
  () => native().personalCloudMoveLegacyFolder(),
  (result) =>
    logger.info("[Personal Cloud] Moved the old hydra folder to Nacho", result)
);

/** How often running games are checked for a due backup. */
const BACKUP_TICK_MS = 60_000;

interface PlaySession {
  game: Game;
  lastBackupAt: number;
  running: Promise<void> | null;
  /** Set once a backup uploaded, so only the first one pins the old save. */
  pushed: boolean;
  pinnedVersionId: string | null;
  /** Versions the backups uploaded, replaced by the sync after exit. */
  backupVersionIds: string[];
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Cloud saves through Cloud Save Manager. Hydra shares this device's Google
 * sign-in, catalogue and sync state with the Cloud Save Manager app, so saves
 * made through Hydra show up on the user's other devices, and the reverse.
 */
export class PersonalCloud {
  /** Hydra game key to Cloud Save Manager game id, linked this session. */
  private static links = new Map<string, { exePath: string; gameId: string }>();
  private static startedAt = new Map<string, number>();
  private static signingIn: Promise<PersonalCloudStatus> | null = null;
  private static pulling = new Set<string>();
  private static sessions = new Map<string, PlaySession>();
  private static backupTimer: NodeJS.Timeout | null = null;

  public static status(): Promise<PersonalCloudStatus> {
    return native().personalCloudStatus();
  }

  /** Opens Google sign-in in the browser and waits for it to finish. */
  public static signIn(): Promise<PersonalCloudStatus> {
    this.signingIn ??= (async () => {
      try {
        const url = await native().personalCloudBeginSignIn();
        await shell.openExternal(url);
        await native().personalCloudFinishSignIn();
        return await this.status();
      } finally {
        this.signingIn = null;
      }
    })();
    return this.signingIn;
  }

  /**
   * Starts sign-in from a phone: returns a code (and QR code) for the user to
   * enter at Google's device page. Finish with `finishPhoneSignIn`.
   */
  public static beginPhoneSignIn(): Promise<PersonalCloudDeviceCode> {
    return native().personalCloudBeginDeviceSignIn();
  }

  /** Waits until the user approves on their phone, declines, or the code expires. */
  public static async finishPhoneSignIn(): Promise<PersonalCloudStatus> {
    await native().personalCloudFinishDeviceSignIn();
    return this.status();
  }

  public static cancelPhoneSignIn() {
    native().personalCloudCancelDeviceSignIn();
  }

  /** True when cloud saves are signed in and not paused. Never throws. */
  public static async isSyncing() {
    try {
      const status = await this.status();
      return status.signedIn && !status.paused;
    } catch {
      return false;
    }
  }

  public static async setPaused(paused: boolean) {
    await native().personalCloudSetPaused(paused);
    return this.status();
  }

  private static async linkGame(
    game: Game
  ): Promise<PersonalCloudLinkResult | null> {
    const input = getPersonalCloudLinkInput(game, {
      platform: process.platform,
      winePrefixPath:
        process.platform === "linux"
          ? Wine.getEffectivePrefixPath(game.winePrefixPath, game.objectId)
          : null,
    });
    if (!input) return null;
    const key = levelKeys.game(game.shop, game.objectId);
    const cached = this.links.get(key);
    // Re-linking also picks up a catalogue entry another device added.
    const result = await native().personalCloudLinkGame(input);
    if (cached?.gameId !== result.gameId) {
      logger.info("[Personal Cloud] Linked game", {
        shop: game.shop,
        objectId: game.objectId,
        gameId: result.gameId,
        inCatalogue: result.inCatalogue,
      });
    }
    this.links.set(key, { exePath: input.exePath, gameId: result.gameId });
    return result;
  }

  private static async getGame(shop: GameShop, objectId: string) {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));
    if (!game) throw new Error("Game not found");
    return game;
  }

  private static async requireGameId(shop: GameShop, objectId: string) {
    const game = await this.getGame(shop, objectId);
    const link = await this.linkGame(game);
    if (!link) throw new Error("Choose the game's executable first");
    return link.gameId;
  }

  public static async getGameState(
    shop: GameShop,
    objectId: string
  ): Promise<PersonalCloudGameState> {
    const status = await this.status();
    if (!status.signedIn) return { status, info: null };
    const game = await this.getGame(shop, objectId);
    const link = await this.linkGame(game);
    if (!link) return { status, info: null };
    const info = await native().personalCloudGameInfo(link.gameId);
    if (info.status === "cloud_newer" && !status.paused) {
      void this.pullNewerSave(game);
    }
    return { status, info };
  }

  /**
   * Downloads a newer cloud save as soon as Nacho notices it, so the game is
   * already up to date before it's launched. Never while the game is running.
   */
  private static async pullNewerSave(game: Game) {
    const key = levelKeys.game(game.shop, game.objectId);
    if (this.pulling.has(key) || isGameRunning(game.objectId, game.shop)) {
      return;
    }
    this.pulling.add(key);
    try {
      await this.runSync(game, "auto", (gameId) =>
        native().personalCloudSync(gameId, false)
      );
    } finally {
      this.pulling.delete(key);
    }
  }

  private static notify(event: PersonalCloudSyncEvent) {
    WindowManager.sendToAppWindows("on-personal-cloud-sync", event);
    void this.recordLastSync(event);
  }

  private static async recordLastSync(event: PersonalCloudSyncEvent) {
    try {
      const game = await this.getGame(event.shop, event.objectId).catch(
        () => null
      );
      const record: PersonalCloudLastSync = {
        ...event,
        at: Date.now(),
        title: game?.title ?? null,
      };
      await db.put<string, PersonalCloudLastSync>(
        levelKeys.personalCloudLastSync,
        record,
        { valueEncoding: "json" }
      );
    } catch (error) {
      logger.warn("[Personal Cloud] Couldn't record the last sync", {
        error: errorMessage(error),
      });
    }
  }

  /** The last cloud save sync on this device, if any. */
  public static async getLastSync(): Promise<PersonalCloudLastSync | null> {
    return db
      .get<
        string,
        PersonalCloudLastSync | null
      >(levelKeys.personalCloudLastSync, { valueEncoding: "json" })
      .catch(() => null);
  }

  private static async runSync(
    game: Game,
    phase: PersonalCloudSyncEvent["phase"],
    work: (gameId: string) => Promise<PersonalCloudSyncResult>
  ): Promise<PersonalCloudSyncResult | null> {
    const base = { shop: game.shop, objectId: game.objectId, phase };
    try {
      if (!(await this.status()).signedIn) return null;
      const link = await this.linkGame(game);
      if (!link) return null;
      const result = await work(link.gameId);
      logger.info("[Personal Cloud] Sync finished", { ...base, ...result });
      this.notify({ ...base, result, error: null });
      return result;
    } catch (error) {
      logger.error("[Personal Cloud] Sync failed", {
        ...base,
        error: errorMessage(error),
      });
      this.notify({ ...base, result: null, error: errorMessage(error) });
      return null;
    }
  }

  /**
   * Pulls a newer save from the cloud before the game starts. It never blocks
   * the launch: a failure or a slow connection just starts the game.
   */
  public static async syncBeforeLaunch(game: Game) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        logger.warn("[Personal Cloud] Pre-launch sync is slow, starting game", {
          shop: game.shop,
          objectId: game.objectId,
        });
        this.notify({
          shop: game.shop,
          objectId: game.objectId,
          phase: "pre-launch",
          result: null,
          error: PRE_LAUNCH_TIMEOUT_ERROR,
        });
        resolve(null);
      }, PRE_LAUNCH_SYNC_TIMEOUT_MS);
    });
    try {
      return await Promise.race([
        this.runSync(game, "pre-launch", (gameId) =>
          native().personalCloudSync(gameId, false)
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private static async getBackupIntervalMinutes() {
    const preferences = await db
      .get<string, UserPreferences | null>(levelKeys.userPreferences, {
        valueEncoding: "json",
      })
      .catch(() => null);
    return normalizeCloudSaveBackupInterval(
      preferences?.cloudSaveBackupIntervalMinutes
    );
  }

  private static startBackupTimer() {
    if (this.backupTimer) return;
    this.backupTimer = setInterval(
      () => void this.backupDueGames(),
      BACKUP_TICK_MS
    );
  }

  private static stopBackupTimerIfIdle() {
    if (this.sessions.size > 0 || !this.backupTimer) return;
    clearInterval(this.backupTimer);
    this.backupTimer = null;
  }

  /** Backs up every running game whose interval has passed. */
  private static async backupDueGames() {
    const interval = await this.getBackupIntervalMinutes();
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.running) continue;
      if (!isCloudSaveBackupDue(interval, session.lastBackupAt, now)) continue;
      session.lastBackupAt = now;
      session.running = this.backupWhilePlaying(session).finally(() => {
        session.running = null;
      });
    }
  }

  /**
   * Uploads changed saves while the game runs, so another device gets recent
   * progress even if this one sleeps or dies mid-session. It only uploads; a
   * newer cloud save or a conflict waits for the sync after the game exits.
   */
  private static async backupWhilePlaying(session: PlaySession) {
    const { game } = session;
    const native_ = native();
    if (typeof native_.personalCloudBackupWhilePlaying !== "function") return;
    try {
      if (!(await this.status()).signedIn) return;
      const key = levelKeys.game(game.shop, game.objectId);
      const gameId =
        this.links.get(key)?.gameId ?? (await this.linkGame(game))?.gameId;
      if (!gameId) return;
      const result = await native_.personalCloudBackupWhilePlaying(
        gameId,
        !session.pushed
      );
      if (result.pinnedVersionId) {
        session.pinnedVersionId = result.pinnedVersionId;
      }
      if (result.outcome === "pushed") {
        session.pushed = true;
        if (result.versionId) session.backupVersionIds.push(result.versionId);
      }
      logger.info("[Personal Cloud] Backup while playing", {
        shop: game.shop,
        objectId: game.objectId,
        ...result,
      });
    } catch (error) {
      logger.warn("[Personal Cloud] Backup while playing failed", {
        shop: game.shop,
        objectId: game.objectId,
        error: errorMessage(error),
      });
    }
  }

  /** Removes the session's stand-in backups and unpins the old save. */
  private static async finishBackupSession(
    gameId: string,
    session: PlaySession
  ) {
    if (!session.pinnedVersionId && session.backupVersionIds.length === 0) {
      return;
    }
    try {
      await native().personalCloudFinishBackupSession(
        gameId,
        session.pinnedVersionId,
        session.backupVersionIds
      );
    } catch (error) {
      logger.warn("[Personal Cloud] Couldn't tidy up the session backups", {
        gameId,
        error: errorMessage(error),
      });
    }
  }

  /** Marks the game as playing, so the Cloud Save Manager app leaves it alone. */
  public static async onGameStarted(game: Game) {
    const key = levelKeys.game(game.shop, game.objectId);
    if (!this.startedAt.has(key)) this.startedAt.set(key, Date.now());
    if (!this.sessions.has(key)) {
      this.sessions.set(key, {
        game,
        lastBackupAt: Date.now(),
        running: null,
        pushed: false,
        pinnedVersionId: null,
        backupVersionIds: [],
      });
      this.startBackupTimer();
    }
    try {
      if (!(await this.status()).signedIn) return;
      const link = await this.linkGame(game);
      if (link) native().personalCloudPlayingStart(link.gameId);
    } catch (error) {
      logger.error("[Personal Cloud] Couldn't mark the game as playing", {
        shop: game.shop,
        objectId: game.objectId,
        error: errorMessage(error),
      });
    }
  }

  /**
   * Uploads the session's saves once the game exits. A game Cloud Save Manager
   * doesn't know yet has its saves found from what changed while playing.
   */
  public static async onGameClosed(game: Game) {
    const key = levelKeys.game(game.shop, game.objectId);
    const startedAt = this.startedAt.get(key) ?? Date.now();
    this.startedAt.delete(key);
    const session = this.sessions.get(key);
    this.sessions.delete(key);
    this.stopBackupTimerIfIdle();
    // A backup still uploading would race the exit sync for the cloud head.
    await session?.running;
    const cached = this.links.get(key);
    if (cached) {
      try {
        native().personalCloudPlayingStop(cached.gameId);
      } catch (error) {
        logger.error("[Personal Cloud] Couldn't clear the playing marker", {
          error: errorMessage(error),
        });
      }
    }
    const result = await this.runSync(game, "post-exit", async (gameId) => {
      const result = await native().personalCloudSync(gameId, true);
      if (result.outcome !== "not_in_catalogue") return result;
      return native().personalCloudLearnAfterPlay(gameId, startedAt);
    });
    const gameId = this.links.get(key)?.gameId;
    if (session && gameId) await this.finishBackupSession(gameId, session);
    return result;
  }

  public static async syncNow(shop: GameShop, objectId: string) {
    const gameId = await this.requireGameId(shop, objectId);
    const result = await native().personalCloudSync(gameId, false);
    this.notify({ shop, objectId, phase: "manual", result, error: null });
    return result;
  }

  public static async forceUpload(shop: GameShop, objectId: string) {
    return native().personalCloudForceUpload(
      await this.requireGameId(shop, objectId)
    );
  }

  public static async forceDownload(shop: GameShop, objectId: string) {
    return native().personalCloudForceDownload(
      await this.requireGameId(shop, objectId)
    );
  }

  public static async restoreVersion(
    shop: GameShop,
    objectId: string,
    versionId: string
  ) {
    return native().personalCloudRestoreVersion(
      await this.requireGameId(shop, objectId),
      versionId
    );
  }

  public static async deleteVersion(
    shop: GameShop,
    objectId: string,
    versionId: string
  ) {
    return native().personalCloudDeleteVersion(
      await this.requireGameId(shop, objectId),
      versionId
    );
  }

  /** Starts syncing a game from a save folder the user picked. */
  public static async useSaveFolder(
    shop: GameShop,
    objectId: string,
    folder: string
  ) {
    const game = await this.getGame(shop, objectId);
    const gameId = await this.requireGameId(shop, objectId);
    await native().personalCloudAdoptGame(
      gameId,
      game.title || path.basename(folder),
      folder
    );
    return this.syncNow(shop, objectId);
  }

  /** Reads one of Nacho Launcher's own files in the Drive folder, under `Nacho/`. */
  public static async readFile(key: string) {
    await ensureAppFolder();
    return native().personalCloudReadFile(key);
  }

  public static async writeFile(key: string, data: Buffer) {
    await ensureAppFolder();
    return native().personalCloudWriteFile(key, data);
  }

  /** Moves one of Nacho Launcher's own files under `Nacho/` to the Drive bin. */
  public static async deleteFile(key: string) {
    await ensureAppFolder();
    return native().personalCloudDeleteFile(key);
  }

  /**
   * Whether anything in the Drive folder changed since `token`, plus the token
   * for next time. Null when there's no change feed to ask.
   */
  public static changes(token: string | null) {
    return native().personalCloudChanges(token);
  }
}
