import { appVersion, defaultDownloadsPath, isStaging } from "@main/constants";
import { ipcMain } from "electron";
import { ScreenshotService } from "@main/services/screenshot";

import "./autoupdater";
import "./big-picture";
import "./catalogue";
import "./cloud-save";
import "./personal-cloud";
import "./connectivity";
import "./download-sources";
import "./hardware";
import "./library";
import "./leveldb";
import "./main-window-controls";
import "./misc";
import "./recompilation";
import "./notifications";
import "./profile";
import "./screenshots";
import "./themes";
import "./torrenting";
import "./user";
import "./user-preferences";
import "./library/transfer-game-files";
import "./emulators";
import "./retroarch";
import "./screenshot-input";

ipcMain.handle("ping", () => "pong");
ipcMain.handle("getVersion", () => appVersion);
ipcMain.handle("isStaging", () => isStaging);
ipcMain.handle("getDefaultDownloadsPath", () => defaultDownloadsPath);
ipcMain.handle("getScreenshotsPath", () =>
  ScreenshotService.getScreenshotsPath()
);
