import type { GameShop, TdpRange, TdpStatus } from "@types";
import { useCallback, useEffect, useRef, useState } from "react";

/** Wattages a TDP picker offers: every whole watt in the device's range. */
export const getTdpWattOptions = (range: TdpRange | null): number[] => {
  if (!range) return [];
  const options: number[] = [];
  for (let watts = range.min; watts <= range.max; watts += 1) {
    options.push(watts);
  }
  return options;
};

interface UseTdpStatusOptions {
  shop?: GameShop | null;
  objectId?: string | null;
}

/**
 * TDP status for this device and, when given, one game. `status` stays null
 * until the first answer, and `available` is false everywhere except a
 * SteamOS handheld in Desktop mode, so callers render nothing until then.
 */
export function useTdpStatus({ shop, objectId }: UseTdpStatusOptions = {}) {
  const [status, setStatus] = useState<TdpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await globalThis.window.electron.getTdpStatus(
        shop ?? null,
        objectId ?? null
      );
      if (mountedRef.current) setStatus(next);
    } catch {
      if (mountedRef.current) setStatus(null);
    }
  }, [shop, objectId]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const run = useCallback(
    async (task: () => Promise<void>) => {
      setBusy(true);
      try {
        await task();
      } finally {
        await refresh();
        if (mountedRef.current) setBusy(false);
      }
    },
    [refresh]
  );

  const setGlobalLimit = useCallback(
    (watts: number | null) =>
      run(() => globalThis.window.electron.setGlobalTdpLimit(watts)),
    [run]
  );

  const setGameLimit = useCallback(
    (watts: number | null) => {
      if (!shop || !objectId) return Promise.resolve();
      return run(() =>
        globalThis.window.electron.setGameTdpLimit(shop, objectId, watts)
      );
    },
    [run, shop, objectId]
  );

  const prepare = useCallback(
    () => run(() => globalThis.window.electron.prepareTdpControl()),
    [run]
  );

  return { status, busy, refresh, setGlobalLimit, setGameLimit, prepare };
}
