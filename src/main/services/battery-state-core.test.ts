import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRunningOnBattery } from "./battery-state-core.js";

describe("battery state", () => {
  it("is on battery only while discharging without mains", () => {
    assert.equal(
      isRunningOnBattery([
        { type: "Mains", online: "0" },
        { type: "Battery", status: "Discharging" },
      ]),
      true
    );
    assert.equal(
      isRunningOnBattery([
        { type: "USB", online: "1" },
        { type: "Battery", status: "Discharging" },
      ]),
      false
    );
    assert.equal(
      isRunningOnBattery([{ type: "Battery", status: "Full" }]),
      false
    );
    assert.equal(isRunningOnBattery([]), false);
    // A wireless controller's battery doesn't make a desktop PC "on battery".
    assert.equal(
      isRunningOnBattery([
        { type: "Battery", status: "Discharging", scope: "Device" },
      ]),
      false
    );
  });
});
