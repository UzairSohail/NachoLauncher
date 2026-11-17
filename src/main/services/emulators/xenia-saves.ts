import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Xbox 360 saves made by Xenia Canary. Xenia keeps each game's saves in its
 * content folder, one folder per profile and title:
 *
 *   content/<profile XUID>/<title ID>/00000001/...   (Canary with profiles)
 *   content/<title ID>/00000001/...                  (older builds)
 *
 * 00000001 is the Xbox 360 "saved game" content type. Nacho backs up that
 * folder per game and writes it back into a profile on another device.
 */

export const XENIA_SAVED_GAME_FOLDER = "00000001";
const TITLE_ID_RE = /^[0-9A-F]{8}$/i;
const PROFILE_ID_RE = /^[0-9A-F]{16}$/i;
const SHARED_PROFILE_ID = "0000000000000000";
// Xenia's own dashboard title, which holds profile data rather than game saves.
const DASHBOARD_TITLE_ID = "FFFE07D1";

export const isXeniaTitleId = (value: string) => TITLE_ID_RE.test(value);
export const isXeniaProfileId = (value: string) => PROFILE_ID_RE.test(value);

const isDirectory = async (directory: string) =>
  (await fs.stat(directory).catch(() => null))?.isDirectory() ?? false;

const readContentRootFromConfig = async (
  storageRoot: string
): Promise<string | null> => {
  for (const name of ["xenia-canary.config.toml", "xenia.config.toml"]) {
    const config = await fs
      .readFile(path.join(storageRoot, name), "utf8")
      .catch(() => null);
    const match = config?.match(/^\s*content_root\s*=\s*"([^"]*)"/m);
    const configured = match?.[1]?.trim();
    if (configured) {
      return path.isAbsolute(configured)
        ? configured
        : path.join(storageRoot, configured);
    }
  }
  return null;
};

/**
 * Where Xenia may keep its content folder, most likely first. Xenia uses the
 * folder next to its executable when `portable.txt` is there, otherwise
 * Documents\Xenia (inside the Proton prefix when it runs through Proton) or
 * ~/.local/share/Xenia for the native Linux build.
 */
export const xeniaContentRootCandidates = async (
  executablePath: string,
  protonPrefixPaths: string[] = []
): Promise<string[]> => {
  const executableDirectory = path.dirname(executablePath);
  const storageRoots: string[] = [];

  const portable = await fs
    .access(path.join(executableDirectory, "portable.txt"))
    .then(() => true)
    .catch(() => false);
  if (portable) storageRoots.push(executableDirectory);

  if (process.platform === "win32") {
    storageRoots.push(path.join(os.homedir(), "Documents", "Xenia"));
  } else {
    for (const prefix of protonPrefixPaths) {
      for (const base of [prefix, path.join(prefix, "pfx")]) {
        storageRoots.push(
          path.join(base, "drive_c", "users", "steamuser", "Documents", "Xenia")
        );
      }
    }
    const dataHome =
      process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    storageRoots.push(path.join(dataHome, "Xenia"));
  }
  if (!portable) storageRoots.push(executableDirectory);

  const roots: string[] = [];
  for (const storageRoot of storageRoots) {
    const configured = await readContentRootFromConfig(storageRoot);
    if (configured) roots.push(configured);
    roots.push(path.join(storageRoot, "content"));
  }
  return Array.from(new Set(roots));
};

export interface XeniaSaveFolder {
  contentRoot: string;
  /** Null for the older layout without profile folders. */
  profileId: string | null;
  titleId: string;
  /** The game's 00000001 folder. */
  sourcePath: string;
}

const listDirectories = async (directory: string) =>
  (await fs.readdir(directory, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

export const findXeniaSaveFolders = async (
  contentRoots: string[]
): Promise<XeniaSaveFolder[]> => {
  const found: XeniaSaveFolder[] = [];
  const addTitle = async (
    contentRoot: string,
    profileId: string | null,
    titleDirectory: string,
    titleId: string
  ) => {
    if (titleId.toUpperCase() === DASHBOARD_TITLE_ID) return;
    const sourcePath = path.join(titleDirectory, XENIA_SAVED_GAME_FOLDER);
    if (!(await isDirectory(sourcePath))) return;
    found.push({
      contentRoot,
      profileId: profileId?.toUpperCase() ?? null,
      titleId: titleId.toUpperCase(),
      sourcePath,
    });
  };

  for (const contentRoot of contentRoots) {
    for (const name of await listDirectories(contentRoot)) {
      const directory = path.join(contentRoot, name);
      if (isXeniaTitleId(name)) {
        await addTitle(contentRoot, null, directory, name);
      } else if (isXeniaProfileId(name) && name !== SHARED_PROFILE_ID) {
        for (const titleId of await listDirectories(directory)) {
          if (!isXeniaTitleId(titleId)) continue;
          await addTitle(
            contentRoot,
            name,
            path.join(directory, titleId),
            titleId
          );
        }
      }
    }
  }
  return found;
};

export interface XeniaRestoreTarget {
  /** The profile folder (or the content folder for the older layout). */
  directory: string;
  label: string;
}

/**
 * Profile folders a downloaded save can go into. Profiles differ between
 * devices, so every local profile is offered. With none yet, the save's own
 * profile is recreated in the first content folder that exists.
 */
export const xeniaRestoreTargets = async (
  contentRoots: string[],
  originalProfileId: string | null
): Promise<XeniaRestoreTarget[]> => {
  const targets: XeniaRestoreTarget[] = [];
  for (const contentRoot of contentRoots) {
    for (const name of await listDirectories(contentRoot)) {
      if (!isXeniaProfileId(name) || name === SHARED_PROFILE_ID) continue;
      targets.push({
        directory: path.join(contentRoot, name),
        label: `Profile ${name.toUpperCase()}`,
      });
    }
  }
  if (targets.length > 0) return targets;

  const existingRoot =
    (
      await Promise.all(
        contentRoots.map(async (root) =>
          (await isDirectory(root)) ? root : null
        )
      )
    ).find(Boolean) ?? contentRoots[0];
  if (!existingRoot) return [];
  return [
    originalProfileId
      ? {
          directory: path.join(existingRoot, originalProfileId),
          label: `Profile ${originalProfileId}`,
        }
      : { directory: existingRoot, label: "Xenia content" },
  ];
};
