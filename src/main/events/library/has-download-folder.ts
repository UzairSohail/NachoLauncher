import fs from "node:fs";

import { registerEvent } from "../register-event";
import { downloadsSublevel, levelKeys } from "@main/level";
import { getDownloadFolderPath } from "@main/helpers/find-game-installer";
import type { GameShop } from "@types";

const hasDownloadFolder = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
): Promise<boolean> => {
  const download = await downloadsSublevel.get(levelKeys.game(shop, objectId));
  const folderPath = download ? await getDownloadFolderPath(download) : null;

  if (!folderPath) return false;

  // An emptied folder (files deleted by hand, or a download that never
  // finished on this machine) is not an install.
  const stat = await fs.promises.stat(folderPath).catch(() => null);
  if (!stat) return false;
  if (!stat.isDirectory()) return true;
  const entries = await fs.promises.readdir(folderPath).catch(() => []);
  return entries.length > 0;
};

registerEvent("hasDownloadFolder", hasDownloadFolder);
