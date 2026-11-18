import type { GameShop } from "@types";
import { levelKeys } from "@main/level";
import { TdpController } from "@main/services/tdp";
import { BatteryState } from "@main/services/battery-state";
import { getUserPreferences } from "@main/services/user-preferences";
import { applyUserPreferences } from "../user-preferences/update-user-preferences";
import { registerEvent } from "../register-event";

const parseLimit = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid TDP limit");
  }
  return Math.round(value);
};

registerEvent(
  "getTdpStatus",
  async (_event, shop?: GameShop | null, objectId?: string | null) =>
    TdpController.getStatus(
      shop && objectId ? levelKeys.game(shop, objectId) : null
    )
);

registerEvent("getOnBatteryPower", () => BatteryState.isOnBattery());

registerEvent("prepareTdpControl", async () => {
  await TdpController.prepare();
});

// TDP settings stay on this device: none of these keys are synced.
registerEvent("setGlobalTdpLimit", async (_event, watts: unknown) => {
  await applyUserPreferences({ tdpLimitWatts: parseLimit(watts) });
  await TdpController.apply();
});

registerEvent(
  "setGameTdpLimit",
  async (_event, shop: GameShop, objectId: string, watts: unknown) => {
    if (typeof shop !== "string" || typeof objectId !== "string") {
      throw new Error("Invalid game");
    }
    const limit = parseLimit(watts);
    const gameKey = levelKeys.game(shop, objectId);
    const preferences = await getUserPreferences();
    const gameLimits = { ...(preferences?.tdpGameLimits ?? {}) };

    if (limit === null) delete gameLimits[gameKey];
    else gameLimits[gameKey] = limit;

    await applyUserPreferences({ tdpGameLimits: gameLimits });
    await TdpController.apply();
  }
);
