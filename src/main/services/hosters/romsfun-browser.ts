import { BrowserWindow, session } from "electron";
import { setTimeout as sleep } from "node:timers/promises";
import {
  isCloudflareChallenge,
  isRomsFunFilePage,
  isRomsFunGamePage,
  parseRomsFunDirectLink,
  parseRomsFunDownloadPage,
  parseRomsFunFilePages,
  parseRomsFunSearch,
  pickRomsFunFile,
  ROMSFUN_ORIGIN,
  romsFunSearchUrl,
  type RomsFunSearchResult,
} from "@shared";
import { logger } from "../logger";

/** Kept between runs so a passed Cloudflare check is remembered. */
export const ROMSFUN_PARTITION = "persist:romsfun";
/** How long Nacho walks the pages by itself before asking the person. */
const AUTOMATIC_MS = 30_000;
/** How long the person has to click the download in the window themselves. */
const TOTAL_TIMEOUT_MS = 4 * 60_000;
/** How long a search waits for the site's human check to pass. */
const SEARCH_TIMEOUT_MS = 90_000;
const POLL_MS = 1_000;
const SHOW_SEARCH_AFTER_MS = 4_000;

export class RomsFunWindowClosedError extends Error {}

const getSession = () => session.fromPartition(ROMSFUN_PARTITION);

/** Electron's default user agent minus its "Electron/x" and app tokens. */
export const getRomsFunUserAgent = () =>
  getSession()
    .getUserAgent()
    .replace(
      /\s(Electron|nacho-launcher|hydralauncher|Nacho Launcher)\/\S+/gi,
      ""
    );

/** Cookies the site set for a link's host, for the download request. */
export const getRomsFunCookieHeader = async (url: string) => {
  const cookies = await getSession()
    .cookies.get({ url })
    .catch(() => []);
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
};

const prepareSession = () => {
  const browserSession = getSession();
  browserSession.setUserAgent(getRomsFunUserAgent());
  browserSession.setPermissionRequestHandler((_c, _p, callback) =>
    callback(false)
  );
  return browserSession;
};

/** A page read straight over HTTP, or null when the site wants a browser. */
const fetchPage = async (url: string, referer: string) => {
  try {
    const response = await prepareSession().fetch(url, {
      headers: { Referer: referer },
    });
    const html = await response.text();
    if (!response.ok || isCloudflareChallenge(html)) {
      logger.log(`[RomsFun] ${url} needs a browser (HTTP ${response.status})`);
      return null;
    }
    return html;
  } catch (error) {
    logger.warn(`[RomsFun] Could not read ${url}`, error);
    return null;
  }
};

/** Game page -> download page -> the file's page -> the file, over plain HTTP. */
const resolveByFetch = async (pageUrl: string) => {
  let url = pageUrl;
  let html = await fetchPage(url, `${ROMSFUN_ORIGIN}/`);
  if (html && isRomsFunGamePage(url)) {
    const downloadPage = parseRomsFunDownloadPage(html, url);
    if (!downloadPage) return null;
    html = await fetchPage(downloadPage, url);
    url = downloadPage;
  }
  if (!html) return null;

  const direct = parseRomsFunDirectLink(html, url);
  if (direct) return direct;

  const file = pickRomsFunFile(parseRomsFunFilePages(html, url));
  if (!file) return null;
  const fileHtml = await fetchPage(file.url, url);
  return fileHtml ? parseRomsFunDirectLink(fileHtml, file.url) : null;
};

