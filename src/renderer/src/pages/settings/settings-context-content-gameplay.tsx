import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, CheckboxField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector, useFeature } from "@renderer/hooks";
import { FileDirectoryIcon, HistoryIcon } from "@primer/octicons-react";
import type { UserPreferences } from "@types";

import "./settings-context-content-gameplay.scss";

const buildForm = (preferences: UserPreferences | null) => ({
  autoplayGameTrailers: preferences?.autoplayGameTrailers ?? true,
  disableNsfwAlert: preferences?.disableNsfwAlert ?? false,
  showSensitiveScreenshots: preferences?.showSensitiveScreenshots ?? false,
  showHiddenAchievementsDescription:
    preferences?.showHiddenAchievementsDescription ?? false,
  enableSteamAchievements: preferences?.enableSteamAchievements ?? false,
  enableNewDownloadOptionsBadges:
    preferences?.enableNewDownloadOptionsBadges ?? true,
  hideClassicsBookmark: preferences?.hideClassicsBookmark ?? false,
  classicsUseHeroLayout: preferences?.classicsUseHeroLayout ?? false,
  hideLibraryGameBadges: preferences?.hideLibraryGameBadges ?? false,
  hideLibraryReadySizeBadges: preferences?.hideLibraryReadySizeBadges ?? false,
  hideLibraryClassicsBadges: preferences?.hideLibraryClassicsBadges ?? false,
  hideSteamLibraryBadges: preferences?.hideSteamLibraryBadges ?? false,
  hideEpicLibraryBadges: preferences?.hideEpicLibraryBadges ?? false,
  hideLibraryAchievementProgress:
    preferences?.hideLibraryAchievementProgress ?? false,
  autoplayAnimatedArtwork: preferences?.autoplayAnimatedArtwork ?? false,
  persistFiltersAndSorting: preferences?.persistFiltersAndSorting ?? false,
});

