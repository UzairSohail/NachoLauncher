import type { GameShop } from "@types";
import { getCloudSaveEmulatorProvider } from "../../../../shared/cloud-save-emulator-provider.js";
import { platformToEmulationSavePlatform } from "../../../../shared/cloud-save-access.js";

export type CloudSaveUiMode = "emulator" | "v2";

export interface CloudSaveSettingsVisibility {
  showV2: boolean;
  /** The Drive emulator saves panel for PS1, PS2, PSP, GameCube, Wii and Xbox 360. */
  showEmulatorSaves: boolean;
}

export interface CloudSaveVisibility {
  hero: CloudSaveUiMode | null;
  settings: CloudSaveSettingsVisibility;
}

export const getCloudSaveVisibility = (
  shop: GameShop,
  platform?: string | null
): CloudSaveVisibility => {
  if (shop === "steam") {
    return { hero: "v2", settings: { showV2: true, showEmulatorSaves: false } };
  }

  if (shop === "launchbox") {
    if (getCloudSaveEmulatorProvider(shop, platform)) {
      return {
        hero: "v2",
        settings: { showV2: true, showEmulatorSaves: false },
      };
    }
    return {
      hero: "emulator",
      settings: {
        showV2: false,
        showEmulatorSaves: platformToEmulationSavePlatform(platform) !== null,
      },
    };
  }

  return {
    hero: null,
    settings: { showV2: false, showEmulatorSaves: false },
  };
};
