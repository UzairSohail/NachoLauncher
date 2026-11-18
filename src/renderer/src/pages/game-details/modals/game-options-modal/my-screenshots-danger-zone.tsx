import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, ConfirmationModal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import type { GameShop } from "@types";

interface MyScreenshotsDangerZoneProps {
  shop: GameShop;
  objectId: string;
}

export function MyScreenshotsDangerZone({
  shop,
  objectId,
}: Readonly<MyScreenshotsDangerZoneProps>) {
  const { t } = useTranslation("screenshots");
  const { showSuccessToast, showErrorToast } = useToast();
  const [count, setCount] = useState(0);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const refreshCount = useCallback(() => {
    window.electron
      .countLocalScreenshotFilesForGame(shop, objectId)
      .then(setCount)
      .catch((error) =>
        logger.error("Failed to count screenshots for the game", error)
      );
  }, [objectId, shop]);

  useEffect(() => {
    refreshCount();
    return window.electron.onLocalScreenshotsChange(refreshCount);
  }, [refreshCount]);

  const confirm = async () => {
    setIsConfirming(false);
    setIsDeleting(true);
    try {
      const deleted = await window.electron.deleteLocalScreenshotsForGame(
        shop,
        objectId
      );
      showSuccessToast(t("screenshots_deleted_count", { count: deleted }));
    } catch (error) {
      logger.error("Failed to delete screenshots for the game", error);
      showErrorToast(t("delete_screenshots_failed"));
    } finally {
      setIsDeleting(false);
      refreshCount();
    }
  };

  return (
    <div className="game-options-modal__my-screenshots">
      <h3>{t("my_screenshots")}</h3>
      <div className="game-options-modal__danger-zone-buttons">
        <Button
          theme="danger"
          disabled={isDeleting || count === 0}
          onClick={() => setIsConfirming(true)}
        >
          {t("delete_local_screenshots")}
        </Button>
      </div>

      <ConfirmationModal
        visible={isConfirming}
        title={t("delete_local_screenshots_title")}
        descriptionText={t("delete_local_screenshots_description")}
        confirmButtonLabel={t("delete")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        onConfirm={() => void confirm()}
        onClose={() => setIsConfirming(false)}
      />
    </div>
  );
}
