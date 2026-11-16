import type {
  RecompilationDetails,
  RecompilationRef,
  RecompilationReleases,
} from "@types";
import { isCatalogSlug } from "@shared";
import { HydraApi } from "@main/services/hydra-api";
import { RecompCatalog } from "@main/services/recomp-catalog";

/*
 * Where a port's details and releases come from: Hydra's API, or the
 * community catalog for ports with a catalog slug.
 */

const apiPath = ({ objectId, slug }: RecompilationRef) =>
  `/games/launchbox/${objectId}/recompilations/${slug}`;

export const fetchRecompilationDetails = async (
  ref: RecompilationRef
): Promise<RecompilationDetails> => {
  if (!isCatalogSlug(ref.slug)) {
    return HydraApi.get<RecompilationDetails>(apiPath(ref), undefined, {
      needsAuth: false,
    });
  }
  const details = await RecompCatalog.getDetails(ref.objectId, ref.slug);
  if (!details) throw new Error(`${ref.slug} is not in the recomp catalog`);
  return details;
};

export const fetchRecompilationReleases = async (
  ref: RecompilationRef
): Promise<RecompilationReleases> => {
  if (!isCatalogSlug(ref.slug)) {
    return HydraApi.get<RecompilationReleases>(
      `${apiPath(ref)}/releases`,
      undefined,
      { needsAuth: false }
    );
  }
  return { releases: await RecompCatalog.getReleases(ref.slug) };
};
