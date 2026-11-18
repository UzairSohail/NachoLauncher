import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Game } from "@types";

import {
  otherDevicesPlaytime,
  recordGameFlags,
  recordOwnPlaytime,
  syncedGamePatch,
  type GameWithKey,
} from "./game-library-sync.js";
import { mergeSyncEntries } from "./sync-merge.js";

const game = (overrides: Partial<Game> = {}): Game =>
  ({
    title: "Game",
    objectId: "1",
    shop: "steam",
    playTimeInMilliseconds: 0,
    lastTimePlayed: null,
    isDeleted: false,
    ...overrides,
  }) as Game;

describe("game library sync", () => {
  it("adds up time played on every device", () => {
    const pc: GameWithKey[] = [
      ["steam:1", game({ playTimeInMilliseconds: 60_000 })],
    ];
    const ally: GameWithKey[] = [
      [
        "steam:1",
        game({
          playTimeInMilliseconds: 30_000,
          lastTimePlayed: new Date("2026-11-10T00:00:00.000Z"),
        }),
      ],
    ];

    const fromPc = recordOwnPlaytime({}, pc, 10, "pc");
    const fromAlly = recordOwnPlaytime({}, ally, 20, "ally");
    const merged = mergeSyncEntries(fromPc, fromAlly);

    const seenOnPc = otherDevicesPlaytime(merged, "pc").get("steam:1");
    assert.equal(seenOnPc?.playTimeInMilliseconds, 30_000);
    assert.equal(seenOnPc?.lastTimePlayed, "2026-11-10T00:00:00.000Z");
    assert.equal(
      otherDevicesPlaytime(merged, "ally").get("steam:1")
        ?.playTimeInMilliseconds,
      60_000
    );
  });

  it("keeps the latest favourite and pin change", () => {
    const before = recordGameFlags(
      {},
      [["steam:1", game({ favorite: true })]],
      100,
      "pc"
    );
    const later = recordGameFlags(
      before,
      [
        [
          "steam:1",
          game({
            favorite: false,
            isPinned: true,
            pinnedDate: new Date("2026-11-11T00:00:00.000Z"),
          }),
        ],
      ],
      200,
      "ally"
    );
    const merged = mergeSyncEntries(before, later);
    assert.deepEqual(merged["steam:1"].value, {
      favorite: false,
      isPinned: true,
      pinnedDate: "2026-11-11T00:00:00.000Z",
    });
  });

  it("patches only what differs", () => {
    const local = game({
      favorite: true,
      otherDevicesPlayTimeInMilliseconds: 5,
    });
    assert.equal(
      syncedGamePatch(
        local,
        { favorite: true, isPinned: false, pinnedDate: null },
        { playTimeInMilliseconds: 5, lastTimePlayed: null }
      ),
      null
    );

    assert.deepEqual(
      syncedGamePatch(local, null, {
        playTimeInMilliseconds: 40,
        lastTimePlayed: "2026-11-12T00:00:00.000Z",
      }),
      {
        otherDevicesPlayTimeInMilliseconds: 40,
        lastTimePlayed: new Date("2026-11-12T00:00:00.000Z"),
      }
    );
  });

  it("does not record games that were never played or were removed", () => {
    const entries = recordOwnPlaytime(
      {},
      [
        ["steam:1", game()],
        ["steam:2", game({ playTimeInMilliseconds: 10, isDeleted: true })],
      ],
      1,
      "pc"
    );
    assert.deepEqual(entries, {});
  });
});
