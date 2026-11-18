import { getHydraPlaytimeRevision } from "./library-queue/library-write-queue";
import { WindowManager } from "./window-manager";
import { updateGameExecutablePath } from "@main/helpers/update-executable-path";
import type { Game, UserPreferences } from "@types";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { PersonalCloud } from "./personal-cloud";
import { logger, networkLogger } from "./logger";
import { PowerSaveBlockerManager } from "./power-save-blocker";
import path from "node:path";
import { AchievementWatcherManager } from "./achievements/achievement-watcher-manager";
import { abortAchievementMetadataExport } from "./achievements/metadata-export";
import { Wine } from "./wine";
import { NativeAddon } from "./native-addon";
import { emulatorSessions } from "./emulators/emulator-session-tracker";
import { launchedGamePids } from "./launched-game-pids";
import { markGameLauncherGameDetected } from "./game-launcher-status";
import {
  isValidProcessWatcherScan,
  startOptionalExecutableCatalogueLoad,
} from "./process-watcher-scan";
import {
  doesSteamCompatDataPathMatchWinePrefix,
  hasLaunchedPidMatch,
  hasLinuxNativeOrAppImageMatch,
  type LinuxProcessInfo,
} from "./linux-process-match";
import { isWindowsBatchFile } from "@main/helpers/windows-batch-command";
import {
  getCloudSaveAutomaticSyncMode,
  runAutomaticCloudSavePostExit,
  shouldRunV2AutomaticCloudSave,
} from "./cloud-save";
import {
  clearGamesPlaytimeState,
  deleteGamePlaytime,
  gamesPlaytime,
  getGamePlaytimeDeltas,
  getTrackedGamesRunning,
  recompilationGameSessions,
  setGamePlaytime,
} from "./game-running-state";
import { stopLinuxGameCaptureSession } from "./linux-game-capture-session";
import { scheduleSettingsSync, updateGameRecord } from "./game-record-updater";
import { onScreenshotGameClosed, onScreenshotGameStarted } from "./screenshots";
import { GameExecutables } from "./game-executables";

export { gamesPlaytime };
export { isGameRunning } from "./game-running-state";

const runAutomaticCloudSaveOnClose = async (game: Game) => {
  const mode = await getCloudSaveAutomaticSyncMode(game.objectId, game.shop);
  if (shouldRunV2AutomaticCloudSave(mode)) {
    await runAutomaticCloudSavePostExit(game.objectId, game.shop);
  }
};

const handleAutomaticCloudSaveLifecycleError = (
  phase: "open" | "close",
  game: Game,
  error: unknown
) => {
  logger.error("[Cloud Save] Automatic lifecycle failed", {
    phase,
    shop: game.shop,
    objectId: game.objectId,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : "Unknown error",
  });
};

export const getGamesRunning = () => {
  const now = performance.now();
  const gamesRunning = getTrackedGamesRunning(now);

  for (const [gameKey, session] of emulatorSessions) {
    gamesRunning.push({
      id: gameKey,
      sessionDurationInMillis: now - session.startedAt,
    });
  }

  for (const session of recompilationGameSessions.values()) {
    gamesRunning.push({
      id: session.gameKey,
      sessionDurationInMillis: now - session.startedAt,
      recompilationSlug: session.recompilationSlug,
    });
  }

  return gamesRunning;
};

const platform = process.platform;

const logPlaytimeTrace = (
  event: string,
  game: Game,
  payload?: Record<string, unknown>
) => {
  networkLogger.info("[playtime-trace]", event, {
    gameKey: levelKeys.game(game.shop, game.objectId),
    shop: game.shop,
    objectId: game.objectId,
    localPlayTimeInMilliseconds: Math.trunc(game.playTimeInMilliseconds ?? 0),
    unsyncedDeltaPlayTimeInMilliseconds:
      game.unsyncedDeltaPlayTimeInMilliseconds ?? 0,
    countHydraPlaytime: gamesPlaytime.get(
      levelKeys.game(game.shop, game.objectId)
    )?.countHydraPlaytime,
    lastTimePlayed:
      game.lastTimePlayed instanceof Date
        ? game.lastTimePlayed.toISOString()
        : game.lastTimePlayed,
    ...payload,
  });
};

void GameExecutables.ensureLoaded();

const findGamePathByProcess = async (
  processMap: Map<string, Set<string>>,
  winePrefixMap: Map<string, string>,
  gameId: string
) => {
  const executables = GameExecutables.getExecutablesForGame(gameId);
  if (!executables) return;

  for (const executable of executables) {
    const executablewithoutExtension = executable.exe.replace(/\.exe$/i, "");

    const pathSet =
      processMap.get(executable.exe) ??
      processMap.get(executablewithoutExtension);

    if (pathSet) {
      for (const path of pathSet) {
        if (
          path.toLowerCase().endsWith(executable.name) ||
          path.toLowerCase().endsWith(executablewithoutExtension)
        ) {
          const gameKey = levelKeys.game("steam", gameId);
          const game = await gamesSublevel.get(gameKey);

          if (game) {
            const updatedGame: Game = {
              ...updateGameExecutablePath(game, path),
            };

            if (process.platform === "linux" && winePrefixMap.has(path)) {
              updatedGame.winePrefixPath = winePrefixMap.get(path)!;
            }

            await gamesSublevel.put(gameKey, updatedGame);
            logger.info("Set game path", gameKey, path);
          }
        }
      }
    }
  }
};

