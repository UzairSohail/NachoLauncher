import { useEffect, useState } from "react";
import { refreshAllDebridSupportedDomains } from "@shared";

/**
 * Keeps AllDebrid's supported-host list fresh (at most every 15 minutes)
 * while a download picker is open. Returns a number that changes when the
 * list does, for use as a memo dependency.
 */
export function useAllDebridHosts(enabled: boolean): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void refreshAllDebridSupportedDomains(() =>
      globalThis.window.electron.getAllDebridHosts()
    ).then((changed) => {
      if (active && changed) setVersion((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [enabled]);
  return version;
}
