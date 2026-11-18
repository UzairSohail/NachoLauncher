import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { Game } from "@types";

import {
  AchievementMemoryStore,
  mergePersistedAchievementTotals,
} from "./achievements/achievement-memory-store.js";
import { createGameRecordUpdater } from "./game-record-updater-core.js";

const game: Game = {
  title: "Portal 2",
  iconUrl: null,
  libraryHeroImageUrl: null,
  logoImageUrl: null,
  playTimeInMilliseconds: 600_000,
  unsyncedDeltaPlayTimeInMilliseconds: 120_000,
  lastTimePlayed: null,
  objectId: "620",
  shop: "steam",
  remoteId: "remote-id",
  isDeleted: false,
};

describe("game record updater", () => {
  afterEach(() => AchievementMemoryStore.clear());

  it("preserves playtime and pending deltas across concurrent setting updates", async () => {
    let storedGame = { ...game };
    const updateGame = createGameRecordUpdater({
      get: async () => ({ ...storedGame }),
      put: async (_key, value) => {
        await Promise.resolve();
        storedGame = { ...value };
      },
    });

    await Promise.all([
      updateGame("steam:620", {
        playTimeInMilliseconds: 660_000,
        unsyncedDeltaPlayTimeInMilliseconds: 180_000,
      }),
      updateGame("steam:620", { enableHydraPlaytimeTracking: true }),
    ]);

    assert.equal(storedGame.playTimeInMilliseconds, 660_000);
    assert.equal(storedGame.unsyncedDeltaPlayTimeInMilliseconds, 180_000);
    assert.equal(storedGame.enableHydraPlaytimeTracking, true);
  });

  it("keeps process state across a concurrent achievement-count update", async () => {
    let storedGame = { ...game };
    const updateGame = createGameRecordUpdater({
      get: async () => ({ ...storedGame }),
      put: async (_key, value) => {
        await Promise.resolve();
        storedGame = { ...value };
      },
    });

    await Promise.all([
      updateGame("steam:620", {
        playTimeInMilliseconds: 720_000,
        unsyncedDeltaPlayTimeInMilliseconds: 240_000,
        executablePath: "/games/Portal 2/portal2",
      }),
      updateGame("steam:620", (currentGame) =>
        mergePersistedAchievementTotals("steam", "620", currentGame, {
          achievementCount: 51,
          unlockedAchievementCount: 15,
        })
      ),
    ]);

    assert.equal(storedGame.playTimeInMilliseconds, 720_000);
    assert.equal(storedGame.unsyncedDeltaPlayTimeInMilliseconds, 240_000);
    assert.equal(storedGame.executablePath, "/games/Portal 2/portal2");
    assert.equal(storedGame.achievementCount, 51);
    assert.equal(storedGame.unlockedAchievementCount, 15);
  });
});
