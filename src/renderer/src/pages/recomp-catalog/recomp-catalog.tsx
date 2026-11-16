import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { SyncIcon } from "@primer/octicons-react";
import cn from "classnames";

import {
  getRecompOriginName,
  getRecompilationOs,
  normalizeGameTitle,
  type RecompCatalogItem,
} from "@shared";
import { Button } from "@renderer/components/button/button";
import { SelectField } from "@renderer/components/select-field/select-field";
import { TextField } from "@renderer/components/text-field/text-field";
import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { useToast } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  buildRecompilationPath,
  findCatalogueGameForRecomp,
} from "../recompilation/recompilations-api";
import "./recomp-catalog.scss";

type SortKey = "popular" | "newest" | "name";

const ALL_CONSOLES = "all";

const sorters: Record<
  SortKey,
  (left: RecompCatalogItem, right: RecompCatalogItem) => number
> = {
  popular: (left, right) =>
    right.downloads - left.downloads || right.stars - left.stars,
  newest: (left, right) =>
    (right.released ?? "").localeCompare(left.released ?? ""),
  name: (left, right) => left.name.localeCompare(right.name),
};

const searchText = (item: RecompCatalogItem) =>
  normalizeGameTitle(
    [item.name, item.game, item.author, getRecompOriginName(item.origin)]
      .filter(Boolean)
      .join(" ")
  );

export default function RecompCatalog() {
  const { t } = useTranslation("recomp_catalog");
  const navigate = useNavigate();
  const { showErrorToast } = useToast();

  const [items, setItems] = useState<RecompCatalogItem[] | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [consoleFilter, setConsoleFilter] = useState(ALL_CONSOLES);
  const [sort, setSort] = useState<SortKey>("popular");
  const [onlyMySystem, setOnlyMySystem] = useState(true);
  const [openingSlug, setOpeningSlug] = useState<string | null>(null);

  const load = useCallback((force = false) => {
    setIsRefreshing(force);
    return window.electron
      .getRecompCatalog(force)
      .then((list) => setItems(Array.isArray(list) ? list : []))
      .catch((error) => {
        logger.error("Failed to load the recomp catalog", error);
        setItems((current) => current ?? []);
      })
      .finally(() => setIsRefreshing(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mySystem = getRecompilationOs(window.electron.platform);

  const consoles = useMemo(() => {
    const origins = new Set(
      (items ?? []).map((item) => item.origin).filter(Boolean) as string[]
    );
    return [...origins]
      .map((origin) => ({ origin, name: getRecompOriginName(origin) }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [items]);

  const visible = useMemo(() => {
    const wanted = normalizeGameTitle(query);
    return (items ?? [])
      .filter(
        (item) =>
          consoleFilter === ALL_CONSOLES || item.origin === consoleFilter
      )
      .filter(
        (item) => !onlyMySystem || !mySystem || item.systems.includes(mySystem)
      )
      .filter((item) => !wanted || searchText(item).includes(wanted))
      .sort(sorters[sort]);
  }, [items, query, consoleFilter, sort, onlyMySystem, mySystem]);

  const open = async (item: RecompCatalogItem) => {
    if (openingSlug) return;
    setOpeningSlug(item.slug);
    try {
      const objectId = await findCatalogueGameForRecomp(item);
      if (!objectId) {
        showErrorToast(t("game_not_found", { game: item.game ?? item.name }));
        return;
      }
      navigate(buildRecompilationPath(objectId, item.slug));
    } catch (error) {
      logger.error(`Failed to open ${item.slug}`, error);
      showErrorToast(t("open_failed"));
    } finally {
      setOpeningSlug(null);
    }
  };

  return (
    <section className="recomp-catalog">
      <header className="recomp-catalog__header">
        <div>
          <h2 className="recomp-catalog__title">{t("title")}</h2>
          <p className="recomp-catalog__subtitle">{t("subtitle")}</p>
        </div>
        <Button
          theme="outline"
          onClick={() => load(true)}
          disabled={isRefreshing}
        >
          <SyncIcon />
          {isRefreshing ? t("refreshing") : t("refresh")}
        </Button>
      </header>

      <div className="recomp-catalog__filters">
        <TextField
          theme="dark"
          placeholder={t("search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="recomp-catalog__search"
        />
        <SelectField
          theme="dark"
          value={consoleFilter}
          onChange={(event) => setConsoleFilter(event.target.value)}
          options={[
            {
              key: ALL_CONSOLES,
              value: ALL_CONSOLES,
              label: t("all_consoles"),
            },
            ...consoles.map(({ origin, name }) => ({
              key: origin,
              value: origin,
              label: name,
            })),
          ]}
        />
        <SelectField
          theme="dark"
          value={sort}
          onChange={(event) => setSort(event.target.value as SortKey)}
          options={[
            { key: "popular", value: "popular", label: t("sort_popular") },
            { key: "newest", value: "newest", label: t("sort_newest") },
            { key: "name", value: "name", label: t("sort_name") },
          ]}
        />
        <CheckboxField
          label={t("only_my_system")}
          checked={onlyMySystem}
          onChange={() => setOnlyMySystem((value) => !value)}
        />
      </div>

      {items === null ? (
        <p className="recomp-catalog__status">{t("loading")}</p>
      ) : visible.length === 0 ? (
        <p className="recomp-catalog__status">
          {items.length === 0 ? t("unavailable") : t("no_results")}
        </p>
      ) : (
        <>
          <p className="recomp-catalog__count">
            {t("count", { count: visible.length })}
          </p>
          <ul className="recomp-catalog__grid">
            {visible.map((item) => (
              <li key={item.slug}>
                <button
                  type="button"
                  className={cn("recomp-catalog__card", {
                    "recomp-catalog__card--opening": openingSlug === item.slug,
                  })}
                  onClick={() => open(item)}
                  disabled={openingSlug !== null}
                  title={item.game ?? item.name}
                >
                  <div className="recomp-catalog__cover">
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" loading="lazy" />
                    ) : (
                      <span className="recomp-catalog__cover-name">
                        {item.name}
                      </span>
                    )}
                    {item.hasEasySetup && (
                      <span className="recomp-catalog__badge">
                        {t("easy_setup")}
                      </span>
                    )}
                  </div>
                  <span className="recomp-catalog__name">{item.name}</span>
                  <span className="recomp-catalog__meta">
                    {[getRecompOriginName(item.origin), item.game]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="recomp-catalog__credit">{t("credit")}</p>
    </section>
  );
}
