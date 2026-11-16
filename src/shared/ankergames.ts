/**
 * AnkerGames (ankergames.net) lists each game on its own page, which offers a
 * FileKeeper mirror, AnkerGames' own direct download and a torrent. Sources
 * list that page, and Nacho reads the real link from it when a download starts.
 */

export type AnkerGamesLinkKind = "direct" | "filekeeper" | "torrent";

/** Links Nacho found for one AnkerGames game page. */
export interface AnkerGamesLinks {
  direct?: string;
  filekeeper?: string;
  /** A magnet, or a .torrent file link that still has to be read. */
  torrent?: string;
}

const hostOf = (uri: string) => {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};

const isAnkerGamesHost = (host: string | null) =>
  host !== null &&
  (host === "ankergames.net" || host.endsWith(".ankergames.net"));

/** True for a game page like https://ankergames.net/game/<slug>. */
export const isAnkerGamesPageUri = (uri: string) => {
  if (!isAnkerGamesHost(hostOf(uri))) return false;
  return /^\/game\/[^/]+\/?$/i.test(new URL(uri).pathname);
};

/**
 * Where a link found on (or opened from) an AnkerGames page leads, or null for
 * links that are part of the site itself (other pages, ads, socials...).
 */
export const classifyAnkerGamesLink = (
  uri: string,
  hint?: { filename?: string; mimeType?: string }
): AnkerGamesLinkKind | null => {
  if (uri.startsWith("magnet:?")) return "torrent";
  const host = hostOf(uri);
  if (!host) return null;

  const path = new URL(uri).pathname.toLowerCase();
  if (
    path.endsWith(".torrent") ||
    hint?.filename?.toLowerCase().endsWith(".torrent") ||
    hint?.mimeType === "application/x-bittorrent"
  ) {
    return "torrent";
  }
  if (host === "filekeeper.net") return "filekeeper";
  if (isAnkerGamesHost(host)) return null;
  if (
    IGNORED_HOSTS.some(
      (ignored) => host === ignored || host.endsWith(`.${ignored}`)
    )
  )
    return null;
  return "direct";
};

/** Hosts a game page links to that never carry the game itself. */
const IGNORED_HOSTS = [
  "discord.gg",
  "discord.com",
  "t.me",
  "telegram.me",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "reddit.com",
  "youtube.com",
  "youtu.be",
  "steampowered.com",
  "steamcommunity.com",
  "google.com",
  "gstatic.com",
  "googletagmanager.com",
  "cloudflare.com",
  "ko-fi.com",
  "patreon.com",
  "paypal.com",
  "buymeacoffee.com",
];

/**
 * Which links to look for, best first, for a downloader: the torrent for a
 * debrid service (torrents only ever go through debrid), with FileKeeper as a
 * hoster link debrid may still unlock; otherwise the free link asked for, then
 * the other free one.
 */
export const ankerGamesLinkOrder = (
  wanted: "direct" | "filekeeper" | "debrid"
): AnkerGamesLinkKind[] => {
  if (wanted === "debrid") return ["torrent", "filekeeper"];
  if (wanted === "filekeeper") return ["filekeeper", "direct"];
  return ["direct", "filekeeper"];
};
