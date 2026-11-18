import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as visibilityModule from "./cloud-save-visibility.ts";

const { getCloudSaveVisibility } = visibilityModule;

describe("cloud save visibility", () => {
  it("uses V2 for Steam", () => {
    assert.deepEqual(getCloudSaveVisibility("steam"), {
      hero: "v2",
      settings: { showV2: true, showEmulatorSaves: false },
    });
  });

  it("uses V2 for eligible emulator platforms", () => {
    for (const platform of [
      "Sony PlayStation 3",
      "Nintendo Game Boy Advance",
    ]) {
      assert.deepEqual(getCloudSaveVisibility("launchbox", platform), {
        hero: "v2",
        settings: { showV2: true, showEmulatorSaves: false },
      });
    }
  });

  it("shows the Drive emulator saves panel for memory-card consoles", () => {
    for (const platform of [
      "Sony PlayStation",
      "Sony PlayStation 2",
      "Sony PlayStation Portable",
      "Nintendo GameCube",
      "Nintendo Wii",
    ]) {
      assert.deepEqual(getCloudSaveVisibility("launchbox", platform), {
        hero: "emulator",
        settings: { showV2: false, showEmulatorSaves: true },
      });
    }
  });

  it("has no emulator saves panel for unknown consoles", () => {
    assert.deepEqual(getCloudSaveVisibility("launchbox", "Unknown Console"), {
      hero: "emulator",
      settings: { showV2: false, showEmulatorSaves: false },
    });
  });

  it("shows nothing for custom games", () => {
    assert.deepEqual(getCloudSaveVisibility("custom"), {
      hero: null,
      settings: { showV2: false, showEmulatorSaves: false },
    });
  });
});
