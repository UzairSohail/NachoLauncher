import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { LANGUAGE_NAMES } from "./language-names.js";

const localesDir = path.dirname(fileURLToPath(import.meta.url));

describe("language names", () => {
  it("lists every locale with its own name", () => {
    const expected = Object.fromEntries(
      fs
        .readdirSync(localesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
          const file = path.join(localesDir, entry.name, "translation.json");
          const locale = JSON.parse(fs.readFileSync(file, "utf8")) as {
            language_name: string;
          };
          return [entry.name, locale.language_name];
        })
    );

    assert.deepEqual(
      Object.entries(LANGUAGE_NAMES).sort(),
      Object.entries(expected).sort()
    );
  });
});
