import { useTranslation } from "react-i18next";
import type { LocalScreenshot, ProfileVisibility } from "@types";
import {
  sanitizeScreenshotDescriptionInput,
  SCREENSHOT_DESCRIPTION_MAX_LENGTH,
  SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH,
  SCREENSHOT_VISIBILITY_OPTIONS,
} from "@shared";
import { CheckboxField, InlineEditField } from "@renderer/components";
import { useFeature } from "@renderer/hooks";

import {
  ReviewSegmentedControl,
  type ReviewSegmentedOption,
} from "./review-segmented-control";
import {
  isScreenshotEditable,
  type ScreenshotReviewDraft,
} from "./screenshot-review-state";

import "./screenshot-upload-form.scss";

const VISIBILITY_LABEL_KEYS: Record<ProfileVisibility, string> = {
  PUBLIC: "visibility_public",
  FRIENDS: "visibility_friends_short",
  PRIVATE: "visibility_private",
};

interface ScreenshotReviewFieldsProps {
  screenshot: LocalScreenshot;
  draft: ScreenshotReviewDraft;
  isBusy: boolean;
  onDraftChange: (draft: ScreenshotReviewDraft) => void;
  onDraftCommit?: () => void;
}

export function ScreenshotReviewFields({
  screenshot,
  draft,
  isBusy,
  onDraftChange,
  onDraftCommit,
}: Readonly<ScreenshotReviewFieldsProps>) {
  const { t } = useTranslation("screenshots_capture");
  const { isFeatureEnabled, Feature } = useFeature();
  const isCommentsEnabled = isFeatureEnabled(Feature.ScreenshotComments);

  const isTitleEditable =
    screenshot.shop === "custom" && isScreenshotEditable(screenshot);
  const isFormDisabled = isBusy || !isScreenshotEditable(screenshot);

  const visibilityOptions: ReviewSegmentedOption<ProfileVisibility>[] =
    SCREENSHOT_VISIBILITY_OPTIONS.map((option) => ({
      value: option,
      label: t(VISIBILITY_LABEL_KEYS[option]),
    }));
  const handleDescriptionSave = (description: string) => {
    onDraftChange({ ...draft, description });
    onDraftCommit?.();
    return true;
  };

  const handleTitleSave = (customGameTitle: string) => {
    onDraftChange({ ...draft, customGameTitle: customGameTitle.trim() });
    onDraftCommit?.();
    return true;
  };

  return (
    <>
      {isTitleEditable && (
        <InlineEditField
          className="screenshot-review-item__title-field"
          label={t("custom_game_title_edit")}
          placeholder={t("custom_game_default_title")}
          initialValue={draft.customGameTitle}
          maxLength={SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH}
          allowEmpty
          disabled={isBusy}
          onSave={handleTitleSave}
        />
      )}

      <InlineEditField
        className="screenshot-review-item__description"
        label={t("description_label")}
        placeholder={t("description_add")}
        initialValue={draft.description}
        maxLength={SCREENSHOT_DESCRIPTION_MAX_LENGTH}
        sanitize={sanitizeScreenshotDescriptionInput}
        multiline
        allowEmpty
        disabled={isFormDisabled}
        onSave={handleDescriptionSave}
      />

      <ReviewSegmentedControl
        label={t("visibility_label")}
        options={visibilityOptions}
        value={draft.visibility}
        disabled={isFormDisabled}
        onChange={(visibility) => onDraftChange({ ...draft, visibility })}
      />

      <div className="screenshot-review-item__checkbox">
        <CheckboxField
          label={t("spoiler_label")}
          checked={draft.isSpoiler}
          disabled={isFormDisabled}
          onChange={(event) =>
            onDraftChange({ ...draft, isSpoiler: event.target.checked })
          }
        />
        <small className="screenshot-review-item__hint">
          {t("spoiler_hint")}
        </small>
      </div>

      {isCommentsEnabled && (
        <div className="screenshot-review-item__checkbox">
          <CheckboxField
            label={t("allow_comments", { ns: "screenshots" })}
            checked={draft.commentsEnabled}
            disabled={isFormDisabled}
            onChange={(event) =>
              onDraftChange({ ...draft, commentsEnabled: event.target.checked })
            }
          />
        </div>
      )}
    </>
  );
}
