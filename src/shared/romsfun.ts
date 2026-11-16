/**
 * RomsFun (romsfun.com) is a free ROM / disc image site. Each game has a page
 * like https://romsfun.com/roms/<console>/<game>.html whose "Download ROM"
 * button leads to https://romsfun.com/download/<game>-<id>, which lists the
 * game's files (one page per file, ending in /<n>). Each file page carries the
 * real link in `a#download-link`. Nacho searches the site by the game's name
 * and reads the real link from those pages when a download starts.
 */

export const ROMSFUN_ORIGIN = "https://romsfun.com";

export interface RomsFunSearchResult {
  /** The game page, e.g. https://romsfun.com/roms/xbox/black-2.html */
  url: string;
  title: string;
  /** RomsFun's console slug, e.g. "xbox" or "playstation-2". */
  console: string;
}

export interface RomsFunFileLink {
  url: string;
  /** What the page calls the file (usually its name, with its region). */
  label: string;
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

export const isRomsFunHost = (host: string | null) => host === "romsfun.com";

const GAME_PAGE = /^\/roms\/[a-z0-9-]+\/[^/]+\.html$/i;
const DOWNLOAD_PAGE = /^\/download\/[^/]+(\/\d+)?\/?$/i;

/** True for a RomsFun game page or one of its download pages. */
export const isRomsFunPageUri = (uri: string) => {
  if (!isRomsFunHost(hostOf(uri))) return false;
  const { pathname } = new URL(uri);
  return GAME_PAGE.test(pathname) || DOWNLOAD_PAGE.test(pathname);
};

export const isRomsFunGamePage = (uri: string) =>
  isRomsFunHost(hostOf(uri)) && GAME_PAGE.test(new URL(uri).pathname);

/** A download page that is one file (ends in /<n>). */
export const isRomsFunFilePage = (uri: string) =>
  isRomsFunHost(hostOf(uri)) &&
  /^\/download\/[^/]+\/\d+\/?$/i.test(new URL(uri).pathname);

export const romsFunSearchUrl = (query: string) =>
  `${ROMSFUN_ORIGIN}/?s=${encodeURIComponent(query)}`;

/**
 * RomsFun's console slugs for the names consoles go by: the recomp catalog's
 * short codes ("n64", "gc", "x360"...) and LaunchBox's platform names.
 */
const CONSOLE_SLUGS: Array<[RegExp, string]> = [
  [/^(xbox ?360|x360|microsoft xbox 360)$/, "xbox-360"],
  [/^(xbox|microsoft xbox|xb|ogxbox)$/, "xbox"],
  [/^(ps2|playstation 2|sony playstation 2)$/, "playstation-2"],
  [/^(ps3|playstation 3|sony playstation 3)$/, "ps3"],
  [/^(psp|playstation portable|sony psp)$/, "playstation-portable"],
  [/^(ps1|psx|playstation|sony playstation)$/, "playstation"],
  [/^(vita|ps vita|psvita|sony playstation vita)$/, "ps-vita"],
  [/^(n64|nintendo 64)$/, "nintendo-64"],
  [/^(gc|ngc|gamecube|nintendo gamecube)$/, "gamecube"],
  [/^(wii|nintendo wii)$/, "nintendo-wii"],
  [/^(wiiu|wii u|nintendo wii u)$/, "wii-u"],
  [/^(ds|nds|nintendo ds)$/, "nintendo-ds"],
  [/^(3ds|nintendo 3ds)$/, "nintendo-3ds"],
  [/^(gba|game boy advance|nintendo game boy advance)$/, "game-boy-advance"],
  [/^(gbc|game boy color|nintendo game boy color)$/, "game-boy-color"],
  [/^(gb|game boy|nintendo game boy)$/, "game-boy"],
  [
    /^(snes|super nintendo|super nintendo entertainment system)$/,
    "super-nintendo",
  ],
  [/^(nes|nintendo entertainment system)$/, "nes"],
  [/^(genesis|md|mega drive|sega genesis|sega mega drive)$/, "sega-genesis"],
  [/^(dc|dreamcast|sega dreamcast)$/, "dreamcast"],
  [/^(saturn|sega saturn)$/, "sega-saturn"],
];

export const toRomsFunConsole = (platform: string | null | undefined) => {
  if (!platform) return null;
  const name = platform
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
  return CONSOLE_SLUGS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
};

const decodeEntities = (text: string) =>
  text
    .replaceAll(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replaceAll(/&#x([0-9a-f]+);/gi, (_m, code) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ");

const textOf = (html: string) =>
  decodeEntities(html.replaceAll(/<[^>]*>/g, " "))
    .replaceAll(/\s+/g, " ")
    .trim();

const slugTitle = (slug: string) =>
  slug
    .replace(/-\d+$/, "")
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");

interface Anchor {
  href: string;
  attributes: string;
  text: string;
}

/** Every <a> in a page, with its absolute link, attributes and text. */
const anchorsOf = (html: string, base: string): Anchor[] => {
  const anchors: Anchor[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1];
    const href = /\bhref\s*=\s*(["'])(.*?)\1/i.exec(attributes)?.[2];
    if (!href) continue;
    try {
      anchors.push({
        href: new URL(decodeEntities(href), base).href,
        attributes,
        text: textOf(match[2]),
      });
    } catch {
      // Not a link.
    }
  }
  return anchors;
};

const attribute = (attributes: string, name: string) => {
  const value = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(
    attributes
  )?.[2];
  return value ? decodeEntities(value).trim() : null;
};

/** The game pages a RomsFun search (or console listing) page links to. */
export const parseRomsFunSearch = (html: string): RomsFunSearchResult[] => {
  const byUrl = new Map<string, RomsFunSearchResult & { named: boolean }>();
  for (const anchor of anchorsOf(html, ROMSFUN_ORIGIN)) {
    if (!isRomsFunGamePage(anchor.href)) continue;
    const url = anchor.href.split(/[?#]/)[0];
    const [, , console, file] = new URL(url).pathname.split("/");
    const title = (attribute(anchor.attributes, "title") || anchor.text)
      .replace(/\s+ROM\s*(&|and)\s*ISO.*$/i, "")
      .trim();
    // The same game is linked from its cover and its name: keep the name.
    if (byUrl.get(url)?.named) continue;
    byUrl.set(url, {
      url,
      title: title || slugTitle(file.replace(/\.html$/i, "")),
      console,
      named: Boolean(title),
    });
  }
  return [...byUrl.values()].map(({ named: _named, ...result }) => result);
};

/** The game page's "Download ROM" page. */
export const parseRomsFunDownloadPage = (html: string, pageUrl: string) =>
  anchorsOf(html, pageUrl).find(
    (anchor) =>
      isRomsFunHost(hostOf(anchor.href)) &&
      /^\/download\//i.test(new URL(anchor.href).pathname)
  )?.href ?? null;

/** The files a download page lists, one page each. */
export const parseRomsFunFilePages = (
  html: string,
  pageUrl: string
): RomsFunFileLink[] => {
  const seen = new Set<string>();
  const files: RomsFunFileLink[] = [];
  for (const anchor of anchorsOf(html, pageUrl)) {
    if (!isRomsFunFilePage(anchor.href) || seen.has(anchor.href)) continue;
    seen.add(anchor.href);
    files.push({ url: anchor.href, label: anchor.text });
  }
  return files;
};

/** The real file link on a file page (`a#download-link`). */
export const parseRomsFunDirectLink = (html: string, pageUrl: string) => {
  const anchor = anchorsOf(html, pageUrl).find((candidate) =>
    /\bid\s*=\s*(["'])download-link\1/i.test(candidate.attributes)
  );
  return anchor && /^https?:/i.test(anchor.href) ? anchor.href : null;
};

export const isCloudflareChallenge = (html: string) =>
  /<title>\s*(just a moment|attention required|un instant|einen moment)/i.test(
    html
  ) || /challenge-platform|cf-turnstile|id="challenge-form"/i.test(html);

const normalize = (text: string) =>
  text
    .normalize("NFKD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll("&", " and ")
    .replaceAll(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .replace(/^the /, "")
    .trim();

/**
 * Search results best first: right console before others, then how closely
 * the name matches the game's.
 */
export const rankRomsFunResults = (
  results: RomsFunSearchResult[],
  gameTitle: string,
  console: string | null
) => {
  const wanted = normalize(gameTitle);
  const wantedWords = new Set(wanted.split(" ").filter(Boolean));
  const score = (result: RomsFunSearchResult) => {
    const title = normalize(result.title);
    let value = 0;
    if (console && result.console === console) value += 100;
    if (title === wanted) value += 50;
    else if (title.startsWith(wanted) || wanted.startsWith(title)) value += 25;
    const words = title.split(" ").filter(Boolean);
    const shared = words.filter((word) => wantedWords.has(word)).length;
    value += (20 * shared) / Math.max(wantedWords.size, words.length, 1);
    return value;
  };
  return results
    .map((result, index) => ({ result, index, value: score(result) }))
    .filter(({ value }) => value >= 5)
    .sort((left, right) => right.value - left.value || left.index - right.index)
    .map(({ result }) => result);
};

const REGION_ORDER = [
  /\b(usa|us|u|ntsc-u|north america)\b/i,
  /\b(world|w)\b/i,
  /\b(europe|eu|e|pal)\b/i,
  /\b(en)\b/i,
];

/**
 * The file to take when a game has several: the region the port asks for when
 * it names one, else USA, World, Europe; never a demo or beta.
 */
export const pickRomsFunFile = (
  files: RomsFunFileLink[],
  requirement?: string | null
): RomsFunFileLink | null => {
  if (files.length === 0) return null;
  const wantedRegion = requirement
    ? REGION_ORDER.find((pattern) => pattern.test(requirement))
    : undefined;
  const order = wantedRegion
    ? [wantedRegion, ...REGION_ORDER.filter((r) => r !== wantedRegion)]
    : REGION_ORDER;
  const score = (file: RomsFunFileLink) => {
    if (/\b(demo|beta|proto|sample|kiosk)\b/i.test(file.label)) return 100;
    const rank = order.findIndex((pattern) => pattern.test(file.label));
    return rank === -1 ? order.length : rank;
  };
  return [...files].sort((left, right) => score(left) - score(right))[0];
};
