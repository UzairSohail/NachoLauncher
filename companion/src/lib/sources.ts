import {
  loadSettings,
  NO_SETTINGS_MESSAGE,
  phoneEntry,
  saveSettings,
  type SyncEntries,
} from "./settings-file";

export interface SyncedSource {
  name: string;
  url: string;
}

const sourceEntries = (value: unknown) =>
  (value ?? {}) as SyncEntries<SyncedSource>;

/** The download sources every launcher shares, by URL. */
export const loadSources = async (): Promise<SyncedSource[]> => {
  const settings = await loadSettings();
  return Object.entries(sourceEntries(settings?.downloadSources))
    .filter(([, entry]) => !entry.deleted && entry.value)
    .map(([url, entry]) => ({ name: entry.value?.name ?? url, url }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * Records a change the same way a launcher does: a newer entry for that URL.
 * Each launcher applies it the next time it syncs settings.
 */
const changeSource = async (url: string, value: SyncedSource | null) => {
  const settings = await loadSettings();
  if (!settings) throw new Error(NO_SETTINGS_MESSAGE);
  const now = Date.now();
  await saveSettings(
    {
      ...settings,
      downloadSources: {
        ...sourceEntries(settings.downloadSources),
        [url]: phoneEntry(value, now),
      },
    },
    now
  );
};

export const addSource = (source: SyncedSource) => changeSource(source.url, source);

export const removeSource = (url: string) => changeSource(url, null);
