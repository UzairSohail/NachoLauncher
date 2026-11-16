// Builds the AnkerGames source feed for Nacho Launcher.
//
// Walks ankergames.net's games list and writes a Hydra-format source whose
// links are the game pages; Nacho reads the real download link from the page
// when a download starts. Run by .github/workflows/ankergames-feed.yml.
//
//   node ankergames-feed.mjs <output folder>
//
// MAX_PAGES (default 150) game pages are read per run for size, date and
// version: new games first, then the ones checked longest ago.
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import {
  FEED_NAME,
  addListedGames,
  applyGameDetails,
  normalizeGameUrl,
  parseGameText,
  pickPagesToRead,
  sortFeed,
} from "./ankergames-feed-lib.mjs";

const BASE = process.env.ANKERGAMES_BASE || "https://ankergames.net";
const outDir = process.argv[2] || ".";
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 150);
const DELAY_MS = Number(process.env.DELAY_MS ?? 1500);
const MIN_GAMES = Number(process.env.MIN_GAMES ?? 50);
const MAX_LIST_STEPS = 600;

const feedPath = path.join(outDir, "ankergames.json");
const statePath = path.join(outDir, "ankergames-state.json");
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};

const isChallenged = (page) =>
  page
    .evaluate(
      () =>
        /just a moment|attention required|verify you are human/i.test(
          document.title || ""
        ) ||
        Boolean(
          document.querySelector(
            "#challenge-form, #challenge-running, .cf-turnstile, #cf-challenge-running"
          )
        )
    )
    .catch(() => true);

/** Opens a page and waits out an automatic human check, up to 45s. */
const open = async (page, url) => {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  for (let waited = 0; waited < 45; waited++) {
    if (!(await isChallenged(page))) return response?.status() ?? 0;
    await sleep(1000);
  }
  throw new Error(
    `ankergames.net asked for a human check at ${url}; it can't be scraped from here.`
  );
};

const readListedGames = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("a[href*='/game/']")].map((a) => {
      const card = a.closest("article, li, .card, .game-card") ?? a;
      const heading = card.querySelector("h1, h2, h3, h4, .title");
      const image = card.querySelector("img[alt]");
      return {
        href: a.href,
        title:
          heading?.textContent?.trim() ||
          a.getAttribute("title") ||
          image?.getAttribute("alt") ||
          a.textContent?.trim() ||
          "",
      };
    })
  );

/** Every game on the list: scrolls, clicks "Load more" and follows "next". */
const listGames = async (page) => {
  await open(page, `${BASE}/games-list`);
  const games = new Map();
  let idle = 0;
  for (let step = 0; step < MAX_LIST_STEPS && idle < 3; step++) {
    const before = games.size;
    for (const { href, title } of await readListedGames(page)) {
      const url = normalizeGameUrl(href, BASE);
      if (url && !(games.get(url) || "").trim()) games.set(url, title);
    }
    idle = games.size === before ? idle + 1 : 0;

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const more = page
      .locator("button, a, [role=button]")
      .filter({ hasText: /load more|show more|daha fazla/i })
      .first();
    if (await more.isVisible().catch(() => false)) {
      await more.click({ timeout: 10_000 }).catch(() => undefined);
      await page
        .waitForLoadState("networkidle", { timeout: 8000 })
        .catch(() => undefined);
      await sleep(DELAY_MS);
      continue;
    }
    const nextLink = page.locator(
      "a[rel=next], a[aria-label*=next i], .pagination a:has-text('Next')"
    );
    const next = (await nextLink.count())
      ? await nextLink
          .first()
          .getAttribute("href", { timeout: 5000 })
          .catch(() => null)
      : null;
    if (next) {
      await sleep(DELAY_MS);
      await open(page, new URL(next, page.url()).href);
      continue;
    }
    await sleep(DELAY_MS);
  }
  return [...games].map(([url, title]) => ({ url, title }));
};

const readGamePage = async (page, url) => {
  const status = await open(page, url);
  if (status === 404 || status === 410) return { gone: true };
  if (status >= 400) throw new Error(`HTTP ${status}`);
  const { title, text } = await page.evaluate(() => ({
    title: document.querySelector("h1")?.textContent?.trim() || "",
    text: document.querySelector("main")?.innerText || document.body.innerText,
  }));
  return { title, ...parseGameText(text) };
};

const browser = await chromium.launch({
  args: ["--disable-blink-features=AutomationControlled"],
});
try {
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 900 },
  });
  // Pictures and fonts aren't needed; skipping them keeps the visit light.
  await context.route("**/*", (route) =>
    ["image", "media", "font"].includes(route.request().resourceType())
      ? route.abort()
      : route.continue()
  );
  const page = await context.newPage();

  const listed = await listGames(page);
  console.log(`Games on the list: ${listed.length}`);
  if (listed.length < MIN_GAMES) {
    throw new Error(
      `Only ${listed.length} games found on the list; the page layout may have changed. Feed left as it was.`
    );
  }

  const now = new Date().toISOString();
  const previous = readJson(feedPath, { downloads: [] }).downloads ?? [];
  const state = readJson(statePath, { checkedAt: {} });
  const merged = addListedGames(previous, listed, now);
  console.log(`New games: ${merged.added}`);

  const byUrl = new Map(
    merged.downloads.map((entry) => [entry.uris[0], entry])
  );
  const listedUrls = new Set(listed.map(({ url }) => url));
  let read = 0;
  let failed = 0;
  for (const url of pickPagesToRead(
    merged.downloads,
    state.checkedAt,
    MAX_PAGES
  )) {
    await sleep(DELAY_MS);
    try {
      const details = await readGamePage(page, url);
      if (details.gone && !listedUrls.has(url)) {
        // Off the list and its page is gone: the game was taken down.
        byUrl.delete(url);
        delete state.checkedAt[url];
      } else if (details.gone) {
        state.checkedAt[url] = now;
      } else {
        byUrl.set(url, applyGameDetails(byUrl.get(url), details));
        state.checkedAt[url] = now;
      }
      read++;
    } catch (error) {
      failed++;
      console.warn(`Could not read ${url}: ${error.message}`);
      if (/human check/.test(error.message) || failed > 20) break;
    }
  }
  console.log(`Game pages read: ${read}, failed: ${failed}`);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    feedPath,
    JSON.stringify(
      { name: FEED_NAME, downloads: sortFeed([...byUrl.values()]) },
      null,
      1
    ) + "\n"
  );
  fs.writeFileSync(statePath, JSON.stringify(state, null, 1) + "\n");
  console.log(`Wrote ${byUrl.size} games to ${feedPath}`);
} finally {
  await browser.close();
}
