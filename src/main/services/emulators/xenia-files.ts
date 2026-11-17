import { promises as fs, readFileSync, statSync } from "node:fs";
import path from "node:path";

/*
 * Xenia Canary has no --version flag, and its releases are tagged with the
 * commit they were built from. Nacho records that tag next to the executable
 * when it installs Xenia, and reads it back to show the installed version.
 */

interface XeniaVersionRecord {
  version: string;
  executableSize: number;
}

const versionRecordPath = (executablePath: string) =>
  path.join(
    path.dirname(executablePath),
    `.nacho-version-${path.basename(executablePath)}.json`
  );

export const writeXeniaVersionRecord = async (
  executablePath: string,
  releaseTag: string | null
): Promise<void> => {
  const version = releaseTag?.trim();
  if (!version) return;

  const { size } = await fs.stat(executablePath);
  const record: XeniaVersionRecord = { version, executableSize: size };
  await fs.writeFile(versionRecordPath(executablePath), JSON.stringify(record));
};

export const readXeniaInstalledVersion = (
  executablePath: string
): string | null => {
  try {
    const record = JSON.parse(
      readFileSync(versionRecordPath(executablePath), "utf8")
    ) as Partial<XeniaVersionRecord>;
    if (
      typeof record.version === "string" &&
      record.executableSize === statSync(executablePath).size
    ) {
      return record.version;
    }
    return null;
  } catch {
    return null;
  }
};

/**
 * True when Xenia has to run through Proton: the Windows build of Xenia
 * picked on Linux (SteamOS included).
 */
export const xeniaNeedsProton = (
  executablePath: string,
  platform: NodeJS.Platform = process.platform
): boolean =>
  platform === "linux" && path.extname(executablePath).toLowerCase() === ".exe";

/**
 * Wine maps the Linux file system to the Z: drive. Handing Xenia a Windows
 * style path keeps it from resolving the game against the wrong drive.
 */
export const toWineZDrivePath = (linuxPath: string): string =>
  `Z:${linuxPath.replaceAll("/", "\\")}`;

export const buildXeniaLaunchArguments = (
  bootTarget: string,
  executablePath: string,
  platform: NodeJS.Platform = process.platform
): string[] => [
  "--fullscreen",
  xeniaNeedsProton(executablePath, platform)
    ? toWineZDrivePath(bootTarget)
    : bootTarget,
];
