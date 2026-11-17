import type { CloudSaveAccessAction } from "@shared";

import type { GameSettingsCategoryId } from "./types";

export interface GameSettingsCategoryAvailability {
  cloudSaveAccessAction: CloudSaveAccessAction;
  showCloudSaveV2Settings: boolean;
  showLegacyCloudSaveSettings: boolean;
  showDownloadSettings: boolean;
}

export const getCloudGameSettingsCategories = (
  availability: GameSettingsCategoryAvailability,
  legacyPurpose: "active" | "archive"
): GameSettingsCategoryId[] => {
  const categories: GameSettingsCategoryId[] = [];
  // Cloud saves go through the user's own Google Drive instead, so Hydra Cloud
  // only shows for an account that already has it, never as an upsell.
  const showHydra = availability.cloudSaveAccessAction === "open";
  if (showHydra && availability.showCloudSaveV2Settings) {
    categories.push("hydra_cloud");
  }
  const showLegacy = showHydra && availability.showLegacyCloudSaveSettings;
  if (showLegacy && legacyPurpose === "active") {
    categories.push("hydra_cloud_legacy");
  }
  if (showLegacy && legacyPurpose === "archive") {
    categories.push("hydra_cloud_legacy");
  }
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
    category === "hydra_cloud_legacy" &&
    (!availability.showLegacyCloudSaveSettings ||
      availability.cloudSaveAccessAction !== "open")
  ) {
    return "general";
  }

  if (category === "downloads" && !availability.showDownloadSettings) {
    return "general";
  }

  return category;
};
