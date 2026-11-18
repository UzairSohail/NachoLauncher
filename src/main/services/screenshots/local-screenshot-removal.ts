import fs from "node:fs";
import path from "node:path";
import type { GameShop, LocalScreenshot } from "@types";

import { logger } from "../logger";
import { WindowManager } from "../window-manager";
import { isLocalScreenshotFileForGame } from "./local-screenshot-game";
import { LocalScreenshotStore } from "./local-screenshot-store";
import { removeScreenshotPreview } from "./screenshot-preview";
import {
  getScreenshotsRoot,
  readRootMarkerId,
} from "./screenshots-root-marker";

const isMissingFileError = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code === "ENOENT";

const pathExists = (filePath: string) =>
  fs.promises.access(filePath).then(
    () => true,
    () => false
  );

const isOnRecordedFilesystem = async (screenshot: LocalScreenshot) => {
  if (typeof screenshot.rootMarkerId !== "string") {
    return pathExists(path.dirname(screenshot.path));
  }
  const rootMarkerId = await readRootMarkerId(
    getScreenshotsRoot(screenshot.path)
  );
  return rootMarkerId === screenshot.rootMarkerId;
};

const isFileDeleted = async (screenshot: LocalScreenshot) => {
  try {
    await fs.promises.access(screenshot.path);
    return false;
  } catch (error) {
    if (!isMissingFileError(error)) return false;
    return isOnRecordedFilesystem(screenshot);
  }
};

const removeLocalScreenshot = async (
  clientId: string,
  shouldDelete: (screenshot: LocalScreenshot) => boolean = () => true
) => {
  const screenshot = await LocalScreenshotStore.get(clientId);
  if (!screenshot || screenshot.state === "deleted") return false;
  if (!shouldDelete(screenshot)) return false;

  await fs.promises.rm(screenshot.path, { force: true });
  await removeScreenshotPreview(screenshot.previewPath);
  await LocalScreenshotStore.delete(clientId);
  return true;
};

export const deleteLocalScreenshot = async (clientId: string) => {
  await removeLocalScreenshot(clientId);
};

const isUnpublishedLocalFile = (screenshot: LocalScreenshot) =>
  screenshot.state !== "uploaded" && screenshot.state !== "deleted";

const pendingMissingRemovals = new Map<string, Promise<boolean>>();

const removeMissingLocalScreenshot = async (clientId: string) => {
  const pending = pendingMissingRemovals.get(clientId);
  if (pending !== undefined) {
    await pending;
    return false;
  }

  const removal = removeLocalScreenshot(
    clientId,
    isUnpublishedLocalFile
  ).finally(() => pendingMissingRemovals.delete(clientId));
  pendingMissingRemovals.set(clientId, removal);
  return removal;
};

const announceMissingLocalScreenshots = (count: number) => {
  if (count === 0) return;
  WindowManager.sendToAppWindows("on-local-screenshots-missing", count);
};

export const pruneMissingLocalScreenshots = async (
  screenshots: LocalScreenshot[]
) => {
  const isPresent = await Promise.all(
    screenshots.map(
      async (screenshot) =>
        !isUnpublishedLocalFile(screenshot) ||
        !(await isFileDeleted(screenshot))
    )
  );
  const missing = screenshots.filter((_, index) => !isPresent[index]);
  if (!missing.length) return screenshots;

  const removed = await Promise.all(
    missing.map((screenshot) =>
      removeMissingLocalScreenshot(screenshot.clientId)
    )
  );
  announceMissingLocalScreenshots(removed.filter(Boolean).length);
  return screenshots.filter((_, index) => isPresent[index]);
};

const listLocalScreenshotFilesForGame = async (
  shop: GameShop,
  objectId: string
) => {
  const screenshots = await LocalScreenshotStore.list();
  const candidates = screenshots.filter((screenshot) =>
    isLocalScreenshotFileForGame(screenshot, shop, objectId)
  );
  const hasFile = await Promise.all(
    candidates.map(
      (screenshot) =>
        screenshot.state !== "uploaded" || pathExists(screenshot.path)
    )
  );
  return candidates.filter((_, index) => hasFile[index]);
};

export const countLocalScreenshotFilesForGame = async (
  shop: GameShop,
  objectId: string
) => (await listLocalScreenshotFilesForGame(shop, objectId)).length;

export const deleteLocalScreenshotsForGame = async (
  shop: GameShop,
  objectId: string
) => {
  const screenshots = await listLocalScreenshotFilesForGame(shop, objectId);
  const results = await Promise.allSettled(
    screenshots.map((screenshot) =>
      removeLocalScreenshot(
        screenshot.clientId,
        (current) => isLocalScreenshotFileForGame(current, shop, objectId)
      )
    )
  );

  let deleted = 0;
  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.value) deleted += 1;
    } else {
      logger.error("Failed to delete a local screenshot", result.reason);
    }
  }
  return deleted;
};
