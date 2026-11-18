import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isGamescopeSession,
  isValidTdpRange,
  normalizeTdpLimit,
  parseBusctlInteger,
  parseBusctlString,
  parseBusctlStringArray,
  resolveTargetTdpLimit,
} from "./tdp-core.js";

describe("TDP core", () => {
  it("detects SteamOS Game Mode", () => {
    assert.equal(
      isGamescopeSession({ XDG_CURRENT_DESKTOP: "gamescope" }),
      true
    );
    assert.equal(
      isGamescopeSession({ XDG_SESSION_DESKTOP: "gamescope" }),
      true
    );
    assert.equal(
      isGamescopeSession({ GAMESCOPE_WAYLAND_DISPLAY: "gamescope-0" }),
      true
    );
    assert.equal(isGamescopeSession({ XDG_CURRENT_DESKTOP: "KDE" }), false);
    assert.equal(isGamescopeSession({}), false);
  });

  it("parses busctl property output", () => {
    assert.equal(parseBusctlInteger("u 15\n"), 15);
    assert.equal(parseBusctlInteger('s "15"'), null);
    assert.equal(parseBusctlString('s "custom"\n'), "custom");
    assert.deepEqual(
      parseBusctlStringArray('as 3 "low-power" "balanced" "custom"\n'),
      ["low-power", "balanced", "custom"]
    );
    assert.equal(parseBusctlStringArray('as 2 "one"'), null);
  });

  it("validates ranges and keeps limits inside them", () => {
    assert.equal(isValidTdpRange({ min: 5, max: 30 }), true);
    assert.equal(isValidTdpRange({ min: 30, max: 5 }), false);
    assert.equal(isValidTdpRange(null), false);
    assert.equal(normalizeTdpLimit(40, { min: 5, max: 30 }), 30);
    assert.equal(normalizeTdpLimit(2, { min: 5, max: 30 }), 5);
    assert.equal(normalizeTdpLimit(12.4, { min: 5, max: 30 }), 12);
    assert.equal(normalizeTdpLimit("12", { min: 5, max: 30 }), null);
  });

  it("prefers the override of the game that started last", () => {
    const gameLimits = { "steam:1": 10, "steam:2": 25 };

    assert.deepEqual(
      resolveTargetTdpLimit({
        globalLimit: 15,
        gameLimits,
        runningGameKeys: ["steam:1", "steam:2"],
      }),
      { limit: 25, gameKey: "steam:2" }
    );
    assert.deepEqual(
      resolveTargetTdpLimit({
        globalLimit: 15,
        gameLimits,
        runningGameKeys: ["steam:3"],
      }),
      { limit: 15, gameKey: null }
    );
    assert.deepEqual(
      resolveTargetTdpLimit({
        globalLimit: null,
        gameLimits,
        runningGameKeys: [],
      }),
      { limit: null, gameKey: null }
    );
  });
});
