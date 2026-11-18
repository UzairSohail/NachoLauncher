import { getUserPreferences } from "../user-preferences";
import { resolveEmulatorAchievementTracking } from "./emulator-achievement-tracking";

export const loadEmulatorAchievementTracking = async () =>
  resolveEmulatorAchievementTracking(
    await getUserPreferences().catch(() => null)
  );
