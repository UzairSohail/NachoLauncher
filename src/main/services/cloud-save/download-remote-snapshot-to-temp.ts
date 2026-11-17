import { SystemPath } from "@main/services/system-path";
import type {
  DownloadedRestoreFile,
  RestoreDownloadUrlFile,
  RestoreManifestFile,
} from "@types";

import {
  downloadDriveBlobToTemp,
  getDriveRestoreManifest,
} from "./drive-snapshot-store";
import { cloudSaveFileKey } from "./cloud-save-contract";
import {
  mapWithConcurrency,
  MAX_CONCURRENT_RESTORE_OPERATIONS,
} from "./map-with-concurrency";

export const downloadRemoteSnapshotToTemp = async (
  snapshotId: string,
  snapshotVersion: number,
  requestedFiles?: RestoreManifestFile[],
  onProgress?: (processedFiles: number, totalFiles: number) => void
): Promise<DownloadedRestoreFile[]> => {
  if (requestedFiles?.length === 0) return [];
  const files: RestoreDownloadUrlFile[] = (
    await getDriveRestoreManifest(snapshotId)
  ).files.map((file) => ({ ...file, downloadUrl: "drive:" }));
  const requestedById = requestedFiles
    ? new Map(
        requestedFiles.map((file) => [cloudSaveFileKey(file), file] as const)
      )
    : null;
  const selectedFiles = requestedById
    ? files.filter((file) => requestedById.has(cloudSaveFileKey(file)))
    : files;
  if (requestedById) {
    if (selectedFiles.length !== requestedById.size) {
      throw new Error("Missing restore download URL file");
    }
    for (const file of selectedFiles) {
      const requested = requestedById.get(cloudSaveFileKey(file));
      if (
        requested?.hash !== file.hash ||
        requested?.sizeBytes !== file.sizeBytes ||
        requested.lastModifiedAt !== file.lastModifiedAt
      ) {
        throw new Error("Restore download URL file does not match manifest");
      }
    }
  }

  const tempRoot = SystemPath.getPath("temp");
  const tempSnapshotId = `${snapshotId}-${snapshotVersion}`;
  const filesByBlob = new Map<string, RestoreDownloadUrlFile[]>();
  for (const file of selectedFiles) {
    const key = JSON.stringify([file.hash, file.sizeBytes]);
    filesByBlob.set(key, [...(filesByBlob.get(key) ?? []), file]);
  }

  const groups = [...filesByBlob.values()];
  let processedFiles = 0;
  const downloadedGroups = await mapWithConcurrency(
    groups,
    MAX_CONCURRENT_RESTORE_OPERATIONS,
    async (group) => {
      const [file] = group;
      const tempPath = await downloadDriveBlobToTemp(
        snapshotId,
        tempSnapshotId,
        file,
        tempRoot
      );
      return { key: JSON.stringify([file.hash, file.sizeBytes]), tempPath };
    },
    (_result, group) => {
      processedFiles += group.length;
      onProgress?.(processedFiles, selectedFiles.length);
    }
  );
  const tempPathByBlob = new Map(
    downloadedGroups.map(({ key, tempPath }) => [key, tempPath])
  );

  return selectedFiles.map((file) => {
    const tempPath = tempPathByBlob.get(
      JSON.stringify([file.hash, file.sizeBytes])
    );
    if (!tempPath) throw new Error("Missing downloaded restore blob");
    return { ...file, tempPath };
  });
};
