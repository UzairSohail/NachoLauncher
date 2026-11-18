import { downloadSourcesSublevel } from "@main/level";
import { SettingsSync } from "@main/services/settings-sync";
import { registerEvent } from "../register-event";

const removeDownloadSource = async (
  _event: Electron.IpcMainInvokeEvent,
  removeAll = false,
  downloadSourceId?: string
) => {
  if (removeAll) {
    await downloadSourcesSublevel.clear();
  } else if (downloadSourceId) {
    await downloadSourcesSublevel.del(downloadSourceId);
  }

  SettingsSync.scheduleSync();
};

registerEvent("removeDownloadSource", removeDownloadSource);
