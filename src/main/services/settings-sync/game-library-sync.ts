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

/*
 * Library membership. A game added on one device shows up in the library on
 * the others (not installed there, so it can be downloaded from the card), and
 * removing it elsewhere removes it here unless it is installed here.
 *
 * Custom games and Classics point at files on one machine, and Steam or Epic
 * account imports are re-imported on each machine, so they stay local.
 */

/** Enough to show the game in another device's library. */
export interface SyncedLibraryGame {
  shop: Game["shop"];
  objectId: string;
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  logoImageUrl: string | null;
  addedToLibraryAt: string | null;
}

export const isSyncableLibraryGame = (game: Game) =>
  !game.isDeleted &&
  game.shop !== "custom" &&
  game.shop !== "launchbox" &&
  game.source !== "steam" &&
  game.source !== "epic";

export const toSyncedLibraryGame = (game: Game): SyncedLibraryGame => ({
  shop: game.shop,
  objectId: game.objectId,
  title: game.title,
  iconUrl: game.iconUrl ?? null,
  libraryHeroImageUrl: game.libraryHeroImageUrl ?? null,
  logoImageUrl: game.logoImageUrl ?? null,
  addedToLibraryAt: toIso(game.addedToLibraryAt),
});

/**
 * This device's library as synced items. A game whose removal came in from
 * another device but that stays here (because it is installed) is left out,
 * so it doesn't bring itself back everywhere else; re-adding it here later
 * (a newer addedToLibraryAt) does.
 */
export const localLibraryItems = (
  entries: SyncEntries<SyncedLibraryGame>,
  games: GameWithKey[]
): Record<string, SyncedLibraryGame> => {
  const items: Record<string, SyncedLibraryGame> = {};
  for (const [key, game] of games) {
    if (!isSyncableLibraryGame(game)) continue;
    const entry = entries[key];
    const added = game.addedToLibraryAt
      ? new Date(game.addedToLibraryAt).getTime()
      : 0;
    if (entry?.deleted && !(added > entry.updatedAt)) continue;
    items[key] = toSyncedLibraryGame(game);
  }
  return items;
};

export interface LibraryGamePlan {
  add: SyncedLibraryGame[];
  remove: string[];
}

/**
 * What to change locally after a merge. Additions bring back a game this
 * device had removed; removals skip games installed or downloading here.
 */
export const planLibraryGames = (
  entries: SyncEntries<SyncedLibraryGame>,
  changedKeys: readonly string[],
  games: GameWithKey[],
  isBusyHere: (key: string, game: Game) => boolean
): LibraryGamePlan => {
  const local = new Map(games);
  const plan: LibraryGamePlan = { add: [], remove: [] };
  for (const key of changedKeys) {
    const entry = entries[key];
    if (!entry) continue;
    const game = local.get(key);
    if (entry.deleted || !entry.value) {
      if (game && !game.isDeleted && isSyncableLibraryGame(game)) {
        if (!isBusyHere(key, game)) plan.remove.push(key);
      }
      continue;
    }
    if (!game || game.isDeleted) plan.add.push(entry.value);
  }
  return plan;
};
