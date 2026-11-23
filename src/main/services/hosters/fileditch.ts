import {
  DownloadError,
  fileDitchPageCandidates,
  fileDitchRefererFor,
  isFileDitchUri,
  isSignedFileDitchLink,
  normalizeFileDitchUrl,
  parseFileDitchPage,
} from "@shared";
import { logger } from "../logger";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

/**
 * FileDitch's signed links are short-lived and the file servers throttle
 * many parallel requests from one person, so keep the connection count low.
 */
export const FILEDITCH_MAX_CONNECTIONS = 4;

export interface FileDitchDownload {
  url: string;
  headers: Record<string, string>;
}

/**
 * FileDitch shows its files behind a page with a download button; the
 * button's link is signed and expires. The page is read over plain HTTP when
 * it allows that, otherwise in the app's browser where the site's human
 * check can run.
 */
export class FileDitchApi {
  public static canHandle(uri: string): boolean {
    return isFileDitchUri(uri);
  }

  public static async getDownload(uri: string): Promise<FileDitchDownload> {
    const { url, kind } = normalizeFileDitchUrl(uri);
    const referer = fileDitchRefererFor(url);

    // Hotlinks already point at the file.
    if (kind === "hotlink") {
      return {
        url,
        headers: {
          "User-Agent": USER_AGENT,
          ...(referer ? { Referer: referer } : {}),
        },
      };
    }

    let pages = kind === "short" ? [url] : fileDitchPageCandidates(url);
    let challengedPage: string | null = null;
    let gone = false;

    for (let index = 0; index < pages.length; index++) {
      const pageUrl = pages[index];
      const html = await this.fetchPage(pageUrl, referer);
      if (html === null) continue;
      const state = parseFileDitchPage(html);

      if (state.gone) {
        gone = true;
        continue;
      }
      if (state.challenged) {
        challengedPage ??= pageUrl;
        continue;
      }
      if (state.downloadHref) {
        const link = new URL(state.downloadHref, pageUrl).href;
        if (isSignedFileDitchLink(link)) {
          return {
            url: link,
            headers: { "User-Agent": USER_AGENT, Referer: referer ?? pageUrl },
          };
        }
        logger.warn(`[FileDitch] Unexpected download link on ${pageUrl}`);
      }
      if (kind === "short" && state.shortLinkHref && pages.length === 1) {
        const next = normalizeFileDitchUrl(
          new URL(state.shortLinkHref, pageUrl).href
        ).url;
        pages = [...pages, ...fileDitchPageCandidates(next)];
      }
    }

    if (gone && !challengedPage) {
      throw new Error(DownloadError.HosterUnlockFileNotFound);
    }

    const browserLink = await this.resolveInBrowser(
      challengedPage ?? pages[pages.length - 1],
      referer
    );
    if (browserLink) return browserLink;

    throw new Error(
      gone
        ? DownloadError.HosterUnlockFileNotFound
        : DownloadError.HosterUnlockUnavailable
    );
  }

  private static async fetchPage(
    pageUrl: string,
    referer: string | null
  ): Promise<string | null> {
    try {
      const response = await fetch(pageUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 404 || response.status === 410) {
        return `<div class="gone-path"></div>`;
      }
      // Cloudflare answers its check with 403/503 and an HTML page.
      return await response.text();
    } catch (error) {
      logger.warn(`[FileDitch] ${pageUrl} unreachable`, error);
      return null;
    }
  }

  private static async resolveInBrowser(
    pageUrl: string,
    referer: string | null
  ): Promise<FileDitchDownload | null> {
    const {
      resolveFileDitchInBrowser,
      FileDitchCheckCancelledError,
      getFileDitchCookieHeader,
      getFileDitchUserAgent,
    } = await import("./fileditch-browser");
    try {
      const result = await resolveFileDitchInBrowser(pageUrl, referer);
      if (result.gone) throw new Error(DownloadError.HosterUnlockFileNotFound);
      if (!result.url) return null;
      const cookie = await getFileDitchCookieHeader(result.url);
      return {
        url: result.url,
        headers: {
          "User-Agent": getFileDitchUserAgent(),
          Referer: referer ?? result.pageUrl,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      };
    } catch (error) {
      if (error instanceof FileDitchCheckCancelledError) {
        logger.log("[FileDitch] Check window closed by the person");
        return null;
      }
      throw error;
    }
  }
}
