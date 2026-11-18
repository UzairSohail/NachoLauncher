/** Minutes between cloud save backups while a game is running. 0 turns them off. */
export const CLOUD_SAVE_BACKUP_INTERVAL_CHOICES = [0, 5, 10, 15, 30, 60];

export const DEFAULT_CLOUD_SAVE_BACKUP_INTERVAL_MINUTES = 15;

/** The interval to use for a stored preference, falling back to the default. */
export const normalizeCloudSaveBackupInterval = (
  value: number | null | undefined
): number =>
  typeof value === "number" &&
  CLOUD_SAVE_BACKUP_INTERVAL_CHOICES.includes(value)
    ? value
    : DEFAULT_CLOUD_SAVE_BACKUP_INTERVAL_MINUTES;

/** Whether a running game is due a backup, given when it last had one. */
export const isCloudSaveBackupDue = (
  intervalMinutes: number,
  lastBackupAt: number,
  now: number
): boolean =>
  intervalMinutes > 0 && now - lastBackupAt >= intervalMinutes * 60_000;
