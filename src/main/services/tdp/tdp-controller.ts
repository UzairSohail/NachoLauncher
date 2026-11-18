import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { TdpRange, TdpStatus, UserPreferences } from "@types";
import { logger } from "../logger";
import {
  getUserPreferences,
  saveUserPreferences,
} from "../user-preferences/user-preferences-store";
import {
  CUSTOM_PERFORMANCE_PROFILE,
  PERFORMANCE_PROFILE_INTERFACE,
  STEAMOS_MANAGER_DESTINATION,
  STEAMOS_MANAGER_PATH,
  TDP_LIMIT_INTERFACE,
  isGamescopeSession,
  isValidTdpRange,
  normalizeTdpLimit,
  parseBusctlInteger,
  parseBusctlString,
  parseBusctlStringArray,
  resolveTargetTdpLimit,
} from "./tdp-core";

const execFileAsync = promisify(execFile);

const BUSCTL_TIMEOUT_MS = 3_000;
/** A launch that never shows a running game gives its override back. */
const PENDING_LAUNCH_TIMEOUT_MS = 3 * 60_000;
const PROFILE_SWITCH_WAIT_MS = 4_000;
const PROFILE_SWITCH_POLL_MS = 250;

const busctl = async (args: string[]) => {
  const { stdout } = await execFileAsync("busctl", ["--user", ...args], {
    timeout: BUSCTL_TIMEOUT_MS,
    windowsHide: true,
  });
  return String(stdout);
};

const getProperty = (iface: string, name: string) =>
  busctl([
    "get-property",
    STEAMOS_MANAGER_DESTINATION,
    STEAMOS_MANAGER_PATH,
    iface,
    name,
  ]);

const setProperty = (
  iface: string,
  name: string,
  signature: string,
  value: string
) =>
  busctl([
    "set-property",
    STEAMOS_MANAGER_DESTINATION,
    STEAMOS_MANAGER_PATH,
    iface,
    name,
    signature,
    value,
  ]);

const readTdpRange = async (): Promise<TdpRange | null> => {
  try {
    const [minOutput, maxOutput] = await Promise.all([
      getProperty(TDP_LIMIT_INTERFACE, "TdpLimitMin"),
      getProperty(TDP_LIMIT_INTERFACE, "TdpLimitMax"),
    ]);
    const range = {
      min: parseBusctlInteger(minOutput) ?? undefined,
      max: parseBusctlInteger(maxOutput) ?? undefined,
    };
    return isValidTdpRange(range) ? range : null;
  } catch {
    return null;
  }
};

const readTdpLimit = async (): Promise<number | null> => {
  try {
    return parseBusctlInteger(
      await getProperty(TDP_LIMIT_INTERFACE, "TdpLimit")
    );
  } catch {
    return null;
  }
};

