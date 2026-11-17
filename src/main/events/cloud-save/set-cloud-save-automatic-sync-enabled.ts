import { setCloudSaveAutomaticSyncEnabled } from "@main/services/cloud-save";
import type { GameShop } from "@types";

import { registerEvent } from "../register-event";

registerEvent(
  "setCloudSaveAutomaticSyncEnabled",
  async (
    _event: Electron.IpcMainInvokeEvent,
    objectId: string,
    shop: GameShop,
    enabled: boolean
  ) => {
    return setCloudSaveAutomaticSyncEnabled(objectId, shop, enabled);
  }
);
