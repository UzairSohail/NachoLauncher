import {
  ArrowsClockwiseIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react";
import type { GameShop } from "@types";
import { formatBytes } from "@shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { usePersonalCloudGame } from "@renderer/pages/game-details/personal-cloud/use-personal-cloud-game";

import { useBigPictureToast, useDate } from "../../../../hooks";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import {
  Button,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../../common";
import { ConfirmationModal } from "../../../modals";

import "./personal-cloud-tab.scss";

/*
 * The Google Drive (Cloud Save Manager) save backups for a PC game, the same
 * as the desktop game options' Google Drive panel.
 */

export const GAME_PERSONAL_CLOUD_PRIMARY_CONTROL_ID =
  "game-personal-cloud-primary";
const versionRestoreId = (id: string) => `game-personal-cloud-restore:${id}`;
const versionDeleteId = (id: string) => `game-personal-cloud-delete:${id}`;

interface PendingConfirmation {
  description: string;
  action: () => Promise<unknown>;
  successMessage?: string;
  danger?: boolean;
}

interface GamePersonalCloudSettingsTabProps {
  shop: GameShop;
  objectId: string;
  executablePath?: string | null;
  onSelectExecutable: () => void;
}

export function GamePersonalCloudSettingsTab({
  shop,
  objectId,
  executablePath,
  onSelectExecutable,
}: Readonly<GamePersonalCloudSettingsTabProps>) {
  const { t } = useTranslation("personal_cloud");
  const { formatDateTime } = useDate();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const { state, isLoading, isBusy, error, run } = usePersonalCloudGame(
    shop,
    objectId,
    executablePath
  );
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(
    null
  );
  const [unclear, setUnclear] = useState<string[]>([]);

  const perform = async (
    action: () => Promise<unknown>,
    successMessage?: string
  ) => {
    try {
      await run(action);
      if (successMessage) showSuccessToast(successMessage);
    } catch (err) {
      showErrorToast(
        t("action_failed", {
          message: err instanceof Error ? err.message : String(err),
        })
      );
    }
  };

  const signIn = () =>
    run(() => globalThis.window.electron.signInPersonalCloud()).catch(() =>
      showErrorToast(t("sign_in_failed"))
    );

  const chooseSaveFolder = () =>
    perform(() =>
      globalThis.window.electron.choosePersonalCloudSaveFolder(shop, objectId)
    );

  const syncNow = () =>
    perform(async () => {
      const result = await globalThis.window.electron.syncPersonalCloudGame(
        shop,
        objectId
      );
      setUnclear(result.unclear);
    });

  const note = (text: string) => (
    <p className="game-personal-cloud-tab__note">{text}</p>
  );

  const renderBody = () => {
    if (!state && isLoading) return note(t("checking"));
    if (error && !state) return note(error);

    if (!state?.status.signedIn) {
      return (
        <>
          {note(t("sign_in_to_use"))}
          <Button
            focusId={GAME_PERSONAL_CLOUD_PRIMARY_CONTROL_ID}
            loading={isBusy}
            onClick={() => void signIn()}
          >
            {isBusy ? t("signing_in") : t("sign_in")}
          </Button>
        </>
      );
    }

    if (!executablePath) {
      return (
        <>
          {note(t("needs_executable"))}
          <Button
            variant="secondary"
            focusId={GAME_PERSONAL_CLOUD_PRIMARY_CONTROL_ID}
            onClick={onSelectExecutable}
          >
            {t("choose_executable")}
          </Button>
        </>
      );
    }

    const info = state.info;
    if (!info) return note(t("unsupported"));

    if (!info.inCatalogue) {
      return (
        <>
          {note(
            unclear.length > 0
              ? t("unclear_folders", { folders: unclear.join(", ") })
              : t("learning")
          )}
          <Button
            variant="secondary"
            focusId={GAME_PERSONAL_CLOUD_PRIMARY_CONTROL_ID}
            icon={<FolderOpenIcon size={18} />}
            disabled={isBusy}
            onClick={() => void chooseSaveFolder()}
          >
            {t("choose_save_folder")}
          </Button>
        </>
      );
    }

    return (
      <>
        <div className="game-personal-cloud-tab__summary">
          <span
            className={`game-personal-cloud-tab__status game-personal-cloud-tab__status--${info.status}`}
          >
            {state.status.paused
              ? t("paused")
              : t(`status_${info.status}`, { defaultValue: info.statusLabel })}
          </span>
          {info.saveLocation && (
            <span className="game-personal-cloud-tab__meta">
              {t("save_location")}: {info.saveLocation}
            </span>
          )}
          {info.localFiles > 0 && (
            <span className="game-personal-cloud-tab__meta">
              {t("local_files", {
                count: info.localFiles,
                size: formatBytes(info.localBytes),
              })}
            </span>
          )}
        </div>

        <HorizontalFocusGroup asChild>
          <div className="game-personal-cloud-tab__actions">
            <Button
              focusId={GAME_PERSONAL_CLOUD_PRIMARY_CONTROL_ID}
              icon={<ArrowsClockwiseIcon size={18} />}
              loading={isBusy}
              disabled={isBusy || state.status.paused}
              onClick={() => void syncNow()}
            >
              {isBusy ? t("syncing") : t("sync_now")}
            </Button>
            <Button
              variant="secondary"
              icon={<CloudArrowUpIcon size={18} />}
              disabled={isBusy}
              onClick={() =>
                setConfirmation({
                  description: t("force_upload_confirm"),
                  action: () =>
                    globalThis.window.electron.forcePersonalCloudUpload(
                      shop,
                      objectId
                    ),
                  successMessage: t("force_upload_done"),
                })
              }
            >
              {t("force_upload")}
            </Button>
            <Button
              variant="secondary"
              icon={<CloudArrowDownIcon size={18} />}
              disabled={isBusy || info.versions.length === 0}
              onClick={() =>
                setConfirmation({
                  description: t("force_download_confirm"),
                  action: () =>
                    globalThis.window.electron.forcePersonalCloudDownload(
                      shop,
                      objectId
                    ),
                  successMessage: t("force_download_done"),
                })
              }
            >
              {t("force_download")}
            </Button>
            <Button
              variant="secondary"
              icon={<FolderOpenIcon size={18} />}
              disabled={isBusy}
              onClick={() => void chooseSaveFolder()}
            >
              {t("choose_save_folder")}
            </Button>
          </div>
        </HorizontalFocusGroup>

        <h3 className="game-personal-cloud-tab__heading">{t("versions")}</h3>
        {info.versions.length === 0 ? (
          note(t("no_versions"))
        ) : (
          <VerticalFocusGroup asChild>
            <ul className="game-personal-cloud-tab__versions">
              {info.versions.map((version) => (
                <li
                  key={version.id}
                  className="game-personal-cloud-tab__version"
                >
                  <span className="game-personal-cloud-tab__version-text">
                    {t("version_details", {
                      device: version.device,
                      date: formatDateTime(version.createdMs),
                      size: formatBytes(version.size),
                    })}
                    {version.isCurrent && (
                      <span className="game-personal-cloud-tab__badge">
                        {t("current")}
                      </span>
                    )}
                  </span>
                  {!version.isCurrent && (
                    <HorizontalFocusGroup asChild>
                      <div className="game-personal-cloud-tab__version-actions">
                        <Button
                          variant="secondary"
                          size="small"
                          focusId={versionRestoreId(version.id)}
                          disabled={isBusy}
                          onClick={() =>
                            setConfirmation({
                              description: t("restore_confirm"),
                              successMessage: t("restore_done", {
                                date: formatDateTime(version.createdMs),
                              }),
                              action: () =>
                                globalThis.window.electron.restorePersonalCloudVersion(
                                  shop,
                                  objectId,
                                  version.id
                                ),
                            })
                          }
                        >
                          {t("restore")}
                        </Button>
                        <Button
                          variant="danger"
                          size="small"
                          focusId={versionDeleteId(version.id)}
                          disabled={isBusy}
                          onClick={() =>
                            setConfirmation({
                              description: t("delete_confirm"),
                              danger: true,
                              action: () =>
                                globalThis.window.electron.deletePersonalCloudVersion(
                                  shop,
                                  objectId,
                                  version.id
                                ),
                            })
                          }
                        >
                          {t("delete")}
                        </Button>
                      </div>
                    </HorizontalFocusGroup>
                  )}
                </li>
              ))}
            </ul>
          </VerticalFocusGroup>
        )}
      </>
    );
  };

  return (
    <div className="game-personal-cloud-tab">
      <SettingsSection title={t("title")} description={t("panel_description")}>
        <VerticalFocusGroup asChild>
          <div className="game-personal-cloud-tab__content">{renderBody()}</div>
        </VerticalFocusGroup>
      </SettingsSection>

      <ConfirmationModal
        visible={confirmation !== null}
        title={t("title")}
        description={confirmation?.description ?? ""}
        confirmLabel={t("confirm")}
        cancelLabel={t("cancel")}
        danger={confirmation?.danger}
        onClose={() => setConfirmation(null)}
        onConfirm={() => {
          const pending = confirmation;
          setConfirmation(null);
          if (pending) void perform(pending.action, pending.successMessage);
        }}
      />
    </div>
  );
}
