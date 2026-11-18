import { isAxiosError } from "axios";

import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import { RetroAchievementsClient } from "@main/services/retro-achievements/retro-achievements-client";
import {
  requestRetroAchievementsConnectToken,
  saveRetroAchievementsEmulatorAccount,
} from "@main/services/retro-achievements/retro-achievements-emulator-account";
import { syncRetroAchievementsEmulatorCredentials } from "@main/services/retro-achievements/emulator-credentials/emulator-credential-sync";
import { getUserPreferences } from "@main/services/user-preferences/user-preferences-store";

/*
 * RetroAchievements links straight to the user's RetroAchievements account
 * now. The password signs the emulators in, and the Web API key lets Nacho
 * read unlocks. Neither is sent anywhere but retroachievements.org.
 */

const isUnauthorized = (error: unknown) =>
  isAxiosError(error) &&
  (error.response?.status === 401 || error.response?.status === 403);

const connectRetroAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  username: string,
  password: string,
  webApiKey: string
) => {
  if (!username || !password || !webApiKey) {
    throw new Error("profile/retroachievements-missing-credentials");
  }

  const account = await requestRetroAchievementsConnectToken(
    username,
    password
  ).catch((error) => {
    logger.error("RetroAchievements rejected the password", error);
    throw new Error("profile/retroachievements-invalid-password");
  });

  await RetroAchievementsClient.getUserProfile(
    account.username,
    webApiKey
  ).catch((error) => {
    logger.error("RetroAchievements rejected the Web API key", error);
    throw new Error("profile/retroachievements-invalid-web-api-key");
  });

  await saveRetroAchievementsEmulatorAccount(account);
  void syncRetroAchievementsEmulatorCredentials();

  return { username: account.username };
};

const getRetroAchievementsConnectionStatus = async () => {
  const preferences = await getUserPreferences();
  const username = preferences?.retroAchievementsUsername;
  const webApiKey = preferences?.retroAchievementsWebApiKey;
  if (!username || !webApiKey) return { connected: false as const };

  try {
    await RetroAchievementsClient.getUserProfile(username, webApiKey);
  } catch (error) {
    // Offline is not a reason to say the key is wrong.
    if (isUnauthorized(error) || !isAxiosError(error)) {
      return {
        connected: true as const,
        username,
        status: "invalid_credentials" as const,
      };
    }
  }

  return { connected: true as const, username, status: "active" as const };
};

registerEvent("connectRetroAchievements", connectRetroAchievements);
registerEvent(
  "getRetroAchievementsConnectionStatus",
  getRetroAchievementsConnectionStatus
);