const readPerformanceProfiles = async (): Promise<{
  available: string[];
  current: string | null;
} | null> => {
  try {
    const [availableOutput, currentOutput] = await Promise.all([
      getProperty(
        PERFORMANCE_PROFILE_INTERFACE,
        "AvailablePerformanceProfiles"
      ),
      getProperty(PERFORMANCE_PROFILE_INTERFACE, "PerformanceProfile"),
    ]);
    const available = parseBusctlStringArray(availableOutput);
    if (!available) return null;
    return { available, current: parseBusctlString(currentOutput) };
  } catch {
    return null;
  }
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type TdpProbe =
  | { kind: "unavailable"; reason: NonNullable<TdpStatus["reason"]> }
  | { kind: "active"; range: TdpRange; current: number | null }
  | { kind: "needs-custom-profile"; profile: string | null };

/**
 * Holds the TDP limit through steamos-manager's TdpLimit1 D-Bus interface:
 * the global per-device limit, or a game's override while that game runs.
 * It never acts in Game Mode, where Steam and Decky own the TDP.
 */
export class TdpController {
  /** Running games in the order they started. */
  private static runningGameKeys: string[] = [];

  private static pendingLaunches = new Map<string, NodeJS.Timeout>();

  /** The limit before Nacho first changed it, to give back on "default". */
  private static baseline: number | null = null;

  /** The power profile before Nacho switched to "custom", if it did. */
  private static profileBeforeCustom: string | null = null;

  private static lastApplied: number | null = null;

  private static queue: Promise<unknown> = Promise.resolve();

  private static serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private static async probe(): Promise<TdpProbe> {
    if (process.platform !== "linux") {
      return { kind: "unavailable", reason: "unsupported-platform" };
    }
    if (isGamescopeSession(process.env)) {
      return { kind: "unavailable", reason: "game-mode" };
    }

    const range = await readTdpRange();
    if (range) {
      return { kind: "active", range, current: await readTdpLimit() };
    }

    // Some handhelds (ROG Ally, Legion Go) only expose TdpLimit1 while the
    // "custom" power profile is selected.
    const profiles = await readPerformanceProfiles();
    if (profiles?.available.includes(CUSTOM_PERFORMANCE_PROFILE)) {
      return { kind: "needs-custom-profile", profile: profiles.current };
    }

    return { kind: "unavailable", reason: "no-steamos-manager" };
  }

  private static async rememberRange(
    preferences: UserPreferences | null,
    range: TdpRange
  ) {
    const cached = preferences?.tdpLimitRange;
    if (cached?.min === range.min && cached?.max === range.max) return;
    const latest = await getUserPreferences();
    await saveUserPreferences({ ...latest, tdpLimitRange: range });
  }

  /** Switches to the custom profile and waits for TdpLimit1 to appear. */
  private static async enterCustomProfile(
    currentProfile: string | null
  ): Promise<TdpRange | null> {
    if (this.profileBeforeCustom === null && currentProfile) {
      this.profileBeforeCustom =
        currentProfile === CUSTOM_PERFORMANCE_PROFILE ? null : currentProfile;
    }

    await setProperty(
      PERFORMANCE_PROFILE_INTERFACE,
      "PerformanceProfile",
      "s",
      CUSTOM_PERFORMANCE_PROFILE
    );

    const deadline = Date.now() + PROFILE_SWITCH_WAIT_MS;
    while (Date.now() < deadline) {
      const range = await readTdpRange();
      if (range) return range;
      await wait(PROFILE_SWITCH_POLL_MS);
    }
    return null;
  }

  private static async restoreSystemDefault() {
    if (this.lastApplied === null) return;

    if (this.baseline !== null && (await readTdpRange())) {
      await setProperty(
        TDP_LIMIT_INTERFACE,
        "TdpLimit",
        "u",
        String(this.baseline)
      ).catch((error) =>
        logger.warn("Could not restore the previous TDP limit", error)
      );
    }

    if (this.profileBeforeCustom) {
      await setProperty(
        PERFORMANCE_PROFILE_INTERFACE,
        "PerformanceProfile",
        "s",
        this.profileBeforeCustom
      ).catch((error) =>
        logger.warn("Could not restore the previous power profile", error)
      );
    }

    logger.info("Restored the system TDP limit", {
      baseline: this.baseline,
      profile: this.profileBeforeCustom,
    });
    this.baseline = null;
    this.profileBeforeCustom = null;
    this.lastApplied = null;
  }

  private static async applyNow() {
    const probe = await this.probe();
    if (probe.kind === "unavailable") return;

    const preferences = await getUserPreferences();
    const target = resolveTargetTdpLimit({
      globalLimit: preferences?.tdpLimitWatts,
      gameLimits: preferences?.tdpGameLimits,
      runningGameKeys: this.runningGameKeys,
    });

    if (target.limit === null) {
      await this.restoreSystemDefault();
      return;
    }

    let range: TdpRange | null = probe.kind === "active" ? probe.range : null;
    if (probe.kind === "needs-custom-profile") {
      range = await this.enterCustomProfile(probe.profile);
      if (!range) {
        logger.warn("TDP control did not appear after the custom profile");
        return;
      }
    }
    if (!range) return;
    void this.rememberRange(preferences, range).catch(() => undefined);

    const current = await readTdpLimit();
    if (this.lastApplied === null && this.baseline === null) {
      this.baseline = current;
    }

    const watts = normalizeTdpLimit(target.limit, range);
    if (watts === null) return;
    if (current !== watts) {
      await setProperty(TDP_LIMIT_INTERFACE, "TdpLimit", "u", String(watts));
      logger.info("Set TDP limit", {
        watts,
        previous: current,
        gameKey: target.gameKey,
      });
    }
    this.lastApplied = watts;
  }

  /** Applies whichever limit should hold now. Safe to call often. */
  public static apply(): Promise<void> {
    return this.serialize(() =>
      this.applyNow().catch((error) => {
        logger.error("Failed to apply the TDP limit", error);
      })
    );
  }

  public static async getStatus(gameKey?: string | null): Promise<TdpStatus> {
    const [probe, preferences] = await Promise.all([
      this.probe(),
      getUserPreferences(),
    ]);

    const activeGameKey =
      resolveTargetTdpLimit({
        globalLimit: preferences?.tdpLimitWatts,
        gameLimits: preferences?.tdpGameLimits,
        runningGameKeys: this.runningGameKeys,
      }).gameKey ?? null;

    const base = {
      globalLimit: preferences?.tdpLimitWatts ?? null,
      gameLimit: gameKey
        ? (preferences?.tdpGameLimits?.[gameKey] ?? null)
        : null,
      activeGameKey,
    };

    if (probe.kind === "unavailable") {
      return {
        ...base,
        available: false,
        reason: probe.reason,
        range: null,
        current: null,
        needsCustomProfile: false,
      };
    }

    if (probe.kind === "active") {
      void this.rememberRange(preferences, probe.range).catch(() => undefined);
      return {
        ...base,
        available: true,
        range: probe.range,
        current: probe.current,
        needsCustomProfile: false,
      };
    }

    const cached = preferences?.tdpLimitRange;
    return {
      ...base,
      available: true,
      range: isValidTdpRange(cached) ? cached : null,
      current: null,
      needsCustomProfile: true,
    };
  }

  /**
   * Reads the device's TDP range when it only shows in the custom profile,
   * then puts the previous profile back if no limit is set.
   */
  public static prepare(): Promise<void> {
    return this.serialize(async () => {
      const probe = await this.probe();
      if (probe.kind !== "needs-custom-profile") return;

      const previousProfile = probe.profile;
      const range = await this.enterCustomProfile(previousProfile);
      if (range) {
        await this.rememberRange(await getUserPreferences(), range);
      }

      if (this.lastApplied === null) {
        if (previousProfile && previousProfile !== CUSTOM_PERFORMANCE_PROFILE) {
          await setProperty(
            PERFORMANCE_PROFILE_INTERFACE,
            "PerformanceProfile",
            "s",
            previousProfile
          ).catch(() => undefined);
        }
        this.profileBeforeCustom = null;
      }
    });
  }

  /** Called as Nacho launches a game, before the process watcher sees it. */
  public static onGameLaunching(gameKey: string) {
    const pending = this.pendingLaunches.get(gameKey);
    if (pending) clearTimeout(pending);

    this.pendingLaunches.set(
      gameKey,
      setTimeout(() => {
        this.pendingLaunches.delete(gameKey);
        this.onGameClosed(gameKey);
      }, PENDING_LAUNCH_TIMEOUT_MS)
    );
    this.markRunning(gameKey);
  }

  public static onGameStarted(gameKey: string) {
    const pending = this.pendingLaunches.get(gameKey);
    if (pending) {
      clearTimeout(pending);
      this.pendingLaunches.delete(gameKey);
    }
    this.markRunning(gameKey);
  }

  public static onGameClosed(gameKey: string) {
    const pending = this.pendingLaunches.get(gameKey);
    if (pending) {
      clearTimeout(pending);
      this.pendingLaunches.delete(gameKey);
    }
    if (!this.runningGameKeys.includes(gameKey)) return;
    this.runningGameKeys = this.runningGameKeys.filter(
      (key) => key !== gameKey
    );
    void this.apply();
  }

  private static markRunning(gameKey: string) {
    if (this.runningGameKeys.includes(gameKey)) return;
    this.runningGameKeys = [...this.runningGameKeys, gameKey];
    void this.apply();
  }
}
