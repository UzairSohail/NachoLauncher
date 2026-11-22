/*
 * Nacho's feature switches. Hydra used to turn these on and off remotely
 * through its /features endpoint; they are now part of the build, so a
 * change on Hydra's servers can't hide a downloader or a page.
 */
export enum Feature {
  CheckDownloadWritePermission = "CHECK_DOWNLOAD_WRITE_PERMISSION",
  TorBox = "TORBOX",
  Premiumize = "PREMIUMIZE",
  AllDebrid = "ALLDEBRID",
  Screenshots = "SCREENSHOTS",
  MultipartHosterDownloads = "MULTIPART_HOSTER_DOWNLOADS",
  Recompilations = "RECOMPILATIONS",
  RecompilationCloudSaves = "RECOMPILATION_CLOUD_SAVES",
  /** Extracting archives in place with the native addon. Still experimental. */
  InPlaceArchiveExtraction = "IN_PLACE_ARCHIVE_EXTRACTION",
}

export const ENABLED_FEATURES: readonly string[] = [
  Feature.CheckDownloadWritePermission,
  Feature.TorBox,
  Feature.Premiumize,
  Feature.AllDebrid,
  Feature.Screenshots,
  Feature.MultipartHosterDownloads,
  Feature.Recompilations,
  Feature.RecompilationCloudSaves,
];

export const isNachoFeatureEnabled = (feature: Feature | string) =>
  ENABLED_FEATURES.includes(feature);
