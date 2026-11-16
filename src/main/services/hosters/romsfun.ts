import { Downloader, DownloadError, isRomsFunPageUri } from "@shared";
import { logger } from "../logger";

/**
 * A RomsFun listing points at the game's page. When a download starts, swap
 * it for the file the page links to. RomsFun is a free direct download, so it
 * works without debrid; any other link is returned unchanged.
 */
export const resolveRomsFunDownload = async (
  downloader: Downloader,
  uri: string
): Promise<{ downloader: Downloader; uri: string }> => {
  if (!isRomsFunPageUri(uri)) return { downloader, uri };

  const { resolveRomsFunLink, RomsFunWindowClosedError } = await import(
    "./romsfun-browser"
  );
  let link: string | null;
  try {
    link = await resolveRomsFunLink(uri);
  } catch (error) {
    if (error instanceof RomsFunWindowClosedError) {
      throw new Error(DownloadError.RomsFunWindowClosed);
    }
    throw error;
  }
  if (!link) throw new Error(DownloadError.RomsFunLinkNotFound);

  logger.log(`[RomsFun] Using ${link.slice(0, 120)} for ${uri}`);
  return { downloader: Downloader.RomsFun, uri: link };
};
