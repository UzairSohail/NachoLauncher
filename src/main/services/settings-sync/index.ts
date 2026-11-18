import os from "node:os";
import { randomUUID } from "node:crypto";

import { safeStorage } from "electron";

import type {
  LocalGameCollection,
  SettingsSyncError,
  SettingsSyncStatus,
  Theme,
  UserPreferences,
} from "@types";
import {
  db,
  downloadSourcesSublevel,
  gamesSublevel,
  levelKeys,
  themesSublevel,
} from "@main/level";

import { logger } from "../logger";
import { PersonalCloud } from "../personal-cloud";
import { DriveChangeFeed } from "../personal-cloud/change-feed";
import { WindowManager } from "../window-manager";
import { getUserPreferences } from "../user-preferences";
import { generateSyncKey } from "./secret-box";
import {
  emptySettingsSyncState,
  fromSettingsDocument,
  mergeSettingsState,
  pickSyncedPreferences,
  pickSyncedSecrets,
  toSettingsDocument,
  type SettingsSyncDocument,
  type SettingsSyncState,
  type SyncedDownloadSource,
  type SyncedGameCollection,
  type SyncedTheme,
} from "./settings-document";
import { GameCollections } from "../game-collections";
import { recordCollection, recordLocalValues } from "./sync-merge";
import { describeSettingsSyncError } from "./sync-error";
import {
  applySyncedArtwork,
  readArtworkSyncStore,
  type SyncedArtwork,
} from "../game-artwork-cloud";
import {
  otherDevicesPlaytime,
  recordGameFlags,
  recordOwnPlaytime,
  syncedGamePatch,
  type GameWithKey,
} from "./game-library-sync";
import { SYNCED_SECRET_KEYS } from "./synced-keys";

const SETTINGS_FILE = "Nacho/settings.json";
const KEY_FILE = "Nacho/sync-key";
const PUSH_DELAY_MS = 5_000;
// Other devices' changes normally arrive through DriveChangeFeed; this is
// only a safety net in case a change notice is missed.
const PERIODIC_SYNC_MS = 60 * 60_000;

interface LocalSyncRecord {
  deviceId: string;
  enabled: boolean;
  lastSyncedAt: number | null;
  lastChangeFromDevice: string | null;
  state: SettingsSyncState;
  /** Keys this device actually had after the last sync. */
  localKeys: {
    downloadSources: string[];
    themes: string[];
    gameCollections: string[];
  };
}

interface StoredKey {
  data: string;
  encrypted: boolean;
}

const deviceLabel = () => os.hostname() || process.platform;

const newRecord = (): LocalSyncRecord => ({
  deviceId: `${deviceLabel()}-${randomUUID().slice(0, 8)}`,
  enabled: true,
  lastSyncedAt: null,
  lastChangeFromDevice: null,
  state: emptySettingsSyncState(),
  localKeys: { downloadSources: [], themes: [], gameCollections: [] },
});

const toSyncedTheme = (theme: Theme): SyncedTheme => ({
  id: theme.id,
  name: theme.name,
  author: theme.author,
  authorName: theme.authorName,
  isActive: theme.isActive,
  code: theme.code,
});

/**
 * Syncs settings, API keys, download sources, themes and library collections
 * through the user's Google Drive, using the Google sign-in shared with Cloud
 * Save Manager. The
 * file is `Nacho/settings.json`; credentials inside it are sealed with a key
 * kept next to it in `Nacho/sync-key`.
 */
export class SettingsSync {
  private static running: Promise<void> | null = null;
  private static rerun = false;
  private static pushTimer: NodeJS.Timeout | null = null;
  private static periodicTimer: NodeJS.Timeout | null = null;
  private static unsubscribeFeed: (() => void) | null = null;
  private static applying = false;
  private static lastError: SettingsSyncError | null = null;

  private static async readRecord(): Promise<LocalSyncRecord> {
    const stored = await db
      .get<string, LocalSyncRecord | null>(levelKeys.settingsSync, {
        valueEncoding: "json",
      })
      .catch(() => null);
    if (stored?.deviceId) {
      return {
        ...newRecord(),
        ...stored,
        state: { ...emptySettingsSyncState(), ...stored.state },
        localKeys: { ...newRecord().localKeys, ...stored.localKeys },
      };
    }

    const record = newRecord();
    await this.writeRecord(record);
    return record;
  }

  private static writeRecord(record: LocalSyncRecord) {
    return db.put<string, LocalSyncRecord>(levelKeys.settingsSync, record, {
      valueEncoding: "json",
    });
  }

