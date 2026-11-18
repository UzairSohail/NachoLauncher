import type {
  Game,
  GameShop,
  UnlockedAchievement,
  UserPreferences,
} from "@types";
import { achievementSyncCoordinator } from "./achievement-sync-coordinator";
import { WindowManager } from "../window-manager";
import { getUnlockedAchievements } from "@main/events/user/get-unlocked-achievements";
import { achievementsLogger } from "../logger";
import { db, levelKeys } from "@main/level";
import { getGameAchievementData } from "./get-game-achievement-data";
import { AchievementMemoryStore } from "./achievement-memory-store";
import { UnlockedAchievementsCache } from "./unlocked-achievements-cache";
import { publishAchievementUnlockNotifications } from "./achievement-unlock-notifications";
import { AchievementSync, SyncedUnlocksStore } from "../achievement-sync";

interface MergeAchievementsOptions {
  alwaysUpdateInterface?: boolean;
}

const saveAchievementsInMemory = async (
  objectId: string,
  shop: GameShop,
  unlockedAchievements: UnlockedAchievement[],
  sendUpdateEvent: boolean,
  current: () => boolean = () => true
) => {
  const gameAchievement = AchievementMemoryStore.get(shop, objectId);
  AchievementMemoryStore.set(shop, objectId, {
    achievements: gameAchievement?.achievements ?? [],
    unlockedAchievements,
    language: gameAchievement?.language,
    catalogueValidator: gameAchievement?.catalogueValidator,
  });
  const since = UnlockedAchievementsCache.invalidate(shop, objectId);

  if (!sendUpdateEvent) return;

  return getUnlockedAchievements(objectId, shop, true, current)
    .then((achievements) => {
      if (!current()) return;
      UnlockedAchievementsCache.set(
        shop,
        objectId,
        achievements,
        current,
        since
      );
      WindowManager.mainWindow?.webContents.send(
        `on-update-achievements-${objectId}-${shop}`,
        achievements
      );
    })
    .catch(() => {});
};

const mergeAchievementsLocally = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean,
  options: MergeAchievementsOptions,
  current: () => boolean
) => {
  let localGameAchievement = AchievementMemoryStore.get(
    game.shop,
    game.objectId
  );
  const userPreferences = await db.get<string, UserPreferences>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (!localGameAchievement) {
    await getGameAchievementData(game.objectId, game.shop, false, current);
    localGameAchievement = AchievementMemoryStore.get(game.shop, game.objectId);
  }

  if (!current()) throw new Error("achievement-sync-context-changed");
  const achievementsData = localGameAchievement?.achievements ?? [];
  // Unlocks synced from the user's other devices count as already unlocked,
  // so they don't pop up as new here.
  const unlockedAchievements = SyncedUnlocksStore.withSynced(
    game.shop,
    game.objectId,
    localGameAchievement?.unlockedAchievements ?? []
  );

  const newAchievementsMap = new Map(
    achievements.toReversed().map((achievement) => {
      return [achievement.name.toUpperCase(), achievement];
    })
  );

  const newAchievements = [...newAchievementsMap.values()]
    .filter((achievement) => {
      return !unlockedAchievements.some((localAchievement) => {
        return (
          localAchievement.name.toUpperCase() === achievement.name.toUpperCase()
        );
      });
    })
    .map((achievement) => {
      return {
        name: achievement.name.toUpperCase(),
        unlockTime: achievement.unlockTime,
        hardcoreUnlockTime: achievement.hardcoreUnlockTime,
      };
    });

  const mergedLocalAchievements = unlockedAchievements.concat(newAchievements);

  if (!current()) throw new Error("achievement-sync-context-changed");
  if (publishNotification) {
    publishAchievementUnlockNotifications({
      game,
      achievements: newAchievements
        .toSorted((a, b) => a.unlockTime - b.unlockTime)
        .map((achievement) =>
          achievementsData.find(
            (steamAchievement) =>
              achievement.name.toUpperCase() ===
              steamAchievement.name.toUpperCase()
          )
        )
        .filter((achievement) => !!achievement),
      completesGame:
        newAchievements.length + unlockedAchievements.length ===
        achievementsData.length,
      unlockedAchievementCount: mergedLocalAchievements.length,
      totalAchievementCount: achievementsData.length,
      userPreferences,
    });
  }

  const achievementsToSync = mergedLocalAchievements;

  await saveAchievementsInMemory(
    game.objectId,
    game.shop,
    achievementsToSync,
    publishNotification || options.alwaysUpdateInterface === true,
    current
  );
  if (!current()) throw new Error("achievement-sync-context-changed");
  void AchievementSync.recordLocal(
    game.shop,
    game.objectId,
    achievementsToSync
  ).catch((error) =>
    achievementsLogger.error(
      "Failed to record achievements for Drive sync",
      game.objectId,
      error
    )
  );

  return newAchievements.length;
};

export const mergeAchievements = async (
  game: Game,
  achievements: UnlockedAchievement[],
  publishNotification: boolean,
  options: MergeAchievementsOptions = {}
) => {
  if (game.shop === "epic") return 0;
  return achievementSyncCoordinator.runMerge(
    levelKeys.game(game.shop, game.objectId),
    (valid) =>
      mergeAchievementsLocally(
        game,
        achievements,
        publishNotification,
        options,
        valid
      )
  );
};
