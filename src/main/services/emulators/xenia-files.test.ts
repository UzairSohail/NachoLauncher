import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildXeniaLaunchArguments,
  toWineZDrivePath,
  xeniaNeedsProton,
} from "./xenia-files.js";

describe("xenia launch arguments", () => {
  it("runs the Windows build through Proton only on Linux", () => {
    assert.equal(xeniaNeedsProton("/x/xenia_canary.exe", "linux"), true);
    assert.equal(
      xeniaNeedsProton("/x/xenia_canary_linux.AppImage", "linux"),
      false
    );
    assert.equal(xeniaNeedsProton("C:\\x\\xenia_canary.exe", "win32"), false);
  });

  it("hands Proton a Z: drive path", () => {
    assert.equal(
      toWineZDrivePath("/home/deck/roms/Halo 3.iso"),
      "Z:\\home\\deck\\roms\\Halo 3.iso"
    );
    assert.deepEqual(
      buildXeniaLaunchArguments(
        "/home/deck/roms/Halo 3.iso",
        "/home/deck/Xenia Canary/xenia_canary.exe",
        "linux"
      ),
      ["--fullscreen", "Z:\\home\\deck\\roms\\Halo 3.iso"]
    );
  });

  it("passes the game path as is to native builds", () => {
    assert.deepEqual(
      buildXeniaLaunchArguments(
        "D:\\Roms\\Halo 3.iso",
        "C:\\Xenia\\xenia_canary.exe",
        "win32"
      ),
      ["--fullscreen", "D:\\Roms\\Halo 3.iso"]
    );
  });
});
