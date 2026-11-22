import { readFile } from "./drive";
import {
  checkAllDebrid,
  checkPremiumize,
  checkRealDebrid,
  checkRetroAchievements,
  checkSteamGridDb,
  checkTorBox,
  type KeyCheck,
} from "./key-checks";
import { importSyncKey, isSealedBox, openJson, sealJson } from "./secret-box";
import {
  loadSettings,
  NO_SETTINGS_MESSAGE,
  phoneEntry,
  saveSettings,
  type SettingsFile,
  type SyncEntries,
} from "./settings-file";

/** Where the launchers keep the key that seals the synced API keys. */
const SYNC_KEY_FILE = "Nacho/sync-key";

/** Preference names, as the launcher stores them (preference-secrets.ts). */
export type KeyId =
  | "allDebridApiToken"
  | "realDebridApiToken"
  | "torBoxApiToken"
  | "premiumizeApiToken"
  | "steamGridDbApiKey"
  | "retroAchievementsWebApiKey";

export const RETRO_ACHIEVEMENTS_USERNAME = "retroAchievementsUsername";

export interface KeyInfo {
  id: KeyId;
  name: string;
  group: "Debrid services" | "Artwork" | "Achievements";
  description: string;
  /** Where the user finds the key. */
  keyUrl: string;
  recommended?: boolean;
  check: (key: string, username: string) => Promise<KeyCheck>;
}

export const KEYS: KeyInfo[] = [
  {
    id: "allDebridApiToken",
    name: "AllDebrid",
    group: "Debrid services",
    recommended: true,
    description: "Fetches torrents and hoster links at full speed.",
    keyUrl: "https://alldebrid.com/apikeys/",
    check: (key) => checkAllDebrid(key),
  },
  {
    id: "realDebridApiToken",
    name: "Real-Debrid",
    group: "Debrid services",
    description: "Needs a premium account.",
    keyUrl: "https://real-debrid.com/apitoken",
    check: (key) => checkRealDebrid(key),
  },
  {
    id: "torBoxApiToken",
    name: "TorBox",
    group: "Debrid services",
    description: "Find the key under Settings on the TorBox site.",
    keyUrl: "https://torbox.app/settings",
    check: (key) => checkTorBox(key),
  },
  {
    id: "premiumizeApiToken",
    name: "Premiumize",
    group: "Debrid services",
    description: "Find the key on your Premiumize account page.",
    keyUrl: "https://www.premiumize.me/account",
    check: (key) => checkPremiumize(key),
  },
  {
    id: "steamGridDbApiKey",
    name: "SteamGridDB",
    group: "Artwork",
    description: "Lets you pick covers, heroes, logos and icons for your games. Free.",
    keyUrl: "https://www.steamgriddb.com/profile/preferences/api",
    check: (key) => checkSteamGridDb(key),
  },
  {
    id: "retroAchievementsWebApiKey",
    name: "RetroAchievements",
    group: "Achievements",
    description:
      "Tracks achievements in emulated games. To sign the emulators in as well, connect with your password in Nacho Launcher's Settings on a computer.",
    keyUrl: "https://retroachievements.org/settings",
    check: (key, username) => checkRetroAchievements(username, key),
  },
];

export interface StoredKeys {
  keys: Partial<Record<KeyId, string>>;
  retroAchievementsUsername: string | null;
}

const liveValue = <T>(entries: SyncEntries<T> | undefined, key: string) => {
  const entry = entries?.[key];
  return entry && !entry.deleted && entry.value !== null ? entry.value : null;
};

interface OpenedSettings {
  settings: SettingsFile;
  syncKey: Awaited<ReturnType<typeof importSyncKey>>;
  secrets: SyncEntries<string>;
}

/**
 * Reads the settings file and opens its sealed keys with the launchers'
 * shared key. Refuses rather than guesses, so a save can never wipe keys it
 * couldn't read.
 */
const openSettings = async (): Promise<OpenedSettings> => {
  const [settings, keyText] = await Promise.all([
    loadSettings(),
    readFile(SYNC_KEY_FILE),
  ]);
  if (!settings || !keyText) throw new Error(NO_SETTINGS_MESSAGE);

  const syncKey = await importSyncKey(keyText).catch(() => {
    throw new Error(
      "The launchers' settings sync key couldn't be read. Open Nacho Launcher on a computer so it syncs, then try again."
    );
  });

  let secrets: SyncEntries<string> = {};
  if (settings.secrets) {
    if (!isSealedBox(settings.secrets)) {
      throw new Error("The synced keys are in a format this app doesn't know yet. Update Nacho Companion.");
    }
    secrets = await openJson<SyncEntries<string>>(syncKey, settings.secrets).catch(
      () => {
        throw new Error(
          "The synced keys couldn't be opened. Open Nacho Launcher on a computer so it syncs, then try again."
        );
      }
    );
  }
  return { settings, syncKey, secrets };
};

export const loadKeys = async (): Promise<StoredKeys> => {
  const { settings, secrets } = await openSettings();
  const keys: StoredKeys["keys"] = {};
  for (const { id } of KEYS) {
    const value = liveValue(secrets, id);
    if (value) keys[id] = value;
  }
  const username = liveValue(settings.preferences, RETRO_ACHIEVEMENTS_USERNAME);
  return {
    keys,
    retroAchievementsUsername: typeof username === "string" ? username : null,
  };
};

/**
 * Saves one key (null removes it) for every launcher. Each launcher takes it
 * the next time it syncs settings, which is within a minute or so while it's
 * open. RetroAchievements also saves its username, which syncs in the open.
 */
export const saveKey = async (
  id: KeyId,
  value: string | null,
  retroAchievementsUsername?: string | null
) => {
  const { settings, syncKey, secrets } = await openSettings();
  const now = Date.now();
  const nextSecrets: SyncEntries<string> = { ...secrets, [id]: phoneEntry(value, now) };

  let preferences = settings.preferences;
  if (retroAchievementsUsername !== undefined) {
    preferences = {
      ...(preferences ?? {}),
      [RETRO_ACHIEVEMENTS_USERNAME]: phoneEntry<unknown>(retroAchievementsUsername, now),
    };
  }

  await saveSettings(
    {
      ...settings,
      ...(preferences ? { preferences } : {}),
      secrets: await sealJson(syncKey, nextSecrets),
    },
    now
  );
};
