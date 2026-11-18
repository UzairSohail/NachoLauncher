import type { BackendModule, ResourceKey } from "i18next";

import en from "./en/translation.json";

type LocaleFile = Record<string, ResourceKey>;

/**
 * The renderer bundles only English. Every other language is its own chunk,
 * loaded when it's picked, so each window doesn't parse all 35 languages
 * (about 3.8 MB of JSON) before it can draw.
 */
export const localeLoaders: Record<
  string,
  () => Promise<{ default: LocaleFile }>
> = {
  "pt-BR": () => import("./pt-BR/translation.json"),
  "pt-PT": () => import("./pt-PT/translation.json"),
  en: () => import("./en/translation.json"),
  de: () => import("./de/translation.json"),
  el: () => import("./el/translation.json"),
  es: () => import("./es/translation.json"),
  nl: () => import("./nl/translation.json"),
  fr: () => import("./fr/translation.json"),
  hu: () => import("./hu/translation.json"),
  it: () => import("./it/translation.json"),
  pl: () => import("./pl/translation.json"),
  ru: () => import("./ru/translation.json"),
  tr: () => import("./tr/translation.json"),
  be: () => import("./be/translation.json"),
  uk: () => import("./uk/translation.json"),
  zh: () => import("./zh/translation.json"),
  id: () => import("./id/translation.json"),
  ko: () => import("./ko/translation.json"),
  da: () => import("./da/translation.json"),
  ar: () => import("./ar/translation.json"),
  fa: () => import("./fa/translation.json"),
  fi: () => import("./fi/translation.json"),
  ro: () => import("./ro/translation.json"),
  ca: () => import("./ca/translation.json"),
  bg: () => import("./bg/translation.json"),
  kk: () => import("./kk/translation.json"),
  cs: () => import("./cs/translation.json"),
  nb: () => import("./nb/translation.json"),
  et: () => import("./et/translation.json"),
  uz: () => import("./uz/translation.json"),
  sv: () => import("./sv/translation.json"),
  lv: () => import("./lv/translation.json"),
  vi: () => import("./vi/translation.json"),
  ja: () => import("./ja/translation.json"),
  sl: () => import("./sl/translation.json"),
};

export const SUPPORTED_LANGUAGES = Object.keys(localeLoaders);

/** Every namespace in the locale files, so a language loads all at once. */
export const LOCALE_NAMESPACES = Object.entries(en)
  .filter(([, value]) => typeof value === "object" && value !== null)
  .map(([namespace]) => namespace);

export const bundledLocaleResources = { en: en as LocaleFile };

/** The locale file for a language code such as "pt" or "en-US". */
export function resolveLocaleKey(language: string): string | null {
  if (localeLoaders[language]) return language;
  const base = language.split("-")[0];
  return SUPPORTED_LANGUAGES.find((key) => key.split("-")[0] === base) ?? null;
}

const loaded = new Map<string, Promise<LocaleFile>>();

export function loadLocale(key: string): Promise<LocaleFile> {
  let promise = loaded.get(key);
  if (!promise) {
    promise = localeLoaders[key]().then((module) => module.default);
    // A failed load can be tried again on the next language change.
    promise.catch(() => loaded.delete(key));
    loaded.set(key, promise);
  }
  return promise;
}

/** An i18next backend that reads namespaces from the lazily loaded files. */
export const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init: () => {},
  read: (language, namespace, callback) => {
    const key = resolveLocaleKey(language);
    if (!key) {
      callback(null, {});
      return;
    }
    if (key === "en") {
      callback(null, (en as LocaleFile)[namespace] ?? {});
      return;
    }
    loadLocale(key).then(
      (file) => callback(null, file[namespace] ?? {}),
      (error: unknown) => callback(error as Error, null)
    );
  },
};