export function SettingsContextContentGameplay() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const { isFeatureEnabled, Feature } = useFeature();
  const isScreenshotsEnabled = isFeatureEnabled(Feature.Screenshots);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState(() => buildForm(userPreferences));
  const [screenshotsPath, setScreenshotsPath] = useState("");

  useEffect(() => {
    void window.electron.getScreenshotsPath().then(setScreenshotsPath);
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const handleChooseScreenshotsPath = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      defaultPath: screenshotsPath || undefined,
      properties: ["openDirectory"],
    });
    const selectedPath = filePaths[0];

    if (canceled || !selectedPath) return;

    setScreenshotsPath(selectedPath);
    await updateUserPreferences({
      achievementScreenshotsPath: selectedPath,
    });
  };

  const handleOpenScreenshotsPath = async () => {
    const currentPath =
      screenshotsPath || (await window.electron.getScreenshotsPath());
    await window.electron.openFolder(currentPath);
  };

  const handleResetScreenshotsPath = async () => {
    await updateUserPreferences({ achievementScreenshotsPath: undefined });
    setScreenshotsPath(await window.electron.getScreenshotsPath());
  };

  const hasCustomScreenshotsPath = Boolean(
    userPreferences?.achievementScreenshotsPath
  );

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("content_preferences")}</h3>

        <CheckboxField
          label={t("autoplay_trailers_on_game_page")}
          checked={form.autoplayGameTrailers}
          onChange={() =>
            handleChange({
              autoplayGameTrailers: !form.autoplayGameTrailers,
            })
          }
        />

        <CheckboxField
          label={t("disable_nsfw_alert")}
          checked={form.disableNsfwAlert}
          onChange={() =>
            handleChange({ disableNsfwAlert: !form.disableNsfwAlert })
          }
        />

        {isScreenshotsEnabled && (
          <CheckboxField
            label={t("screenshots_show_sensitive")}
            checked={form.showSensitiveScreenshots}
            onChange={() =>
              handleChange({
                showSensitiveScreenshots: !form.showSensitiveScreenshots,
              })
            }
          />
        )}

        <CheckboxField
          label={t("show_hidden_achievement_description")}
          checked={form.showHiddenAchievementsDescription}
          onChange={() =>
            handleChange({
              showHiddenAchievementsDescription:
                !form.showHiddenAchievementsDescription,
            })
          }
        />

        <CheckboxField
          label={t("enable_new_download_options_badges")}
          checked={form.enableNewDownloadOptionsBadges}
          onChange={() =>
            handleChange({
              enableNewDownloadOptionsBadges:
                !form.enableNewDownloadOptionsBadges,
            })
          }
        />

        <CheckboxField
          label={t("persist_filters_and_sorting")}
          checked={form.persistFiltersAndSorting}
          onChange={() =>
            handleChange({
              persistFiltersAndSorting: !form.persistFiltersAndSorting,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("gameplay_metadata")}</h3>

        <CheckboxField
          label={t("enable_steam_achievements")}
          checked={form.enableSteamAchievements}
          onChange={() =>
            handleChange({
              enableSteamAchievements: !form.enableSteamAchievements,
            })
          }
        />

        <div className="settings-context-content-gameplay__screenshots-directory">
          <TextField
            label={t("screenshots_directory")}
            value={screenshotsPath}
            readOnly
            disabled
            rightContent={
              <>
                <Button theme="outline" onClick={handleChooseScreenshotsPath}>
                  <FileDirectoryIcon size={14} />
                  {t("change_screenshots_directory")}
                </Button>
                {hasCustomScreenshotsPath && (
                  <Button
                    className="settings-context-content-gameplay__reset-screenshots-button"
                    theme="outline"
                    tooltip={t("reset_screenshots_directory")}
                    aria-label={t("reset_screenshots_directory")}
                    onClick={handleResetScreenshotsPath}
                  >
                    <HistoryIcon size={14} />
                  </Button>
                )}
              </>
            }
          />

          <Button
            className="settings-context-content-gameplay__open-screenshots-button"
            theme="outline"
            onClick={handleOpenScreenshotsPath}
          >
            <FileDirectoryIcon size={14} />
            {t("open_screenshots_directory")}
          </Button>
        </div>
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("library_appearance")}</h3>

        <CheckboxField
          label={t("hide_library_game_badges")}
          checked={form.hideLibraryGameBadges}
          onChange={() =>
            handleChange({
              hideLibraryGameBadges: !form.hideLibraryGameBadges,
            })
          }
        />

        <CheckboxField
          label={t("hide_library_ready_size_badges")}
          checked={form.hideLibraryReadySizeBadges}
          onChange={() =>
            handleChange({
              hideLibraryReadySizeBadges: !form.hideLibraryReadySizeBadges,
            })
          }
        />

        <CheckboxField
          label={t("hide_library_classics_badges")}
          checked={form.hideLibraryClassicsBadges}
          onChange={() =>
            handleChange({
              hideLibraryClassicsBadges: !form.hideLibraryClassicsBadges,
            })
          }
        />

        <CheckboxField
          label={t("hide_library_steam_badges")}
          checked={form.hideSteamLibraryBadges}
          onChange={() =>
            handleChange({
              hideSteamLibraryBadges: !form.hideSteamLibraryBadges,
            })
          }
        />

        <CheckboxField
          label={t("hide_library_epic_badges")}
          checked={form.hideEpicLibraryBadges}
          onChange={() =>
            handleChange({ hideEpicLibraryBadges: !form.hideEpicLibraryBadges })
          }
        />

        <CheckboxField
          label={t("hide_library_achievement_progress")}
          checked={form.hideLibraryAchievementProgress}
          onChange={() =>
            handleChange({
              hideLibraryAchievementProgress:
                !form.hideLibraryAchievementProgress,
            })
          }
        />

        <CheckboxField
          label={t("autoplay_animated_artwork")}
          checked={form.autoplayAnimatedArtwork}
          onChange={() =>
            handleChange({
              autoplayAnimatedArtwork: !form.autoplayAnimatedArtwork,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("classics_appearance")}</h3>

        <CheckboxField
          label={t("hide_classics_bookmark")}
          checked={form.hideClassicsBookmark}
          onChange={() =>
            handleChange({
              hideClassicsBookmark: !form.hideClassicsBookmark,
            })
          }
        />

        <CheckboxField
          label={t("classics_use_hero_layout")}
          checked={form.classicsUseHeroLayout}
          onChange={() =>
            handleChange({
              classicsUseHeroLayout: !form.classicsUseHeroLayout,
            })
          }
        />
      </div>
    </div>
  );
}
