import { normalizeSku } from "@main/services/emulators";
import type { LaunchboxShopDetailsAssetsResponse } from "@main/services/emulators";
import {
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
} from "@main/level";

/**
 * Build a sku → assets index from games already in the local Hydra library.
 *
 * The remote shop-details endpoint occasionally misses a serial the user has
 * already imported (its art is cached locally from a prior ROM scan), so memory
 * card scans fall back to this index before marking a save unmatched. Shared by
 * the local save scanners. Lives in the events layer because it joins the level
 * sublevels with the emulators service — keeping it out of `@main/services`
 * avoids a services↔level import cycle.
 */
export const buildLocalLaunchboxAssetIndex = async (): Promise<
  Map<string, LaunchboxShopDetailsAssetsResponse>
> => {
  const index = new Map<string, LaunchboxShopDetailsAssetsResponse>();

  // sku → objectId, from cached LaunchBox shop-details.
  const skuToObjectId = new Map<string, string>();
  for (const [key, details] of await gamesShopCacheSublevel.iterator().all()) {
    if (!key.startsWith("launchbox:") || !details?.objectId || !details.skus) {
      continue;
    }
    for (const sku of details.skus) {
      skuToObjectId.set(normalizeSku(sku), details.objectId);
    }
  }
  if (skuToObjectId.size === 0) return addLibraryDiscSkus(index);

  // objectId → cached assets.
  const assetsByObjectId = new Map(
    (await gamesShopAssetsSublevel.iterator().all())
      .filter(
        ([key, assets]) => key.startsWith("launchbox:") && assets?.objectId
      )
      .map(([, assets]) => [assets.objectId, assets] as const)
  );

  for (const [normSku, objectId] of skuToObjectId) {
    const assets = assetsByObjectId.get(objectId);
    if (!assets) continue;
    index.set(normSku, {
      objectId,
      shop: "launchbox",
      title: assets.title,
      iconUrl: assets.iconUrl,
      libraryImageUrl: assets.libraryImageUrl,
      libraryHeroImageUrl: assets.libraryHeroImageUrl,
      logoImageUrl: assets.logoImageUrl,
    });
  }
  return addLibraryDiscSkus(index);
};

/**
 * Adds the serials read from the ROMs in the library. Games matched by name
 * (common for Xbox 360) have no serial in the shop cache, but their discs do.
 */
const addLibraryDiscSkus = async (
  index: Map<string, LaunchboxShopDetailsAssetsResponse>
) => {
  for (const game of await gamesSublevel.values().all()) {
    if (game.shop !== "launchbox" || game.isDeleted || !game.discs) continue;
    for (const disc of game.discs) {
      if (!disc.sku) continue;
      const sku = normalizeSku(disc.sku);
      if (!sku || index.has(sku)) continue;
      index.set(sku, {
        objectId: game.objectId,
        shop: "launchbox",
        title: game.title,
        iconUrl: game.iconUrl,
        libraryImageUrl: game.customCoverImageUrl ?? null,
        libraryHeroImageUrl: game.libraryHeroImageUrl,
        logoImageUrl: game.logoImageUrl,
      });
    }
  }
  return index;
};

export const findUniqueLocalAssetBySkuPrefix = (
  index: Map<string, LaunchboxShopDetailsAssetsResponse>,
  prefix: string,
  skuLength: number
): { sku: string; assets: LaunchboxShopDetailsAssetsResponse } | null => {
  const candidates = Array.from(index.entries()).filter(
    ([sku]) => sku.length === skuLength && sku.startsWith(prefix)
  );
  if (
    candidates.length === 0 ||
    new Set(candidates.map(([, assets]) => assets.objectId)).size !== 1
  ) {
    return null;
  }

  return { sku: candidates[0][0], assets: candidates[0][1] };
};
