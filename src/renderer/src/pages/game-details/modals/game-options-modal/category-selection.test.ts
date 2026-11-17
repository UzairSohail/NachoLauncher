import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as categorySelectionModule from "./category-selection.ts";

const {
  getAvailableGameSettingsCategory,
  getCloudGameSettingsCategories,
  shouldInitializeGameSettingsCategory,
} = categorySelectionModule;

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
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showLegacyCloudSaveSettings: false,
        showDownloadSettings: true,
      }),
      "assets"
    );
  });

  it("falls back when the selected cloud category is unavailable", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: false,
        showLegacyCloudSaveSettings: true,
        showDownloadSettings: true,
      }),
      "general"
    );
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud_legacy", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showLegacyCloudSaveSettings: false,
        showDownloadSettings: true,
      }),
      "general"
    );
  });

  it("falls back when cloud access is lost", () => {
    assert.equal(
      getAvailableGameSettingsCategory("hydra_cloud", {
        cloudSaveAccessAction: "paywall",
        showCloudSaveV2Settings: true,
        showLegacyCloudSaveSettings: true,
        showDownloadSettings: true,
      }),
      "general"
    );
  });

  it("falls back when downloads are unavailable", () => {
    assert.equal(
      getAvailableGameSettingsCategory("downloads", {
        cloudSaveAccessAction: "open",
        showCloudSaveV2Settings: true,
        showLegacyCloudSaveSettings: true,
        showDownloadSettings: false,
      }),
      "general"
    );
  });

  it("orders active Hydra Cloud before legacy archives", () => {
    const availability = {
      cloudSaveAccessAction: "open" as const,
      showCloudSaveV2Settings: true,
      showLegacyCloudSaveSettings: true,
      showDownloadSettings: true,
    };
    assert.deepEqual(getCloudGameSettingsCategories(availability, "archive"), [
      "hydra_cloud",
      "hydra_cloud_legacy",
    ]);
    assert.deepEqual(
      getCloudGameSettingsCategories(
        { ...availability, showCloudSaveV2Settings: false },
        "active"
      ),
      ["hydra_cloud_legacy"]
    );
  });

  it("hides Hydra Cloud categories behind the paywall", () => {
    assert.deepEqual(
      getCloudGameSettingsCategories(
        {
          cloudSaveAccessAction: "paywall",
          showCloudSaveV2Settings: true,
          showLegacyCloudSaveSettings: true,
          showDownloadSettings: true,
        },
        "active"
      ),
      []
    );
  });
});
