import { BrowserWindow, session, type Session } from "electron";
import { setTimeout as sleep } from "node:timers/promises";
import { classifyAnkerGamesLink, type AnkerGamesLinkKind } from "@shared";
import { torrentFileToMagnet } from "@main/helpers/torrent-file-to-magnet";
import { logger } from "../logger";

/** Kept between runs so a passed Cloudflare check is remembered. */
export const ANKERGAMES_PARTITION = "persist:ankergames";
/** How long Nacho clicks through the page by itself before only waiting. */
const AUTOMATIC_MS = 45_000;
/** How long the person has to pick the download in the window themselves. */
const TOTAL_TIMEOUT_MS = 4 * 60_000;
const POLL_MS = 1_000;

export class AnkerGamesWindowClosedError extends Error {}

/** Electron's default user agent minus its "Electron/x" and app tokens. */
export const getAnkerGamesUserAgent = () =>
  session
    .fromPartition(ANKERGAMES_PARTITION)
    .getUserAgent()
    .replace(
      /\s(Electron|nacho-launcher|hydralauncher|Nacho Launcher)\/\S+/gi,
      ""
    );

/** Cookies the window got for a link's host, for the download request. */
export const getAnkerGamesCookieHeader = async (url: string) => {
  const cookies = await session
    .fromPartition(ANKERGAMES_PARTITION)
    .cookies.get({ url })
    .catch(() => []);
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
};

const LABELS: Record<AnkerGamesLinkKind, string> = {
  direct: "direct",
  filekeeper: "file\\s*keeper",
  torrent: "torrent|magnet",
};

/**
 * Runs in the page once a second. Reports the links it can see and clicks one
 * step further towards the wanted download: the button for that kind of
 * download, then the button inside the dialog it opens, then the "Download
 * now" button that appears once the short wait is over.
 */
const stepScript = (kind: AnkerGamesLinkKind) => `(() => {
  const want = new RegExp(${JSON.stringify(LABELS[kind])}, "i");
  const title = document.title || "";
  const challenged = /just a moment|attention required|un instant|einen moment/i.test(title)
    || Boolean(document.querySelector("#challenge-form, #challenge-running, .cf-turnstile, #cf-challenge-running"));
  const visible = (el) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden"
      && Number(style.opacity) > 0 && box.width > 0 && box.height > 0;
  };
  const links = [];
  for (const el of document.querySelectorAll("a[href], [data-href], [data-url], [data-link]")) {
    const value = el.getAttribute("href") || el.dataset.href || el.dataset.url || el.dataset.link;
    if (!value || value.startsWith("#") || value.startsWith("javascript:")) continue;
    try { links.push(new URL(value, location.href).href); } catch {}
  }
  if (challenged) return { challenged, links: [], clicked: null };

  const label = (el) => [el.innerText, el.getAttribute("aria-label"), el.getAttribute("title"), el.className]
    .filter((v) => typeof v === "string").join(" ").replace(/\\s+/g, " ").trim();
  const clickable = [...document.querySelectorAll("a, button, [role=button], input[type=submit]")]
    .filter((el) => visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true");
  const now = Date.now();
  const canClick = (el) => {
    const last = Number(el.dataset.nachoClickedAt || 0);
    const count = Number(el.dataset.nachoClicks || 0);
    return count < 3 && now - last > 6000;
  };
  const click = (el, why) => {
    el.dataset.nachoClickedAt = String(now);
    el.dataset.nachoClicks = String(Number(el.dataset.nachoClicks || 0) + 1);
    el.scrollIntoView({ block: "center" });
    el.click();
    return why + ": " + label(el).slice(0, 80);
  };

  // 1. The "Download now" button revealed after the countdown.
  const reveal = clickable.find((el) => el.matches("a.download-btn-reveal, a[aria-label='Download Now']") && canClick(el));
  if (reveal) return { challenged, links, clicked: click(reveal, "reveal") };

  // 2. A button for the kind of download we want (page or dialog).
  const dialog = [...document.querySelectorAll(".modal-content, [role=dialog], .modal, [x-show]")]
    .find((el) => visible(el) && el.querySelector("a, button"));
  const inDialog = dialog ? clickable.filter((el) => dialog.contains(el)) : [];
  const wanted = (inDialog.length ? inDialog : clickable)
    .find((el) => want.test(label(el)) && canClick(el));
  if (wanted) return { challenged, links, clicked: click(wanted, "option") };

  // 3. Inside the dialog, its own download / continue button.
  const next = inDialog.find((el) => (el.matches(".download-button, a[x-bind*=isLoading], [x-bind\\\\:href]")
    || /download|continue|get link|proceed|generate/i.test(label(el))) && canClick(el));
  if (next) return { challenged, links, clicked: click(next, "dialog") };

  // 4. With no dialog open, the page's main download button opens it.
  if (!dialog) {
    const opener = clickable.find((el) => (el.matches(".download-button, .btn-download, a.download")
      || /^\\s*download/i.test(label(el))) && canClick(el));
    if (opener) return { challenged, links, clicked: click(opener, "download") };
  }
  return { challenged, links, clicked: null };
})()`;

