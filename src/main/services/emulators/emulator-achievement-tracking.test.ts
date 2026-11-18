import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserPreferences } from "@types";
import {
  isEmulatorAchievementTrackingActive,
  needsEmulatorOverlayVisibility,
  resolveEmulatorAchievementTracking,
} from "./emulator-achievement-tracking.js";

const connected = {
  retroAchievementsUsername: "player",
  retroAchievementsWebApiKey: "key",
} as UserPreferences;

describe("emulator achievement tracking", () => {
  it("enables realtime unlocks with RetroAchievements credentials", () => {
    const tracking = resolveEmulatorAchievementTracking(connected);

    assert.deepEqual(tracking, { realtimeUnlocks: true });
    assert.equal(isEmulatorAchievementTrackingActive(tracking), true);
  });

  it("requires both RetroAchievements credentials for realtime unlocks", () => {
    const tracking = resolveEmulatorAchievementTracking({
      retroAchievementsUsername: "player",
    } as UserPreferences);

    assert.equal(tracking.realtimeUnlocks, false);
    assert.equal(isEmulatorAchievementTrackingActive(tracking), false);
  });
});

describe("emulator overlay visibility", () => {
  it("is needed while achievement notifications are on", () => {
    assert.equal(needsEmulatorOverlayVisibility(null), true);
    assert.equal(
      needsEmulatorOverlayVisibility({
        achievementNotificationsEnabled: true,
      } as UserPreferences),
      true
    );
  });

  it("is not needed with notifications off", () => {
    assert.equal(
      needsEmulatorOverlayVisibility({
        achievementNotificationsEnabled: false,
      } as UserPreferences),
      false
    );
  });
});
