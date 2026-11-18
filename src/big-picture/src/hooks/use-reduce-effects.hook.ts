import { useSyncExternalStore } from "react";

import { useUserPreferences } from "./use-user-preferences.hook";

type BatteryBridge = {
  getOnBatteryPower?: () => Promise<boolean>;
  onBatteryPowerChanged?: (cb: (onBattery: boolean) => void) => () => void;
};

// One shared subscription for every card that asks, instead of one each.
let onBattery = false;
let unsubscribeFromBridge: (() => void) | null = null;
const listeners = new Set<() => void>();

const setOnBattery = (value: boolean) => {
  if (value === onBattery) return;
  onBattery = value;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);

  if (!unsubscribeFromBridge) {
    const electron = globalThis.window.electron as BatteryBridge | undefined;
    if (electron?.getOnBatteryPower && electron.onBatteryPowerChanged) {
      electron
        .getOnBatteryPower()
        .then(setOnBattery)
        .catch(() => undefined);
      unsubscribeFromBridge = electron.onBatteryPowerChanged(setOnBattery);
    }
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribeFromBridge) {
      unsubscribeFromBridge();
      unsubscribeFromBridge = null;
    }
  };
};

export function useOnBattery() {
  return useSyncExternalStore(subscribe, () => onBattery);
}

/**
 * Big Picture's blur, motion and animated covers are off when the user asks,
 * and on battery unless they turned that off.
 */
export function useReduceEffects() {
  const userPreferences = useUserPreferences();
  const batteryActive = useOnBattery();

  if (userPreferences?.bigPictureReduceEffects) return true;
  return (
    batteryActive && (userPreferences?.bigPictureReduceEffectsOnBattery ?? true)
  );
}
