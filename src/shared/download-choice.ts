import { Downloader } from "./constants.js";
import { isAnkerGamesPageUri } from "./ankergames.js";

/** Hosts with no direct downloader that a debrid provider can still unlock. */
export const debridOnlyHosts = [
  "https://1fichier.com",
  "https://mediafire.com",
];

/** Debrid providers that unlock regular file-hoster links. */
export const hosterDebridDownloaders = [
  Downloader.AllDebrid,
  Downloader.RealDebrid,
];

/** Debrid providers in the order Nacho prefers them: AllDebrid first. */
export const DEBRID_PREFERENCE = [
  Downloader.AllDebrid,
  Downloader.RealDebrid,
  Downloader.Premiumize,
  Downloader.TorBox,
];

const DEBRID = new Set<Downloader>(DEBRID_PREFERENCE);

export const isKnownDebridHosterUri = (uri: string) =>
  debridOnlyHosts.some((host) => uri.startsWith(host));

let allDebridDomains = new Set<string>();

/** The hosts AllDebrid can unlock right now, from its /hosts API. */
export const setAllDebridSupportedDomains = (domains: string[]) => {
  allDebridDomains = new Set(
    domains.map((domain) => domain.toLowerCase().replace(/^www\./, ""))
  );
};

const ALL_DEBRID_HOSTS_REFRESH_MS = 15 * 60 * 1000;
let allDebridHostsFetchedAt = 0;
let allDebridHostsRequest: Promise<boolean> | null = null;

/**
 * Load AllDebrid's host list if it is missing or over 15 minutes old.
 * Resolves true when the list changed, so a screen can recompute its choice.
 */
export const refreshAllDebridSupportedDomains = (
  fetchDomains: () => Promise<string[]>
): Promise<boolean> => {
  if (Date.now() - allDebridHostsFetchedAt < ALL_DEBRID_HOSTS_REFRESH_MS)
    return Promise.resolve(false);
  allDebridHostsRequest ??= fetchDomains()
    .then((domains) => {
      const before = [...allDebridDomains].sort().join();
      setAllDebridSupportedDomains(domains);
      // An empty answer (no key yet, or an error) is retried next time.
      if (domains.length) allDebridHostsFetchedAt = Date.now();
      return before !== [...allDebridDomains].sort().join();
    })
    .catch(() => false)
    .finally(() => {
      allDebridHostsRequest = null;
    });
  return allDebridHostsRequest;
};

/** True when AllDebrid lists this link's host (or a parent domain) as up. */
export const isAllDebridSupportedUri = (uri: string): boolean => {
  if (allDebridDomains.size === 0) return false;
  let host: string;
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    host = url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  for (let domain = host; domain.includes("."); ) {
    if (allDebridDomains.has(domain)) return true;
    domain = domain.slice(domain.indexOf(".") + 1);
  }
  return false;
};

type GetDownloadersForUri = (uri: string) => Downloader[];

/**
 * How sure we are that a downloader can fetch a link, best first:
 * 0. a torrent through debrid (debrid is the only way torrents are fetched),
 *    including an AnkerGames page's torrent,
 * 0.5. a hoster link AllDebrid currently supports: it unlocks to a premium,
 *    uncapped link, so it beats the host's own capped download,
 * 1. a host with its own downloader (Gofile, Buzzheavier, Pixeldrain...) or a
 *    host debrid is known to unlock (1fichier, Mediafire),
 * 2. any other hoster link handed to debrid, which the service often rejects
 *    with "This host or link is not supported".
 */
export const getUriConfidence = (
  uri: string,
  downloader: Downloader
): number => {
  if (uri.startsWith("magnet:")) return 0;
  // Debrid fetches an AnkerGames page's torrent.
  if (DEBRID.has(downloader) && isAnkerGamesPageUri(uri)) return 0;
  if (downloader === Downloader.AllDebrid && isAllDebridSupportedUri(uri))
    return 0.5;
  if (!DEBRID.has(downloader)) return 1;
  if (isKnownDebridHosterUri(uri)) return 1;
  return 2;
};

const debridRank = (downloader: Downloader) => {
  const index = DEBRID_PREFERENCE.indexOf(downloader);
  return index === -1 ? DEBRID_PREFERENCE.length : index;
};

