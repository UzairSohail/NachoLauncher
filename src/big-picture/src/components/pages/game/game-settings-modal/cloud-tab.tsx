import { SpinnerIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import type {
  EmulationCloudSave,
  EmulationSavePlatform,
  GameArtifact,
  LibraryGame,
  MemoryCardSaveRecord,
} from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { platformToEmulationSavePlatform } from "@renderer/helpers";
import {
  Button,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../../common";
import { useBigPictureToast } from "../../../../hooks";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { EmulationCloudRestoreModal } from "../../../../pages/settings/emulation/emulation-cloud-restore-modal";
import { CloudSavesList } from "./cloud-saves-list";

import "./cloud-tab.scss";

export const GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID =
  "game-cloud-settings-primary-control";

export interface GameCloudSettingsProps {
  game: LibraryGame;
}

const RESTORE_MODAL_REGION_ID = "emu-saves-restore-modal-region";
const RESTORE_MODAL_ACTIONS_REGION_ID = "emu-saves-restore-modal-actions";
const RESTORE_MODAL_PICK_BUTTON_ID = "emu-saves-restore-pick-button";
const RESTORE_MODAL_CONFIRM_BUTTON_ID = "emu-saves-restore-confirm";

const recordKey = (record: MemoryCardSaveRecord): string =>
  `${record.cardFilePath}::${record.folderName}`;

const listLocalSaves = (
  platform: EmulationSavePlatform
): Promise<MemoryCardSaveRecord[]> => {
  if (platform === "ps2") {
    return globalThis.window.electron.listPs2MemcardSaves();
  }
  if (platform === "ps1") {
    return globalThis.window.electron.listPs1MemcardSaves();
  }
  return globalThis.window.electron.listLocalEmulationSaves(platform);
};

function emulationSaveToArtifact(save: EmulationCloudSave): GameArtifact {
  return {
    id: save.id,
    artifactLengthInBytes: save.artifactLengthInBytes,
    downloadOptionTitle: save.fileName,
    createdAt: save.createdAt,
    updatedAt: save.updatedAt,
    hostname: save.hostname ?? "—",
    downloadCount: 0,
    label: save.label ?? undefined,
    isFrozen: false,
  };
}

function EmulationRestoreModal({
  save,
  platform,
  onClose,
  onRestored,
}: Readonly<{
  save: EmulationCloudSave | null;
  platform: EmulationSavePlatform;
  onClose: () => void;
  onRestored: () => void;
}>) {
  const { t } = useTranslation("settings");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const unformattedKey =
    platform === "ps2"
      ? "cloud_restore_unformatted_ps2"
      : "cloud_restore_unformatted";
  return (
    <EmulationCloudRestoreModal
      save={save}
      platform={platform}
      onClose={onClose}
      onRestored={onRestored}
      onRestoreSuccess={(result) =>
        showSuccessToast(
          t(
            result.reason === "manual-import-required"
              ? "cloud_restore_wii_downloaded"
              : "cloud_restore_success"
          )
        )
      }
      onRestoreError={(reason) =>
        showErrorToast(
          t(reason === "unformatted" ? unformattedKey : "cloud_restore_failed")
        )
      }
      regionId={RESTORE_MODAL_REGION_ID}
      actionsRegionId={RESTORE_MODAL_ACTIONS_REGION_ID}
      pickButtonId={RESTORE_MODAL_PICK_BUTTON_ID}
      confirmButtonId={RESTORE_MODAL_CONFIRM_BUTTON_ID}
    />
  );
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Emulator saves backed up to the user's Google Drive. PC games use the
 * Personal Cloud tab instead.
 */
export function GameCloudSettingsTab({
  game,
}: Readonly<GameCloudSettingsProps>) {
  const { t } = useTranslation("big_picture");
  const { t: tSettings } = useTranslation("settings");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();

  const emulationPlatform =
    game.shop === "launchbox"
      ? platformToEmulationSavePlatform(game.platform)
      : null;

  const [emulationSaves, setEmulationSaves] = useState<EmulationCloudSave[]>(
    []
  );
  const [loadingArtifacts, setLoadingArtifacts] = useState(true);
  const [deletingArtifactId, setDeletingArtifactId] = useState<string | null>(
    null
  );
  const [emulationRestoreTarget, setEmulationRestoreTarget] =
    useState<EmulationCloudSave | null>(null);
  const [records, setRecords] = useState<MemoryCardSaveRecord[]>([]);
  const [uploadingCardKey, setUploadingCardKey] = useState<string | null>(null);

  const artifacts = useMemo(
    () => emulationSaves.map(emulationSaveToArtifact),
    [emulationSaves]
  );
  const localSaves = useMemo(
    () => records.filter((r) => r.objectId === game.objectId),
    [records, game.objectId]
  );
  const hasLocalSaves = localSaves.length > 0;

  const loadArtifacts = useCallback(async () => {
    if (!emulationPlatform) {
      setLoadingArtifacts(false);
      return;
    }

    setLoadingArtifacts(true);
    const [saves, local] = await Promise.all([
      globalThis.window.electron
        .listEmulationSaves(emulationPlatform, game.objectId)
        .catch(() => [] as EmulationCloudSave[]),
      listLocalSaves(emulationPlatform).catch(
        () => [] as MemoryCardSaveRecord[]
      ),
    ]);
    setEmulationSaves(saves.filter((s) => s.objectId === game.objectId));
    setRecords(local);
    setLoadingArtifacts(false);
  }, [emulationPlatform, game.objectId]);

  useEffect(() => {
    loadArtifacts().catch(() => {});
  }, [loadArtifacts]);

  const handleUploadCard = useCallback(
    async (record: MemoryCardSaveRecord) => {
      if (!emulationPlatform) return;
      const key = recordKey(record);
      setUploadingCardKey(key);
      try {
        await globalThis.window.electron.uploadEmulationSave(
          emulationPlatform,
          record.cardFilePath,
          record.folderName
        );
        showSuccessToast("Cloud backup complete");
        loadArtifacts().catch(() => {});
      } catch {
        showErrorToast("Cloud backup failed");
      } finally {
        setUploadingCardKey(null);
      }
    },
    [emulationPlatform, showSuccessToast, showErrorToast, loadArtifacts]
  );

  const handleWiiUpload = useCallback(async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Dolphin Wii Save", extensions: ["bin"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    setUploadingCardKey("wii-data-bin");
    try {
      await globalThis.window.electron.uploadWiiEmulationSave(
        result.filePaths[0],
        game.objectId
      );
      showSuccessToast("Cloud backup complete");
      await loadArtifacts();
    } catch (error) {
      showErrorToast(
        error instanceof Error ? error.message : "Cloud backup failed"
      );
    } finally {
      setUploadingCardKey(null);
    }
  }, [game.objectId, loadArtifacts, showErrorToast, showSuccessToast]);

  const handleRestoreArtifact = useCallback(
    async (artifactId: string) => {
      const save = emulationSaves.find((s) => s.id === artifactId);
      if (save) setEmulationRestoreTarget(save);
    },
    [emulationSaves]
  );

  const handleDeleteArtifact = useCallback(
    async (artifactId: string) => {
      if (deletingArtifactId) return;

      setDeletingArtifactId(artifactId);

      try {
        await globalThis.window.electron.deleteEmulationSave(artifactId);
        showSuccessToast("Cloud save removed");
        await loadArtifacts();
      } catch (error) {
        showErrorToast("Unable to sync cloud save");
        throw error;
      } finally {
        setDeletingArtifactId(null);
      }
    },
    [deletingArtifactId, loadArtifacts, showErrorToast, showSuccessToast]
  );

  if (!emulationPlatform) {
    return <p>{t("settings_not_available_for_custom_games")}</p>;
  }

  return (
    <VerticalFocusGroup className="game-cloud-settings-tab">
      {(hasLocalSaves || emulationPlatform === "wii") && (
        <SettingsSection
          className="game-cloud-settings-tab__section"
          title={t("cloud_saves_section_title")}
          description={
            emulationPlatform === "ps1" || emulationPlatform === "ps2"
              ? t("cloud_saves_section_description_memory")
              : tSettings("cloud_saves_section_description")
          }
        >
          <div className="game-cloud-settings-tab__saves-list">
            {emulationPlatform === "wii" && (
              <Button
                focusId={`${GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID}-wii`}
                variant="secondary"
                loading={uploadingCardKey === "wii-data-bin"}
                disabled={uploadingCardKey === "wii-data-bin"}
                icon={<UploadSimpleIcon size={20} weight="bold" />}
                onClick={() => void handleWiiUpload()}
              >
                {tSettings("browse_files")}
              </Button>
            )}
            {localSaves.map((record) => {
              const key = recordKey(record);
              const uploading = uploadingCardKey === key;
              return (
                <div key={key} className="game-cloud-settings-tab__save-card">
                  <div className="game-cloud-settings-tab__save-copy">
                    <p
                      className="game-cloud-settings-tab__save-title"
                      title={record.title ?? record.folderName}
                    >
                      {record.title ?? record.folderName}
                    </p>
                    <p className="game-cloud-settings-tab__save-info">
                      {record.cardLabel} · {formatBytes(record.sizeBytes)}
                    </p>
                  </div>
                  <HorizontalFocusGroup asChild>
                    <div className="game-cloud-settings-tab__save-actions">
                      <Button
                        focusId={`${GAME_CLOUD_SETTINGS_PRIMARY_CONTROL_ID}-${key}`}
                        variant="secondary"
                        className="game-cloud-settings-tab__save-restore-button"
                        loading={uploading}
                        disabled={uploading}
                        icon={
                          uploading ? (
                            <SpinnerIcon size={20} />
                          ) : (
                            <UploadSimpleIcon size={20} weight="bold" />
                          )
                        }
                        onClick={() => handleUploadCard(record)}
                      >
                        {uploading ? "Uploading..." : t("create_backup")}
                      </Button>
                    </div>
                  </HorizontalFocusGroup>
                </div>
              );
            })}
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        className="game-cloud-settings-tab__section game-cloud-settings-tab__section--backups"
        title={t("backups")}
        description={t("cloud_saves_list_description")}
      >
        <div className="game-cloud-settings-tab__section-content game-cloud-settings-tab__section-content--backups">
          <CloudSavesList
            artifacts={artifacts}
            loading={loadingArtifacts}
            restoringArtifactId={null}
            updatingArtifactId={null}
            deletingArtifactId={deletingArtifactId}
            onRestoreArtifact={handleRestoreArtifact}
            onToggleArtifactFreeze={async () => {}}
            onDeleteArtifact={handleDeleteArtifact}
            hideFreeze
          />
        </div>
      </SettingsSection>

      <EmulationRestoreModal
        save={emulationRestoreTarget}
        platform={emulationRestoreTarget?.platform ?? emulationPlatform}
        onClose={() => setEmulationRestoreTarget(null)}
        onRestored={() => {
          setEmulationRestoreTarget(null);
          loadArtifacts().catch(() => {});
        }}
      />
    </VerticalFocusGroup>
  );
}
