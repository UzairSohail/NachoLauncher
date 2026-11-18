import { gamesSublevel } from "@main/level";

import { createGameRecordUpdater } from "./game-record-updater-core";

import { libraryWriteQueue } from "./library-sync/library-write-queue";
const updater = createGameRecordUpdater(gamesSublevel);

// Favourite and pin changes sync to the user's other devices through Drive.
const SYNCED_FIELDS = ["favorite", "isPinned", "pinnedDate"] as const;

export const scheduleSettingsSync = () => {
  void import("./settings-sync")
    .then(({ SettingsSync }) => SettingsSync.scheduleSync())
    .catch(() => undefined);
};

export const updateGameRecord: typeof updater = async (key, patch) => {
  const result = await libraryWriteQueue.run(() => updater(key, patch));
  if (
    typeof patch === "object" &&
    SYNCED_FIELDS.some((field) => Object.hasOwn(patch, field))
  ) {
    scheduleSettingsSync();
  }
  return result;
};
