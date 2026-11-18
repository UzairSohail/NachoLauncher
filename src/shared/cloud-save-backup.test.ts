import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_CLOUD_SAVE_BACKUP_INTERVAL_MINUTES,
  isCloudSaveBackupDue,
  normalizeCloudSaveBackupInterval,
} from "./cloud-save-backup.js";

describe("cloud save backups while playing", () => {
  it("defaults to every 15 minutes", () => {
    assert.equal(DEFAULT_CLOUD_SAVE_BACKUP_INTERVAL_MINUTES, 15);
    assert.equal(normalizeCloudSaveBackupInterval(undefined), 15);
    assert.equal(normalizeCloudSaveBackupInterval(null), 15);
    assert.equal(normalizeCloudSaveBackupInterval(7), 15);
  });

  it("keeps a chosen interval, including off", () => {
    assert.equal(normalizeCloudSaveBackupInterval(30), 30);
    assert.equal(normalizeCloudSaveBackupInterval(0), 0);
  });

  it("is due once the interval has passed", () => {
    const start = 1_000_000;
    assert.equal(isCloudSaveBackupDue(15, start, start + 14 * 60_000), false);
    assert.equal(isCloudSaveBackupDue(15, start, start + 15 * 60_000), true);
  });

  it("is never due when turned off", () => {
    assert.equal(isCloudSaveBackupDue(0, 0, Number.MAX_SAFE_INTEGER), false);
  });
});
