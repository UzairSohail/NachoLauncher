import { PHONE_DEVICE_ID } from "./config";
import { readFile, writeFile } from "./drive";

/** The launchers' synced settings file. */
export const SETTINGS_FILE = "Nacho/settings.json";

/** One synced value, stamped the way the launcher's sync stamps it. */
export interface SyncEntry<T> {
  value: T | null;
  updatedAt: number;
  deviceId: string;
  deleted?: true;
}

export type SyncEntries<T> = Record<string, SyncEntry<T>>;

/**
 * The file as the phone sees it. The phone only changes the sections it
 * knows; everything else is written back exactly as it was.
 */
export type SettingsFile = Record<string, unknown> & {
  version: 1;
  updatedAt: number;
  deviceId: string;
  preferences?: SyncEntries<unknown>;
  secrets?: unknown;
  downloadSources?: SyncEntries<unknown>;
};

export const NO_SETTINGS_MESSAGE =
  "Turn on settings sync in Nacho Launcher on a computer first, then try again.";

export const loadSettings = async (): Promise<SettingsFile | null> => {
  const text = await readFile(SETTINGS_FILE);
  if (!text) return null;
  return JSON.parse(text) as SettingsFile;
};

export const saveSettings = (settings: SettingsFile, now: number) =>
  writeFile(
    SETTINGS_FILE,
    JSON.stringify({ ...settings, updatedAt: now, deviceId: PHONE_DEVICE_ID })
  );

/**
 * A change made on the phone. A newer stamp wins over what each launcher
 * has, so every launcher takes it the next time it syncs.
 */
export const phoneEntry = <T>(value: T | null, now: number): SyncEntry<T> =>
  value === null
    ? { value: null, updatedAt: now, deviceId: PHONE_DEVICE_ID, deleted: true }
    : { value, updatedAt: now, deviceId: PHONE_DEVICE_ID };
