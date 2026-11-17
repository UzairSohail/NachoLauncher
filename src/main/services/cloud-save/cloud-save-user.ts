import { db, levelKeys } from "@main/level";
import type { User } from "@types";

/**
 * Who this device's cloud save records belong to. Upstream keyed them by the
 * Hydra account; Nacho has no Hydra account, so they belong to the Google
 * Drive the saves are kept in.
 */
export const DRIVE_CLOUD_SAVE_USER_ID = "google-drive";

export const getCloudSaveUserId = async (): Promise<string> => {
  const user = await db
    .get<string, User>(levelKeys.user, { valueEncoding: "json" })
    .catch(() => null);
  return user?.id || DRIVE_CLOUD_SAVE_USER_ID;
};