const newWindow = (title: string) => {
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 680,
    title,
    autoHideMenuBar: true,
    webPreferences: {
      session: prepareSession(),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  window.webContents.setAudioMuted(true);
  // Ads open new windows: never follow them.
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return window;
};

const readPage = (window: BrowserWindow) =>
  window.webContents
    .executeJavaScript(
      "({ url: location.href, html: document.documentElement.outerHTML })"
    )
    .catch(() => null) as Promise<{ url: string; html: string } | null>;

/**
 * Walks the same pages in a small window of Nacho's own browser, for when the
 * site asks for a human check. The window is visible: if the check needs a
 * click, or Nacho can't find the link, the person clicks the download there.
 */
const resolveInWindow = async (pageUrl: string) => {
  const previouslyFocused = BrowserWindow.getFocusedWindow();
  const browserSession = prepareSession();
  let found: string | null = null;

  const onDownload = (event: Electron.Event, item: Electron.DownloadItem) => {
    event.preventDefault();
    found = item.getURL();
    logger.log(`[RomsFun] Download started in the window: ${found}`);
  };
  browserSession.on("will-download", onDownload);

  const window = newWindow("RomsFun – getting the download link");
  let closed = false;
  window.on("closed", () => {
    closed = true;
  });

  try {
    window.show();
    await window.loadURL(pageUrl).catch(() => undefined);
    const started = Date.now();
    const visited = new Set<string>([pageUrl]);
    let handedOff = false;

    while (!closed && !found) {
      const waited = Date.now() - started;
      if (waited > TOTAL_TIMEOUT_MS) return null;
      if (waited > AUTOMATIC_MS && !handedOff) {
        handedOff = true;
        window.setTitle("RomsFun – click the download to continue");
      }

      const page = await readPage(window);
      if (page && !isCloudflareChallenge(page.html)) {
        const direct = parseRomsFunDirectLink(page.html, page.url);
        let next: string | null = null;
        if (direct) {
          found = direct;
          break;
        }
        if (!handedOff) {
          if (isRomsFunGamePage(page.url)) {
            next = parseRomsFunDownloadPage(page.html, page.url);
          } else if (!isRomsFunFilePage(page.url)) {
            next =
              pickRomsFunFile(parseRomsFunFilePages(page.html, page.url))
                ?.url ?? null;
          }
        }
        if (next && !visited.has(next)) {
          visited.add(next);
          logger.log(`[RomsFun] Opening ${next}`);
          await window.loadURL(next).catch(() => undefined);
          continue;
        }
      }
      await sleep(POLL_MS);
    }

    if (closed && !found) throw new RomsFunWindowClosedError();
    return found;
  } finally {
    browserSession.off("will-download", onDownload);
    if (!window.isDestroyed()) window.destroy();
    if (previouslyFocused && !previouslyFocused.isDestroyed()) {
      previouslyFocused.focus();
    }
  }
};

/** The real file behind a RomsFun game or download page. */
export async function resolveRomsFunLink(pageUrl: string) {
  logger.log(`[RomsFun] Resolving ${pageUrl}`);
  return (await resolveByFetch(pageUrl)) ?? (await resolveInWindow(pageUrl));
}

/**
 * Searches RomsFun for a game. Reads the results page directly, and only when
 * the site asks for a human check opens it in a window the person can see.
 */
export async function searchRomsFunPages(
  query: string
): Promise<RomsFunSearchResult[]> {
  const url = romsFunSearchUrl(query);
  const html = await fetchPage(url, `${ROMSFUN_ORIGIN}/`);
  if (html) return parseRomsFunSearch(html);

  const window = newWindow("RomsFun – searching");
  let closed = false;
  window.on("closed", () => {
    closed = true;
  });
  try {
    await window.loadURL(url).catch(() => undefined);
    const started = Date.now();
    while (!closed && Date.now() - started < SEARCH_TIMEOUT_MS) {
      const page = await readPage(window);
      if (page && !isCloudflareChallenge(page.html)) {
        return parseRomsFunSearch(page.html);
      }
      // Most checks pass by themselves; show the ones that want a click.
      if (!window.isVisible() && Date.now() - started > SHOW_SEARCH_AFTER_MS) {
        window.show();
      }
      await sleep(POLL_MS);
    }
    return [];
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}
