import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon, LinkExternalIcon } from "@primer/octicons-react";

import { Button, Link, TextField } from "@renderer/components";
import { useAppSelector, useToast } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import { STEAM_GRID_DB_API_KEY_URL } from "@renderer/constants";

import { SettingsIntegrationCard } from "./settings-integration-card";

export function SettingsSteamGridDb() {
  const { t } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useToast();
  const { updateUserPreferences } = useContext(settingsContext);
  const savedKey = useAppSelector(
    (state) => state.userPreferences.value?.steamGridDbApiKey ?? ""
  );

  const [apiKey, setApiKey] = useState(savedKey);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setApiKey(savedKey);
  }, [savedKey]);

  const isConnected = Boolean(savedKey);
  const trimmedKey = apiKey.trim();

  const handleSubmit: React.FormEventHandler<HTMLFormElement> = async (
    event
  ) => {
    event.preventDefault();
    if (!trimmedKey) return;

    setIsSaving(true);
    try {
      const isValid =
        await window.electron.validateSteamGridDbApiKey(trimmedKey);
      if (!isValid) {
        showErrorToast(t("steamgriddb_settings_key_invalid"));
        return;
      }

      await updateUserPreferences({ steamGridDbApiKey: trimmedKey });
      showSuccessToast(t("steamgriddb_settings_key_saved"));
    } catch {
      showErrorToast(t("steamgriddb_settings_key_check_failed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemove = async () => {
    await updateUserPreferences({ steamGridDbApiKey: null });
    setApiKey("");
    showSuccessToast(t("steamgriddb_settings_key_removed"));
  };

  return (
    <SettingsIntegrationCard
      title={t("steamgriddb_settings_title")}
      logo={<ImageIcon size={20} />}
      status={
        isConnected
          ? t("steamgriddb_settings_connected")
          : t("steamgriddb_settings_not_connected")
      }
      statusTone={isConnected ? "success" : "neutral"}
      actions={
        isConnected ? (
          <Button theme="danger" onClick={handleRemove} disabled={isSaving}>
            {t("steamgriddb_settings_remove")}
          </Button>
        ) : undefined
      }
    >
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <p className="settings-integration-card__description">
          {t("steamgriddb_settings_description")}
        </p>
        <Link
          to={STEAM_GRID_DB_API_KEY_URL}
          style={{ display: "flex", alignItems: "center", gap: 8 }}
        >
          <LinkExternalIcon />
          {t("steamgriddb_settings_get_key")}
        </Link>
        <TextField
          label={t("api_token")}
          value={apiKey}
          type="password"
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t("api_token")}
          rightContent={
            <Button
              type="submit"
              disabled={isSaving || !trimmedKey || trimmedKey === savedKey}
            >
              {t("save_changes")}
            </Button>
          }
        />
      </form>
    </SettingsIntegrationCard>
  );
}