interface StepResult {
  challenged: boolean;
  links: string[];
  clicked: string | null;
}

interface Found {
  kind: AnkerGamesLinkKind;
  url: string;
}

const isHtml = (contentType: string | null) =>
  !contentType || /text\/html|application\/xhtml/i.test(contentType);

/** Reads a .torrent link with the window's cookies and turns it into a magnet. */
const readTorrent = async (browserSession: Session, url: string) => {
  if (url.startsWith("magnet:")) return url;
  const response = await browserSession.fetch(url);
  if (!response.ok)
    throw new Error(`Torrent file returned HTTP ${response.status}`);
  return torrentFileToMagnet(Buffer.from(await response.arrayBuffer()));
};

/**
 * True when a link answers with a file rather than a web page, so an ad that
 * pops up in a new window isn't taken for the game.
 */
const servesFile = async (browserSession: Session, url: string) => {
  try {
    const controller = new AbortController();
    const response = await browserSession.fetch(url, {
      headers: { Range: "bytes=0-0" },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type");
    const disposition = response.headers.get("content-disposition") ?? "";
    controller.abort();
    return (
      response.ok && (!isHtml(contentType) || /attachment/i.test(disposition))
    );
  } catch {
    return false;
  }
};

/**
 * Opens an AnkerGames game page in a small window of Nacho's own browser and
 * clicks through to the wanted download (`order`, best first). The window is
 * visible the whole time: if the site asks the person to confirm they're
 * human, or the page changed and Nacho can't find the buttons, the person can
 * click the download themselves and Nacho takes the link from there.
 */
export async function resolveAnkerGamesInBrowser(
  pageUrl: string,
  order: AnkerGamesLinkKind[]
): Promise<Found | null> {
  const previouslyFocused = BrowserWindow.getFocusedWindow();
  const browserSession = session.fromPartition(ANKERGAMES_PARTITION);
  browserSession.setUserAgent(getAnkerGamesUserAgent());
  browserSession.setPermissionRequestHandler((_c, _p, callback) =>
    callback(false)
  );

  const found = new Map<AnkerGamesLinkKind, string>();
  const checking = new Set<string>();
  const record = (kind: AnkerGamesLinkKind, url: string, how: string) => {
    if (!order.includes(kind) || found.has(kind)) return;
    logger.log(
      `[AnkerGames] Found ${kind} link (${how}): ${url.slice(0, 120)}`
    );
    found.set(kind, url);
  };

  /** A link the page opened or pointed at: keep it if it's a download. */
  const consider = async (url: string, how: string) => {
    const kind = classifyAnkerGamesLink(url);
    if (!kind || found.has(kind) || checking.has(url)) return;
    if (kind !== "direct") return record(kind, url, how);
    checking.add(url);
    if (await servesFile(browserSession, url)) record(kind, url, how);
  };

  const onDownload = (event: Electron.Event, item: Electron.DownloadItem) => {
    event.preventDefault();
    const url = item.getURL();
    const kind = classifyAnkerGamesLink(url, {
      filename: item.getFilename(),
      mimeType: item.getMimeType(),
    });
    if (kind) record(kind, url, "download");
  };
  browserSession.on("will-download", onDownload);

  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 680,
    title: "AnkerGames – getting the download link",
    autoHideMenuBar: true,
    webPreferences: {
      session: browserSession,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  window.webContents.setAudioMuted(true);

  // "Direct download" opens a new page: follow it in this same window when
  // it's AnkerGames' own, and take the link when it's the file itself.
  window.webContents.setWindowOpenHandler(({ url }) => {
    logger.log(`[AnkerGames] Page opened ${url.slice(0, 120)}`);
    const kind = classifyAnkerGamesLink(url);
    if (kind === null && /^https?:/i.test(url)) {
      setImmediate(() => {
        if (!window.isDestroyed()) window.loadURL(url).catch(() => undefined);
      });
    } else if (kind === "direct") {
      void servesFile(browserSession, url).then((file) => {
        if (file) record("direct", url, "new window");
        else if (/download|dl|file/i.test(url) && !window.isDestroyed())
          window.loadURL(url).catch(() => undefined);
      });
    } else if (kind) {
      record(kind, url, "new window");
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const kind = classifyAnkerGamesLink(url);
    if (kind === "torrent" || kind === "filekeeper") {
      event.preventDefault();
      record(kind, url, "navigation");
    }
  });

  let closed = false;
  window.on("closed", () => {
    closed = true;
  });

  try {
    logger.log(`[AnkerGames] Opening ${pageUrl}`);
    // Shown from the start: Chromium throttles hidden windows, which can
    // stall the site's checks and countdowns.
    window.show();
    window.focus();
    await window.loadURL(pageUrl).catch(() => undefined);

    const started = Date.now();
    let loggedChallenge = false;
    let loggedHandOff = false;
    while (!closed) {
      const best = order.find((kind) => found.has(kind));
      const waited = Date.now() - started;
      if (best === order[0]) break;
      if (best && waited > AUTOMATIC_MS) break;
      if (waited > TOTAL_TIMEOUT_MS) {
        logger.warn("[AnkerGames] No download link found in time");
        return null;
      }

      const step = (await window.webContents
        .executeJavaScript(stepScript(order[0]))
        .catch(() => null)) as StepResult | null;
      if (step?.challenged && !loggedChallenge) {
        loggedChallenge = true;
        logger.log("[AnkerGames] Waiting for the site's human check");
      }
      for (const link of step?.links ?? []) await consider(link, "page");
      if (step?.clicked && waited < AUTOMATIC_MS) {
        logger.log(`[AnkerGames] Clicked ${step.clicked}`);
      }
      if (waited > AUTOMATIC_MS && !loggedHandOff) {
        loggedHandOff = true;
        logger.log("[AnkerGames] Waiting for the person to pick the download");
        window.setTitle("AnkerGames – click the download you want to continue");
      }
      await sleep(POLL_MS);
    }

    if (closed && found.size === 0) throw new AnkerGamesWindowClosedError();
    const kind = order.find((candidate) => found.has(candidate));
    if (!kind) return null;
    const url = found.get(kind)!;
    return {
      kind,
      url: kind === "torrent" ? await readTorrent(browserSession, url) : url,
    };
  } finally {
    browserSession.off("will-download", onDownload);
    if (!window.isDestroyed()) window.destroy();
    if (previouslyFocused && !previouslyFocused.isDestroyed()) {
      previouslyFocused.focus();
    }
  }
}
