import type { CloudSaveAccessAction } from "@shared";

import type { GameSettingsCategoryId } from "./types";

export interface GameSettingsCategoryAvailability {
  cloudSaveAccessAction: CloudSaveAccessAction;
  showCloudSaveV2Settings: boolean;
  showEmulatorSaves: boolean;
  showDownloadSettings: boolean;
}

/** Cloud categories only show once Google Drive sign-in makes them usable. */
export const getCloudGameSettingsCategories = (
  availability: GameSettingsCategoryAvailability
): GameSettingsCategoryId[] => {
  if (availability.cloudSaveAccessAction !== "open") return [];
  const categories: GameSettingsCategoryId[] = [];
  if (availability.showCloudSaveV2Settings) categories.push("hydra_cloud");
  if (availability.showEmulatorSaves) categories.push("emulator_saves");
  return categories;
};

export interface GameSettingsCategoryInitializationState {
  visible: boolean;
  initialCategory: GameSettingsCategoryId | undefined;
}

export const shouldInitializeGameSettingsCategory = (
  previousState: GameSettingsCategoryInitializationState,
  currentState: GameSettingsCategoryInitializationState
): boolean =>
  currentState.visible &&
  (!previousState.visible ||
    previousState.initialCategory !== currentState.initialCategory);

export const getAvailableGameSettingsCategory = (
  category: GameSettingsCategoryId,
  availability: GameSettingsCategoryAvailability
): GameSettingsCategoryId => {
  if (
    category === "hydra_cloud" &&
    (!availability.showCloudSaveV2Settings ||
      availability.cloudSaveAccessAction !== "open")
  ) {
    return "general";
  }

  if (
    category === "emulator_saves" &&
    (!availability.showEmulatorSaves ||
      availability.cloudSaveAccessAction !== "open")
  ) {
    return "general";
  }

  if (category === "downloads" && !availability.showDownloadSettings) {
    return "general";
  }

  return category;
};
