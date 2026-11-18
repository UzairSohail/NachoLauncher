import fs from "node:fs/promises";
import path from "node:path";

import { powerMonitor } from "electron";

import { logger } from "./logger";
import { WindowManager } from "./window-manager";
import {
  isRunningOnBattery,
  type PowerSupplyReading,
} from "./battery-state-core";

const POWER_SUPPLY_DIR = "/sys/class/power_supply";
const LINUX_POLL_MS = 30_000;

const readValue = (file: string) =>
  fs
    .readFile(file, "utf8")
    .then((value) => value.trim())
    .catch(() => null);

const readLinuxPowerSupplies = async (): Promise<PowerSupplyReading[]> => {
  const names = await fs.readdir(POWER_SUPPLY_DIR).catch(() => []);
  return Promise.all(
    names.map(async (name) => {
      const dir = path.join(POWER_SUPPLY_DIR, name);
      const [type, status, online, scope] = await Promise.all([
        readValue(path.join(dir, "type")),
        readValue(path.join(dir, "status")),
        readValue(path.join(dir, "online")),
        readValue(path.join(dir, "scope")),
      ]);
      return { type: type ?? "", status, online, scope };
    })
  );
};

/**
 * Whether the device is running on battery. Background work stretches its
 * timers then, and Big Picture can turn its effects down.
 */
export class BatteryState {
  private static onBattery = false;
  private static started = false;
  private static readonly listeners = new Set<(onBattery: boolean) => void>();

  public static isOnBattery() {
    return this.onBattery;
  }

  /** `acValue` on mains power, `batteryValue` on battery. */
  public static pick<T>(acValue: T, batteryValue: T): T {
    return this.onBattery ? batteryValue : acValue;
  }

  public static subscribe(listener: (onBattery: boolean) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private static set(onBattery: boolean) {
    if (onBattery === this.onBattery) return;
    this.onBattery = onBattery;
    logger.info(onBattery ? "Running on battery" : "Running on mains power");
    WindowManager.sendToAppWindows("on-battery-power-changed", onBattery);
    for (const listener of this.listeners) {
      try {
        listener(onBattery);
      } catch (error) {
        logger.error("Battery state listener failed", error);
      }
    }
  }

  private static async refreshLinux() {
    const supplies = await readLinuxPowerSupplies();
    this.set(isRunningOnBattery(supplies));
  }

  public static start() {
    if (this.started) return;
    this.started = true;

    if (process.platform === "linux") {
      // Electron's power events don't reach every Linux desktop, so read
      // the kernel's power supply state. A few small file reads.
      void this.refreshLinux();
      setInterval(() => void this.refreshLinux(), LINUX_POLL_MS).unref?.();
      return;
    }

    try {
      this.onBattery = powerMonitor.isOnBatteryPower();
    } catch {
      this.onBattery = false;
    }
    powerMonitor.on("on-battery", () => this.set(true));
    powerMonitor.on("on-ac", () => this.set(false));
  }
}
