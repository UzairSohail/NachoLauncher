import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameShop, LocalScreenshot } from "@types";
import { isLocalScreenshotForGame } from "@shared";
import { logger } from "@renderer/logger";

interface LoadedScreenshots {
  targetKey: string | null;
  screenshots: LocalScreenshot[];
  hasLoaded: boolean;
  hasFailed: boolean;
}

const NOT_LOADED: LoadedScreenshots = {
  targetKey: null,
  screenshots: [],
  hasLoaded: false,
  hasFailed: false,
};

const byNewest = (a: LocalScreenshot, b: LocalScreenshot) =>
  b.capturedAt - a.capturedAt;

/** Screenshots saved on this device for one game, newest first. */
export function useLocalGameScreenshots(
  shop: GameShop,
  objectId: string,
  isEnabled: boolean
) {
  const targetKey = `${shop}:${objectId}`;
  const [loaded, setLoaded] = useState<LoadedScreenshots>(NOT_LOADED);
  const current = loaded.targetKey === targetKey ? loaded : NOT_LOADED;

  const load = useCallback(
    () =>
      globalThis.window.electron
        .getLocalScreenshotsForGame(shop, objectId)
        .then((screenshots) =>
          setLoaded({
            targetKey,
            screenshots,
            hasLoaded: true,
            hasFailed: false,
          })
        )
        .catch((error: unknown) => {
          logger.error("Failed to load local screenshots for the game", error);
          setLoaded((previous) => ({
            targetKey,
            screenshots:
              previous.targetKey === targetKey ? previous.screenshots : [],
            hasLoaded: true,
            hasFailed: true,
          }));
        }),
    [objectId, shop, targetKey]
  );

  useEffect(() => {
    if (!isEnabled) return;
    let isCurrent = true;
    void load();

    const unsubscribe = globalThis.window.electron.onLocalScreenshotsChange(
      (items) => {
        if (!isCurrent) return;
        setLoaded({
          targetKey,
          screenshots: items.filter((item) =>
            isLocalScreenshotForGame(item, shop, objectId)
          ),
          hasLoaded: true,
          hasFailed: false,
        });
      }
    );

    return () => {
      isCurrent = false;
      unsubscribe();
    };
  }, [isEnabled, load, objectId, shop, targetKey]);

  const screenshots = useMemo(
    () => current.screenshots.toSorted(byNewest),
    [current.screenshots]
  );

  return {
    screenshots,
    hasLoaded: current.hasLoaded,
    hasFailed: current.hasFailed,
    retry: load,
  };
}
