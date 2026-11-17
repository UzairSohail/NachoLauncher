import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { Game } from "../../../types/level.types";

const DEFAULT_PREFIX = "/prefixes/Namespace:Item";

function load(game: Game | undefined) {
  const state = {
    environmentPrefixes: [] as Array<string | undefined>,
  };
  const modules: Record<string, unknown> = {
    "./recompilation-cloud-save": {
      getCloudSaveGameRecord: async () => game,
    },
    "@main/services/steam": { getSteamLocation: async () => undefined },
    "@main/services/system-path": { SystemPath: { getPath: () => "/home" } },
    "@main/services/wine": {
      Wine: {
        getEffectivePrefixPath: () => DEFAULT_PREFIX,
        resolvePrefixPath: async (prefix: string | null) => prefix,
        validatePrefix: () => true,
      },
    },
    "@main/services/logger": { logger: { warn: () => {} } },
    "@main/services/steam-login-users": {
      getSteamStoreUserContext: async () => ({ known: [] }),
    },
    "@shared": {
      getCloudSaveEmulatorProvider: () => null,
      isDiscCloudSaveEmulatorProvider: () => false,
      discCloudSaveEmulatorSystem: () => null,
    },
    "../emulators/emulators-repository": {
      getEmulatorConfig: async () => null,
    },
    "../retroarch/retroarch-repository": {
      getRetroArchConfig: async () => null,
    },
    "./emulator-save-provider": {
      getEmulatorSaveEnvironmentKey: async () => "",
    },
    "./emulator-provider-identity": {
      emulatorEnvironmentId: (id: string) => id,
    },
    "./cloud-save-environment": {
      resolveCloudSaveEnvironment: async (context: {
        winePrefixPath?: string;
      }) => {
        state.environmentPrefixes.push(context.winePrefixPath);
        return { environmentId: "env", prefixIdentityMode: "marker" };
      },
    },
  };
  const context = {} as typeof import("./cloud-save-game-context");
  const compiled = ts.transpileModule(
    fs.readFileSync(
      new URL("./cloud-save-game-context.ts", import.meta.url),
      "utf8"
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  );
  vm.runInNewContext(compiled.outputText, {
    exports: context,
    require: (specifier: string) =>
      modules[specifier] ?? assert.fail(`Unexpected dependency: ${specifier}`),
    process: { ...process, platform: "linux" },
  });
  return { context, state };
}

test("Windows games use the default per-game prefix", async () => {
  const { context, state } = load({
    shop: "steam",
    objectId: "Namespace:Item",
    executablePath: "/games/Game/Game.exe",
  } as unknown as Game);
  await context.getCloudSaveGameContext("Namespace:Item", "steam");
  assert.deepEqual(state.environmentPrefixes, [DEFAULT_PREFIX]);
});
