import fs from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { shell } from "electron";
import { gamesSublevel } from "@main/level";
import { resolveScreenshotPreferences } from "@shared";
import type { GameShop, LocalScreenshot, LocalScreenshotDraft } from "@types";

import { emulatorSessions } from "../emulators/emulator-session-tracker";
import {
  gamesPlaytime,
  hasTrackedGamesRunning,
  isTrackedGameKeyRunning,
} from "../game-running-state";
import {
  isWaylandCaptureBackend,
  stopAllLinuxGameCaptureSessions,
} from "../linux-game-capture-session";
import { logger } from "../logger";
import { NativeAddon } from "../native-addon";
import { ScreenshotInputService } from "../screenshot-input";
import { WindowManager } from "../window-manager";
import { forgetForegroundGame } from "./foreground-game";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { pruneMissingLocalScreenshots } from "./local-screenshot-removal";
import { findLocalScreenshotGameObjectId } from "./local-screenshot-game";
import { buildLocalScreenshotDraftPatch } from "./screenshot-draft";
import {
  clearScreenshotGameSession,
  handleScreenshotTrigger,
} from "./screenshot-capture-service";
import { ScreenshotFeedback } from "./screenshot-feedback";
import { ScreenshotFrameWorker } from "./screenshot-frame-worker";
import { isScreenshotsFeatureEnabled } from "./screenshot-feature";
import {
  getScreenshotFolderCandidates,
  getScreenshotsFolder,
} from "./screenshots-folder";
import { startWaylandFocusWatch, stopWaylandFocusWatch } from "./wayland-focus";
import { readUserPreferences } from "./screenshot-user-preferences";

export { LocalScreenshotStore } from "./local-screenshot-store";
export { stopWaylandFocusWatch } from "./wayland-focus";

const GAME_HELPERS_WARMUP_TIMEOUT_MS = 5_000;

let initialized = false;

const broadcastLocalScreenshots = (screenshots: LocalScreenshot[]) => {
  WindowManager.sendToAppWindows("on-local-screenshots-change", screenshots);
};

const isScreenshotCaptureAvailable = async () => {
  const preferences = resolveScreenshotPreferences(await readUserPreferences());
  return preferences.enabled && (await isScreenshotsFeatureEnabled());
};

export const initializeScreenshots = () => {
  if (initialized) return;
  initialized = true;

  ScreenshotInputService.onTrigger((source) => {
    void handleScreenshotTrigger(source);
  });

  LocalScreenshotStore.onChange(broadcastLocalScreenshots);
  void backfillLocalScreenshotGameIds().catch((error) => {
    logger.error("Failed to back-fill local screenshot game ids", error);
  });
};

const releaseRunningGameResources = () => {
  ScreenshotFeedback.release();
  ScreenshotFrameWorker.release();
  NativeAddon.releaseWindowsDesktopCapture();
  stopWaylandFocusWatch();
};

export const onScreenshotGameStarted = async (gameKey: string) => {
  try {
    if (!(await isScreenshotCaptureAvailable())) return;
    if (!isTrackedGameKeyRunning(gameKey)) return;

    void ScreenshotFeedback.prepare();
    void ScreenshotFeedback.prepareToast().catch((error) => {
      logger.error("Failed to prepare the screenshot toast", error);
    });
    if (isWaylandCaptureBackend()) {
      startWaylandFocusWatch();
    } else if (process.platform === "win32" || process.platform === "linux") {
      void ScreenshotFrameWorker.prepare();
      NativeAddon.prepareWindowsDesktopCapture();
    }
  } catch (error) {
    logger.error("Failed to prepare screenshots for a running game", error);
  }
};

export const holdGameHelpersBeforeLaunch = async () => {
  if (process.platform !== "win32") return;

  const warmups: Promise<unknown>[] = [
    ScreenshotFrameWorker.hold(),
    ScreenshotFeedback.prepareToast(),
  ];
  if (await isScreenshotCaptureAvailable().catch(() => false)) {
    warmups.push(ScreenshotFeedback.prepare());
  }

  await Promise.race([
    Promise.allSettled(warmups),
    delay(GAME_HELPERS_WARMUP_TIMEOUT_MS, undefined, { ref: false }),
  ]);
};

export const releaseGameHelpersIfIdle = () => {
  if (!hasTrackedGamesRunning()) releaseRunningGameResources();
};

export const onScreenshotGameClosed = (gameKey: string) => {
  clearScreenshotGameSession(gameKey);
  forgetForegroundGame(gameKey);
  releaseGameHelpersIfIdle();
};

export const applyScreenshotsEnabledPreference = async (
  enabled: boolean | undefined
) => {
  if (enabled === false) {
    stopAllLinuxGameCaptureSessions("screenshot");
    releaseRunningGameResources();
    return;
  }

  if (!hasTrackedGamesRunning()) return;

  const runningGameKeys = new Set([
    ...gamesPlaytime.keys(),
    ...emulatorSessions.keys(),
  ]);
  await Promise.all(
    [...runningGameKeys].map(async (gameKey) => {
      const game = await gamesSublevel.get(gameKey).catch(() => null);
      if (game) {
        await onScreenshotGameStarted(gameKey);
      }
    })
  );
};

export const getLocalScreenshots = async () =>
  pruneMissingLocalScreenshots(await LocalScreenshotStore.list());

export const getLocalScreenshotsForGame = async (
  shop: GameShop,
  objectId: string
) =>
  pruneMissingLocalScreenshots(
    await LocalScreenshotStore.listForGame(shop, objectId)
  );

export const getScreenshotsFolderPath = () => getScreenshotsFolder();

const backfillLocalScreenshotGameIds = async () => {
  const screenshots = await LocalScreenshotStore.listIncludingDeleted();
  if (!screenshots.some((screenshot) => !screenshot.objectId)) return;

  const games = await gamesSublevel.values().all();
  const updates = screenshots.flatMap((screenshot) => {
    const objectId = findLocalScreenshotGameObjectId(screenshot, games);
    return objectId ? [{ clientId: screenshot.clientId, objectId }] : [];
  });

  await Promise.all(
    updates.map(({ clientId, objectId }) =>
      LocalScreenshotStore.update(clientId, (current) =>
        current.objectId ? {} : { objectId }
      )
    )
  );
};

export {
  countLocalScreenshotFilesForGame,
  deleteLocalScreenshot,
  deleteLocalScreenshotsForGame,
} from "./local-screenshot-removal";

export const updateLocalScreenshotDraft = async (
  clientId: string,
  draft: LocalScreenshotDraft
) => {
  const screenshot = await LocalScreenshotStore.get(clientId);
  if (!screenshot) return null;

  return LocalScreenshotStore.update(clientId, (current) =>
    buildLocalScreenshotDraftPatch(current, draft)
  );
};

export const openScreenshotsFolder = async () => {
  for (const directory of await getScreenshotFolderCandidates()) {
    const isAvailable = await fs.promises
      .mkdir(directory, { recursive: true })
      .then(
        () => true,
        () => false
      );
    if (!isAvailable) continue;

    const error = await shell.openPath(directory);
    if (error) logger.error("Failed to open the screenshots folder", error);
    return;
  }

  logger.error("No screenshots folder is available to open");
};
