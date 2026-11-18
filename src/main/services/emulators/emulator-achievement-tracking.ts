import type { UserPreferences } from "@types";

export interface EmulatorAchievementTracking {
  realtimeUnlocks: boolean;
}

export const hasRetroAchievementsCredentials = (
  userPreferences: UserPreferences | null | undefined
) =>
  Boolean(
    userPreferences?.retroAchievementsWebApiKey &&
      userPreferences?.retroAchievementsUsername
  );

export const resolveEmulatorAchievementTracking = (
  userPreferences: UserPreferences | null | undefined
): EmulatorAchievementTracking => ({
  realtimeUnlocks: hasRetroAchievementsCredentials(userPreferences),
});

export const isEmulatorAchievementTrackingActive = (
  tracking: EmulatorAchievementTracking
) => tracking.realtimeUnlocks;

export const needsEmulatorOverlayVisibility = (
  userPreferences: UserPreferences | null | undefined
) => userPreferences?.achievementNotificationsEnabled !== false;
