import { chunk } from "lodash-es";

import { normalizeGameTitle } from "@shared";
import { HydraApi } from "@main/services/hydra-api";
import { logger } from "@main/services/logger";

import type { LaunchboxShopDetailsEntry } from "./launchbox-shop-details";
import { stripXbox360Extension } from "./xbox360-disc-reader";

/*
 * The catalogue is keyed by disc serials, which Xbox 360 dumps do not carry
 * in a form the catalogue always knows. When a game's title ID finds nothing,
 * ROM import falls back to looking the game up by its name, keeping only an
 * exact title match on the Xbox 360.
 */

const SEARCH_CONCURRENCY = 4;
const MAX_TITLE_SEARCHES = 300;
const SHOP_DETAILS_CHUNK_SIZE = 100;
const XBOX_360_PLATFORM_RE = /xbox\s*360/i;

interface CatalogueSearchEdge {
  objectId: string;
  title: string;
  shop?: string;
  platform?: string | null;
  alternateNames?: string[];
}

export interface Xbox360TitleQuery {
  key: string;
  name: string;
}

/** The text searched for a dump: its name without extension or dump tags. */
export const xbox360SearchTitle = (name: string): string =>
  stripXbox360Extension(name)
    .replaceAll(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replaceAll("_", " ")
    .replaceAll(/\s+/g, " ")
    .trim();

export const pickXbox360CatalogueMatch = (
  results: CatalogueSearchEdge[],
  searchTitle: string
): CatalogueSearchEdge | null => {
  const wanted = normalizeGameTitle(searchTitle);
  if (!wanted) return null;
  return (
    results.find(
      (result) =>
        (!result.shop || result.shop === "launchbox") &&
        !!result.platform &&
        XBOX_360_PLATFORM_RE.test(result.platform) &&
        [result.title, ...(result.alternateNames ?? [])].some(
          (title) => !!title && normalizeGameTitle(title) === wanted
        )
    ) ?? null
  );
};

const searchCatalogue = async (
  title: string,
  signal?: AbortSignal
): Promise<CatalogueSearchEdge[]> => {
  const response = await HydraApi.post<{ edges?: CatalogueSearchEdge[] }>(
    "/catalogue/search",
    {
      title,
      sortBy: "popularity",
      sortOrder: "desc",
      downloadSourceFingerprints: [],
      tags: [],
      publishers: [],
      genres: [],
      developers: [],
      protondbSupportBadges: [],
      deckCompatibility: [],
      platforms: [],
      shops: ["launchbox"],
      take: 20,
      skip: 0,
      downloadSourceIds: [],
    },
    { needsAuth: false, signal }
  );
  return Array.isArray(response?.edges) ? response.edges : [];
};

const fetchEntriesByObjectId = async (
  objectIds: string[],
  language: string,
  signal?: AbortSignal
): Promise<Map<string, LaunchboxShopDetailsEntry>> => {
  const entries = new Map<string, LaunchboxShopDetailsEntry>();
  for (const idChunk of chunk(objectIds, SHOP_DETAILS_CHUNK_SIZE)) {
    if (signal?.aborted) break;
    try {
      const response = await HydraApi.post<LaunchboxShopDetailsEntry[]>(
        "/games/shop-details",
        { shop: "launchbox", objectIds: idChunk, language },
        { needsAuth: false, signal }
      );
      for (const entry of Array.isArray(response) ? response : []) {
        if (entry?.objectId && entry.data) entries.set(entry.objectId, entry);
      }
    } catch (error) {
      if (signal?.aborted) break;
      logger.error("Failed to fetch Xbox 360 shop details", error);
    }
  }
  return entries;
};

/**
 * Looks Xbox 360 dumps up by name. Returns the catalogue entry for each query
 * key that found an exact Xbox 360 match.
 */
export const matchXbox360GamesByTitle = async (
  queries: Xbox360TitleQuery[],
  language: string,
  signal?: AbortSignal
): Promise<Map<string, LaunchboxShopDetailsEntry>> => {
  const keysByTitle = new Map<string, string[]>();
  for (const query of queries) {
    const title = xbox360SearchTitle(query.name);
    if (!normalizeGameTitle(title)) continue;
    const keys = keysByTitle.get(title) ?? [];
    keys.push(query.key);
    keysByTitle.set(title, keys);
  }

  const titles = Array.from(keysByTitle.keys()).slice(0, MAX_TITLE_SEARCHES);
  const objectIdByTitle = new Map<string, string>();

  for (const titleChunk of chunk(titles, SEARCH_CONCURRENCY)) {
    if (signal?.aborted) break;
    await Promise.all(
      titleChunk.map(async (title) => {
        try {
          const match = pickXbox360CatalogueMatch(
            await searchCatalogue(title, signal),
            title
          );
          if (match) objectIdByTitle.set(title, match.objectId);
        } catch (error) {
          if (!signal?.aborted) {
            logger.error("Xbox 360 catalogue search failed", { title, error });
          }
        }
      })
    );
  }

  const entries = await fetchEntriesByObjectId(
    Array.from(new Set(objectIdByTitle.values())),
    language,
    signal
  );

  const matches = new Map<string, LaunchboxShopDetailsEntry>();
  for (const [title, objectId] of objectIdByTitle) {
    const entry = entries.get(objectId);
    if (!entry) continue;
    for (const key of keysByTitle.get(title) ?? []) matches.set(key, entry);
  }
  return matches;
};
