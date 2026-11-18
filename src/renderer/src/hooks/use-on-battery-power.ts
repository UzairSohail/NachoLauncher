import { useEffect, useState } from "react";

/** True while the device runs on battery. False where it can't tell. */
export function useOnBatteryPower() {
  const [onBattery, setOnBattery] = useState(false);

  useEffect(() => {
    const electron = globalThis.window.electron;
    if (!electron?.getOnBatteryPower) return;

    let active = true;
    electron
      .getOnBatteryPower()
      .then((value) => {
        if (active) setOnBattery(value);
      })
      .catch(() => undefined);
    const unsubscribe = electron.onBatteryPowerChanged((value) =>
      setOnBattery(value)
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return onBattery;
}
