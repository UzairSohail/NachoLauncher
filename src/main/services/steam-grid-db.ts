import axios, { type AxiosInstance } from "axios";
import type { ArtworkItem, ArtworkKind, GameShop } from "@types";
import { gamesShopAssetsSublevel, gamesSublevel, levelKeys } from "@main/level";
import { appVersion } from "@main/constants";
import { getUserPreferences } from "./user-preferences";

/*
 * Upstream Hydra proxied SteamGridDB through its own API, and only for signed
 * in users. Nacho has no Hydra account, so the artwork picker talks to
 * SteamGridDB directly with the user's own (free) API key.
 */

const STEAM_GRID_DB_API_URL = "https://www.steamgriddb.com/api/v2";
const SEARCH_CACHE_MAX_ENTRIES = 500;

export class SteamGridDbInvalidKeyError extends Error {
  constructor() {
    super("SteamGridDB rejected the API key");
    this.name = "SteamGridDbInvalidKeyError";
  }
}

interface SteamGridDbResponse<T> {
  success: boolean;
  data?: T;
}

interface SteamGridDbSearchResult {
  id: number;
  name: string;
}

let client: AxiosInstance | null = null;
const gameIdByTitle = new Map<string, number | null>();

const getClient = () => {
  client ??= axios.create({
    baseURL: STEAM_GRID_DB_API_URL,
    headers: { "User-Agent": `Nacho Launcher v${appVersion}` },
  });
  return client;
};

export const getSteamGridDbApiKey = async (): Promise<string | null> => {
  const preferences = await getUserPreferences();
  const key = preferences?.steamGridDbApiKey?.trim();
  return key ? key : null;
};

const request = async <T>(
  apiKey: string,
  url: string,
  params: Record<string, string | number>,
  timeout?: number
): Promise<{ status: number; data: SteamGridDbResponse<T> | undefined }> => {
  const response = await getClient().get<SteamGridDbResponse<T>>(url, {
    params,
    headers: { Authorization: `Bearer ${apiKey}` },
    ...(timeout !== undefined && {
      timeout,
      signal: AbortSignal.timeout(timeout),
    }),
    validateStatus: (status) =>
      (status >= 200 && status < 300) || status === 404,
  });

  return { status: response.status, data: response.data };
};

const findGameTitle = async (
  shop: GameShop,
  objectId: string
): Promise<string | null> => {
  const key = levelKeys.game(shop, objectId);
  const [game, assets] = await Promise.all([
    gamesSublevel.get(key).catch(() => undefined),
    gamesShopAssetsSublevel.get(key).catch(() => undefined),
  ]);
  return game?.title?.trim() || assets?.title?.trim() || null;
};

const searchGameId = async (
  apiKey: string,
  title: string,
  timeout?: number
): Promise<number | null> => {
  const cacheKey = title.toLowerCase();
  if (gameIdByTitle.has(cacheKey)) return gameIdByTitle.get(cacheKey) ?? null;

  const { status, data } = await request<SteamGridDbSearchResult[]>(
    apiKey,
    `/search/autocomplete/${encodeURIComponent(title)}`,
    {},
    timeout
  );
  const results = status === 404 ? [] : (data?.data ?? []);
  const exact = results.find(
    (result) => result.name.toLowerCase() === cacheKey
  );
  const id = (exact ?? results[0])?.id ?? null;

  if (gameIdByTitle.size >= SEARCH_CACHE_MAX_ENTRIES) gameIdByTitle.clear();
  gameIdByTitle.set(cacheKey, id);
  return id;
};

/** Which SteamGridDB path holds this game's artwork, or null if unknown. */
const resolveArtworkPath = async (
  apiKey: string,
  shop: GameShop,
  objectId: string,
  kind: ArtworkKind,
  timeout?: number
): Promise<string | null> => {
  if (shop === "steam" && /^\d+$/.test(objectId)) {
    return `/${kind}/steam/${objectId}`;
  }

  const title = await findGameTitle(shop, objectId);
  if (!title) return null;

  const gameId = await searchGameId(apiKey, title, timeout);
  return gameId === null ? null : `/${kind}/game/${gameId}`;
};

export const fetchSteamGridDbArtwork = async (
  apiKey: string,
  shop: GameShop,
  objectId: string,
  kind: ArtworkKind,
  query: Record<string, string | number>,
  timeout?: number
): Promise<ArtworkItem[]> => {
  try {
    const path = await resolveArtworkPath(
      apiKey,
      shop,
      objectId,
      kind,
      timeout
    );
    if (!path) return [];

    const { status, data } = await request<ArtworkItem[]>(
      apiKey,
      path,
      query,
      timeout
    );
    if (status === 404) return [];
    if (data?.success !== true || !Array.isArray(data.data)) {
      throw new Error("Invalid SteamGridDB artwork response");
    }
    return data.data;
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      (error.response?.status === 401 || error.response?.status === 403)
    ) {
      throw new SteamGridDbInvalidKeyError();
    }
    throw error;
  }
};

/** Checks a key before it is saved, so typos show up in Settings. */
export const validateSteamGridDbApiKey = async (apiKey: string) => {
  try {
    await fetchSteamGridDbArtwork(
      apiKey.trim(),
      "steam",
      "1245620",
      "icons",
      { limit: 1 },
      10_000
    );
    return true;
  } catch (error) {
    if (error instanceof SteamGridDbInvalidKeyError) return false;
    throw error;
  }
};
