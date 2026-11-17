import type { GameShop, RemoteSnapshotSummary } from "@types";

import { listDriveSnapshots } from "./drive-snapshot-store";

/** The game's active cloud save snapshot in Google Drive, if any. */
export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> => listDriveSnapshots(shop, objectId);
