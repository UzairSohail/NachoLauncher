import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseDeckyRelease } from "./decky-release.js";

describe("parseDeckyRelease", () => {
  it("takes the tag without its v and the zip asset", () => {
    assert.deepEqual(
      parseDeckyRelease({
        tag_name: "v1.2.3",
        assets: [
          { name: "checksums.txt", browser_download_url: "https://x/c.txt" },
          { name: "Hydra.zip", browser_download_url: "https://x/Hydra.zip" },
        ],
      }),
      { version: "1.2.3", downloadUrl: "https://x/Hydra.zip" }
    );
  });

  it("refuses a release without a zip", () => {
    assert.throws(() => parseDeckyRelease({ tag_name: "1.0.0", assets: [] }));
  });
});
