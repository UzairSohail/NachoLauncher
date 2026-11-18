import type {
  DownloadSource,
  LocalGameCollection,
  Theme,
  UserPreferences,
} from "@types";
import type { SyncedArtwork } from "../game-artwork-cloud";
import type { PreferenceSecrets } from "../user-preferences/preference-secrets";
import { openJson, sealJson, type SealedBox } from "./secret-box.js";
import {
  changedKeys,
  mergeSyncEntries,
  type SyncEntries,
} from "./sync-merge.js";
import { SYNCED_PREFERENCE_KEYS, SYNCED_SECRET_KEYS } from "./synced-keys.js";

/** What a device needs to rebuild a download source: the rest is refetched. */
export type SyncedDownloadSource = Pick<DownloadSource, "name" | "url">;

export type SyncedTheme = Pick<
  Theme,
  "id" | "name" | "author" | "authorName" | "isActive" | "code"
>;

/** A game's favourite and pin state; the latest change wins. */
export interface SyncedGameFlags {
  favorite: boolean;
  isPinned: boolean;
  pinnedDate: string | null;
}

/** One device's own time in one game. Only that device writes it. */
export interface SyncedDevicePlaytime {
  playTimeInMilliseconds: number;
  lastTimePlayed: string | null;
}

/** A library collection, with its member games in custom order. */
export type SyncedGameCollection = Omit<LocalGameCollection, "id">;

/** The synced state, as held locally and (with secrets sealed) in Drive. */
export interface SettingsSyncState {
  preferences: SyncEntries<unknown>;
  secrets: SyncEntries<string>;
  /** Keyed by source URL. */
  downloadSources: SyncEntries<SyncedDownloadSource>;
  /** Keyed by theme ID. */
  themes: SyncEntries<SyncedTheme>;
  /** Keyed by collection ID. */
  gameCollections: SyncEntries<SyncedGameCollection>;
  /** Keyed by game key (shop:objectId). */
  gameFlags: SyncEntries<SyncedGameFlags>;
  /** Keyed by `<deviceId>/<game key>`. */
  playtime: SyncEntries<SyncedDevicePlaytime>;
  /** Keyed by `<game key>/<artwork type>`. */
  gameArtwork: SyncEntries<SyncedArtwork>;
}

/** `hydra/settings.json` in Drive. */
export interface SettingsSyncDocument {
  version: 1;
  updatedAt: number;
  deviceId: string;
  preferences: SyncEntries<unknown>;
  secrets: SealedBox | null;
  downloadSources: SyncEntries<SyncedDownloadSource>;
  themes: SyncEntries<SyncedTheme>;
  /** Added after version 1 shipped; older documents don't have it. */
  gameCollections?: SyncEntries<SyncedGameCollection>;
  gameFlags?: SyncEntries<SyncedGameFlags>;
  playtime?: SyncEntries<SyncedDevicePlaytime>;
  gameArtwork?: SyncEntries<SyncedArtwork>;
}

export const emptySettingsSyncState = (): SettingsSyncState => ({
  preferences: {},
  secrets: {},
  downloadSources: {},
  themes: {},
  gameCollections: {},
  gameFlags: {},
  playtime: {},
  gameArtwork: {},
});

export const pickSyncedPreferences = (
  preferences: UserPreferences | null
): Record<string, unknown> => {
  const picked: Record<string, unknown> = {};
  for (const key of SYNCED_PREFERENCE_KEYS) {
    picked[key] = preferences?.[key];
  }
  return picked;
};

export const pickSyncedSecrets = (
  preferences: UserPreferences | null
): PreferenceSecrets => {
  const picked: PreferenceSecrets = {};
  for (const key of SYNCED_SECRET_KEYS) {
    const value = preferences?.[key];
    if (typeof value === "string" && value) picked[key] = value;
  }
  return picked;
};

export const toSettingsDocument = (
  state: SettingsSyncState,
  key: Buffer,
  now: number,
  deviceId: string
): SettingsSyncDocument => ({
  version: 1,
  updatedAt: now,
  deviceId,
  preferences: state.preferences,
  secrets:
    Object.keys(state.secrets).length > 0 ? sealJson(key, state.secrets) : null,
  downloadSources: state.downloadSources,
  themes: state.themes,
  gameCollections: state.gameCollections,
  gameFlags: state.gameFlags,
  playtime: state.playtime,
  gameArtwork: state.gameArtwork,
});

export const fromSettingsDocument = (
  document: SettingsSyncDocument,
  key: Buffer
): SettingsSyncState => {
  if (document.version !== 1) {
    throw new Error(`Unsupported settings sync version ${document.version}`);
  }

  return {
    preferences: document.preferences ?? {},
    secrets: document.secrets
      ? openJson<SyncEntries<string>>(key, document.secrets)
      : {},
    downloadSources: document.downloadSources ?? {},
    themes: document.themes ?? {},
    gameCollections: document.gameCollections ?? {},
    gameFlags: document.gameFlags ?? {},
    playtime: document.playtime ?? {},
    gameArtwork: document.gameArtwork ?? {},
  };
};

export interface SettingsMergeResult {
  merged: SettingsSyncState;
  /** Changes the remote brought in, to apply on this device. */
  incoming: Record<keyof SettingsSyncState, string[]>;
  /** True when the remote is missing something this device has. */
  shouldPush: boolean;
}

const SECTIONS = [
  "preferences",
  "secrets",
  "downloadSources",
  "themes",
  "gameCollections",
  "gameFlags",
  "playtime",
  "gameArtwork",
] as const satisfies readonly (keyof SettingsSyncState)[];

export const mergeSettingsState = (
  local: SettingsSyncState,
  remote: SettingsSyncState | null
): SettingsMergeResult => {
  const base = remote ?? emptySettingsSyncState();
  const merged = emptySettingsSyncState();
  const incoming = {} as SettingsMergeResult["incoming"];
  let shouldPush = remote === null;

  for (const section of SECTIONS) {
    const sectionMerged = mergeSyncEntries<unknown>(
      local[section],
      base[section]
    );
    (merged as unknown as Record<string, SyncEntries<unknown>>)[section] =
      sectionMerged;
    incoming[section] = changedKeys<unknown>(local[section], sectionMerged);
    if (changedKeys<unknown>(base[section], sectionMerged).length > 0) {
      shouldPush = true;
    }
  }

  return { merged, incoming, shouldPush };
};
