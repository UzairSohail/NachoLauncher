import type {
  CatalogueSearchResult,
  RecompilationDetails,
  RecompilationReadme,
  RecompilationReleases,
  RecompilationSummary,
} from "@types";
import {
  CATALOG_SLUG_PREFIX,
  isCatalogSlug,
  normalizeGameTitle,
  pickCatalogueGameForRecomp,
  type RecompCatalogItem,
} from "@shared";

const gamePath = (objectId: string) =>
  `/games/launchbox/${encodeURIComponent(objectId)}/recompilations`;

const portPath = (objectId: string, slug: string) =>
  `${gamePath(objectId)}/${encodeURIComponent(slug)}`;

const getHydraRecompilations = (objectId: string) =>
  window.electron.hydraApi
    .get<RecompilationSummary[]>(gamePath(objectId))
    .then((items) => (Array.isArray(items) ? items : []));

/**
 * Hydra's ports for a game, then the community catalog's for the same game.
 * A catalog port Hydra already lists (same id or name) shows once, as Hydra's.
 */
export const getGameRecompilations = async (
  objectId: string,
  gameTitle: string,
  { includeHydra = true } = {}
) => {
  const [hydra, catalog] = await Promise.all([
    includeHydra
      ? getHydraRecompilations(objectId).catch(() => [])
      : Promise.resolve([] as RecompilationSummary[]),
    gameTitle
      ? window.electron.getCatalogRecompilations(gameTitle).catch(() => [])
      : Promise.resolve([] as RecompilationSummary[]),
  ]);

  const hydraSlugs = new Set(hydra.map(({ slug }) => slug.toLowerCase()));
  const hydraNames = new Set(hydra.map(({ name }) => normalizeGameTitle(name)));
  const extra = catalog.filter(
    ({ slug, name }) =>
      !hydraSlugs.has(slug.slice(CATALOG_SLUG_PREFIX.length).toLowerCase()) &&
      !hydraNames.has(normalizeGameTitle(name))
  );
  return [...hydra, ...extra];
};

export const getRecompilation = async (objectId: string, slug: string) => {
  if (!isCatalogSlug(slug)) {
    return window.electron.hydraApi.get<RecompilationDetails>(
      portPath(objectId, slug)
    );
  }
  const details = await window.electron.getCatalogRecompilation(objectId, slug);
  if (!details) throw new Error(`${slug} is not in the recomp catalog`);
  return details;
};

export const getRecompilationReadme = async (
  objectId: string,
  slug: string,
  language: string
) => {
  if (!isCatalogSlug(slug)) {
    return window.electron.hydraApi.get<RecompilationReadme>(
      `${portPath(objectId, slug)}/readme`,
      { params: { language } }
    );
  }
  const readme = await window.electron.getCatalogRecompilationReadme(slug);
  if (!readme) throw new Error(`No README for ${slug}`);
  return readme;
};

export const getRecompilationReleases = (objectId: string, slug: string) =>
  isCatalogSlug(slug)
    ? window.electron.getCatalogRecompilationReleases(slug)
    : window.electron.hydraApi.get<RecompilationReleases>(
        `${portPath(objectId, slug)}/releases`
      );

export const buildRecompilationPath = (objectId: string, slug: string) =>
  `/recompilation/${encodeURIComponent(objectId)}/${encodeURIComponent(slug)}`;

const CATALOGUE_GAME_CACHE_KEY = "recomp-catalogue-games";

const readCatalogueGameCache = (): Record<string, string> => {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(CATALOGUE_GAME_CACHE_KEY) ?? "{}"
    );
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

/**
 * The classics catalogue game a catalog recomp belongs to, found by its
 * original game's name. Recomp pages hang off that game, so this is what
 * opening a recomp from the catalog page needs. Null when no game matches.
 */
export const findCatalogueGameForRecomp = async (item: RecompCatalogItem) => {
  const cached = readCatalogueGameCache()[item.slug];
  if (cached) return cached;

  const response = await window.electron.hydraApi.post<{
    edges: CatalogueSearchResult[];
  }>("/catalogue/search", {
    data: {
      title: item.game ?? item.name,
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
  });

  const match = pickCatalogueGameForRecomp(
    Array.isArray(response?.edges) ? response.edges : [],
    item
  );
  if (!match) return null;

  try {
    localStorage.setItem(
      CATALOGUE_GAME_CACHE_KEY,
      JSON.stringify({
        ...readCatalogueGameCache(),
        [item.slug]: match.objectId,
      })
    );
  } catch {
    // Only a shortcut for next time.
  }
  return match.objectId;
};
