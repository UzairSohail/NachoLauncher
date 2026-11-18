export type SystemPowerAction = "power-off" | "restart" | "suspend";

/** Why Nacho can't control the TDP limit on this device. */
export type TdpUnavailableReason =
  | "unsupported-platform"
  | "game-mode"
  | "no-steamos-manager";

export interface TdpRange {
  min: number;
  max: number;
}

/**
 * TDP limit control through SteamOS's steamos-manager service. Only
 * `available` devices (handhelds on SteamOS in Desktop mode) show controls.
 */
export interface TdpStatus {
  available: boolean;
  reason?: TdpUnavailableReason;
  /** Watts, read from steamos-manager for this device. */
  range: TdpRange | null;
  /** The limit in effect now, in watts, when steamos-manager reports it. */
  current: number | null;
  /**
   * The device only takes a TDP limit in its "custom" power profile (ROG Ally
   * and similar). Nacho switches to it when a limit is set.
   */
  needsCustomProfile: boolean;
  /** Nacho's global limit for this device, or null for the system default. */
  globalLimit: number | null;
  /** The per-game override for the game asked about, if any. */
  gameLimit: number | null;
  /** The limit Nacho applied for a running game, if one is running now. */
  activeGameKey: string | null;
}