const getSystemProcessMap = async () => {
  const result = await NativeAddon.getSystemProcessMap();
  if (result === null) return null;

  const {
    processMap: rawMap,
    winePrefixMap: rawWineMap,
    linuxProcesses,
    processTree,
  } = result;

  const processMap = new Map<string, Set<string>>(
    Object.entries(rawMap).map(([k, v]) => [k, new Set(v)])
  );

  const winePrefixMap = new Map<string, string>(Object.entries(rawWineMap));

  return { processMap, winePrefixMap, linuxProcesses, processTree };
};

// Do not restore an old import flag or executable after an asynchronous sync.
export const persistGamePlaytime = async (
  gameKey: string,
  update: Partial<
    Pick<
      Game,
      | "playTimeInMilliseconds"
      | "lastTimePlayed"
      | "unsyncedDeltaPlayTimeInMilliseconds"
    >
  >,
  delta?: number,
  hydraRevision = getHydraPlaytimeRevision(gameKey)
) => {
  await updateGameRecord(gameKey, (current) => {
    // A manual playtime change while this was pending wins.
    if (getHydraPlaytimeRevision(gameKey) !== hydraRevision) return {};
    return {
      ...update,
      ...(delta === undefined
        ? {}
        : { playTimeInMilliseconds: current.playTimeInMilliseconds + delta }),
    };
  });
};

const hasLinuxCompatibilityProcessMatch = (
  game: Game,
  executablePath: string,
  linuxProcesses: LinuxProcessInfo[]
) => {
  if (path.extname(executablePath).toLowerCase() !== ".exe") {
    return false;
  }

  const executableName = path.basename(executablePath).toLowerCase();
  const executableNameWithoutExtension = executableName.replace(/\.exe$/i, "");
  const executableDirectory = path.dirname(executablePath).toLowerCase();
  const expectedWinePrefix = Wine.getEffectivePrefixPath(
    game.winePrefixPath,
    game.objectId
  )?.toLowerCase();

  return linuxProcesses.some((process) => {
    if (process.cwd !== executableDirectory) {
      return false;
    }

    if (
      expectedWinePrefix &&
      process.steamCompatDataPath &&
      !doesSteamCompatDataPathMatchWinePrefix(
        process.steamCompatDataPath,
        expectedWinePrefix
      )
    ) {
      return false;
    }

    if (
      process.name === executableName ||
      process.name === executableNameWithoutExtension
    ) {
      return true;
    }

    const processRunsUnderWine = process.exe.includes("wine");

    return processRunsUnderWine && process.name.length > 0;
  });
};

export const watchProcesses = async () => {
  startOptionalExecutableCatalogueLoad(() => GameExecutables.ensureLoaded());

  const games = await gamesSublevel
    .values()
    .all()
    .then((results) => {
      // Finish an already monitored session even if unlinking hides its import.
      return results.filter(
        (game) =>
          game.isDeleted === false ||
          gamesPlaytime.has(levelKeys.game(game.shop, game.objectId))
      );
    });

  if (!games.length) return;

  const systemProcessMap = await getSystemProcessMap();
  if (!isValidProcessWatcherScan(systemProcessMap)) {
    logger.warn("Process enumeration failed; skipping process watcher tick");
    return;
  }
  const { processMap, winePrefixMap, linuxProcesses } = systemProcessMap;

  const pidToProcess = new Map<number, LinuxProcessInfo>(
    linuxProcesses.map((process) => [process.pid, process])
  );

  for (const game of games) {
    const gameKey = levelKeys.game(game.shop, game.objectId);
    const executablePath = game.executablePath;
    if (!executablePath) {
      if (GameExecutables.getExecutablesForGame(game.objectId)) {
        await findGamePathByProcess(processMap, winePrefixMap, game.objectId);
      }

      continue;
    }

    const trackingPaths = game.trackingExecutablePaths?.filter(Boolean) ?? [];

    let matchPaths: string[];
    if (isWindowsBatchFile(executablePath)) {
      matchPaths = trackingPaths.length ? trackingPaths : [executablePath];
    } else {
      matchPaths = [executablePath, ...trackingPaths];
    }

    let matchedPath = matchPaths.find((matchPath) => {
      const executable = matchPath
        .slice(matchPath.lastIndexOf(platform === "win32" ? "\\" : "/") + 1)
        .toLowerCase();

      if (processMap.get(executable)?.has(matchPath)) return true;

      if (platform === "linux") {
        return (
          hasLinuxNativeOrAppImageMatch(matchPath, linuxProcesses) ||
          hasLinuxCompatibilityProcessMatch(game, matchPath, linuxProcesses)
        );
      }

      return false;
    });

    if (
      !matchedPath &&
      platform === "linux" &&
      hasLaunchedPidMatch(
        launchedGamePids.get(gameKey),
        executablePath,
        pidToProcess
      )
    ) {
      matchedPath = executablePath;
    }

    if (matchedPath) {
      if (gamesPlaytime.has(gameKey)) {
        onTickGame(game);
      } else {
        await onOpenGame(game, matchedPath);
      }
    } else if (gamesPlaytime.has(gameKey)) {
      onCloseGame(game);
    }
  }

  WindowManager.sendToAppWindows("on-games-running", getGamesRunning());
};