  private static async readCachedKey(): Promise<Buffer | null> {
    const stored = await db
      .get<string, StoredKey | null>(levelKeys.settingsSyncKey, {
        valueEncoding: "json",
      })
      .catch(() => null);
    if (!stored?.data) return null;
    try {
      const base64 = stored.encrypted
        ? safeStorage.decryptString(Buffer.from(stored.data, "base64"))
        : stored.data;
      return Buffer.from(base64, "base64");
    } catch {
      return null;
    }
  }

  private static async cacheKey(key: Buffer) {
    const base64 = key.toString("base64");
    const encrypted = safeStorage.isEncryptionAvailable();
    await db.put<string, StoredKey>(
      levelKeys.settingsSyncKey,
      {
        data: encrypted
          ? safeStorage.encryptString(base64).toString("base64")
          : base64,
        encrypted,
      },
      { valueEncoding: "json" }
    );
  }

  /** The shared key from Drive, created by whichever device syncs first. */
  private static async getKey(refresh = false): Promise<Buffer> {
    if (!refresh) {
      const cached = await this.readCachedKey();
      if (cached?.length === 32) return cached;
    }

    const remote = await PersonalCloud.readFile(KEY_FILE);
    const remoteKey: Buffer | null = remote
      ? Buffer.from(remote.toString("utf8").trim(), "base64")
      : null;

    let key: Buffer;
    if (remoteKey?.length === 32) {
      key = remoteKey;
    } else {
      key = generateSyncKey();
      await PersonalCloud.writeFile(
        KEY_FILE,
        Buffer.from(key.toString("base64"))
      );
    }

    await this.cacheKey(key);
    return key;
  }

  private static async readRemote(): Promise<SettingsSyncState | null> {
    const raw = await PersonalCloud.readFile(SETTINGS_FILE);
    if (!raw) return null;

    const document = JSON.parse(raw.toString("utf8")) as SettingsSyncDocument;
    try {
      return fromSettingsDocument(document, await this.getKey());
    } catch {
      // Another device may have replaced the key; read it again once.
      try {
        return fromSettingsDocument(document, await this.getKey(true));
      } catch (error) {
        logger.warn("Settings sync could not open synced API keys", error);
        return fromSettingsDocument(
          { ...document, secrets: null },
          Buffer.alloc(32)
        );
      }
    }
  }

  /** Stamps whatever changed on this device since the last sync. */
  private static async recordLocal(record: LocalSyncRecord, now: number) {
    const [preferences, sources, themes, collections, games, artwork] =
      await Promise.all([
        getUserPreferences(),
        downloadSourcesSublevel.values().all(),
        themesSublevel.values().all(),
        GameCollections.all(),
        gamesSublevel.iterator().all() as Promise<GameWithKey[]>,
        readArtworkSyncStore(),
      ]);

    const sourceItems: Record<string, SyncedDownloadSource> = {};
    for (const source of sources) {
      sourceItems[source.url] = { name: source.name, url: source.url };
    }
    const themeItems: Record<string, SyncedTheme> = {};
    for (const theme of themes) themeItems[theme.id] = toSyncedTheme(theme);
    const collectionItems: Record<string, SyncedGameCollection> = {};
    for (const { id, ...collection } of collections) {
      collectionItems[id] = collection;
    }

    const { deviceId, state, localKeys } = record;
    const secrets = pickSyncedSecrets(preferences);
    return {
      preferences: recordLocalValues(
        state.preferences,
        pickSyncedPreferences(preferences),
        now,
        deviceId
      ),
      secrets: recordLocalValues<string>(
        state.secrets,
        Object.fromEntries(
          SYNCED_SECRET_KEYS.map((key) => [key, secrets[key]])
        ),
        now,
        deviceId
      ),
      downloadSources: recordCollection(
        state.downloadSources,
        sourceItems,
        localKeys.downloadSources,
        now,
        deviceId
      ),
      themes: recordCollection(
        state.themes,
        themeItems,
        localKeys.themes,
        now,
        deviceId
      ),
      gameCollections: recordCollection(
        state.gameCollections,
        collectionItems,
        localKeys.gameCollections,
        now,
        deviceId
      ),
      gameFlags: recordGameFlags(state.gameFlags, games, now, deviceId),
      playtime: recordOwnPlaytime(state.playtime, games, now, deviceId),
      gameArtwork: recordLocalValues<SyncedArtwork>(
        state.gameArtwork,
        artwork,
        now,
        deviceId
      ),
    } satisfies SettingsSyncState;
  }

