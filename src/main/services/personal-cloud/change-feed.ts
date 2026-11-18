import { BatteryState } from "../battery-state";
import { logger } from "../logger";
import { PersonalCloud } from "./index";

const POLL_MS = 60_000;
// On battery, Drive is asked at most every 5 minutes, so Wi-Fi can rest.
const MIN_GAP_ON_BATTERY_MS = 5 * 60_000;
const FIRST_CHECK_DELAY_MS = 20_000;

type Listener = () => void;

/**
 * One cheap Drive request a minute that says whether anything in the Nacho
 * folder changed. Settings, achievements and the phone link read their files
 * only when it says so, instead of each polling Drive on its own timer.
 *
 * Drive reports this launcher's own writes too, so a change can be our own.
 * Listeners must cope with having nothing new to read.
 */
export class DriveChangeFeed {
  private static token: string | null = null;
  private static timer: NodeJS.Timeout | null = null;
  private static lastCheckAt = 0;
  private static checking: Promise<void> | null = null;
  private static readonly listeners = new Set<Listener>();

  public static subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public static start() {
    if (this.timer) return;
    setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS);
    this.timer = setInterval(() => {
      if (
        BatteryState.isOnBattery() &&
        Date.now() - this.lastCheckAt < MIN_GAP_ON_BATTERY_MS
      ) {
        return;
      }
      void this.check();
    }, POLL_MS);
  }

  public static check(): Promise<void> {
    this.lastCheckAt = Date.now();
    this.checking ??= this.checkOnce()
      .catch((error) => {
        // A token Drive no longer accepts, or an outage. Start over, and let
        // everyone check for themselves once in case something was missed.
        logger.warn("[DriveChangeFeed] Change check failed", error);
        const hadToken = this.token !== null;
        this.token = null;
        if (hadToken) this.notify();
      })
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }

  private static async checkOnce() {
    const status = await PersonalCloud.status().catch(() => null);
    if (!status?.signedIn) {
      this.token = null;
      return;
    }

    const result = await PersonalCloud.changes(this.token);
    if (!result) {
      // No change feed (a local test folder): behave like a plain poll.
      this.notify();
      return;
    }

    this.token = result.token;
    // The first call has nothing to compare against and always reports a
    // change, which covers anything written since the services' launch sync.
    if (result.changed) this.notify();
  }

  private static notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        logger.error("[DriveChangeFeed] Listener failed", error);
      }
    }
  }
}
