import { TrashIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";

interface ScreenshotReviewActionButtonsProps {
  isBusy: boolean;
  onRequestDelete: () => void;
}

/** Screenshots stay on this device, so the only action is deleting one. */
export function ScreenshotReviewActionButtons({
  isBusy,
  onRequestDelete,
}: Readonly<ScreenshotReviewActionButtonsProps>) {
  const { t } = useTranslation("screenshots_capture");

  return (
    <Button
      className="screenshot-review-item__delete"
      theme="danger"
      disabled={isBusy}
      tooltip={t("delete")}
      aria-label={t("delete")}
      onClick={onRequestDelete}
    >
      <TrashIcon size={16} />
    </Button>
  );
}
