import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as categorySelectionModule from "./category-selection.ts";

const {
  getAvailableGameSettingsCategory,
  getCloudGameSettingsCategories,
  shouldInitializeGameSettingsCategory,
} = categorySelectionModule;

const available = {
  cloudSaveAccessAction: "open" as const,
  showCloudSaveV2Settings: true,
  showEmulatorSaves: true,
  showDownloadSettings: true,
};

describe("game options category selection", () => {
  it("initializes when the modal opens", () => {
    assert.equal(
      shouldInitializeGameSettingsCategory(
        { visible: false, initialCategory: "general" },
        { visible: true, initialCategory: "general" }
      ),
      true
    );
  });

  it("initializes when the requested category changes while open", () => {
    assert.equal(
      shouldInitializeGameSettingsCategory(
        { visible: true, initialCategory: "general" },
        { visible: true, initialCategory: "assets" }
      ),
      true
    );
  });

  it("does not initialize again while the modal remains open", () => {
    assert.equal(
      shouldInitializeGameSettingsCategory(
        { visible: true, initialCategory: "general" },
        { visible: true, initialCategory: "general" }
      ),
      false
    );
  });

  it("preserves a manually selected category when availability changes", () => {
    assert.equal(
      getAvailableGameSettingsCategory("assets", {
        ...available,
        showEmulatorSaves: false,
      }),
      "assets"
    );
  });

  it("falls back when the selected cloud category is unavailable", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        ...available,
        showCloudSaveV2Settings: false,
      }),
      "general"
    );
    assert.equal(
      getAvailableGameSettingsCategory("emulator_saves", {
        ...available,
        showEmulatorSaves: false,
      }),
      "general"
    );
  });

  it("falls back when Google sign-in is lost", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        ...available,
        cloudSaveAccessAction: "sign-in",
      }),
      "general"
    );
  });

  it("falls back when downloads are unavailable", () => {
    assert.equal(
      getAvailableGameSettingsCategory("downloads", {
        ...available,
        showDownloadSettings: false,
      }),
      "general"
    );
  });

  it("lists cloud categories only once they can be used", () => {
    assert.deepEqual(getCloudGameSettingsCategories(available), [
      "hydra_cloud",
      "emulator_saves",
    ]);
    assert.deepEqual(
      getCloudGameSettingsCategories({
        ...available,
        cloudSaveAccessAction: "sign-in",
      }),
      []
    );
  });
});
