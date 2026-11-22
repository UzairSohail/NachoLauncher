import { registerEvent } from "../register-event";
import { getProtonDBData } from "@main/services/protondb";

registerEvent(
  "getProtonDBData",
  (_event: Electron.IpcMainInvokeEvent, shop: string, objectId: string) =>
    getProtonDBData(shop, objectId)
);
