import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as visibilityModule from "./cloud-tab-visibility.ts";

const { shouldShowCloudSaveV2Tab, shouldShowEmulatorSavesTab } =
  visibilityModule;

describe("Big Picture cloud save V2 tab visibility", () => {
  it("never shows the V2 tab for PC games", () => {
    assert.equal(shouldShowCloudSaveV2Tab("steam", true), false);
    assert.equal(shouldShowCloudSaveV2Tab("custom", true), false);
  });

  it("shows V2 for eligible LaunchBox emulators once signed in to Google", () => {
    for (const platform of [
      "Sony PlayStation 3",
      "Nintendo Game Boy Advance",
    ]) {
      assert.equal(shouldShowCloudSaveV2Tab("launchbox", true, platform), true);
      assert.equal(
        shouldShowCloudSaveV2Tab("launchbox", false, platform),
        false
      );
    }
  });

  it("hides V2 for emulators that use the emulator saves tab", () => {
    for (const platform of [
      "Sony PlayStation",
      "Sony PlayStation 2",
      "Nintendo GameCube",
      "Nintendo Wii",
      "Atari 2600",
    ]) {
      assert.equal(
        shouldShowCloudSaveV2Tab("launchbox", true, platform),
        false
      );
    }
  });
});

describe("Big Picture emulator saves tab visibility", () => {
  it("shows the tab for memory card and Dolphin emulators once signed in", () => {
    for (const platform of [
      "Sony PlayStation",
      "Sony PlayStation 2",
      "Nintendo GameCube",
      "Nintendo Wii",
    ]) {
      assert.equal(
        shouldShowEmulatorSavesTab("launchbox", true, platform),
        true
      );
      assert.equal(
        shouldShowEmulatorSavesTab("launchbox", false, platform),
        false
      );
    }
  });

  it("hides the tab for PC games and V2 emulators", () => {
    assert.equal(shouldShowEmulatorSavesTab("steam", true), false);
    assert.equal(
      shouldShowEmulatorSavesTab("launchbox", true, "Sony PlayStation 3"),
      false
    );
    assert.equal(
      shouldShowEmulatorSavesTab("launchbox", true, "Atari 2600"),
      false
    );
  });
});
