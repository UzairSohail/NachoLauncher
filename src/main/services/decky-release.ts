import axios from "axios";

export interface DeckyReleaseInfo {
  version: string;
  downloadUrl: string;
}

/*
 * The Decky plugin's latest release, read straight from its GitHub
 * releases instead of through Hydra's API.
 */
const DECKY_PLUGIN_RELEASES_URL =
  "https://api.github.com/repos/hydralauncher/decky-hydra-launcher/releases/latest";

interface GitHubRelease {
  tag_name?: unknown;
  assets?: Array<{ name?: unknown; browser_download_url?: unknown }>;
}

/** Turns a GitHub release into the version and zip to install. */
export const parseDeckyRelease = (release: GitHubRelease): DeckyReleaseInfo => {
  const tag = typeof release.tag_name === "string" ? release.tag_name : "";
  const zip = (release.assets ?? []).find(
    (asset) =>
      typeof asset.name === "string" &&
      asset.name.toLowerCase().endsWith(".zip") &&
      typeof asset.browser_download_url === "string"
  );

  if (!tag || !zip) {
    throw new Error("The Decky plugin release has no zip to install");
  }

  return {
    version: tag.replace(/^v/i, ""),
    downloadUrl: zip.browser_download_url as string,
  };
};

let cached: Promise<DeckyReleaseInfo> | null = null;

export const fetchDeckyReleaseInfo = () => {
  cached ??= axios
    .get<GitHubRelease>(DECKY_PLUGIN_RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
      timeout: 15_000,
    })
    .then((response) => parseDeckyRelease(response.data))
    .catch((error) => {
      cached = null;
      throw error;
    });
  return cached;
};
