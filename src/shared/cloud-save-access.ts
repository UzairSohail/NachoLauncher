import type { EmulationSavePlatform, GameShop } from "@types";

import { getCloudSaveEmulatorProvider } from "./cloud-save-emulator-provider.js";

export type CloudSaveAccessAction = "sign-in" | "paywall" | "open";

export const getCloudSaveAccessAction = (
  isAuthenticated: boolean,
  hasActiveSubscription: boolean
): CloudSaveAccessAction => {
  if (!isAuthenticated) return "sign-in";
  if (!hasActiveSubscription) return "paywall";
  return "open";
};

export const platformToEmulationSavePlatform = (
  platform?: string | null
): EmulationSavePlatform | null => {
  if (!platform) return null;
  const normalized = platform.toLowerCase().trim();
  if (/playstation\s*portable|\bpsp\b/.test(normalized)) return "psp";
  if (/playstation\s*[34]|\bps[34]\b/.test(normalized)) return null;
  if (/playstation\s*2|\bps2\b/.test(normalized)) return "ps2";
  if (/playstation(?!\s*(?:[5-9]|vita))|\bps1\b|\bpsx\b/.test(normalized)) {
    return "ps1";
  }
  if (/game\s*cube/.test(normalized)) return "gamecube";
  if (/^(nintendo\s+)?wii$/.test(normalized)) return "wii";
  if (/xbox\s*360/.test(normalized)) return "xbox360";
  return null;
};

/**
 * Emulator games keep their saves in the user's own Google Drive rather than
 * Hydra Cloud, so they only need Google sign-in. PC games sync through Cloud
 * Save Manager and are not covered here.
 */
export const usesDriveCloudSaves = (
  shop: GameShop,
  platform?: string | null
): boolean =>
  shop === "launchbox" &&
  (getCloudSaveEmulatorProvider(shop, platform) !== null ||
    platformToEmulationSavePlatform(platform) !== null);

/** The cloud save access for a game, given both kinds of sign-in. */
export const resolveCloudSaveAccessAction = (
  shop: GameShop,
  platform: string | null | undefined,
  access: {
    isAuthenticated: boolean;
    hasActiveSubscription: boolean;
    driveSignedIn: boolean;
  }
): CloudSaveAccessAction => {
  if (usesDriveCloudSaves(shop, platform)) {
    return access.driveSignedIn ? "open" : "sign-in";
  }
  return getCloudSaveAccessAction(
    access.isAuthenticated,
    access.hasActiveSubscription
  );
};
