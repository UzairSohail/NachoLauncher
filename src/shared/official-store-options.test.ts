import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LibraryGame } from "@types";
import {
  getInstalledStoreMembers,
  getOfficialStoreMembers,
} from "./official-store-options.js";

const makeGame = (overrides: Partial<LibraryGame> = {}) =>
  ({
    id: "steam:real-id",
    shop: "steam",
    objectId: "real-id",
    title: "Steam presentation",
    availableShops: ["steam"],
    catalogueGame: { shop: "steam", objectId: "catalogue-id" },
    hasActiveSteamImport: true,
    ...overrides,
  }) as LibraryGame;

describe("official store members", () => {
  it("only reports a Steam copy the account actually imported", () => {
    const steam = makeGame();
    assert.equal(getOfficialStoreMembers([steam]).steam, steam);
    assert.equal(
      getOfficialStoreMembers([makeGame({ hasActiveSteamImport: false })])
        .steam,
      null
    );
    assert.equal(
      getOfficialStoreMembers([makeGame({ isDeleted: true })]).steam,
      null
    );
  });

  it("lists installed Steam copies once", () => {
    const installed = makeGame({ executablePath: "game.exe" });
    assert.deepEqual(getInstalledStoreMembers([installed, installed]), [
      installed,
    ]);
    assert.deepEqual(getInstalledStoreMembers([makeGame()]), []);
  });
});