/**
 * The link of a listing to hand a downloader: the one it is most likely to
 * fetch, skipping links already known to be down when another one exists.
 */
export const pickUriForDownloader = (
  repack: { uris: string[]; unavailableUris?: string[] | null },
  downloader: Downloader,
  getDownloadersForUri: GetDownloadersForUri
): string | null =>
  rankUrisForDownloader(repack, downloader, getDownloadersForUri)[0] ?? null;

/**
 * Every link of a listing a downloader can take, best first, so a link debrid
 * rejects can be followed by the next one.
 */
export const rankUrisForDownloader = (
  repack: { uris: string[]; unavailableUris?: string[] | null },
  downloader: Downloader,
  getDownloadersForUri: GetDownloadersForUri
): string[] => {
  const unavailable = new Set(repack.unavailableUris ?? []);
  const candidates = repack.uris
    .map((uri, order) => ({ uri, order }))
    .filter(({ uri }) => getDownloadersForUri(uri).includes(downloader));

  candidates.sort(
    (a, b) =>
      Number(unavailable.has(a.uri)) - Number(unavailable.has(b.uri)) ||
      getUriConfidence(a.uri, downloader) -
        getUriConfidence(b.uri, downloader) ||
      a.order - b.order
  );

  return candidates.map(({ uri }) => uri);
};

/**
 * The downloader to preselect for a listing. A torrent goes through debrid,
 * AllDebrid first. Otherwise a host with its own downloader, or one debrid is
 * known to unlock, beats handing an unknown host to debrid, so a SteamRIP
 * style listing starts on its Gofile/Buzzheavier/Pixeldrain mirror instead of
 * failing with "This host or link is not supported".
 */
export const pickDefaultDownloader = (
  repack: { uris: string[]; unavailableUris?: string[] | null } | null,
  availableDownloaders: Downloader[],
  getDownloadersForUri: GetDownloadersForUri
): Downloader | null => {
  if (availableDownloaders.length === 0) return null;
  if (!repack) {
    return (
      [...availableDownloaders].sort(
        (a, b) => debridRank(a) - debridRank(b)
      )[0] ?? null
    );
  }

  const ranked = availableDownloaders.map((downloader, order) => {
    const uri = pickUriForDownloader(repack, downloader, getDownloadersForUri);
    return {
      downloader,
      order,
      confidence: uri ? getUriConfidence(uri, downloader) : 3,
    };
  });

  ranked.sort(
    (a, b) =>
      a.confidence - b.confidence ||
      debridRank(a.downloader) - debridRank(b.downloader) ||
      a.order - b.order
  );

  return ranked[0].downloader;
};

/** Adds AllDebrid to a link's downloaders when AllDebrid supports its host. */
export const withAllDebridSupport = (
  uri: string,
  downloaders: Downloader[]
): Downloader[] =>
  isAllDebridSupportedUri(uri) && !downloaders.includes(Downloader.AllDebrid)
    ? [...downloaders, Downloader.AllDebrid]
    : downloaders;

/**
 * Every (link, downloader) pair to try, in order: the chosen downloader's
 * links best first, then, after a debrid provider, each link's own direct
 * downloader so a host debrid rejects can still download directly.
 */
export const getDownloadAttempts = (
  repack: { uris: string[]; unavailableUris?: string[] | null },
  downloader: Downloader,
  getDownloadersForUri: GetDownloadersForUri,
  firstUri?: string
): { uri: string; downloader: Downloader }[] => {
  const ranked = rankUrisForDownloader(
    repack,
    downloader,
    getDownloadersForUri
  );
  const uris = firstUri
    ? [firstUri, ...ranked.filter((uri) => uri !== firstUri)]
    : ranked;
  const attempts = uris.map((uri) => ({ uri, downloader }));
  if (!DEBRID.has(downloader)) return attempts;
  const unavailable = new Set(repack.unavailableUris ?? []);
  for (const uri of repack.uris) {
    if (unavailable.has(uri)) continue;
    const direct = getDownloadersForUri(uri).find(
      (candidate) => !DEBRID.has(candidate)
    );
    if (direct !== undefined) attempts.push({ uri, downloader: direct });
  }
  return attempts;
};
