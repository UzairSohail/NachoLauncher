import { registerEvent } from "../register-event";
import type { GameShop } from "@types";
import { gamesSublevel, levelKeys } from "@main/level";
import {
  libraryWriteQueue,
  markHydraPlaytimeChanged,
} from "../../services/library-queue/library-write-queue";
import { resetHydraPlaytimeTicks } from "../../services/game-running-state";
import { scheduleSettingsSync } from "../../services/game-record-updater";

const changeGamePlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  playTimeInSeconds: number
) => {
  const key = levelKeys.game(shop, objectId);
  await libraryWriteQueue.run(async () => {
    const latest = await gamesSublevel.get(key);
    if (!latest) return;
    await gamesSublevel.put(key, {
      ...latest,
      // The new total includes time synced from other devices, so this
      // device keeps only the rest.
      playTimeInMilliseconds: Math.max(
        0,
        playTimeInSeconds * 1000 -
          (latest.otherDevicesPlayTimeInMilliseconds ?? 0)
      ),
      hasManuallyUpdatedPlaytime: true,
      unsyncedDeltaPlayTimeInMilliseconds: 0,
    });
    markHydraPlaytimeChanged(key);
    resetHydraPlaytimeTicks(key);
    scheduleSettingsSync();
  });
};
registerEvent("changeGamePlayTime", changeGamePlaytime);
