import assert from "node:assert/strict";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import * as deepLinks from "./deep-link-protocol.ts";

const { buildAppDeepLink, findAppDeepLink, isAppDeepLink } = deepLinks;

describe("app deep links", () => {
  it("builds nacho:// links", () => {
    assert.equal(
      buildAppDeepLink(
        "run",
        new URLSearchParams({ shop: "steam", objectId: "10" })
      ),
      "nacho://run?shop=steam&objectId=10"
    );
  });

  it("accepts nacho:// and older hydralauncher:// links", () => {
    assert.equal(isAppDeepLink("nacho://run?shop=steam&objectId=10"), true);
    assert.equal(
      isAppDeepLink("hydralauncher://run?shop=steam&objectId=10"),
      true
    );
    assert.equal(isAppDeepLink("https://example.com"), false);
    assert.equal(isAppDeepLink("--big-picture"), false);
  });

  it("finds the link among command line arguments", () => {
    assert.equal(
      findAppDeepLink(["/app", "--hidden", "hydralauncher://screenshot"]),
      "hydralauncher://screenshot"
    );
    assert.equal(findAppDeepLink(["/app", "--hidden"]), undefined);
  });
});
