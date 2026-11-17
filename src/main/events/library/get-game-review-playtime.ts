import { registerEvent } from "../register-event";
import { gamesSublevel, levelKeys } from "@main/level";
import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import type { GameShop } from "@types";

const getGameReviewPlaytime = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const recordIncludingRemoved = await gamesSublevel.get(
    levelKeys.game(shop, objectId)
  );
  if (!recordIncludingRemoved) return 0;

  return getDisplayedPlayTimeInMilliseconds(recordIncludingRemoved);
};

registerEvent("getGameReviewPlaytime", getGameReviewPlaytime);
