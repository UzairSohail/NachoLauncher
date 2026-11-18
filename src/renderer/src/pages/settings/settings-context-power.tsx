import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { Button, SelectField } from "@renderer/components";
import { getTdpWattOptions, useTdpStatus, useToast } from "@renderer/hooks";

const SYSTEM_DEFAULT_VALUE = "default";

/** Global TDP limit for this device. Shown only where steamos-manager allows it. */
export function SettingsContextPower() {
  const { t } = useTranslation("tdp");
  const { status, busy, setGlobalLimit, prepare } = useTdpStatus();
  const { showErrorToast } = useToast();

  const options = useMemo(
    () => [
      {
        key: SYSTEM_DEFAULT_VALUE,
        value: SYSTEM_DEFAULT_VALUE,
        label: t("system_default"),
      },
      ...getTdpWattOptions(status?.range ?? null).map((watts) => ({
        key: String(watts),
        value: String(watts),
        label: t("watts", { watts }),
      })),
    ],
    [status?.range, t]
  );

  if (!status?.available) return null;

  const handleChange = (value: string) => {
    const watts = value === SYSTEM_DEFAULT_VALUE ? null : Number(value);
    setGlobalLimit(watts).catch(() => showErrorToast(t("error")));
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("title")}</h3>
        <p>{t("description")}</p>

        {status.range ? (
          <>
            <SelectField
              value={
                status.globalLimit === null
                  ? SYSTEM_DEFAULT_VALUE
                  : String(status.globalLimit)
              }
              options={options}
              disabled={busy}
              onChange={(event) => handleChange(event.target.value)}
            />
            <p>
              {t("range", { min: status.range.min, max: status.range.max })}
              {status.current !== null
                ? ` ${t("current", { watts: status.current })}`
                : ""}
            </p>
          </>
        ) : (
          <>
            <p>{t("enable_description")}</p>
            <div>
              <Button
                theme="outline"
                disabled={busy}
                onClick={() =>
                  prepare().catch(() => showErrorToast(t("error")))
                }
              >
                {t("enable")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
