import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop } from "@types";
import { logger } from "@renderer/logger";

import { Button, VerticalFocusGroup } from "../../../common";
import { ConfirmationModal } from "../../../modals";
import { SettingsSection } from "../../../../pages/settings/settings-section";
import { useBigPictureToast } from "../../../../hooks";
import { NavigationService } from "../../../../services";

const DELETE_FOCUS_ID = "game-danger-zone-my-screenshots-local";

interface MyScreenshotsDangerSectionProps {
  shop: GameShop;
  objectId: string;
  fallbackFocusId: string;
}

export function MyScreenshotsDangerSection({
  shop,
  objectId,
  fallbackFocusId,
}: Readonly<MyScreenshotsDangerSectionProps>) {
  const { t } = useTranslation("screenshots");
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [count, setCount] = useState(0);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const refreshCount = useCallback(() => {
    globalThis.window.electron
      .countLocalScreenshotFilesForGame(shop, objectId)
      .then(setCount)
      .catch((error: unknown) =>
        logger.error("Failed to count screenshots for the game", error)
      );
  }, [objectId, shop]);

  useEffect(() => {
    refreshCount();
    return globalThis.window.electron.onLocalScreenshotsChange(refreshCount);
  }, [refreshCount]);

  const confirm = async () => {
    setIsDeleting(true);
    try {
      const deleted =
        await globalThis.window.electron.deleteLocalScreenshotsForGame(
          shop,
          objectId
        );
      showSuccessToast(t("screenshots_deleted_count", { count: deleted }));
    } catch (error) {
      logger.error("Failed to delete screenshots for the game", error);
      showErrorToast(t("delete_screenshots_failed"));
    } finally {
      setIsDeleting(false);
      setIsConfirming(false);
      refreshCount();
    }
  };

  return (
    <SettingsSection
      className="game-danger-zone-settings-tab__section"
      title={t("my_screenshots")}
      description={t("screenshots_danger_zone_description", {
        ns: "big_picture",
      })}
    >
      <VerticalFocusGroup className="game-danger-zone-settings-tab__buttons">
        <Button
          focusId={DELETE_FOCUS_ID}
          variant="danger"
          className="game-danger-zone-settings-tab__action-button"
          disabled={isDeleting || count === 0}
          onClick={() => setIsConfirming(true)}
        >
          {t("delete_local_screenshots")}
        </Button>
      </VerticalFocusGroup>

      <ConfirmationModal
        visible={isConfirming}
        title={t("delete_local_screenshots_title")}
        description={t("delete_local_screenshots_description")}
        confirmLabel={t("delete")}
        cancelLabel={t("cancel")}
        danger
        loading={isDeleting}
        onClose={() => {
          if (!isDeleting) setIsConfirming(false);
        }}
        onConfirm={confirm}
        onExitComplete={() => {
          const navigation = NavigationService.getInstance();
          const focusedId = navigation.getCurrentFocusId();
          if (focusedId === null || focusedId === DELETE_FOCUS_ID) {
            navigation.requestFocusWhenAvailable(
              count > 0 ? DELETE_FOCUS_ID : fallbackFocusId
            );
          }
        }}
      />
    </SettingsSection>
  );
}
