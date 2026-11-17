import path from "node:path";

import {
  cloudSaveRetroArchBindingsSublevel,
  type RetroArchBindingRecord,
} from "@main/level";
import type { Game } from "@types";

export {
  legacyRetroArchStateId,
  remoteRetroArchStateId,
  reconcileRetroArchStateBindings,
  retroArchStateCloudIdentity,
  type RetroArchObservedState,
} from "./retroarch-state-binding-policy.js";
import { getCloudSaveUserId } from "./cloud-save-user";

const bindingKey = async (game: Game) => {
  const userId = await getCloudSaveUserId();
  return JSON.stringify([userId, game.shop, game.objectId, "retroarch-v2"]);
};

export const loadRetroArchBindings = async (
  game: Game
): Promise<RetroArchBindingRecord> => {
  const stored = await cloudSaveRetroArchBindingsSublevel.get(
    await bindingKey(game)
  );
  if (
    stored?.version === 1 &&
    Array.isArray(stored.states) &&
    stored.states.every(
      (state) =>
        /^[a-f0-9]{64}$/.test(state.id) &&
        path.isAbsolute(state.path) &&
        /^\.state(?:\d+|\.auto)?$/.test(state.slot) &&
        /^[a-f0-9]{64}$/.test(state.hash)
    )
  ) {
    return stored;
  }
  return { version: 1, activeRomPath: null, states: [] };
};

export const saveRetroArchBindings = async (
  game: Game,
  record: RetroArchBindingRecord
) => {
  await cloudSaveRetroArchBindingsSublevel.put(await bindingKey(game), record);
};
