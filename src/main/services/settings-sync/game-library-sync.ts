import type { Game } from "@types";

import type {
  SyncedDevicePlaytime,
  SyncedGameFlags,
} from "./settings-document.js";
import { recordLocalValues, type SyncEntries } from "./sync-merge.js";

/*
 * Favourites, pins and playtime used to follow the user through their Hydra
 * account. They now ride along in the Drive settings file:
 *
 * - Favourite and pin state is one entry per game, and the latest change wins.
 * - Playtime is one entry per device and game, written only by that device.
 *   Each device shows its own time plus the sum of the others, so time played
 *   on two devices adds up instead of one overwriting the other.
 */

export type GameWithKey = [key: string, game: Game];

const toIso = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const playtimeKey = (deviceId: string, gameKey: string) =>
  `${deviceId}/${gameKey}`;

const isLibraryGame = (game: Game) => !game.isDeleted;

export const gameFlagsOf = (game: Game): SyncedGameFlags => ({
  favorite: game.favorite === true,
  isPinned: game.isPinned === true,
  pinnedDate: game.isPinned ? toIso(game.pinnedDate) : null,
});

export const recordGameFlags = (
  entries: SyncEntries<SyncedGameFlags>,
  games: GameWithKey[],
  now: number,
  deviceId: string
) =>
  recordLocalValues(
    entries,
    Object.fromEntries(
      games
        .filter(([, game]) => isLibraryGame(game))
        .map(([key, game]) => [key, gameFlagsOf(game)])
    ),
    now,
    deviceId
  );

/** Records this device's own time. Other devices' entries are left alone. */
export const recordOwnPlaytime = (
  entries: SyncEntries<SyncedDevicePlaytime>,
  games: GameWithKey[],
  now: number,
  deviceId: string
) =>
  recordLocalValues(
    entries,
    Object.fromEntries(
      games
        .filter(
          ([, game]) =>
            isLibraryGame(game) && (game.playTimeInMilliseconds ?? 0) > 0
        )
        .map(([key, game]) => [
          playtimeKey(deviceId, key),
          {
            playTimeInMilliseconds: Math.round(game.playTimeInMilliseconds),
            lastTimePlayed: toIso(game.lastTimePlayed),
          },
        ])
    ),
    now,
    deviceId
  );

export interface OtherDevicesPlaytime {
  playTimeInMilliseconds: number;
  lastTimePlayed: string | null;
}

/** Each game's time on every device but this one, keyed by game key. */
export const otherDevicesPlaytime = (
  entries: SyncEntries<SyncedDevicePlaytime>,
  deviceId: string
): Map<string, OtherDevicesPlaytime> => {
  const totals = new Map<string, OtherDevicesPlaytime>();
  const ownPrefix = `${deviceId}/`;
  for (const [key, entry] of Object.entries(entries)) {
    if (key.startsWith(ownPrefix) || entry.deleted || !entry.value) continue;
    const slash = key.indexOf("/");
    if (slash < 0) continue;
    const gameKey = key.slice(slash + 1);
    const current = totals.get(gameKey) ?? {
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
    };
    const played = entry.value.lastTimePlayed;
    totals.set(gameKey, {
      playTimeInMilliseconds:
        current.playTimeInMilliseconds +
        Math.max(0, entry.value.playTimeInMilliseconds || 0),
      lastTimePlayed:
        played && (!current.lastTimePlayed || played > current.lastTimePlayed)
          ? played
          : current.lastTimePlayed,
    });
  }
  return totals;
};

/**
 * The changes to make to one local game so it matches the merged state, or
 * null when it already does.
 */
export const syncedGamePatch = (
  game: Game,
  flags: SyncedGameFlags | null,
  others: OtherDevicesPlaytime | undefined
): Partial<Game> | null => {
  const patch: Partial<Game> = {};

  if (flags) {
    const current = gameFlagsOf(game);
    if (current.favorite !== flags.favorite) patch.favorite = flags.favorite;
    if (
      current.isPinned !== flags.isPinned ||
      current.pinnedDate !== flags.pinnedDate
    ) {
      patch.isPinned = flags.isPinned;
      patch.pinnedDate =
        flags.isPinned && flags.pinnedDate ? new Date(flags.pinnedDate) : null;
    }
  }

  const otherTime = Math.round(others?.playTimeInMilliseconds ?? 0);
  if ((game.otherDevicesPlayTimeInMilliseconds ?? 0) !== otherTime) {
    patch.otherDevicesPlayTimeInMilliseconds = otherTime;
  }

  const localLastPlayed = toIso(game.lastTimePlayed);
  if (
    others?.lastTimePlayed &&
    (!localLastPlayed || others.lastTimePlayed > localLastPlayed)
  ) {
    patch.lastTimePlayed = new Date(others.lastTimePlayed);
  }

  return Object.keys(patch).length > 0 ? patch : null;
};
