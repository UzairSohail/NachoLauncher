/**
 * Works out whether a download source lists a newer version of a game than
 * the one that is installed. Sources only give us titles and dates, so the
 * version is read from the title ("v1.2.3", "Build 1234", "1.2.3.4") and the
 * upload date settles the rest.
 */

export interface InstalledRepackInfo {
  id: string;
  title: string;
  downloadSourceId: string;
  downloadSourceName: string;
  uploadDate: string | null;
  createdAt?: string | null;
  /** The link the version was downloaded from, used to spot re-listings. */
  uri?: string | null;
  /**
   * Set when this listing was the one picked for the download. Otherwise it
   * was matched later by its link, after the source may have changed it.
   */
  chosenAtDownload?: boolean;
}

export interface GameUpdateInfo extends InstalledRepackInfo {
  fileSize: string | null;
  detectedAt: string;
}

export interface RepackLike {
  id: string;
  title: string;
  fileSize: string | null;
  uris: string[];
  uriGroups?: string[][];
  uploadDate: string | null;
  downloadSourceId: string;
  downloadSourceName: string;
  createdAt: string;
}

const VERSION_PATTERNS = [
  /\bv(?:ersion)?\s*\.?\s*(\d+(?:[._-]\d+)*)/i,
  /\bbuild\s*[#.:-]?\s*(\d+(?:\.\d+)*)/i,
  /(?:^|[\s([])(\d+\.\d+(?:\.\d+)+)(?=$|[\s)\]+,])/,
];

/**
 * Reads the version out of a release title, as numbers, along with which
 * kind of number it is: a version ("v1.2", "1.2.3") or a build number. The
 * two can't be compared with each other.
 */
export const readVersion = (
  title: string
): { kind: "version" | "build"; parts: number[] } | null => {
  for (const [index, pattern] of VERSION_PATTERNS.entries()) {
    const match = pattern.exec(title);
    if (match) {
      return {
        kind: index === 1 ? "build" : "version",
        parts: match[1]
          .split(/[._-]/)
          .filter(Boolean)
          .map((part) => Number.parseInt(part, 10)),
      };
    }
  }
  return null;
};

/** Reads the version out of a release title, as numbers. */
export const extractVersion = (title: string): number[] | null =>
  readVersion(title)?.parts ?? null;

/**
 * Compares the versions in two titles: 1 when `a` is newer, -1 when older,
 * 0 when they're the same, or null when they can't be compared (one has no
 * version, or one is a build number and the other a version).
 */
export const compareTitleVersions = (a: string, b: string) => {
  const versionA = readVersion(a);
  const versionB = readVersion(b);
  if (!versionA || !versionB || versionA.kind !== versionB.kind) return null;
  return compareVersions(versionA.parts, versionB.parts);
};

/** The part of a release title that says which version it is, for display. */
export const describeVersion = (title: string) => {
  const version = readVersion(title);
  if (!version) return null;
  const text = version.parts.join(".");
  return version.kind === "build" ? `Build ${text}` : `v${text}`;
};

export const compareVersions = (a: number[], b: number[]) => {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
};

const IGNORED_WORDS = new Set([
  "the",
  "a",
  "of",
  "and",
  "edition",
  "dlc",
  "dlcs",
  "bonus",
  "bonuses",
  "repack",
  "update",
  "build",
  "multi",
  "free",
  "download",
  "all",
  "content",
  "ost",
  "soundtrack",
]);

/** The words that name the game, without versions, tags or DLC lists. */
export const titleWords = (title: string) =>
  title
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    .replace(/\s\+.*$/, " ")
    .replace(/\bv(?:ersion)?\s*\.?\s*\d+(?:[._-]\d+)*\w*/g, " ")
    .replace(/\bbuild\s*[#.:-]?\s*\d+(?:\.\d+)*/g, " ")
    .replace(/\d+(?:\.\d+){1,}/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !IGNORED_WORDS.has(word));

const isSameGame = (a: string, b: string) => {
  const wordsA = new Set(titleWords(a));
  const wordsB = new Set(titleWords(b));
  if (wordsA.size === 0 || wordsB.size === 0) return false;
  let shared = 0;
  for (const word of wordsA) if (wordsB.has(word)) shared++;
  return shared / Math.min(wordsA.size, wordsB.size) >= 0.8;
};

const normalizeTitle = (title: string) =>
  title.toLowerCase().replace(/\s+/g, " ").trim();

const timeOf = (repack: {
  uploadDate: string | null;
  createdAt?: string | null;
}) => {
  const time = Date.parse(repack.uploadDate ?? repack.createdAt ?? "");
  return Number.isNaN(time) ? null : time;
};

const repackUris = (repack: RepackLike) => [
  ...repack.uris,
  ...(repack.uriGroups ?? []).flat(),
];

/** Finds the listing a game was installed from by the link it used. */
export const findRepackByUri = <T extends RepackLike>(
  repacks: T[],
  uri: string
) => repacks.find((repack) => repackUris(repack).includes(uri)) ?? null;

export const toInstalledRepackInfo = (
  repack: RepackLike,
  uri?: string | null
): InstalledRepackInfo => ({
  id: repack.id,
  title: repack.title,
  downloadSourceId: repack.downloadSourceId,
  downloadSourceName: repack.downloadSourceName,
  uploadDate: repack.uploadDate,
  createdAt: repack.createdAt,
  uri: uri ?? null,
});

/**
 * Picks the newest listing from the installed version's own source that is a
 * newer version of the same game, or null when the installed one is current.
 */
export const findGameUpdate = <T extends RepackLike>(
  installed: InstalledRepackInfo,
  repacks: T[]
): T | null => {
  const installedTime = timeOf(installed);
  const installedTitle = normalizeTitle(installed.title);

  const candidates = repacks.filter((repack) => {
    if (repack.downloadSourceId !== installed.downloadSourceId) return false;
    // Some sources keep the same listing and only change its title and
    // links when a game updates, so the same id with a new title can still
    // be a newer version.
    if (normalizeTitle(repack.title) === installedTitle) return false;
    if (installed.uri && repackUris(repack).includes(installed.uri)) {
      return false;
    }
    if (!isSameGame(repack.title, installed.title)) return false;

    const comparison = compareTitleVersions(repack.title, installed.title);
    if (comparison !== null) return comparison > 0;

    const time = timeOf(repack);
    return time !== null && installedTime !== null && time > installedTime;
  });

  if (candidates.length === 0) return null;

  return candidates.reduce((best, repack) => {
    const comparison = compareTitleVersions(repack.title, best.title);
    if (comparison) return comparison > 0 ? repack : best;
    return (timeOf(repack) ?? 0) > (timeOf(best) ?? 0) ? repack : best;
  });
};
