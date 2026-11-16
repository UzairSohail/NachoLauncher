import type {
  RecompilationDetails,
  RecompilationOs,
  RecompilationReadme,
  RecompilationRelease,
  RecompilationReleaseAsset,
  RecompilationRomMeta,
  RecompilationSummary,
} from "@types";

/*
 * The community recomp catalog (recomplauncher.com/pc-catalog.json) as a
 * second recomp source next to Hydra's. Everything here is pure, so the main
 * process and the tests share it: reading the catalog, matching an entry to a
 * game page, turning GitHub releases into the shapes the recomp page already
 * uses, and reading a developer's recomplauncher.json manifest into the ROM
 * setup the launcher already knows how to run.
 *
 * The file formats are public (the catalog's JSON and the manifest schema at
 * recomplauncher.com/schema/recomplauncher.json). No code is shared with
 * RecompLauncher itself.
 */

export const RECOMP_CATALOG_URL = "https://recomplauncher.com/pc-catalog.json";

/** Catalog ports get their own slug space so they never collide with Hydra's. */
export const CATALOG_SLUG_PREFIX = "rl-";

export const toCatalogSlug = (id: string) => `${CATALOG_SLUG_PREFIX}${id}`;

export const isCatalogSlug = (slug: string) =>
  slug.startsWith(CATALOG_SLUG_PREFIX);

export const fromCatalogSlug = (slug: string) =>
  isCatalogSlug(slug) ? slug.slice(CATALOG_SLUG_PREFIX.length) : null;

// The same shape the install paths and cloud save ids accept.
const SLUG_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/i;
// GitHub owner/name only: the installer only takes files from GitHub releases.
const GITHUB_REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

export interface RecompManifestPlace {
  path: string;
  if?: string;
}

export interface RecompManifest {
  format?: number;
  name?: string;
  game?: {
    kind?: "iso" | "folder" | "iso_or_folder";
    label?: string;
    check?: { file?: string; ids?: string[] };
  };
  start?: {
    program?: string[];
    args?: string[];
    env?: Record<string, string>;
  };
  config?: Array<{
    format?: "toml" | "ini" | "json";
    file?: RecompManifestPlace[];
    game_path?: string;
  }>;
}

export interface CatalogEntry {
  id: string;
  name: string;
  /** The original game's name, e.g. "The Legend of Zelda: Majora's Mask". */
  game: string | null;
  /** Other names the original game goes by (IGDB's), for matching. */
  aliases: string[];
  origin: string | null;
  repo: string;
  version: string | null;
  tag: string | null;
  released: string | null;
  author: string | null;
  systems: RecompilationOs[];
  /** Release file name patterns per system, with `*` wildcards. */
  assets: Partial<Record<RecompilationOs, string>>;
  iconUrl: string | null;
  coverUrl: string | null;
  heroUrl: string | null;
  logoUrl: string | null;
  needs: string | null;
  downloads: number;
  stars: number;
  license: string | null;
  manifest: RecompManifest | null;
}

const OS_LIST: RecompilationOs[] = ["windows", "linux", "macos"];

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const str = (value: unknown) =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

const num = (value: unknown) => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
};

const httpsUrl = (value: unknown) => {
  const text = str(value);
  return text?.startsWith("https://") ? text : null;
};

