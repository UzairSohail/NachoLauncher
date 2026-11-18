import "./content.scss";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowCounterClockwiseIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react";

import {
  Button,
  Checkbox,
  FocusItem,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../components";
import { Feature, useFeature, useUserPreferences } from "../../hooks";
import type { FocusOverrides } from "../../services";
import {
  CONTENT_ITEM_FOCUS_IDS,
  CONTENT_SECTION_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
} from "./settings-navigation";
import { SettingsSection } from "./settings-section";
import type { UserPreferences } from "@types";

interface SettingsSectionProps {
  className?: string;
}

interface ContentForm {
  autoplayGameTrailers: boolean;
  disableNsfwAlert: boolean;
  showSensitiveScreenshots: boolean;
  showHiddenAchievementsDescription: boolean;
  enableSteamAchievements: boolean;
  autoplayAnimatedArtwork: boolean;
  persistFiltersAndSorting: boolean;
}

interface ContentItem {
  id: string;
  focusId: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const DEFAULT_FORM: ContentForm = {
  autoplayGameTrailers: true,
  disableNsfwAlert: false,
  showSensitiveScreenshots: false,
  showHiddenAchievementsDescription: false,
  enableSteamAchievements: false,
  autoplayAnimatedArtwork: false,
  persistFiltersAndSorting: false,
};

const buildForm = (preferences: UserPreferences | null): ContentForm =>
  preferences
    ? {
        autoplayGameTrailers: preferences.autoplayGameTrailers ?? true,
        disableNsfwAlert: preferences.disableNsfwAlert ?? false,
        showSensitiveScreenshots: preferences.showSensitiveScreenshots ?? false,
        showHiddenAchievementsDescription:
          preferences.showHiddenAchievementsDescription ?? false,
        enableSteamAchievements: preferences.enableSteamAchievements ?? false,
        autoplayAnimatedArtwork: preferences.autoplayAnimatedArtwork ?? false,
        persistFiltersAndSorting: preferences.persistFiltersAndSorting ?? false,
      }
    : DEFAULT_FORM;

export function ContentSettingsSection({
  className,
}: Readonly<SettingsSectionProps>) {
  const { t } = useTranslation("settings");
  const userPreferences = useUserPreferences();
  const { isFeatureEnabled } = useFeature();
  const isScreenshotsEnabled = isFeatureEnabled(Feature.Screenshots);
  const [form, setForm] = useState<ContentForm>(() =>
    buildForm(userPreferences)
  );
  const [screenshotsPath, setScreenshotsPath] = useState("");

  useEffect(() => {
    void globalThis.window.electron
      .getScreenshotsPath()
      .then(setScreenshotsPath);
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const updateUserPreferences = useCallback(
    async (values: Partial<ContentForm>) => {
      setForm((currentForm) => ({ ...currentForm, ...values }));

      await globalThis.window.electron.updateUserPreferences(values);
    },
    []
  );

  const handleChooseScreenshotsPath = useCallback(async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      defaultPath: screenshotsPath || undefined,
      properties: ["openDirectory"],
    });
    const selectedPath = result.filePaths[0];

    if (result.canceled || !selectedPath) return;

    setScreenshotsPath(selectedPath);
    await globalThis.window.electron.updateUserPreferences({
      achievementScreenshotsPath: selectedPath,
    });
  }, [screenshotsPath]);

  const handleOpenScreenshotsPath = useCallback(async () => {
    const currentPath =
      screenshotsPath ||
      (await globalThis.window.electron.getScreenshotsPath());
    await globalThis.window.electron.openFolder(currentPath);
  }, [screenshotsPath]);

  const handleResetScreenshotsPath = useCallback(async () => {
    await globalThis.window.electron.updateUserPreferences({
      achievementScreenshotsPath: undefined,
    });
    setScreenshotsPath(await globalThis.window.electron.getScreenshotsPath());
  }, []);

  const items = useMemo<ContentItem[]>(() => {
    return [
      {
        id: "autoplay-game-trailers",
        focusId: CONTENT_ITEM_FOCUS_IDS.autoplayGameTrailers,
        label: t("autoplay_trailers_on_game_page"),
        checked: form.autoplayGameTrailers,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ autoplayGameTrailers: checked }),
      },
      {
        id: "disable-nsfw-alert",
        focusId: CONTENT_ITEM_FOCUS_IDS.disableNsfwAlert,
        label: t("disable_nsfw_alert"),
        checked: form.disableNsfwAlert,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ disableNsfwAlert: checked }),
      },
      ...(isScreenshotsEnabled
        ? [
            {
              id: "show-sensitive-screenshots",
              focusId: CONTENT_ITEM_FOCUS_IDS.showSensitiveScreenshots,
              label: t("screenshots_show_sensitive"),
              checked: form.showSensitiveScreenshots,
              onChange: (checked: boolean) =>
                void updateUserPreferences({
                  showSensitiveScreenshots: checked,
                }),
            },
          ]
        : []),
      {
        id: "show-hidden-achievements-description",
        focusId: CONTENT_ITEM_FOCUS_IDS.showHiddenAchievementsDescription,
        label: t("show_hidden_achievement_description"),
        checked: form.showHiddenAchievementsDescription,
        onChange: (checked: boolean) =>
          void updateUserPreferences({
            showHiddenAchievementsDescription: checked,
          }),
      },
      {
        id: "persist-filters-and-sorting",
        focusId: CONTENT_ITEM_FOCUS_IDS.persistFiltersAndSorting,
        label: t("persist_filters_and_sorting"),
        checked: form.persistFiltersAndSorting,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ persistFiltersAndSorting: checked }),
      },
      {
        id: "enable-steam-achievements",
        focusId: CONTENT_ITEM_FOCUS_IDS.enableSteamAchievements,
        label: t("enable_steam_achievements"),
        checked: form.enableSteamAchievements,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ enableSteamAchievements: checked }),
      },
    ];
  }, [form, isScreenshotsEnabled, t, updateUserPreferences]);

  const trailingItems = useMemo<ContentItem[]>(
    () => [
      {
        id: "autoplay-animated-artwork",
        focusId: CONTENT_ITEM_FOCUS_IDS.autoplayAnimatedArtwork,
        label: t("autoplay_animated_artwork"),
        checked: form.autoplayAnimatedArtwork,
        onChange: (checked: boolean) =>
          void updateUserPreferences({ autoplayAnimatedArtwork: checked }),
      },
    ],
    [form.autoplayAnimatedArtwork, t, updateUserPreferences]
  );

  const hasCustomScreenshotsPath = Boolean(
    userPreferences?.achievementScreenshotsPath
  );

  const navigationFocusIds = useMemo(
    () => [
      ...items.map((item) => item.focusId),
      CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory,
      ...trailingItems.map((item) => item.focusId),
    ],
    [items, trailingItems]
  );

  const navigationOverridesByFocusId = useMemo<
    Record<string, FocusOverrides>
  >(() => {
    return Object.fromEntries(
      navigationFocusIds.map((focusId, index) => {
        const previousFocusId = navigationFocusIds[index - 1];
        const nextFocusId = navigationFocusIds[index + 1];

        return [
          focusId,
          {
            up: previousFocusId
              ? {
                  type: "item",
                  itemId: previousFocusId,
                }
              : SETTINGS_HEADER_RETURN_TARGET,
            down: nextFocusId
              ? {
                  type: "item",
                  itemId: nextFocusId,
                }
              : {
                  type: "block",
                },
          } satisfies FocusOverrides,
        ];
      })
    );
  }, [navigationFocusIds]);

  const renderItem = (item: ContentItem) => (
    <Checkbox
      key={item.id}
      id={item.id}
      label={item.label}
      checked={item.checked}
      focusId={item.focusId}
      navigationOverrides={navigationOverridesByFocusId[item.focusId]}
      block
      onChange={item.onChange}
    />
  );

  return (
    <div
      className={
        className
          ? `content-settings-section ${className}`
          : "content-settings-section"
      }
    >
      <SettingsSection
        title="Preferences"
        description="Choose how Nacho should handle trailers, content warnings, and achievement details."
      >
        <VerticalFocusGroup regionId={CONTENT_SECTION_REGION_ID} asChild>
          <div className="content-settings-section__content">
            {items.map(renderItem)}

            <div className="content-settings-section__screenshots-directory">
              <span className="content-settings-section__screenshots-label">
                {t("screenshots_directory")}
              </span>
              <HorizontalFocusGroup
                className="content-settings-section__screenshots-path-group"
                asChild
              >
                <div>
                  <FocusItem
                    id={CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory}
                    actions={{
                      primary: () => void handleChooseScreenshotsPath(),
                    }}
                    navigationOverrides={
                      navigationOverridesByFocusId[
                        CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory
                      ]
                    }
                    asChild
                  >
                    <button
                      type="button"
                      className="content-settings-section__screenshots-path"
                      title={screenshotsPath}
                      onClick={() => void handleChooseScreenshotsPath()}
                    >
                      {screenshotsPath}
                    </button>
                  </FocusItem>

                  {hasCustomScreenshotsPath && (
                    <Button
                      variant="secondary"
                      size="icon"
                      focusId={CONTENT_ITEM_FOCUS_IDS.resetScreenshotsDirectory}
                      aria-label={t("reset_screenshots_directory")}
                      title={t("reset_screenshots_directory")}
                      icon={<ArrowCounterClockwiseIcon size={18} />}
                      focusNavigationOverrides={{
                        left: {
                          type: "item",
                          itemId:
                            CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory,
                        },
                        right: {
                          type: "item",
                          itemId:
                            CONTENT_ITEM_FOCUS_IDS.openScreenshotsDirectory,
                        },
                        ...navigationOverridesByFocusId[
                          CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory
                        ],
                      }}
                      onClick={() => void handleResetScreenshotsPath()}
                    >
                      {""}
                    </Button>
                  )}

                  <Button
                    variant="secondary"
                    focusId={CONTENT_ITEM_FOCUS_IDS.openScreenshotsDirectory}
                    icon={<FolderOpenIcon size={18} />}
                    focusNavigationOverrides={{
                      ...navigationOverridesByFocusId[
                        CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory
                      ],
                      left: {
                        type: "item",
                        itemId: hasCustomScreenshotsPath
                          ? CONTENT_ITEM_FOCUS_IDS.resetScreenshotsDirectory
                          : CONTENT_ITEM_FOCUS_IDS.changeScreenshotsDirectory,
                      },
                      right: { type: "block" },
                    }}
                    onClick={() => void handleOpenScreenshotsPath()}
                  >
                    {t("open_screenshots_directory")}
                  </Button>
                </div>
              </HorizontalFocusGroup>
            </div>

            {trailingItems.map(renderItem)}
          </div>
        </VerticalFocusGroup>
      </SettingsSection>
    </div>
  );
}
