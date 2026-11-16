// Pure helpers for scripts/ankergames-feed.mjs, kept apart so they can be
// tested without a browser.

export const FEED_NAME = "AnkerGames";
const UNKNOWN_SIZE = "Unknown";

/** https://ankergames.net/game/<slug> in one canonical spelling, or null. */
export const normalizeGameUrl = (href, base = "https://ankergames.net") => {
  try {
    const url = new URL(href, base);
    const match = /^\/game\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return null;
    return `${new URL(base).origin}/game/${match[1].toLowerCase()}`;
  } catch {
    return null;
  }
};

const MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

const toIsoDate = (text) => {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`;
  const named =
    /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(text);
  const dayFirst =
    /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})/.exec(text);
  const parts = named
    ? { month: named[1], day: named[2], year: named[3] }
    : dayFirst
      ? { month: dayFirst[2], day: dayFirst[1], year: dayFirst[3] }
      : null;
  if (!parts) return null;
  const month = MONTHS.indexOf(parts.month.toLowerCase());
  if (month === -1) return null;
  const date = new Date(Date.UTC(Number(parts.year), month, Number(parts.day)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const after = (text, label) => {
  const match = new RegExp(`${label}\\s*:?\\s*([^\\n]{0,40})`, "i").exec(text);
  return match ? match[1] : null;
};

/** Size, last-update date and version from a game page's visible text. */
export const parseGameText = (text) => {
  // Only labelled values: a bare "8 GB" is usually the RAM requirement.
  const sizeMatch = /size\s*:?\s*(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB)/i.exec(text);
  const fileSize = sizeMatch
    ? `${sizeMatch[1].replace(",", ".")} ${sizeMatch[2].toUpperCase()}`
    : null;

  let uploadDate = null;
  for (const label of [
    "last\\s+updated?",
    "updated?(?:\\s+on)?",
    "release(?:d|\\s+date)?",
  ]) {
    const value = after(text, label);
    uploadDate = value ? toIsoDate(value) : null;
    if (uploadDate) break;
  }

  const versionMatch = /version\s*:?\s*v?\s*(\d+(?:\.\d+)+[\w.-]*)/i.exec(text);
  const version = versionMatch ? versionMatch[1] : null;

  return { fileSize, uploadDate, version };
};

const cleanTitle = (title) => title.replace(/\s+/g, " ").trim();

/** "Game" + "1.2.3" -> "Game v1.2.3", unless the title already says so. */
export const titleWithVersion = (title, version) => {
  const clean = cleanTitle(title);
  if (!version || clean.toLowerCase().includes(version.toLowerCase()))
    return clean;
  return `${clean} v${version}`;
};

/**
 * Adds newly listed games to the feed. A new game is listed straight away
 * with the day it was first seen; its size, date and version are filled in
 * when its page is read.
 */
export const addListedGames = (downloads, listed, now) => {
  const byUrl = new Map(downloads.map((entry) => [entry.uris[0], entry]));
  let added = 0;
  for (const { url, title } of listed) {
    if (byUrl.has(url) || !title) continue;
    byUrl.set(url, {
      title: cleanTitle(title),
      uris: [url],
      uploadDate: now,
      fileSize: UNKNOWN_SIZE,
    });
    added++;
  }
  return { downloads: [...byUrl.values()], added };
};

/** Pages to read this run: never-read ones first, then the stalest. */
export const pickPagesToRead = (downloads, checkedAt, limit) =>
  downloads
    .map((entry) => entry.uris[0])
    .sort((a, b) => (checkedAt[a] ?? "").localeCompare(checkedAt[b] ?? ""))
    .slice(0, limit);

/** Applies what a game page said to its feed entry. */
export const applyGameDetails = (entry, details) => {
  const baseTitle = details.title ? cleanTitle(details.title) : entry.title;
  return {
    ...entry,
    title: titleWithVersion(baseTitle, details.version),
    uploadDate: details.uploadDate ?? entry.uploadDate,
    fileSize: details.fileSize ?? entry.fileSize,
  };
};

/** Newest first, so the feed reads like the site. */
export const sortFeed = (downloads) =>
  [...downloads].sort(
    (a, b) =>
      b.uploadDate.localeCompare(a.uploadDate) || a.title.localeCompare(b.title)
  );
