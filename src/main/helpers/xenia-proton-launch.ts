import { Umu, Wine } from "@main/services";
import type { UserPreferences } from "@types";

/*
 * Xenia Canary's Windows build is the most compatible one on Linux and
 * SteamOS, run through Proton with umu-run (the same compatibility layer
 * Nacho uses for Windows games). All Xbox 360 games share one prefix, so
 * Xenia keeps a single content folder with every save and profile.
 */

export const XENIA_PREFIX_ID = "xenia-canary";

const resolveProtonPath = (
  preferences: UserPreferences | null
): string | null => {
  const protonPath = preferences?.defaultProtonPath;
  return protonPath && Umu.isValidProtonPath(protonPath) ? protonPath : null;
};

export interface XeniaProtonLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export const buildXeniaProtonLaunch = async ({
  executableTarget,
  args,
  preferences,
  useMangohud,
}: {
  executableTarget: string;
  args: string[];
  preferences: UserPreferences | null;
  useMangohud: boolean;
}): Promise<XeniaProtonLaunch> => {
  const winePrefixPath = await Wine.resolvePrefixPath(
    Wine.getDefaultPrefixPathForGame(XENIA_PREFIX_ID)
  );
  const protonPath = resolveProtonPath(preferences);
  const { command, args: runArgs } = Umu.resolveRunCommand(
    executableTarget,
    args
  );

  return {
    command,
    args: runArgs,
    env: {
      GAMEID: `umu-${XENIA_PREFIX_ID}`,
      ...(winePrefixPath ? { WINEPREFIX: winePrefixPath } : {}),
      ...(protonPath ? { PROTONPATH: protonPath } : {}),
      ...(useMangohud ? { MANGOHUD: "1" } : {}),
    },
  };
};
