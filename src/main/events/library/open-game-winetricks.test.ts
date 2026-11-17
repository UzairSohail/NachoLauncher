import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function fixture() {
  let handler!: (...args: unknown[]) => Promise<boolean>;
  let legacyLookups = 0;
  const spawns: { binary: string; options: { env: Record<string, string> } }[] =
    [];
  const modules: Record<string, unknown> = {
    "../register-event": {
      registerEvent: (_name: string, callback: typeof handler) => {
        handler = callback;
      },
    },
    "@main/level": {
      levelKeys: { game: (shop: string, id: string) => `${shop}:${id}` },
      gamesSublevel: {
        get: async () => ({
          winePrefixPath: "/custom/prefix",
        }),
      },
    },
    "@main/services": {
      logger: { error: () => {} },
      Wine: {
        getEffectivePrefixPath: () => {
          legacyLookups++;
          return "/custom/prefix";
        },
      },
    },
    "node:child_process": {
      spawn: (binary: string, options: { env: Record<string, string> }) => {
        spawns.push({ binary, options });
        const child = Object.assign(new EventEmitter(), { unref: () => {} });
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
    },
  };
  const { outputText } = ts.transpileModule(
    fs.readFileSync(
      new URL("./open-game-winetricks.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ESNext,
      },
    }
  );
  new Function("exports", "require", "process", outputText)(
    {},
    (name: string) => modules[name] ?? assert.fail(name),
    { platform: "linux", env: { DISPLAY: ":0" } }
  );
  return {
    invoke: (shop: string) => handler({}, shop, "123"),
    spawns,
    legacyLookups: () => legacyLookups,
  };
}

test("games keep their Winetricks launcher and effective prefix", async () => {
  const f = fixture();
  assert.equal(await f.invoke("steam"), true);
  assert.equal(f.legacyLookups(), 1);
  assert.equal(f.spawns[0].binary, "winetricks");
  assert.equal(f.spawns[0].options.env.WINEPREFIX, "/custom/prefix");
});
