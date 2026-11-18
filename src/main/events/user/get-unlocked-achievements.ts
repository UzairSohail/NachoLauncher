import {
  achievementSyncCoordinator,
  AchievementSyncCancelledError,
} from "@main/services/achievements/achievement-sync-coordinator";
import type { GameShop, UserAchievement } from "@types";
import { registerEvent } from "../register-event";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import { gamesSublevel, levelKeys } from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import { UnlockedAchievementsCache } from "@main/services/achievements/unlocked-achievements-cache";
import { SyncedUnlocksStore } from "@main/services/achievement-sync/synced-unlocks-store";

/*
 * Achievements shown for a game: the catalogue's definitions, with what this
 * device unlocked plus what other devices unlocked (synced through Drive).
 */

const indexByUpperCaseName = <T extends { name: string }>(items: T[]) => {
  const byName = new Map<string, T>();
  for (const item of items) {
    const key = item.name.toUpperCase();
    if (!byName.has(key)) byName.set(key, item);
  }
  return byName;
};

const captureAchievementView = (shop: GameShop, objectId: string) =>
  achievementSyncCoordinator.captureCurrent(
    levelKeys.game(shop, objectId),
    () => true
  );

export const getUnlockedAchievements = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean,
  current?: () => boolean
): Promise<UserAchievement[]> => {
  const valid = current ?? captureAchievementView(shop, objectId);
  const assertCurrent = () => {
    if (!valid()) throw new AchievementSyncCancelledError();
  };

  const achievementsData = await getGameAchievementData(
    objectId,
    shop,
    useCachedData,
    valid
  );

  assertCurrent();

  const unlockedAchievements = SyncedUnlocksStore.withSynced(
    shop,
    objectId,
    AchievementMemoryStore.get(shop, objectId)?.unlockedAchievements ?? []
  );

  let catalogueAchievements = achievementsData;

  // Catalogue definitions are display-only: never copy their unlocks or cache.
  if (shop === "epic" && achievementsData.length === 0) {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => undefined);
    assertCurrent();
    const catalogue = game?.catalogueGame;
    if (catalogue?.shop === "steam") {
      const steamDefinitions = await getGameAchievementData(
        catalogue.objectId,
        catalogue.shop,
        true
      ).catch(() => []);
      assertCurrent();
      if (steamDefinitions.length > 0) catalogueAchievements = steamDefinitions;
    }
  }
  const unlockedByName = indexByUpperCaseName(unlockedAchievements);

  return catalogueAchievements
    .map((achievementData) => {
      const upperCaseName = achievementData.name.toUpperCase();
      const unlockedAchievementData = unlockedByName.get(upperCaseName);

      const icongray = achievementData.icongray.endsWith("/")
        ? achievementData.icon
        : achievementData.icongray;

      if (unlockedAchievementData) {
        return {
          ...achievementData,
          unlocked: true,
          unlockTime: unlockedAchievementData.unlockTime,
          imageUrl: null,
        };
      }

      return {
        ...achievementData,
        unlocked: false,
        unlockTime: null,
        icongray: icongray,
      };
    })
    .sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      if (a.unlocked && b.unlocked) {
        return b.unlockTime! - a.unlockTime!;
      }
      return Number(a.hidden) - Number(b.hidden);
    });
};

export const syncAndGetUnlockedAchievements = (
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> =>
  UnlockedAchievementsCache.load(
    shop,
    objectId,
    captureAchievementView(shop, objectId),
    () => AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId),
    () => getUnlockedAchievements(objectId, shop, false)
  );

const getUnlockedAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  return syncAndGetUnlockedAchievements(objectId, shop);
};

registerEvent("getUnlockedAchievements", getUnlockedAchievementsEvent);
