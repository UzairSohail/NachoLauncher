import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { it } from "node:test";

/*
 * The renderer reaches the main process through the `electron` object the
 * preload exposes. `globalThis.electron` isn't type checked, so a renderer
 * call to a preload function that was removed only fails at runtime, and on
 * startup that takes the whole window down. This catches it in the tests.
 */

const root = path.resolve(import.meta.dirname, "..");

const listSourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry.name) &&
      !/\.(test|d)\.tsx?$/.test(entry.name)
      ? [fullPath]
      : [];
  });

const exposedApi = () => {
  const source = fs.readFileSync(path.join(root, "preload/index.ts"), "utf8");
  return new Set(
    [...source.matchAll(/^ {2}([A-Za-z0-9_]+)\s*[:(,]/gm)].map(
      (match) => match[1]
    )
  );
};

it("exposes every preload function the renderer calls", () => {
  const exposed = exposedApi();
  const missing = new Map<string, string>();

  for (const app of ["renderer", "big-picture"]) {
    for (const file of listSourceFiles(path.join(root, app))) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(
        /\b(?:window|globalThis(?:\.window)?)\.electron\.([A-Za-z0-9_]+)/g
      )) {
        if (!exposed.has(match[1]) && !missing.has(match[1])) {
          missing.set(match[1], path.relative(root, file));
        }
      }
    }
  }

  assert.deepEqual(
    [...missing].map(([name, file]) => `${name} (${file})`),
    []
  );
});
