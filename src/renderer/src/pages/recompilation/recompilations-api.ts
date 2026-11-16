import type {
  RecompilationDetails,
  RecompilationReadme,
  RecompilationReleases,
  RecompilationSummary,
} from "@types";
import {
  CATALOG_SLUG_PREFIX,
  isCatalogSlug,
  normalizeGameTitle,
} from "@shared";

const gamePath = (objectId: string) =>
  `/games/launchbox/${encodeURIComponent(objectId)}/recompilations`;

const portPath = (objectId: string, slug: string) =>
  `${gamePath(objectId)}/${encodeURIComponent(slug)}`;

const getHydraRecompilations = (objectId: string) =>
  window.electron.hydraApi
    .get<RecompilationSummary[]>(gamePath(objectId), { needsAuth: false })
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
      portPath(objectId, slug),
      { needsAuth: false }
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
      { params: { language }, needsAuth: false }
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
        `${portPath(objectId, slug)}/releases`,
        { needsAuth: false }
      );

export const buildRecompilationPath = (objectId: string, slug: string) =>
  `/recompilation/${encodeURIComponent(objectId)}/${encodeURIComponent(slug)}`;
