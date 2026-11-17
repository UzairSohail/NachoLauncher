import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { findXeniaSaveFolders, xeniaRestoreTargets } from "./xenia-saves.js";

const makeContentRoot = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xenia-saves-"));
  const save = async (...parts: string[]) => {
    const folder = path.join(root, ...parts);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "save.dat"), "x");
  };
  return { root, save };
};

describe("xenia saves", () => {
  it("finds per-profile and older-layout saved games only", async () => {
    const { root, save } = await makeContentRoot();
    try {
      await save("E030000012345678", "4d5307e6", "00000001", "slot1");
      await save("E030000012345678", "4D5307E6", "00000002"); // DLC
      await save("E030000012345678", "FFFE07D1", "00000001"); // dashboard
      await save("0000000000000000", "4D5307E6", "00000001"); // shared
      await save("415607D1", "00000001");

      const found = await findXeniaSaveFolders([root, path.join(root, "nope")]);
      const summary = found
        .map((f) => `${f.profileId ?? "-"}/${f.titleId}`)
        .sort();
      assert.deepEqual(summary, ["-/415607D1", "E030000012345678/4D5307E6"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("restores into local profiles, or recreates the original one", async () => {
    const { root, save } = await makeContentRoot();
    try {
      assert.deepEqual(
        (await xeniaRestoreTargets([root], "E0300000AAAAAAAA")).map(
          (t) => t.directory
        ),
        [path.join(root, "E0300000AAAAAAAA")]
      );

      await save("E030000012345678", "FFFE07D1", "00010000");
      assert.deepEqual(
        (await xeniaRestoreTargets([root], "E0300000AAAAAAAA")).map(
          (t) => t.directory
        ),
        [path.join(root, "E030000012345678")]
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
