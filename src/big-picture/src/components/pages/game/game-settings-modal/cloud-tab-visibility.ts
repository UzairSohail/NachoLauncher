import type { GameShop } from "@types";
import {
  getCloudSaveEmulatorProvider,
  isCloudSaveV2Eligible,
} from "../../../../../../shared/cloud-save-emulator-provider.js";
import {
  platformToEmulationSavePlatform,
  usesDriveCloudSaves,
} from "../../../../../../shared/cloud-save-access.js";

/** Cloud saves for emulators with a save provider, kept on Google Drive. */
export const shouldShowCloudSaveV2Tab = (
  shop: GameShop,
  driveSignedIn: boolean,
  platform?: string | null
) =>
  driveSignedIn &&
  isCloudSaveV2Eligible(shop, platform) &&
  usesDriveCloudSaves(shop, platform);

/** The Drive emulator saves tab for PS1, PS2, PSP, GameCube, Wii and Xbox 360. */
export const shouldShowEmulatorSavesTab = (
  shop: GameShop,
  driveSignedIn: boolean,
  platform?: string | null
) =>
  driveSignedIn &&
  shop === "launchbox" &&
  getCloudSaveEmulatorProvider(shop, platform) === null &&
  platformToEmulationSavePlatform(platform) !== null;
