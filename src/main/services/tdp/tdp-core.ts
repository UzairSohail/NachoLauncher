import type { TdpRange } from "@types";

/**
 * Pure helpers for TDP control through steamos-manager. Kept free of Electron
 * and child processes so they can be unit tested.
 */

export const STEAMOS_MANAGER_DESTINATION = "com.steampowered.SteamOSManager1";
export const STEAMOS_MANAGER_PATH = "/com/steampowered/SteamOSManager1";
export const TDP_LIMIT_INTERFACE = `${STEAMOS_MANAGER_DESTINATION}.TdpLimit1`;
export const PERFORMANCE_PROFILE_INTERFACE = `${STEAMOS_MANAGER_DESTINATION}.PerformanceProfile1`;
export const CUSTOM_PERFORMANCE_PROFILE = "custom";

/**
 * True inside SteamOS Game Mode (the gamescope session). Steam and Decky
 * own the TDP there, so Nacho leaves it alone.
 */
export const isGamescopeSession = (env: NodeJS.ProcessEnv): boolean => {
  const desktops = [env.XDG_CURRENT_DESKTOP, env.XDG_SESSION_DESKTOP]
    .filter((value): value is string => typeof value === "string")
    .flatMap((value) => value.toLowerCase().split(":"));

  if (desktops.includes("gamescope")) return true;

  return Boolean(env.GAMESCOPE_WAYLAND_DISPLAY);
};

const BUSCTL_UINT_PATTERN = /^\s*[uiqnty]\s+(\d+)\s*$/;

/** Parses `busctl get-property` output for an integer, such as `u 15`. */
export const parseBusctlInteger = (output: string): number | null => {
  const match = BUSCTL_UINT_PATTERN.exec(output);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

/** Parses `busctl get-property` output for a string, such as `s "custom"`. */
export const parseBusctlString = (output: string): string | null => {
  const match = /^\s*s\s+"((?:[^"\\]|\\.)*)"\s*$/.exec(output);
  return match ? match[1] : null;
};

/** Parses `busctl get-property` output for a string array, such as `as 2 "a" "b"`. */
export const parseBusctlStringArray = (output: string): string[] | null => {
  const header = /^\s*as\s+(\d+)/.exec(output);
  if (!header) return null;

  const values = Array.from(
    output.slice(header[0].length).matchAll(/"((?:[^"\\]|\\.)*)"/g),
    (match) => match[1]
  );
  return values.length === Number(header[1]) ? values : null;
};

export const isValidTdpRange = (
  range: Partial<TdpRange> | null | undefined
): range is TdpRange =>
  Boolean(range) &&
  Number.isInteger(range!.min) &&
  Number.isInteger(range!.max) &&
  range!.min! > 0 &&
  range!.max! >= range!.min!;

/** A whole number of watts inside the device's range, or null. */
export const normalizeTdpLimit = (
  value: unknown,
  range: TdpRange | null
): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const watts = Math.round(value);
  if (!range) return watts > 0 ? watts : null;
  return Math.min(range.max, Math.max(range.min, watts));
};

/**
 * The limit Nacho should hold now: the override of the game that started
 * last, else the global limit. Null means the system default.
 */
export const resolveTargetTdpLimit = (options: {
  globalLimit: number | null | undefined;
  gameLimits: Record<string, number> | null | undefined;
  runningGameKeys: readonly string[];
}): { limit: number | null; gameKey: string | null } => {
  const { globalLimit, gameLimits, runningGameKeys } = options;

  for (let index = runningGameKeys.length - 1; index >= 0; index -= 1) {
    const gameKey = runningGameKeys[index];
    const gameLimit = gameLimits?.[gameKey];
    if (typeof gameLimit === "number" && gameLimit > 0) {
      return { limit: gameLimit, gameKey };
    }
  }

  return {
    limit:
      typeof globalLimit === "number" && globalLimit > 0 ? globalLimit : null,
    gameKey: null,
  };
};
