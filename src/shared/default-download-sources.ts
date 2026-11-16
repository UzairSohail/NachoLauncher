/**
 * Sources every Nacho install starts with. `urls` are tried in order: the
 * first is the feed to use, the rest stand in while it can't be added.
 */
export interface DefaultDownloadSource {
  id: string;
  urls: string[];
}

export const DEFAULT_DOWNLOAD_SOURCES: DefaultDownloadSource[] = [
  {
    id: "ankergames",
    urls: [
      // Built daily by .github/workflows/ankergames-feed.yml.
      "https://raw.githubusercontent.com/UzairSohail/NachoLauncher/sources/ankergames.json",
      // Community feed, used until Nacho's own feed is published.
      "https://raw.githubusercontent.com/shirohige0510/ankergames-hydra/main/ankergames.json",
    ],
  },
];

/** Which feed of a default source this install was given, by source id. */
export type DefaultDownloadSourcesState = Record<string, { url: string }>;

export type DefaultSourcePlan =
  /** Nothing to do: it was given before (and may have been removed since). */
  | { kind: "none" }
  /** The person already has one of its feeds: remember that. */
  | { kind: "record"; url: string }
  /** Add the first of `urls` that works, then drop `replaces` if set. */
  | { kind: "add"; urls: string[]; replaces?: string };

/**
 * What to do about one default source at startup. A source is only ever
 * given once, so removing it in Settings sticks. An install that got a
 * stand-in feed moves to the main one once that can be added, unless the
 * stand-in was removed.
 */
export const planDefaultSource = (
  source: DefaultDownloadSource,
  given: { url: string } | undefined,
  existingUrls: string[]
): DefaultSourcePlan => {
  const [main] = source.urls;
  if (!given) {
    const present = source.urls.find((url) => existingUrls.includes(url));
    return present
      ? { kind: "record", url: present }
      : { kind: "add", urls: source.urls };
  }
  if (given.url === main || !source.urls.includes(given.url))
    return { kind: "none" };
  if (!existingUrls.includes(given.url)) return { kind: "none" };
  if (existingUrls.includes(main)) return { kind: "record", url: main };
  return { kind: "add", urls: [main], replaces: given.url };
};