const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const parseEntry = (raw: unknown): CatalogEntry | null => {
  if (!isObject(raw)) return null;
  // "Coming soon" entries have nothing to install yet.
  if (raw.soon) return null;

  const id = str(raw.id);
  const name = str(raw.name);
  const repo = str(raw.repo);
  if (!id || !SLUG_ID.test(id) || !name || !repo || !GITHUB_REPO.test(repo)) {
    return null;
  }

  const about = isObject(raw.about) ? raw.about : {};
  const assets: CatalogEntry["assets"] = {};
  if (isObject(raw.assets)) {
    for (const os of OS_LIST) {
      const pattern = str(raw.assets[os]);
      if (pattern) assets[os] = pattern;
    }
  }

  const systems = strings(raw.systems).filter((system) =>
    OS_LIST.includes(system as RecompilationOs)
  ) as RecompilationOs[];

  const license = isObject(raw.license)
    ? str(raw.license.spdx_id ?? raw.license.name)
    : str(raw.license);

  return {
    id,
    name,
    game: str(raw.game) ?? str(about.name),
    aliases: [str(about.name)].filter((alias): alias is string => !!alias),
    origin: str(raw.origin),
    repo,
    version: str(raw.version),
    tag: str(raw.tag),
    released: str(raw.released),
    author: str(raw.author) ?? repo.split("/")[0],
    systems: systems.length
      ? systems
      : (Object.keys(assets) as RecompilationOs[]),
    assets,
    iconUrl: httpsUrl(raw.icon),
    coverUrl: httpsUrl(raw.cover),
    heroUrl: httpsUrl(raw.hero),
    logoUrl: httpsUrl(raw.logo),
    needs: str(raw.needs),
    downloads: num(raw.downloads),
    stars: num(raw.stars),
    license,
    manifest: isObject(raw.launcher) ? (raw.launcher as RecompManifest) : null,
  };
};

