import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  libraryWriteQueue,
  markHydraPlaytimeChanged,
} from "../../services/library-queue/library-write-queue";
import { resetHydraPlaytimeTicks } from "../../services/game-running-state";
import { scheduleSettingsSync } from "../../services/game-record-updater";

const resetGamePlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const key = levelKeys.game(shop, objectId);
  await libraryWriteQueue.run(async () => {
    const latest = await gamesSublevel.get(key);
    if (!latest) return;
    await gamesSublevel.put(key, {
      ...latest,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      hasManuallyUpdatedPlaytime: false,
      unsyncedDeltaPlayTimeInMilliseconds: 0,
    });
    markHydraPlaytimeChanged(key);
    resetHydraPlaytimeTicks(key);
    scheduleSettingsSync();
  });
};
registerEvent("resetGamePlayTime", resetGamePlaytime);
