import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createAppFolderGate,
  LEGACY_FOLDER_RECHECK_MS,
  type LegacyFolderMove,
} from "./app-folder.js";

describe("createAppFolderGate", () => {
  it("moves once, then waits before looking again", async () => {
    let time = 0;
    let moves = 0;
    const ensure = createAppFolderGate(
      async () => {
        moves += 1;
        return { outcome: "nothing", copied: 0 };
      },
      undefined,
      () => time
    );

    await ensure();
    await ensure();
    assert.equal(moves, 1);

    time += LEGACY_FOLDER_RECHECK_MS;
    await ensure();
    assert.equal(moves, 2);
  });

  it("shares one move between callers that arrive together", async () => {
    let moves = 0;
    const ensure = createAppFolderGate(async () => {
      moves += 1;
      return { outcome: "renamed", copied: 0 };
    });

    await Promise.all([ensure(), ensure(), ensure()]);
    assert.equal(moves, 1);
  });

  it("fails the caller and tries again when the move fails", async () => {
    let fail = true;
    let moves = 0;
    const moved: LegacyFolderMove[] = [];
    const ensure = createAppFolderGate(
      async () => {
        moves += 1;
        if (fail) throw new Error("offline");
        return { outcome: "merged", copied: 3 };
      },
      (result) => moved.push(result)
    );

    await assert.rejects(ensure(), /offline/);
    fail = false;
    await ensure();
    assert.equal(moves, 2);
    assert.deepEqual(moved, [{ outcome: "merged", copied: 3 }]);
  });
});
