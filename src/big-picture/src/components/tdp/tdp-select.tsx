import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  getTdpWattOptions,
  useTdpStatus,
} from "@renderer/hooks/use-tdp-status";
import type { GameShop } from "@types";
import { useBigPictureToast } from "../../hooks";
import type { FocusOverrides } from "../../services";
import { Button } from "../common/button";
import { DropdownSelect } from "../common/dropdown-select";

const DEFAULT_VALUE = "default";

interface TdpSelectProps {
  /** With a game, edits that game's override. Without one, the global limit. */
  game?: { shop: GameShop; objectId: string } | null;
  focusId: string;
  focusNavigationOverrides?: FocusOverrides;
  className?: string;
  label?: string;
}

/**
 * TDP limit picker for Big Picture. Renders nothing unless this device is a
 * SteamOS handheld in Desktop mode whose limits steamos-manager reports.
 */
export function TdpSelect({
  game,
  focusId,
  focusNavigationOverrides,
  className,
  label,
}: Readonly<TdpSelectProps>) {
  const { t } = useTranslation("tdp");
  const { showErrorToast } = useBigPictureToast();
  const { status, busy, setGlobalLimit, setGameLimit, prepare } = useTdpStatus({
    shop: game?.shop,
    objectId: game?.objectId,
  });

  const options = useMemo(() => {
    const globalLabel =
      status?.globalLimit != null
        ? t("watts", { watts: status.globalLimit })
        : t("system_default");

    return [
      {
        value: DEFAULT_VALUE,
        label: game
          ? t("game_use_global", { value: globalLabel })
          : t("system_default"),
      },
      ...getTdpWattOptions(status?.range ?? null).map((watts) => ({
        value: String(watts),
        label: t("watts", { watts }),
      })),
    ];
  }, [game, status?.globalLimit, status?.range, t]);

  if (!status?.available) return null;

  // Ally-style devices only report their limits in the Custom power profile.
  if (!status.range) {
    if (!status.needsCustomProfile || game) return null;
    return (
      <Button
        className={className}
        variant="secondary"
        focusId={focusId}
        focusNavigationOverrides={focusNavigationOverrides}
        loading={busy}
        onClick={() => {
          prepare().catch(() => showErrorToast(t("error")));
        }}
      >
        {t("enable")}
      </Button>
    );
  }

  const limit = game ? status.gameLimit : status.globalLimit;

  return (
    <DropdownSelect
      className={className}
      label={label ?? t(game ? "game_title" : "quick_title")}
      value={limit === null ? DEFAULT_VALUE : String(limit)}
      options={options}
      disabled={busy}
      focusId={focusId}
      focusNavigationOverrides={focusNavigationOverrides}
      onValueChange={(value) => {
        const watts = value === DEFAULT_VALUE ? null : Number(value);
        const update = game ? setGameLimit(watts) : setGlobalLimit(watts);
        update.catch(() => showErrorToast(t("error")));
      }}
    />
  );
}
