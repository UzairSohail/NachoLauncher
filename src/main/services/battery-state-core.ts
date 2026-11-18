/** Pure parts of battery detection, kept separate so they can be tested. */

export interface PowerSupplyReading {
  type: string;
  status?: string | null;
  online?: string | null;
  /** "Device" for peripherals such as a wireless controller's battery. */
  scope?: string | null;
}

/**
 * On Linux, reads /sys/class/power_supply entries: running on battery means
 * a battery is discharging and no mains or USB supply is online.
 */
export const isRunningOnBattery = (
  supplies: readonly PowerSupplyReading[]
): boolean => {
  const externalOnline = supplies.some(
    (supply) =>
      supply.type !== "Battery" &&
      supply.scope?.trim() !== "Device" &&
      supply.online?.trim() === "1"
  );
  if (externalOnline) return false;

  return supplies.some(
    (supply) =>
      supply.type === "Battery" &&
      supply.scope?.trim() !== "Device" &&
      supply.status?.trim().toLowerCase() === "discharging"
  );
};
