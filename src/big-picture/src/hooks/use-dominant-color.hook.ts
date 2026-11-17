import { getDominantColorFromImage } from "../helpers";
import { useEffect, useState } from "react";

const dominantColorCache = new Map<string, string | null>();
const pendingDominantColors = new Map<string, Promise<string | null>>();

// Library pages can show hundreds of cards, and each colour means loading and
// decoding a whole cover. Background requests run a couple at a time while
// the renderer is idle so they never compete with scrolling or navigation.
const MAX_CONCURRENT_BACKGROUND_JOBS = 2;
const backgroundQueue: Array<() => void> = [];
let runningBackgroundJobs = 0;

const scheduleIdle = (callback: () => void) => {
  if (typeof globalThis.requestIdleCallback === "function") {
    globalThis.requestIdleCallback(callback, { timeout: 2_000 });
    return;
  }

  globalThis.setTimeout(callback, 50);
};

const pumpBackgroundQueue = () => {
  while (
    runningBackgroundJobs < MAX_CONCURRENT_BACKGROUND_JOBS &&
    backgroundQueue.length > 0
  ) {
    const job = backgroundQueue.shift()!;
    runningBackgroundJobs++;
    scheduleIdle(job);
  }
};

const runInBackground = <T>(task: () => Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    backgroundQueue.push(() => {
      task()
        .then(resolve, reject)
        .finally(() => {
          runningBackgroundJobs--;
          pumpBackgroundQueue();
        });
    });
    pumpBackgroundQueue();
  });

const loadDominantColor = (imageUrl: string, background: boolean) => {
  const pending = pendingDominantColors.get(imageUrl);
  if (pending) return pending;

  const request = (
    background
      ? runInBackground(() => getDominantColorFromImage(imageUrl))
      : getDominantColorFromImage(imageUrl)
  )
    .catch(() => null)
    .then((color) => {
      dominantColorCache.set(imageUrl, color);
      return color;
    })
    .finally(() => {
      pendingDominantColors.delete(imageUrl);
    });

  pendingDominantColors.set(imageUrl, request);
  return request;
};

export interface UseDominantColorOptions {
  /** Skip the work entirely, e.g. when nothing on the card uses the colour. */
  enabled?: boolean;
  /** Queue the work behind other background colour requests. */
  background?: boolean;
}

export function useDominantColor(
  imageUrl: string | null,
  { enabled = true, background = false }: UseDominantColorOptions = {}
) {
  const effectiveUrl = enabled ? imageUrl : null;
  const [dominantColor, setDominantColor] = useState<string | null>(() => {
    if (!effectiveUrl) return null;
    return dominantColorCache.get(effectiveUrl) ?? null;
  });

  useEffect(() => {
    if (!effectiveUrl) {
      setDominantColor(null);
      return;
    }

    if (dominantColorCache.has(effectiveUrl)) {
      setDominantColor(dominantColorCache.get(effectiveUrl) ?? null);
      return;
    }

    let isMounted = true;

    void loadDominantColor(effectiveUrl, background).then((nextColor) => {
      if (!isMounted) return;

      setDominantColor(nextColor);
    });

    return () => {
      isMounted = false;
    };
  }, [effectiveUrl, background]);

  return dominantColor;
}
