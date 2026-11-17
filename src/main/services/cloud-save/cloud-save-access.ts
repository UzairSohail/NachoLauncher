import { usesDriveCloudSaves, UserNotLoggedInError } from "@shared";
import type { GameShop } from "@types";

import { PersonalCloud } from "../personal-cloud";
import { getCloudSaveGameRecord } from "./recompilation-cloud-save";

/*
 * These cloud saves now live in the user's own Google Drive (see
 * drive-snapshot-store.ts), so they need Google sign-in rather than a Hydra
 * Cloud subscription. Only emulator games use them: PC games sync through
 * Cloud Save Manager, and must not be synced twice.
 */

export const isDriveSignedIn = async () =>
  (await PersonalCloud.status().catch(() => null))?.signedIn === true;

/** Signed in to Google, and the game is one whose saves this code handles. */
export const canAccessCloudSaves = async (
  objectId: string,
  shop: GameShop
): Promise<boolean> => {
  if (!(await isDriveSignedIn())) return false;
  const game = await getCloudSaveGameRecord(shop, objectId).catch(() => null);
  return Boolean(game) && usesDriveCloudSaves(shop, game?.platform);
};

export const assertCloudSaveSubscription = async () => {
  if (!(await isDriveSignedIn())) throw new UserNotLoggedInError();
};
