import {
  ankerGamesLinkOrder,
  Downloader,
  DownloadError,
  isAnkerGamesPageUri,
} from "@shared";
import { logger } from "../logger";

const DEBRID = new Set<Downloader>([
  Downloader.AllDebrid,
  Downloader.RealDebrid,
  Downloader.Premiumize,
  Downloader.TorBox,
]);
/** Debrid services that also unlock hoster links such as FileKeeper. */
const HOSTER_DEBRID = new Set<Downloader>([
  Downloader.AllDebrid,
  Downloader.RealDebrid,
]);

/**
 * An AnkerGames listing points at the game's page. When a download starts,
 * swap that page for the real link the chosen downloader takes:
 * - AnkerGames: the site's direct download (FileKeeper if it has none),
 * - FileKeeper: the FileKeeper mirror (direct if it has none),
 * - a debrid service: the torrent as a magnet, so it never downloads peer to
 *   peer; AllDebrid / Real-Debrid can also unlock the FileKeeper mirror.
 * Any other link is returned unchanged.
 */
export const resolveAnkerGamesDownload = async (
  downloader: Downloader,
  uri: string
): Promise<{ downloader: Downloader; uri: string }> => {
  if (!isAnkerGamesPageUri(uri)) return { downloader, uri };

  const isDebrid = DEBRID.has(downloader);
  const wanted = isDebrid
    ? "debrid"
    : downloader === Downloader.FileKeeper
      ? "filekeeper"
      : "direct";
  const order = ankerGamesLinkOrder(wanted).filter(
    (kind) =>
      kind !== "filekeeper" || !isDebrid || HOSTER_DEBRID.has(downloader)
  );

  const { resolveAnkerGamesInBrowser, AnkerGamesWindowClosedError } =
    await import("./ankergames-browser");
  let found: Awaited<ReturnType<typeof resolveAnkerGamesInBrowser>>;
  try {
    found = await resolveAnkerGamesInBrowser(uri, order);
  } catch (error) {
    if (error instanceof AnkerGamesWindowClosedError) {
      throw new Error(DownloadError.AnkerGamesWindowClosed);
    }
    throw error;
  }
  if (!found) throw new Error(DownloadError.AnkerGamesLinkNotFound);

  logger.log(`[AnkerGames] Using the ${found.kind} link for ${uri}`);
  if (found.kind === "torrent") return { downloader, uri: found.url };
  if (found.kind === "filekeeper") {
    return {
      downloader: isDebrid ? downloader : Downloader.FileKeeper,
      uri: found.url,
    };
  }
  return { downloader: Downloader.AnkerGames, uri: found.url };
};