async function onOpenGame(game: Game, matchedPath: string) {
  const now = performance.now();
  const gameKey = levelKeys.game(game.shop, game.objectId);

  setGamePlaytime(gameKey, {
    lastTick: now,
    firstTick: now,
    lastSyncTick: now,
    countHydraPlaytime: true,
  });

  logPlaytimeTrace("session-open", game, {
    performanceNow: now,
    matchedPath,
  });

  void onScreenshotGameStarted(gameKey);

  void PersonalCloud.onGameStarted(game);

  // On Linux, keep the launcher visible briefly and let it auto-close itself.
  if (process.platform !== "linux") {
    WindowManager.closeGameLauncherWindow();
  } else {
    markGameLauncherGameDetected(gameKey);
  }

  // Hide Nacho to the tray on game startup if enabled
  db.get<string, UserPreferences | null>(levelKeys.userPreferences, {
    valueEncoding: "json",
  })
    .then((userPreferences) => {
      if (userPreferences?.hideToTrayOnGameStart) {
        // Close rather than hide, so its renderer isn't held in memory
        // while the game runs. The tray opens it again.
        WindowManager.releaseMainWindow();
      }
    })
    .catch(() => {});

  if (game.shop === "custom") return;

  AchievementWatcherManager.syncGameAchievementFiles(game.shop, game.objectId);
}

function onTickGame(game: Game) {
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(
    levelKeys.game(game.shop, game.objectId)
  );
  if (!gamePlaytime) return;

  const { localDelta: delta } = getGamePlaytimeDeltas(
    gamePlaytime,
    now,
    game.unsyncedDeltaPlayTimeInMilliseconds ?? 0
  );

  const updatedGame = {
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + delta,
    lastTimePlayed: new Date(),
  };

  void persistGamePlaytime(
    levelKeys.game(game.shop, game.objectId),
    updatedGame,
    delta
  );

  setGamePlaytime(levelKeys.game(game.shop, game.objectId), {
    ...gamePlaytime,
    lastTick: now,
  });
}

const onCloseGame = (game: Game, options: { isShutdown?: boolean } = {}) => {
  const gameKey = levelKeys.game(game.shop, game.objectId);
  const now = performance.now();
  const gamePlaytime = gamesPlaytime.get(gameKey);
  if (!gamePlaytime) return;
  deleteGamePlaytime(gameKey);
  launchedGamePids.delete(gameKey);
  stopLinuxGameCaptureSession(gameKey);
  PowerSaveBlockerManager.markGameClosed(gameKey);
  abortAchievementMetadataExport(gameKey);

  const { localDelta: delta } = getGamePlaytimeDeltas(
    gamePlaytime,
    now,
    game.unsyncedDeltaPlayTimeInMilliseconds ?? 0
  );

  logPlaytimeTrace("session-close", game, {
    performanceNow: now,
    delta,
    firstTick: gamePlaytime.firstTick,
    lastTick: gamePlaytime.lastTick,
    lastSyncTick: gamePlaytime.lastSyncTick,
    countHydraPlaytime: gamePlaytime.countHydraPlaytime,
  });

  const updatedGame = {
    playTimeInMilliseconds: (game.playTimeInMilliseconds ?? 0) + delta,
    lastTimePlayed: new Date(),
  };

  void persistGamePlaytime(gameKey, updatedGame, delta);

  if (!options.isShutdown) onScreenshotGameClosed(gameKey);

  void PersonalCloud.onGameClosed(game);
  // Shares this session's time with the user's other devices.
  scheduleSettingsSync();

  // An update that finished while this game was running can now remove the
  // old version, once its files are no longer in use.
  if (game.previousInstall && !options.isShutdown) {
    setTimeout(
      () =>
        void import("./game-updates").then(({ GameUpdates }) =>
          GameUpdates.finishCompletedUpdates()
        ),
      10_000
    );
  }

  if (game.shop === "custom") return;

  void runAutomaticCloudSaveOnClose(game).catch((error: unknown) => {
    handleAutomaticCloudSaveLifecycleError("close", game, error);
  });
};

export const clearGamesPlaytime = async () => {
  await Promise.all(
    Array.from(gamesPlaytime.keys(), async (game) => {
      const gameData = await gamesSublevel.get(game);

      if (gameData) {
        await onCloseGame(gameData, { isShutdown: true });
      }
    })
  );

  clearGamesPlaytimeState();
};
