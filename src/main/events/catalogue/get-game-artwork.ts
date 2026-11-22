import { registerEvent } from "../register-event";
import { fetchGameArtwork, logger } from "@main/services";
import {
  getSteamGridDbApiKey,
  SteamGridDbInvalidKeyError,
} from "@main/services/steam-grid-db";
import type { ArtworkKind, ArtworkPage, GameShop } from "@types";

const getGameArtwork = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  kind: ArtworkKind,
  page = 0
): Promise<ArtworkPage | null> => {
  if (shop === "custom") return null;

  try {
    return await fetchGameArtwork(shop, objectId, kind, page);
  } catch (error) {
    if (error instanceof SteamGridDbInvalidKeyError) {
      return {
        items: [],
        cache: "fresh",
        hasMore: false,
        apiKeyStatus: "invalid",
      };
    }

    if (!(await getSteamGridDbApiKey())) {
      logger.warn("SteamGridDB artwork needs an API key", { shop, kind });
      return {
        items: [],
        cache: "fresh",
        hasMore: false,
        apiKeyStatus: "missing",
      };
    }

    logger.error("Failed to fetch game artwork", { shop, objectId, kind });
    throw error;
  }
};

registerEvent("getGameArtwork", getGameArtwork);
