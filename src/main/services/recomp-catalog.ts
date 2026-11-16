import axios from "axios";
import fs from "node:fs";
import path from "node:path";

import type {
  RecompilationDetails,
  RecompilationReadme,
  RecompilationRelease,
  RecompilationRomMeta,
  RecompilationSummary,
} from "@types";
import {
  type CatalogEntry,
  type RecompManifest,
  RECOMP_CATALOG_URL,
  findCatalogEntriesForGame,
  fromCatalogSlug,
  isRecompCatalogData,
  manifestExecutable,
  manifestToRomMeta,
  parseRecompCatalog,
  toCatalogDetails,
  toCatalogItem,
  toCatalogReadme,
  toCatalogReleases,
  toCatalogSummary,
} from "@shared";
import { logger } from "./logger";
import { SystemPath } from "./system-path";

/*
 * The community recomp catalog, kept on disk so recomps still show offline.
 * The list is asked for at most hourly and each port's releases every six
 * hours, straight from GitHub's public API (no account needed).
 */

const LIST_FRESH_MS = 60 * 60_000;
const RELEASES_FRESH_MS = 6 * 60 * 60_000;
const README_FRESH_MS = 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const GITHUB_API = "https://api.github.com";

interface CachedFile<T> {
  fetchedAt: number;
  etag?: string | null;
  data: T;
}

const cacheDirectory = () =>
  path.join(SystemPath.getPath("userData"), "recomp-catalog");

const cachePath = (name: string) =>
  path.join(cacheDirectory(), `${name.replaceAll(/[^a-z0-9._-]/gi, "_")}.json`);

const readCache = <T>(name: string): CachedFile<T> | null => {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(name), "utf-8"));
    return parsed && typeof parsed.fetchedAt === "number" ? parsed : null;
  } catch {
    return null;
  }
};

const writeCache = async <T>(name: string, file: CachedFile<T>) => {
  try {
    await fs.promises.mkdir(cacheDirectory(), { recursive: true });
    const target = cachePath(name);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, JSON.stringify(file));
    await fs.promises.rename(temporary, target);
  } catch (error) {
    logger.warn(`Could not keep the recomp catalog's ${name} on disk`, error);
  }
};

/**
 * A cached JSON file: the copy on disk while it's fresh, otherwise the site
 * (only if it changed), and the copy on disk again when the site can't be
 * reached.
 */
const cachedJson = async <T>(
  name: string,
  url: string,
  freshMs: number,
  isValid: (data: unknown) => boolean,
  headers: Record<string, string> = {}
): Promise<CachedFile<T> | null> => {
  const cached = readCache<T>(name);
  if (cached && Date.now() - cached.fetchedAt < freshMs) return cached;

  try {
    const response = await axios.get(url, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        ...headers,
        ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
      },
      validateStatus: (status) => status === 200 || status === 304,
    });
    if (response.status === 304 && cached) {
      const touched = { ...cached, fetchedAt: Date.now() };
      await writeCache(name, touched);
      return touched;
    }
    if (!isValid(response.data)) throw new Error(`Unexpected data from ${url}`);

    const file: CachedFile<T> = {
      fetchedAt: Date.now(),
      etag: (response.headers.etag as string | undefined) ?? null,
      data: response.data as T,
    };
    await writeCache(name, file);
    return file;
  } catch (error) {
    logger.warn(`Could not refresh ${url}`, error);
    return cached;
  }
};

const MANIFESTS_FILE = "installed-manifests";

export class RecompCatalog {
  private static entries: CatalogEntry[] | null = null;
  private static entriesFetchedAt = 0;
  private static loading: Promise<CatalogEntry[]> | null = null;
  private static manifests: Record<string, RecompManifest> | null = null;

  /** The list on disk, read once, for the calls that can't wait for the network. */
  private static entriesNow() {
    if (this.entries) return this.entries;
    const cached = readCache<unknown>("pc-catalog");
    if (!cached) return [];
    this.entries = parseRecompCatalog(cached.data);
    this.entriesFetchedAt = cached.fetchedAt;
    return this.entries;
  }

