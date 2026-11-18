import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCloudSaveAccessAction } from "./cloud-save-access.js";

describe("cloud save access", () => {
  it("asks for Google sign-in for emulator games when signed out", () => {
    assert.equal(
      resolveCloudSaveAccessAction("launchbox", "Sony Playstation 2", {
        driveSignedIn: false,
      }),
      "sign-in"
    );
  });

  it("opens emulator cloud saves once signed in to Google", () => {
    assert.equal(
      resolveCloudSaveAccessAction("launchbox", "Sony Playstation 2", {
        driveSignedIn: true,
      }),
      "open"
    );
  });

  it("leaves PC games to Cloud Save Manager", () => {
    assert.equal(
      resolveCloudSaveAccessAction("steam", null, { driveSignedIn: true }),
      "unavailable"
    );
  });
});