  private static async applyIncoming(
    merged: SettingsSyncState,
    incoming: Record<keyof SettingsSyncState, string[]>,
    deviceId: string
  ) {
    const preferenceChanges: Partial<UserPreferences> = {};
    for (const key of incoming.preferences) {
      const entry = merged.preferences[key];
      (preferenceChanges as Record<string, unknown>)[key] = entry.deleted
        ? null
        : entry.value;
    }
    for (const key of incoming.secrets) {
      const entry = merged.secrets[key];
      (preferenceChanges as Record<string, unknown>)[key] = entry.deleted
        ? null
        : entry.value;
    }

    if (Object.keys(preferenceChanges).length > 0) {
      const { applyUserPreferences } = await import(
        "@main/events/user-preferences/update-user-preferences"
      );
      await applyUserPreferences(preferenceChanges);
      await this.authorizeDebrid(preferenceChanges);
    }

    await this.applyDownloadSources(merged);

    if (incoming.themes.length > 0) {
      await this.applyThemes(merged, incoming.themes);
    }

    await this.applyGameCollections(merged, incoming.gameCollections);
    await this.applyGameLibrary(merged, incoming.gameFlags, deviceId);
    await this.applyGameArtwork(merged);
  }

  /** Applies artwork choices that differ from what this device recorded. */
  private static async applyGameArtwork(merged: SettingsSyncState) {
    const store = await readArtworkSyncStore();
    const changes: Record<string, SyncedArtwork | null> = {};
    for (const [key, entry] of Object.entries(merged.gameArtwork)) {
      const value = entry.deleted ? null : entry.value;
      const local = store[key] ?? null;
      if (JSON.stringify(value) !== JSON.stringify(local)) changes[key] = value;
    }
    if (Object.keys(changes).length === 0) return;
    if (await applySyncedArtwork(changes)) {
      WindowManager.sendToAppWindows("on-library-batch-complete");
    }
  }

  /**
   * Applies favourite and pin changes from other devices, and sets every
   * game's time played on the other devices.
   */
  private static async applyGameLibrary(
    merged: SettingsSyncState,
    changedFlags: string[],
    deviceId: string
  ) {
    const changed = new Set(changedFlags);
    const others = otherDevicesPlaytime(merged.playtime, deviceId);
    const games = (await gamesSublevel.iterator().all()) as GameWithKey[];
    const { updateGameRecord } = await import("../game-record-updater");
    let updated = false;

    for (const [key, game] of games) {
      if (game.isDeleted) continue;
      const entry = changed.has(key) ? merged.gameFlags[key] : null;
      const flags = entry && !entry.deleted ? entry.value : null;
      const patch = syncedGamePatch(game, flags, others.get(key));
      if (!patch) continue;
      await updateGameRecord(key, patch);
      updated = true;
    }

    if (updated) WindowManager.sendToAppWindows("on-library-batch-complete");
  }

  /**
   * Applies collections from other devices, then lines this device's games up
   * with them, which also catches games added here since the last sync.
   */
  private static async applyGameCollections(
    merged: SettingsSyncState,
    ids: string[]
  ) {
    const upserts: LocalGameCollection[] = [];
    const deletedIds: string[] = [];
    for (const id of ids) {
      const entry = merged.gameCollections[id];
      if (entry.deleted || !entry.value) deletedIds.push(id);
      else upserts.push({ ...entry.value, id });
    }

    if (upserts.length > 0 || deletedIds.length > 0) {
      await GameCollections.applySynced(upserts, deletedIds);
    } else {
      await GameCollections.reconcile();
    }
  }

  private static async authorizeDebrid(changes: Partial<UserPreferences>) {
    const {
      RealDebridClient,
      PremiumizeClient,
      AllDebridClient,
      TorBoxClient,
    } = await import("../download");
    if (changes.realDebridApiToken) {
      RealDebridClient.authorize(changes.realDebridApiToken);
    }
    if (changes.premiumizeApiToken) {
      PremiumizeClient.authorize(changes.premiumizeApiToken);
    }
    if (changes.allDebridApiToken) {
      AllDebridClient.authorize(changes.allDebridApiToken);
    }
    if (changes.torBoxApiToken) {
      TorBoxClient.authorize(changes.torBoxApiToken);
    }
  }

  /**
   * Makes this device's sources match the merged list. Runs every sync, so a
   * source that failed to add last time (offline, say) is retried.
   */
  private static async applyDownloadSources(merged: SettingsSyncState) {
    const existing = await downloadSourcesSublevel.iterator().all();
    const { addDownloadSourceByUrl } = await import(
      "@main/events/download-sources/add-download-source"
    );

    for (const [url, entry] of Object.entries(merged.downloadSources)) {
      const local = existing.find(([, source]) => source.url === url);
      try {
        if (entry.deleted) {
          if (local) await downloadSourcesSublevel.del(local[0]);
        } else if (!local) {
          await addDownloadSourceByUrl(url);
        }
      } catch (error) {
        logger.warn(
          `Settings sync could not apply download source ${url}`,
          error
        );
      }
    }
  }