  static async getEntries(force = false) {
    const isFresh =
      this.entries && Date.now() - this.entriesFetchedAt < LIST_FRESH_MS;
    if (isFresh && !force) return this.entries!;
    this.loading ??= cachedJson<unknown>(
      "pc-catalog",
      RECOMP_CATALOG_URL,
      force ? 0 : LIST_FRESH_MS,
      isRecompCatalogData
    )
      .then((file) => {
        if (file) {
          this.entries = parseRecompCatalog(file.data);
          this.entriesFetchedAt = file.fetchedAt;
        }
        return this.entriesNow();
      })
      .finally(() => {
        this.loading = null;
      });
    return this.loading;
  }

  private static async getEntry(slug: string) {
    const id = fromCatalogSlug(slug);
    if (!id) return null;
    const entries = await this.getEntries();
    return entries.find((entry) => entry.id === id) ?? null;
  }

  private static entryNow(slug: string) {
    const id = fromCatalogSlug(slug);
    if (!id) return null;
    return this.entriesNow().find((entry) => entry.id === id) ?? null;
  }

  /** Every recomp in the catalog, for the catalog page. */
  static async listAll(force = false) {
    const entries = await this.getEntries(force);
    return entries.map(toCatalogItem);
  }

  static async findForGame(gameTitle: string): Promise<RecompilationSummary[]> {
    const entries = await this.getEntries();
    return findCatalogEntriesForGame(entries, gameTitle).map(toCatalogSummary);
  }

  static async getDetails(
    objectId: string,
    slug: string
  ): Promise<RecompilationDetails | null> {
    const entry = await this.getEntry(slug);
    if (!entry) return null;
    return toCatalogDetails(
      entry,
      objectId,
      new Date(this.entriesFetchedAt || Date.now()).toISOString()
    );
  }

  static async getReleases(slug: string): Promise<RecompilationRelease[]> {
    const entry = await this.getEntry(slug);
    if (!entry) return [];
    const file = await cachedJson<unknown>(
      `releases-${entry.id}`,
      `${GITHUB_API}/repos/${entry.repo}/releases?per_page=15`,
      RELEASES_FRESH_MS,
      Array.isArray,
      { Accept: "application/vnd.github+json" }
    );
    return file ? toCatalogReleases(entry, file.data) : [];
  }

  static async getReadme(slug: string): Promise<RecompilationReadme | null> {
    const entry = await this.getEntry(slug);
    if (!entry) return null;
    const file = await cachedJson<{ content?: string; sha?: string }>(
      `readme-${entry.id}`,
      `${GITHUB_API}/repos/${entry.repo}/readme`,
      README_FRESH_MS,
      (data) =>
        !!data && typeof (data as { content?: unknown }).content === "string",
      { Accept: "application/vnd.github+json" }
    );
    if (!file?.data.content) return null;
    const markdown = Buffer.from(file.data.content, "base64").toString("utf-8");
    return toCatalogReadme(
      entry,
      markdown,
      file.data.sha ?? "",
      new Date(file.fetchedAt).toISOString()
    );
  }

  // ---------- developer manifests ----------

  private static manifestsNow() {
    if (this.manifests) return this.manifests;
    this.manifests =
      readCache<Record<string, RecompManifest>>(MANIFESTS_FILE)?.data ?? {};
    return this.manifests;
  }

  /** Keeps the recomplauncher.json a port shipped in its release. */
  static async rememberManifest(slug: string, manifest: RecompManifest | null) {
    const manifests = { ...this.manifestsNow() };
    if (manifest) manifests[slug] = manifest;
    else delete manifests[slug];
    this.manifests = manifests;
    await writeCache(MANIFESTS_FILE, {
      fetchedAt: Date.now(),
      data: manifests,
    });
  }

  /** The manifest for a port: the one in its release first, then the catalog's. */
  private static manifestFor(slug: string) {
    const installed = this.manifestsNow()[slug];
    if (installed) return installed;
    return this.entryNow(slug)?.manifest ?? null;
  }

  /** ROM setup for a port that has no hand-written entry, from its manifest. */
  static getRomMeta(slug: string): RecompilationRomMeta | null {
    try {
      return manifestToRomMeta(
        this.manifestFor(slug),
        this.entryNow(slug)?.origin ?? null
      );
    } catch (error) {
      logger.warn(`Could not read the manifest for ${slug}`, error);
      return null;
    }
  }

  static getExecutable(slug: string) {
    return manifestExecutable(this.manifestFor(slug), process.platform);
  }

  static hasManifest(slug: string) {
    return this.manifestFor(slug) !== null;
  }
}
