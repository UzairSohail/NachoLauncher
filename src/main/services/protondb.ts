import axios from "axios";
import type { ProtonDBData } from "@types";

/*
 * ProtonDB ratings and Steam Deck status, read straight from ProtonDB and
 * Steam instead of through Hydra's API. Both only know Steam games.
 */
const summaryUrl = (appId: string) =>
  `https://www.protondb.com/api/v1/reports/summaries/${appId}.json`;
const deckReportUrl = (appId: string) =>
  `https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appId}`;

const REQUEST_TIMEOUT_MS = 10_000;

const DECK_CATEGORIES: Record<number, ProtonDBData["deckCompatibility"]> = {
  0: "unknown",
  1: "unsupported",
  2: "playable",
  3: "verified",
};

const str = (value: unknown) => (typeof value === "string" ? value : null);
const num = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const toProtonDBData = (
  summary: Record<string, unknown> | null,
  deckCategory: number | null
): ProtonDBData | null => {
  if (!summary && deckCategory === null) return null;
  return {
    tier: str(summary?.tier),
    confidence: str(summary?.confidence),
    score: num(summary?.score),
    total: num(summary?.total),
    trendingTier: str(summary?.trendingTier),
    resolvedCategory: deckCategory,
    deckCompatibility:
      deckCategory === null ? null : (DECK_CATEGORIES[deckCategory] ?? null),
  };
};

const getSummary = (appId: string) =>
  axios
    .get<Record<string, unknown>>(summaryUrl(appId), {
      timeout: REQUEST_TIMEOUT_MS,
    })
    .then((response) =>
      response.data && typeof response.data === "object" ? response.data : null
    )
    .catch(() => null);

const getDeckCategory = (appId: string) =>
  axios
    .get<{ results?: { resolved_category?: unknown } }>(deckReportUrl(appId), {
      timeout: REQUEST_TIMEOUT_MS,
    })
    .then((response) => num(response.data?.results?.resolved_category))
    .catch(() => null);

const cache = new Map<string, Promise<ProtonDBData | null>>();

export const getProtonDBData = (shop: string, objectId: string) => {
  if (shop !== "steam" || !/^\d{1,10}$/.test(objectId)) {
    return Promise.resolve(null);
  }
  let request = cache.get(objectId);
  if (!request) {
    request = Promise.all([getSummary(objectId), getDeckCategory(objectId)])
      .then(([summary, deck]) => toProtonDBData(summary, deck))
      .catch(() => null);
    cache.set(objectId, request);
  }
  return request;
};