  private static async applyThemes(merged: SettingsSyncState, ids: string[]) {
    for (const id of ids) {
      const entry = merged.themes[id];
      if (entry.deleted || !entry.value) {
        await themesSublevel.del(id).catch(() => undefined);
        continue;
      }

      const current = await themesSublevel.get(id).catch(() => null);
      const now = new Date();
      await themesSublevel.put(id, {
        ...current,
        ...entry.value,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      });
    }

    // Only one theme can be active: the one that just came in wins here.
    const activated = ids.find((id) => merged.themes[id]?.value?.isActive);
    if (activated) {
      for (const theme of await themesSublevel.values().all()) {
        if (theme.id !== activated && theme.isActive) {
          await themesSublevel.put(theme.id, { ...theme, isActive: false });
        }
      }
    }

    WindowManager.mainWindow?.webContents.send("on-custom-theme-updated");
    const { achievementNotificationPresenter } = await import(
      "../achievement-notification-presenter-electron"
    );
    achievementNotificationPresenter.notifyThemeUpdated();
  }

  private static async runOnce() {
    const record = await this.readRecord();
    if (!record.enabled) return;

    const status = await PersonalCloud.status().catch(() => null);
    if (!status?.signedIn) return;

    const now = Date.now();
    const local = await this.recordLocal(record, now);
    const remote = await this.readRemote();
    const { merged, incoming, shouldPush } = mergeSettingsState(local, remote);

    this.applying = true;
    try {
      await this.applyIncoming(merged, incoming, record.deviceId);
    } finally {
      this.applying = false;
    }

    const localChanged =
      JSON.stringify(local) !== JSON.stringify(record.state) || shouldPush;
    if (localChanged) {
      const document = toSettingsDocument(
        merged,
        await this.getKey(),
        now,
        record.deviceId
      );
      await PersonalCloud.writeFile(
        SETTINGS_FILE,
        Buffer.from(JSON.stringify(document))
      );
    }

    const [sources, themes, collectionIds] = await Promise.all([
      downloadSourcesSublevel.values().all(),
      themesSublevel.keys().all(),
      GameCollections.all().then((items) => items.map((item) => item.id)),
    ]);
    const incomingDevices = Object.entries(incoming).flatMap(
      ([section, keys]) =>
        keys.map(
          (key) =>
            (
              merged as unknown as Record<
                string,
                Record<string, { deviceId: string }>
              >
            )[section][key].deviceId
        )
    );

    await this.writeRecord({
      ...record,
      lastSyncedAt: now,
      lastChangeFromDevice:
        incomingDevices.find((id) => id !== record.deviceId) ??
        record.lastChangeFromDevice,
      state: merged,
      localKeys: {
        downloadSources: sources.map((source) => source.url),
        themes,
        gameCollections: collectionIds,
      },
    });
  }

  /** Pulls and pushes now. Concurrent calls share one run, plus one rerun. */
  public static syncNow(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }

    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          this.notify(true);
          await this.runOnce();
          this.lastError = null;
        } while (this.rerun);
      } catch (error) {
        this.lastError = describeSettingsSyncError(error);
        logger.error(`Settings sync failed (${this.lastError.reason})`, error);
      } finally {
        this.running = null;
        this.notify(false);
      }
    })();

    return this.running;
  }

  /** Pushes a few seconds after a change, so a burst of changes is one upload. */
  public static scheduleSync() {
    if (this.applying) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.syncNow();
    }, PUSH_DELAY_MS);
  }

  /** Syncs on launch and whenever Drive reports a change. */
  public static start() {
    void this.syncNow();
    if (!this.unsubscribeFeed) {
      this.unsubscribeFeed = DriveChangeFeed.subscribe(
        () => void this.syncNow()
      );
    }
    this.periodicTimer ??= setInterval(
      () => void this.syncNow(),
      PERIODIC_SYNC_MS
    );
  }

  public static async getStatus(): Promise<SettingsSyncStatus> {
    const [record, status] = await Promise.all([
      this.readRecord(),
      PersonalCloud.status().catch(() => null),
    ]);
    return {
      enabled: record.enabled,
      signedIn: status?.signedIn ?? false,
      syncing: this.running !== null,
      lastSyncedAt: record.lastSyncedAt,
      lastChangeFromDevice: record.lastChangeFromDevice,
      lastError: this.lastError,
    };
  }

  public static async setEnabled(enabled: boolean) {
    const record = await this.readRecord();
    await this.writeRecord({ ...record, enabled });
    if (enabled) await this.syncNow();
    return this.getStatus();
  }

  private static notify(syncing: boolean) {
    void this.getStatus()
      .then((status) =>
        WindowManager.sendToAppWindows("on-settings-sync-status", {
          ...status,
          syncing,
        })
      )
      .catch(() => undefined);
  }
}
