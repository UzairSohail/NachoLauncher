import { BrowserWindow, session } from "electron";
import { setTimeout as sleep } from "node:timers/promises";
import {
  isSignedFileDitchLink,
  READ_FILEDITCH_PAGE_STATE,
  type FileDitchPageState,
} from "@shared";
import { logger } from "../logger";

/** Kept between runs so a passed check is remembered. */
const PARTITION = "persist:fileditch";
/** How long the person has to get through the check. */
const CHECK_TIMEOUT_MS = 3 * 60_000;
const POLL_MS = 1_000;

export class FileDitchCheckCancelledError extends Error {}

const getSession = () => session.fromPartition(PARTITION);

/** Electron's user agent without its "Electron/x" and app tokens. */
export const getFileDitchUserAgent = () =>
  getSession()
    .getUserAgent()
    .replace(
      /\s(Electron|nacho-launcher|hydralauncher|Nacho Launcher)\/\S+/gi,
      ""
    );

/** Cookies the window holds for a link, so the download looks like the page. */
export const getFileDitchCookieHeader = async (url: string) => {
  const cookies = await getSession()
    .cookies.get({ url })
    .catch(() => []);
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
};

export interface FileDitchBrowserResult {
  url: string | null;
  gone: boolean;
  pageUrl: string;
}

/**
 * Opens a FileDitch page (or short link) in Nacho's own browser and waits
 * for its human / proof-of-work check to clear, then reads the signed link
 * from the download button. The window is shown so the check runs at full
 * speed and the person can click it if it asks; nothing is solved for them.
 */
export async function resolveFileDitchInBrowser(
  pageUrl: string,
  referer: string | null = null
): Promise<FileDitchBrowserResult> {
  const previouslyFocused = BrowserWindow.getFocusedWindow();
  const browserSession = getSession();
  browserSession.setUserAgent(getFileDitchUserAgent());
  browserSession.setPermissionRequestHandler((_c, _p, callback) =>
    callback(false)
  );

  const window = new BrowserWindow({
    show: false,
    width: 960,
    height: 720,
    title: "FileDitch – confirm you're human to continue the download",
    autoHideMenuBar: true,
    webPreferences: {
      session: browserSession,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  let closedByPerson = false;
  window.on("closed", () => {
    closedByPerson = true;
  });

  // Once the check passes, FileDitch may start the file straight away
  // instead of showing a button. Nacho downloads it itself, so take the link
  // and stop the browser's own download.
  let startedDownload: string | null = null;
  const onWillDownload = (
    event: Electron.Event,
    item: Electron.DownloadItem,
    contents: Electron.WebContents
  ) => {
    if (contents !== window.webContents) return;
    event.preventDefault();
    startedDownload ??= item.getURL();
  };
  browserSession.on("will-download", onWillDownload);

  try {
    logger.log(`[FileDitch] Opening ${pageUrl} in the app browser`);
    window.show();
    window.focus();
    await window
      .loadURL(pageUrl, referer ? { httpReferrer: referer } : undefined)
      .catch(() => undefined);

    const started = Date.now();
    let loggedChallenge = false;
    let followedShortLink = false;
    while (!closedByPerson) {
      if (startedDownload) {
        logger.log("[FileDitch] The page started the file download");
        return {
          url: startedDownload,
          gone: false,
          pageUrl: window.webContents.getURL() || pageUrl,
        };
      }
      const state = (await window.webContents
        .executeJavaScript(READ_FILEDITCH_PAGE_STATE)
        .catch(() => null)) as FileDitchPageState | null;
      const currentUrl = window.webContents.getURL() || pageUrl;

      if (state?.gone) return { url: null, gone: true, pageUrl: currentUrl };

      if (state && !state.challenged) {
        // Once the page's own check has passed, its download button is the
        // file even when the link isn't one of the known signed shapes.
        if (state.downloadHref) {
          if (!isSignedFileDitchLink(state.downloadHref)) {
            logger.log(
              `[FileDitch] Using an unsigned download link from ${currentUrl}`
            );
          }
          return {
            url: new URL(state.downloadHref, currentUrl).href,
            gone: false,
            pageUrl: currentUrl,
          };
        }
        if (state.shortLinkHref && !followedShortLink) {
          followedShortLink = true;
          const next = new URL(state.shortLinkHref, currentUrl).href;
          logger.log(`[FileDitch] Following short link to ${next}`);
          await window
            .loadURL(next, { httpReferrer: currentUrl })
            .catch(() => undefined);
          continue;
        }
      } else if (state?.challenged && !loggedChallenge) {
        loggedChallenge = true;
        logger.log(`[FileDitch] Waiting for the page check (${currentUrl})`);
      }

      if (Date.now() - started > CHECK_TIMEOUT_MS) {
        logger.warn("[FileDitch] Page check not passed in time");
        return { url: null, gone: false, pageUrl: currentUrl };
      }
      await sleep(POLL_MS);
    }

    throw new FileDitchCheckCancelledError();
  } finally {
    browserSession.removeListener("will-download", onWillDownload);
    if (!window.isDestroyed()) window.destroy();
    if (previouslyFocused && !previouslyFocused.isDestroyed()) {
      previouslyFocused.focus();
    }
  }
}
