/**
 * FileDitch moves between domains often (fileditchfiles.me, fileditchvids.st,
 * fileditch.com...), so any host with "fileditch" in its name counts, plus its
 * short-link and embed domains. Album pages are not single files.
 */
const FILEDITCH_SHORT_HOST = "theditch.st";
const FILEDITCH_EMBED_HOST = "embedditch.st";
const FILEDITCH_HOTLINK_HOST = "fileditchhot.st";

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mkv",
  "webm",
  "mov",
  "avi",
  "m4v",
  "wmv",
  "flv",
  "ts",
]);

const parseHttpUrl = (uri: string): URL | null => {
  try {
    const url = new URL(uri.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url;
  } catch {
    return null;
  }
};

const hostOf = (url: URL) => url.hostname.toLowerCase().replace(/^www\./, "");

const isFileDitchHost = (host: string) =>
  host === FILEDITCH_SHORT_HOST ||
  host === FILEDITCH_EMBED_HOST ||
  (/(^|\.)fileditch[a-z0-9-]*\.[a-z]+$/.test(host) &&
    !host.startsWith("fileditchalbums."));

export const isFileDitchUri = (uri: string): boolean => {
  const url = parseHttpUrl(uri);
  if (!url || !isFileDitchHost(hostOf(url))) return false;
  const segments = url.pathname.split("/").filter(Boolean);
  if (hostOf(url) === FILEDITCH_SHORT_HOST) return segments.length === 1;
  return (
    segments.length >= 2 ||
    (segments[0] === "file.php" && Boolean(url.searchParams.get("f")))
  );
};

export type FileDitchLinkKind = "short" | "hotlink" | "page";

/**
 * Puts a FileDitch link in the shape its file page uses: `file.php?f=/path`
 * becomes `/path`, doubled slashes are collapsed and the tracking parameter
 * is dropped.
 */
export function normalizeFileDitchUrl(uri: string): {
  url: string;
  kind: FileDitchLinkKind;
} {
  const url = parseHttpUrl(uri);
  if (!url || !isFileDitchUri(uri)) {
    throw new Error(`Invalid FileDitch URL: ${uri}`);
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  const host = hostOf(url);

  if (host === FILEDITCH_SHORT_HOST) {
    url.search = "";
    return { url: url.href, kind: "short" };
  }

  const filePath = url.pathname.endsWith("/file.php")
    ? url.searchParams.get("f")
    : null;
  if (filePath) {
    url.pathname = filePath.replace(/\/{2,}/g, "/");
    url.search = "";
  }
  url.searchParams.delete("fdrh");

  return {
    url: url.href,
    kind: host === FILEDITCH_HOTLINK_HOST ? "hotlink" : "page",
  };
}

/**
 * Video pages are also served from FileDitch's embed domain, which tends to
 * skip the human check; try it first for videos.
 */
export function fileDitchPageCandidates(pageUrl: string): string[] {
  const url = new URL(pageUrl);
  const extension = url.pathname.split(".").pop()?.toLowerCase() ?? "";
  if (!VIDEO_EXTENSIONS.has(extension) || hostOf(url) === FILEDITCH_EMBED_HOST)
    return [url.href];
  const embed = new URL(url.href);
  embed.hostname = FILEDITCH_EMBED_HOST;
  return [embed.href, url.href];
}

/**
 * A real FileDitch file link is signed and expires. It comes in one of three
 * shapes: `?md5=…&expires=…`, `?exp=…&sig=…`, or `https://<node>/<token>`
 * where the token is base64url of `<expires>:<sig>:<n>/<path>`. Anything else
 * (like the site's placeholder image) is not the file.
 */
export function isSignedFileDitchLink(uri: string): boolean {
  const url = parseHttpUrl(uri);
  if (!url) return false;
  const query = url.searchParams;
  if (query.get("md5") && query.get("expires")) return true;
  if (query.get("exp") && query.get("sig")) return true;

  const segments = url.pathname.split("/").filter(Boolean);
  if (url.search || segments.length !== 1) return false;
  try {
    const base64 = segments[0].replace(/-/g, "+").replace(/_/g, "/");
    // atob accepts base64 without its "=" padding.
    const decoded = atob(base64);
    const [expires, signature, ...rest] = decoded.split(":");
    const path = rest.join(":");
    return /^\d+$/.test(expires) && Boolean(signature) && path.includes("/");
  } catch {
    return false;
  }
}

export interface FileDitchPageState {
  /** The page says the file was removed. */
  gone: boolean;
  /** A human or proof-of-work check is still showing. */
  challenged: boolean;
  /** The download button's link, when the page shows one. */
  downloadHref: string | null;
  /** Where a short link's "go" button points. */
  shortLinkHref: string | null;
}

const attribute = (tag: string, name: string) => {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i"
  ).exec(tag);
  if (!match) return null;
  return (match[2] ?? match[3] ?? match[4] ?? "").replace(/&amp;/g, "&");
};

const hasAttribute = (tag: string, name: string) =>
  new RegExp(`\\s${name}(\\s|=|>|/)`, "i").test(tag);

/** Reads a FileDitch page fetched over plain HTTP. */
export function parseFileDitchPage(html: string): FileDitchPageState {
  const gone = /class\s*=\s*["'][^"']*\bgone-path\b/i.test(html);

  let downloadHref: string | null = null;
  let shortLinkHref: string | null = null;
  for (const [tag] of html.matchAll(/<a\b[^>]*>/gi)) {
    const classes = (attribute(tag, "class") ?? "").split(/\s+/);
    const href = attribute(tag, "href");
    if (!href) continue;
    if (
      !downloadHref &&
      classes.includes("btn") &&
      hasAttribute(tag, "download")
    )
      downloadHref = href;
    if (!shortLinkHref && attribute(tag, "id") === "fd-go")
      shortLinkHref = href;
  }

  // A form with hidden inputs, other than the language picker, is the
  // site's human / proof-of-work check.
  let challenged =
    /<title>\s*(just a moment|attention required|un instant|einen moment)/i.test(
      html
    ) || /class\s*=\s*["'][^"']*\bcf-turnstile\b/i.test(html);
  for (const [form] of html.matchAll(/<form\b[\s\S]*?<\/form>/gi)) {
    if (!/<input\b[^>]*type\s*=\s*["']?hidden/i.test(form)) continue;
    if (/<button\b[^>]*class\s*=\s*["'][^"']*\blang\b/i.test(form)) continue;
    challenged = true;
  }

  return { gone, challenged, downloadHref, shortLinkHref };
}

/** Script run inside the page in the app's browser; returns FileDitchPageState. */
export const READ_FILEDITCH_PAGE_STATE = `(() => {
  const title = document.title || "";
  const forms = [...document.querySelectorAll("form")].filter(
    (form) => form.querySelector("input[type='hidden']") && !form.querySelector("button.lang")
  );
  return {
    gone: Boolean(document.querySelector(".gone-path")),
    challenged: /just a moment|attention required|un instant|einen moment/i.test(title)
      || Boolean(document.querySelector(".cf-turnstile, #challenge-form, #challenge-running"))
      || forms.length > 0,
    downloadHref: document.querySelector("a.btn[download]")?.href ?? null,
    shortLinkHref: document.querySelector("a#fd-go")?.href ?? null,
  };
})()`;
