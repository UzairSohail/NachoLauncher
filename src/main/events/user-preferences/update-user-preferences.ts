import { updateGameRecord } from "@main/services/game-record-updater";
import { registerEvent } from "../register-event";
import path from "node:path";

import type { Game, UserPreferences } from "@types";
import i18next from "i18next";
import { defaultDownloadsPath } from "@main/constants";
import { db, gamesSublevel, levelKeys } from "@main/level";
import { DownloadManager, ScreenshotInputService, Wine } from "@main/services";
import { WindowManager } from "@main/services/window-manager";
import { getDownloadDirectoryPreferences } from "@shared";
import {
  restoreDuckStationFileLogging,
  restoreRetroArchAchievementScreenshots,
} from "@main/services/emulators/emulator-souvenir-config";
import {
  isEmulatorAchievementTrackingActive,
  resolveEmulatorAchievementTracking,
} from "@main/services/emulators/emulator-achievement-tracking";
import { SettingsSync } from "@main/services/settings-sync";
import {
  getUserPreferences,
  saveUserPreferences,
} from "@main/services/user-preferences";
import { UnlockedAchievementsCache } from "@main/services/achievements/unlocked-achievements-cache";
import { deleteRetroAchievementsEmulatorAccount } from "@main/services/retro-achievements/retro-achievements-emulator-account";

const updateLanguagePreference = async (language: string | undefined) => {
  if (!language) return;

  await db.put<string, string>(levelKeys.language, language, {
    valueEncoding: "utf8",
  });

  i18next.changeLanguage(language);
};

const pinGameWinePrefix = async (game: Game) => {
  if (game.winePrefixPath || !game.executablePath) return;
  if (path.extname(game.executablePath).toLowerCase() !== ".exe") return;

  const resolvedWinePrefixPath = Wine.getDefaultPrefixPathForGame(
    game.objectId
  );
  if (!resolvedWinePrefixPath) return;

  await updateGameRecord(levelKeys.game(game.shop, game.objectId), {
    winePrefixPath: resolvedWinePrefixPath,
  });
};

const pinExistingWinePrefixes = async (
  preferences: Partial<UserPreferences>,
  userPreferences: UserPreferences | null
) => {
  const shouldPin =
    process.platform === "linux" &&
    Object.hasOwn(preferences, "defaultWinePrefixPath") &&
    preferences.defaultWinePrefixPath !==
      userPreferences?.defaultWinePrefixPath;

  if (!shouldPin) return;

  const games = await gamesSublevel.values().all();
  await Promise.all(games.map(pinGameWinePrefix));
};

const ACHIEVEMENT_VIEW_PREFERENCE_KEYS = [
  "language",
  "showHiddenAchievementsDescription",
] as const;

const EMULATOR_ACHIEVEMENT_TRACKING_PREFERENCE_KEYS = [
  "retroAchievementsWebApiKey",
  "retroAchievementsUsername",
] as const;

const updateEmulatorAchievementTracking = async (
  preferences: Partial<UserPreferences>,
  updatedPreferences: UserPreferences
) => {
  if (
    !EMULATOR_ACHIEVEMENT_TRACKING_PREFERENCE_KEYS.some((key) =>
      Object.hasOwn(preferences, key)
    )
  ) {
    return;
  }

  const tracking = resolveEmulatorAchievementTracking(updatedPreferences);
  if (isEmulatorAchievementTrackingActive(tracking)) return;

  const { stopAllEmulatorSouvenirCaptureSessions } = await import(
    "@main/services/emulators/emulator-session-tracker"
  );
  await Promise.all([
    stopAllEmulatorSouvenirCaptureSessions(),
    restoreRetroArchAchievementScreenshots(),
    restoreDuckStationFileLogging(),
  ]);
};

const unlinkRetroAchievementsEmulatorAccount = async (
  preferences: Partial<UserPreferences>
) => {
  if (
    !Object.hasOwn(preferences, "retroAchievementsWebApiKey") ||
    preferences.retroAchievementsWebApiKey
  ) {
    return;
  }

  await deleteRetroAchievementsEmulatorAccount();
};

const updateScreenshotsPreference = async (
  preferences: Partial<UserPreferences>
) => {
  if (!Object.hasOwn(preferences, "screenshotsEnabled")) return;

  const { applyScreenshotsEnabledPreference } = await import(
    "@main/services/screenshots"
  );
  await applyScreenshotsEnabledPreference(preferences.screenshotsEnabled);
};

const applyDownloadManagerPreferences = async (
  preferences: Partial<UserPreferences>
) => {
  if (Object.hasOwn(preferences, "maxDownloadSpeedBytesPerSecond")) {
    await DownloadManager.applyDownloadSpeedLimit(
      preferences.maxDownloadSpeedBytesPerSecond ?? null
    );
  }

  if (Object.hasOwn(preferences, "downloadConnections")) {
    await DownloadManager.applyDownloadConnections(
      preferences.downloadConnections ?? null
    );
  }

  if (Object.hasOwn(preferences, "torrentNetworkInterface")) {
    await DownloadManager.applyNetworkInterface(
      preferences.torrentNetworkInterface ?? null
    );
  }
};

/** Saves preferences and applies their side effects. Also used by settings sync. */
export const applyUserPreferences = async (
  preferences: Partial<UserPreferences>
) => {
  const userPreferences = await getUserPreferences();

  await updateLanguagePreference(preferences.language);
  await pinExistingWinePrefixes(preferences, userPreferences);

  const mergedPreferences = {
    ...userPreferences,
    ...preferences,
  };
  const normalizedDownloadDirectoryPreferences =
    getDownloadDirectoryPreferences(mergedPreferences, defaultDownloadsPath);
  const updatedPreferences = {
    ...mergedPreferences,
    ...normalizedDownloadDirectoryPreferences,
  };

  await saveUserPreferences(updatedPreferences);

  if (
    ACHIEVEMENT_VIEW_PREFERENCE_KEYS.some(
      (key) =>
        Object.hasOwn(preferences, key) &&
        preferences[key] !== userPreferences?.[key]
    )
  ) {
    UnlockedAchievementsCache.clear();
  }

  Wine.syncUserPreferences(updatedPreferences);
  ScreenshotInputService.syncUserPreferences(updatedPreferences);

  await updateEmulatorAchievementTracking(preferences, updatedPreferences);
  await unlinkRetroAchievementsEmulatorAccount(preferences);
  await updateScreenshotsPreference(preferences);

  WindowManager.sendToAppWindows(
    "on-user-preferences-updated",
    updatedPreferences
  );

  await applyDownloadManagerPreferences(preferences);
};

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  await applyUserPreferences(preferences);
  SettingsSync.scheduleSync();
};

registerEvent("updateUserPreferences", updateUserPreferences);
