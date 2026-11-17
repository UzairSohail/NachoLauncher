import { useEffect, useState } from "react";

/**
 * Whether this device is signed in to Google Drive, where Nacho keeps cloud
 * saves (PC and emulator). Rechecked when the window regains focus, so it
 * catches a sign-in finished in the browser.
 */
export function useGoogleDriveSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let active = true;
    const check = () => {
      globalThis.window.electron
        .getPersonalCloudStatus()
        .then((status) => {
          if (active) setSignedIn(Boolean(status?.signedIn));
        })
        .catch(() => {
          if (active) setSignedIn(false);
        });
    };
    check();
    globalThis.window.addEventListener("focus", check);
    return () => {
      active = false;
      globalThis.window.removeEventListener("focus", check);
    };
  }, []);

  return signedIn;
}
