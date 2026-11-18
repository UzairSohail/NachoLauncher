import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { SelectField } from "@renderer/components";
import { getTdpWattOptions, useTdpStatus, useToast } from "@renderer/hooks";
import type { GameShop } from "@types";

const USE_GLOBAL_VALUE = "global";

interface GameTdpSectionProps {
  shop: GameShop;
  objectId: string;
}

/** Per-game TDP override. Renders nothing where TDP control isn't available. */
export function GameTdpSection({
  shop,
  objectId,
}: Readonly<GameTdpSectionProps>) {
  const { t } = useTranslation("tdp");
  const { status, busy, setGameLimit } = useTdpStatus({ shop, objectId });
  const { showErrorToast } = useToast();

  const options = useMemo(() => {
    const globalLabel =
      status?.globalLimit != null
        ? t("watts", { watts: status.globalLimit })
        : t("system_default");

    return [
      {
        key: USE_GLOBAL_VALUE,
        value: USE_GLOBAL_VALUE,
        label: t("game_use_global", { value: globalLabel }),
      },
      ...getTdpWattOptions(status?.range ?? null).map((watts) => ({
        key: String(watts),
        value: String(watts),
        label: t("watts", { watts }),
      })),
    ];
  }, [status?.globalLimit, status?.range, t]);

  if (!status?.available || !status.range) return null;

  const isActive =
    status.gameLimit !== null && status.activeGameKey === `${shop}:${objectId}`;

  return (
    <div className="game-options-modal__section">
      <div className="game-options-modal__header">
        <h2>{t("game_title")}</h2>
        <h4 className="game-options-modal__header-description">
          {t("game_description")}
          {isActive ? ` ${t("game_active")}` : ""}
        </h4>
      </div>
      <SelectField
        theme="dark"
        value={
          status.gameLimit === null
            ? USE_GLOBAL_VALUE
            : String(status.gameLimit)
        }
        options={options}
        disabled={busy}
        onChange={(event) => {
          const value = event.target.value;
          setGameLimit(value === USE_GLOBAL_VALUE ? null : Number(value)).catch(
            () => showErrorToast(t("error"))
          );
        }}
      />
    </div>
  );
}
