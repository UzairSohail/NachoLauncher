/**
 * Nacho Launcher keeps its own Drive files in `Cloud Save Manager/Nacho/`.
 * Builds from before the rebrand used `Cloud Save Manager/hydra/`, and a
 * device that hasn't updated yet (or an older phone app) can keep writing
 * there. So before Drive files are read or written, and again every so often,
 * anything in `hydra/` is moved into `Nacho/` and the old folder is binned.
 */
export const APP_FOLDER = "Nacho";

/** How often to look again for files an older build wrote to `hydra/`. */
export const LEGACY_FOLDER_RECHECK_MS = 15 * 60_000;

export interface LegacyFolderMove {
  outcome: "nothing" | "renamed" | "merged";
  copied: number;
}

export const createAppFolderGate = (
  move: () => Promise<LegacyFolderMove>,
  onMoved: (result: LegacyFolderMove) => void = () => {},
  now: () => number = Date.now
) => {
  let checkedAt: number | null = null;
  let running: Promise<void> | null = null;

  /**
   * Resolves once `hydra/` has been moved, or was checked recently. Throws
   * when the move fails, so callers don't read or write a half-moved folder;
   * the next call tries again.
   */
  return () => {
    if (checkedAt !== null && now() - checkedAt < LEGACY_FOLDER_RECHECK_MS) {
      return Promise.resolve();
    }

    running ??= move()
      .then((result) => {
        checkedAt = now();
        if (result.outcome !== "nothing") onMoved(result);
      })
      .finally(() => {
        running = null;
      });

    return running;
  };
};
