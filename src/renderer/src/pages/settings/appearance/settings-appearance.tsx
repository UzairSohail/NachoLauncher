import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckCircleFillIcon } from "@primer/octicons-react";
import type { Theme } from "@types";
import { injectCustomCss, removeCustomCss } from "@renderer/helpers";
import { useToast } from "@renderer/hooks";
import { levelDBService } from "@renderer/services/leveldb.service";
import {
  PRESET_THEMES,
  buildThemeCss,
  getPresetTheme,
  type ThemePalette,
} from "@renderer/theme-presets";
import "./settings-appearance.scss";

const DEFAULT_PALETTE: ThemePalette = {
  background: "#121212",
  darkBackground: "#0d0d0d",
  border: "rgba(255, 255, 255, 0.08)",
  text: "#d0d1d7",
  accent: "#f0f1f7",
  accentText: "#0d0d0d",
};

interface ThemeOptionProps {
  name: string;
  description: string;
  palette: ThemePalette;
  selected: boolean;
  disabled: boolean;
  selectedLabel: string;
  onSelect: () => void;
}

function ThemeOption({
  name,
  description,
  palette,
  selected,
  disabled,
  selectedLabel,
  onSelect,
}: Readonly<ThemeOptionProps>) {
  return (
    <button
      type="button"
      className={`settings-appearance__option${
        selected ? " settings-appearance__option--selected" : ""
      }`}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
    >
      <div
        className="settings-appearance__preview"
        style={{ backgroundColor: palette.darkBackground }}
        aria-hidden
      >
        <div
          className="settings-appearance__preview-sidebar"
          style={{
            backgroundColor: palette.darkBackground,
            borderColor: palette.border,
          }}
        >
          <span style={{ backgroundColor: palette.accent }} />
          <span style={{ backgroundColor: palette.border }} />
          <span style={{ backgroundColor: palette.border }} />
        </div>
        <div
          className="settings-appearance__preview-content"
          style={{
            background: `linear-gradient(0deg, ${palette.darkBackground} 30%, ${palette.background} 100%)`,
          }}
        >
          <span
            className="settings-appearance__preview-card"
            style={{
              backgroundColor: palette.background,
              borderColor: palette.border,
            }}
          />
          <span
            className="settings-appearance__preview-button"
            style={{ backgroundColor: palette.accent }}
          />
        </div>
      </div>

      <div className="settings-appearance__option-info">
        <div className="settings-appearance__option-title">
          <span>{name}</span>
          {selected && (
            <span className="settings-appearance__option-selected">
              <CheckCircleFillIcon size={14} />
              {selectedLabel}
            </span>
          )}
        </div>
        <p className="settings-appearance__option-description">{description}</p>
      </div>
    </button>
  );
}

export function SettingsAppearance() {
  const { t } = useTranslation("settings");
  const { showErrorToast } = useToast();

  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const loadActiveTheme = useCallback(async () => {
    const themes = (await levelDBService.values("themes")) as Theme[];
    setActiveThemeId(themes.find((theme) => theme.isActive)?.id ?? null);
  }, []);

  useEffect(() => {
    loadActiveTheme();
  }, [loadActiveTheme]);

  useEffect(() => {
    const unsubscribe = window.electron.onCustomThemeUpdated(() => {
      loadActiveTheme();
    });

    return () => unsubscribe();
  }, [loadActiveTheme]);

  const applyTheme = async (presetId: string | null) => {
    if (isApplying || presetId === activeThemeId) return;

    setIsApplying(true);
    try {
      const themes = (await levelDBService.values("themes")) as Theme[];

      for (const theme of themes) {
        if (theme.isActive && theme.id !== presetId) {
          await window.electron.toggleCustomTheme(theme.id, false);
        }
      }

      const preset = getPresetTheme(presetId);

      if (preset) {
        const code = buildThemeCss(preset.palette);
        const stored = themes.find((theme) => theme.id === preset.id);

        if (!stored) {
          const now = new Date();
          await window.electron.addCustomTheme({
            id: preset.id,
            name: preset.name,
            code,
            isActive: false,
            createdAt: now,
            updatedAt: now,
          });
        }

        await window.electron.toggleCustomTheme(preset.id, true);
        injectCustomCss(code);
      } else {
        removeCustomCss();
      }

      setActiveThemeId(preset?.id ?? null);
    } catch (error) {
      console.error(error);
      showErrorToast(t("theme_apply_failed"));
      await loadActiveTheme();
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="settings-appearance">
      <p className="settings-appearance__description">
        {t("appearance_description")}
      </p>

      <div className="settings-appearance__grid">
        <ThemeOption
          name={t("theme_default")}
          description={t("theme_default_description")}
          palette={DEFAULT_PALETTE}
          selected={activeThemeId === null}
          disabled={isApplying}
          selectedLabel={t("theme_selected")}
          onSelect={() => applyTheme(null)}
        />

        {PRESET_THEMES.map((preset) => (
          <ThemeOption
            key={preset.id}
            name={preset.name}
            description={preset.description}
            palette={preset.palette}
            selected={activeThemeId === preset.id}
            disabled={isApplying}
            selectedLabel={t("theme_selected")}
            onSelect={() => applyTheme(preset.id)}
          />
        ))}
      </div>
    </div>
  );
}