/** Every installable GitHub-hosted entry in the catalog file. */
export const parseRecompCatalog = (data: unknown): CatalogEntry[] => {
  if (!isObject(data) || !Array.isArray(data.apps)) return [];
  const seen = new Set<string>();
  const entries: CatalogEntry[] = [];
  for (const raw of data.apps) {
    const entry = parseEntry(raw);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
};

export const isRecompCatalogData = (data: unknown) =>
  isObject(data) && Array.isArray(data.apps);

// ---------- matching an entry to a game page ----------

/** A game's name reduced to letters and digits, for comparing titles. */
export const normalizeGameTitle = (title: string) =>
  title
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replaceAll(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .trim();

export const findCatalogEntriesForGame = (
  entries: CatalogEntry[],
  gameTitle: string
) => {
  const wanted = normalizeGameTitle(gameTitle);
  if (!wanted) return [];
  return entries.filter((entry) =>
    [entry.game, ...entry.aliases].some(
      (title) => !!title && normalizeGameTitle(title) === wanted
    )
  );
};

// ---------- the shapes the recomp page uses ----------

const UNTESTED: RecompilationSummary["tested"] = {
  level: "untested",
  testedVersion: null,
  isLatestTested: false,
  features: [],
};

const trimTag = (tag: string) => tag.replace(/^v(?=\d)/i, "");

export const toCatalogSummary = (
  entry: CatalogEntry
): RecompilationSummary => ({
  slug: toCatalogSlug(entry.id),
  name: entry.name,
  author: entry.author ?? "",
  iconUrl: entry.iconUrl ?? entry.coverUrl,
  version: entry.version ?? (entry.tag ? trimTag(entry.tag) : ""),
  tested: UNTESTED,
});

export const toCatalogDetails = (
  entry: CatalogEntry,
  objectId: string,
  fetchedAt: string
): RecompilationDetails => {
  const tag = entry.tag ?? (entry.version ? `v${entry.version}` : "");
  return {
    ...toCatalogSummary(entry),
    repository: {
      fullName: entry.repo,
      url: `https://github.com/${entry.repo}`,
      defaultBranch: "main",
    },
    versionName: tag,
    releasedAt: entry.released ?? fetchedAt,
    releaseUrl: tag
      ? `https://github.com/${entry.repo}/releases/tag/${encodeURIComponent(tag)}`
      : `https://github.com/${entry.repo}/releases`,
    downloadCount: entry.downloads,
    stars: entry.stars,
    license: entry.license,
    systems: entry.systems,
    romRequirement: entry.manifest?.game?.label ?? entry.needs,
    assetCount: Object.keys(entry.assets).length,
    reviewCount: 0,
    averageScore: null,
    lastSyncedAt: fetchedAt,
    game: {
      shop: "launchbox",
      objectId,
      title: entry.game ?? entry.name,
      platform: entry.origin,
      iconUrl: entry.iconUrl,
      coverImageUrl: entry.coverUrl,
      libraryImageUrl: entry.coverUrl,
      libraryHeroImageUrl: entry.heroUrl,
      logoImageUrl: entry.logoUrl,
    },
  };
};

// ---------- GitHub releases ----------

const escapeRegExp = (text: string) =>
  text.replaceAll(/[.+?^${}()|[\]\\]/g, String.raw`\$&`);

/** Whether a release file name fits a catalog pattern like `Game-*-Windows.zip`. */
export const matchesAssetPattern = (name: string, pattern: string) =>
  new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "i").test(
    name
  );

// Files that are never the game: debug symbols, sources and checksums.
const NOT_THE_GAME =
  /debug|symbols|\.pdb|source|\.sha256$|\.sha512$|\.sig$|\.asc$|\.md5$|\.txt$|\.json$/i;
const ARM = /arm64|aarch64|\barm\b/i;

/** The system a release file is for, from the words in its name. */
export const guessAssetOs = (name: string): RecompilationOs | null => {
  const lower = name.toLowerCase();
  if (/\.appimage$|linux|\.flatpak$|\.deb$|\.tar\.(gz|xz|zst)$/.test(lower)) {
    return "linux";
  }
  if (/mac|osx|darwin|\.dmg$|apple/.test(lower)) return "macos";
  if (/win|\.exe$|\.msi$|x64\.zip$/.test(lower)) return "windows";
  return null;
};

// Lower is better: zips on Windows, AppImages on Linux, installers last.
const archiveRank = (name: string, os: RecompilationOs) => {
  const lower = name.toLowerCase();
  if (ARM.test(lower)) return 9;
  if (os === "linux") {
    if (lower.endsWith(".appimage")) return 0;
    if (/\.tar\.(gz|xz|zst)$/.test(lower)) return 1;
    if (/\.(zip|7z)$/.test(lower)) return 2;
    return 8;
  }
  if (/\.(zip|7z)$/.test(lower)) return 0;
  if (lower.endsWith(".rar")) return 1;
  if (lower.endsWith(".exe")) return 3;
  return 8;
};

interface GitHubAsset {
  name?: unknown;
  size?: unknown;
  download_count?: unknown;
  browser_download_url?: unknown;
  digest?: unknown;
}

interface GitHubRelease {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  prerelease?: unknown;
  draft?: unknown;
  assets?: unknown;
}

const toAsset = (raw: GitHubAsset, entry: CatalogEntry) => {
  const name = str(raw.name);
  const url = httpsUrl(raw.browser_download_url);
  if (!name || !url || NOT_THE_GAME.test(name)) return null;

  const patternOs = OS_LIST.find((os) => {
    const pattern = entry.assets[os];
    return pattern ? matchesAssetPattern(name, pattern) : false;
  });
  const os = patternOs ?? guessAssetOs(name);
  if (!os) return null;

  const digest = str(raw.digest);
  const sha256 = digest?.toLowerCase().startsWith("sha256:")
    ? digest.slice("sha256:".length).toLowerCase()
    : null;

  const asset: RecompilationReleaseAsset = {
    name,
    size: num(raw.size),
    downloadCount: num(raw.download_count),
    url,
    sha256: sha256 && /^[0-9a-f]{64}$/.test(sha256) ? sha256 : null,
    os,
    arch: ARM.test(name) ? "arm64" : "x64",
    isInstallTarget: false,
  };
  return { asset, fromPattern: !!patternOs };
};

const markInstallTargets = (
  found: { asset: RecompilationReleaseAsset; fromPattern: boolean }[],
  entry: CatalogEntry
) => {
  for (const os of OS_LIST) {
    const forOs = found.filter(({ asset }) => asset.os === os);
    // A catalog pattern names the file for that system; without one, the best
    // archive by name wins.
    const pool = entry.assets[os]
      ? forOs.filter(({ fromPattern }) => fromPattern)
      : forOs;
    const best = [...pool].sort(
      (left, right) =>
        archiveRank(left.asset.name, os) - archiveRank(right.asset.name, os)
    )[0];
    if (best && archiveRank(best.asset.name, os) < 9) {
      best.asset.isInstallTarget = true;
    }
  }
};

/** GitHub's releases for a catalog entry, newest first, as the recomp page shows them. */
export const toCatalogReleases = (
  entry: CatalogEntry,
  data: unknown
): RecompilationRelease[] => {
  if (!Array.isArray(data)) return [];
  const releases: RecompilationRelease[] = [];
  // The catalog's pinned tag is the one it vouches for. Without it, the newest
  // full release is the latest, and a pre-release never is.
  const pinnedTag = data.some(
    (item) => isObject(item) && !item.draft && item.tag_name === entry.tag
  )
    ? entry.tag
    : null;
  let latestTaken = false;

  for (const raw of data as GitHubRelease[]) {
    if (!isObject(raw) || raw.draft) continue;
    const tag = str(raw.tag_name);
    if (!tag) continue;

    const found = (Array.isArray(raw.assets) ? raw.assets : [])
      .map((asset) => toAsset(asset as GitHubAsset, entry))
      .filter((item): item is NonNullable<typeof item> => !!item);
    markInstallTargets(found, entry);

    const isLatest =
      !latestTaken && (pinnedTag ? tag === pinnedTag : !raw.prerelease);
    if (isLatest) latestTaken = true;

    releases.push({
      tag,
      version: trimTag(tag),
      name: str(raw.name) ?? tag,
      notesMarkdown: str(raw.body),
      publishedAt: str(raw.published_at) ?? "",
      url:
        httpsUrl(raw.html_url) ??
        `https://github.com/${entry.repo}/releases/tag/${encodeURIComponent(tag)}`,
      isLatest,
      assets: found.map(({ asset }) => asset),
    });
  }

  return releases;
};

export const toCatalogReadme = (
  entry: CatalogEntry,
  markdown: string,
  sha: string,
  fetchedAt: string
): RecompilationReadme => ({
  repository: entry.repo,
  defaultBranch: "main",
  markdown,
  translatedTo: null,
  sha,
  lastSyncedAt: fetchedAt,
});

// ---------- developer manifests (recomplauncher.json) ----------

/** The files a port accepts for each console, when its manifest wants a disc image or ROM. */
const ORIGIN_EXTENSIONS: Record<string, string[]> = {
  n64: [".z64", ".n64", ".v64"],
  gc: [
    ".iso",
    ".gcm",
    ".ciso",
    ".gcz",
    ".nfs",
    ".rvz",
    ".wbfs",
    ".wia",
    ".tgc",
  ],
  wii: [".iso", ".gcm", ".ciso", ".gcz", ".nfs", ".rvz", ".wbfs", ".wia"],
  wiiu: [".wud", ".wux", ".wua", ".rpx"],
  ps1: [".cue", ".bin", ".iso", ".img", ".m3u"],
  ps2: [".iso", ".bin", ".cue", ".img"],
  ps3: [".iso", ".pkg"],
  psp: [".iso", ".cso"],
  x360: [".iso", ".xex"],
  xbox: [".iso", ".xbe"],
  dc: [".gdi", ".cdi", ".cue", ".m3u"],
  saturn: [".cue", ".bin", ".iso"],
  snes: [".sfc", ".smc"],
  nes: [".nes"],
  gb: [".gb"],
  gbc: [".gbc", ".gb"],
  gba: [".gba"],
  ds: [".nds"],
  "3ds": [".3ds", ".cci", ".cia"],
  switch: [".nsp", ".xci"],
  genesis: [".md", ".bin", ".gen", ".smd"],
};
const DEFAULT_EXTENSIONS = [".iso", ".bin", ".cue", ".img"];

// Manifest paths to the launcher's own placeholders. {install} is the port's
// folder, the same as <base>.
const toLauncherPath = (template: string) => {
  const replaced = template
    .replaceAll("{install}", "<base>")
    .replaceAll("{home}", "<home>")
    .replaceAll("{config}", "<configDir>")
    .replaceAll("{local}", "<localDir>");
  // Other placeholders ({documents}, {pad}, ...) have no equivalent here.
  return /\{[a-z_]+\}/i.test(replaced) ? null : replaced;
};

const perPlatformPath = (template: string) => {
  const launcherPath = toLauncherPath(template);
  if (!launcherPath) return null;
  return {
    win32: launcherPath
      .replaceAll("<configDir>", "<winAppData>")
      .replaceAll("<localDir>", "<winLocalAppData>"),
    linux: launcherPath
      .replaceAll("<configDir>", "<xdgConfig>")
      .replaceAll("<localDir>", "<xdgData>"),
  };
};

const GAME_ONLY = /^[^{}]*(\{game\}[^{}]*)*$/;
const toRomArg = (value: string) =>
  GAME_ONLY.test(value) ? value.replaceAll("{game}", "{rom}") : null;

/**
 * The ROM setup a manifest describes, in the launcher's own terms, or null
 * when the manifest has no player's copy to hand over (the port finds the game
 * itself) or asks for something this launcher can't do yet.
 */
export const manifestToRomMeta = (
  manifest: RecompManifest | null | undefined,
  origin: string | null
): RecompilationRomMeta | null => {
  const game = manifest?.game;
  if (!manifest || !isObject(game)) return null;

  const meta: RecompilationRomMeta = { extensions: [] };
  const kind = game.kind ?? "iso";
  const checkFile = str(game.check?.file);

  if (kind === "folder") {
    if (!checkFile) return null;
    meta.folder = [checkFile];
  } else {
    meta.extensions =
      (origin && ORIGIN_EXTENSIONS[origin.toLowerCase()]) || DEFAULT_EXTENSIONS;
  }

  const args = strings(manifest.start?.args);
  const usesGame = args.some((arg) => arg.includes("{game}"));
  const path: NonNullable<RecompilationRomMeta["path"]> = {};
  if (usesGame) {
    const filled = args.map(toRomArg);
    if (filled.some((arg) => arg === null)) return null;
    path.arg = filled as string[];
  }

  const env = isObject(manifest.start?.env) ? manifest.start.env : {};
  const envWithGame = Object.entries(env).filter(
    ([, value]) => typeof value === "string" && value.includes("{game}")
  );
  if (envWithGame.length) {
    const filled = envWithGame.map(([key, value]) => [key, toRomArg(value)]);
    if (filled.some(([, value]) => value === null)) return null;
    path.env = Object.fromEntries(filled) as Record<string, string>;
  }

  const config = (Array.isArray(manifest.config) ? manifest.config : []).find(
    (item) => isObject(item) && str(item.game_path)
  );
  if (config && (config.format === "json" || config.format === "ini")) {
    // The first place without a condition is where the file normally lives.
    const place = (config.file ?? []).find(
      (item) => isObject(item) && str(item.path) && !item.if
    );
    const file = place ? perPlatformPath(place.path) : null;
    if (file) {
      path.config = {
        file,
        key:
          config.format === "json"
            ? config.game_path!.split(".")
            : [config.game_path!.split(".").at(-1)!],
      };
    }
  }

  // Without a way to hand the game over, there is nothing to set up.
  if (!path.arg && !path.env && !path.config) return null;
  meta.path = path;
  return meta;
};

/** The program a manifest starts on this system: the first one that fits it. */
export const manifestExecutable = (
  manifest: RecompManifest | null | undefined,
  platform: string
) => {
  const programs = strings(manifest?.start?.program).filter(
    (program) =>
      !program.includes("..") &&
      !program.startsWith("/") &&
      !/^[a-z]:/i.test(program)
  );
  const isWindowsProgram = (program: string) =>
    /\.(exe|bat|cmd)$/i.test(program);
  const fits = programs.filter((program) =>
    platform === "win32"
      ? isWindowsProgram(program)
      : !isWindowsProgram(program)
  );
  return fits[0] ?? null;
};

export const parseRecompManifest = (text: string): RecompManifest | null => {
  try {
    const parsed = JSON.parse(text);
    return isObject(parsed) ? (parsed as RecompManifest) : null;
  } catch {
    return null;
  }
};
