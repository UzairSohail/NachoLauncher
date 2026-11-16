import { db, downloadSourcesSublevel, levelKeys } from "@main/level";
import {
  DEFAULT_DOWNLOAD_SOURCES,
  planDefaultSource,
  type DefaultDownloadSourcesState,
} from "@shared";
import { logger } from "./logger";
import { summarizeNetworkError } from "./network-error-summary";

const readState = async (): Promise<DefaultDownloadSourcesState> =>
  (await db
    .get<
      string,
      DefaultDownloadSourcesState
    >(levelKeys.defaultDownloadSources, { valueEncoding: "json" })
    .catch(() => null)) ?? {};

/**
 * Gives this install Nacho's built-in sources (see @shared
 * default-download-sources). Runs at every start; a source that couldn't be
 * added, say while offline, is tried again next time.
 */
export const ensureDefaultDownloadSources = async () => {
  const { addDownloadSourceByUrl } = await import(
    "@main/events/download-sources/add-download-source"
  );
  const state = await readState();
  let changed = false;

  for (const source of DEFAULT_DOWNLOAD_SOURCES) {
    const existing = await downloadSourcesSublevel.iterator().all();
    const plan = planDefaultSource(
      source,
      state[source.id],
      existing.map(([, value]) => value.url)
    );
    if (plan.kind === "none") continue;

    if (plan.kind === "record") {
      state[source.id] = { url: plan.url };
      changed = true;
      continue;
    }

    for (const url of plan.urls) {
      try {
        await addDownloadSourceByUrl(url);
      } catch (error) {
        // Settings sync may have added it in the meantime.
        const sources = await downloadSourcesSublevel.values().all();
        if (sources.some((value) => value.url === url)) {
          state[source.id] = { url };
          changed = true;
          break;
        }
        logger.warn(
          `[DefaultSources] Could not add ${url}:`,
          summarizeNetworkError(error)
        );
        continue;
      }
      if (plan.replaces) {
        const old = existing.find(([, value]) => value.url === plan.replaces);
        if (old) await downloadSourcesSublevel.del(old[0]);
      }
      state[source.id] = { url };
      changed = true;
      logger.log(`[DefaultSources] Added ${source.id} from ${url}`);
      break;
    }
  }

  if (!changed) return;
  await db.put<string, DefaultDownloadSourcesState>(
    levelKeys.defaultDownloadSources,
    state,
    { valueEncoding: "json" }
  );
  const { SettingsSync } = await import("./settings-sync");
  SettingsSync.scheduleSync();
};
