import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { orderBy } from "lodash-es";
import { ChevronDownIcon, ChevronUpIcon } from "@primer/octicons-react";
import { Tooltip } from "react-tooltip";
import type { DownloadSource, GameRepack } from "@types";
import {
  Downloader,
  getRepackUriParts,
  pickUriForDownloader,
  type RomsFunSearchResult,
} from "@shared";

import { Button } from "@renderer/components/button/button";
import { beginDownloadFlight } from "@renderer/components/sidebar/download-flight";
import { CheckboxField } from "@renderer/components/checkbox-field/checkbox-field";
import { TextField } from "@renderer/components/text-field/text-field";
import { gameDetailsContext } from "@renderer/context";
import {
  useAppSelector,
  useDate,
  useDownload,
  useFeature,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import type { Feature } from "@renderer/hooks/use-feature";
import { levelDBService } from "@renderer/services/leveldb.service";
import { getRepackAvailabilityStatus } from "../game-details/modals/repack-availability";
import {
  getDefaultDownloader,
  getDownloadOptions,
} from "../game-details/modals/use-download-options";
import "../game-details/modals/repacks-modal.scss";
import "./recompilation-install-modal.scss";

interface RomSourceListProps {
  objectId: string;
  gameTitle: string;
  downloadPath: string;
  onStarted: () => void;
}

function RomSourceRow({
  repack,
  objectId,
  gameTitle,
  downloadPath,
  onStarted,
  hasActiveSubscription,
  isFeatureEnabled,
}: Readonly<
  RomSourceListProps & {
    repack: GameRepack;
    hasActiveSubscription: boolean;
    isFeatureEnabled: (feature: Feature) => boolean;
  }
>) {
  const { t } = useTranslation("recompilation");
  const { t: tGame } = useTranslation("game_details");
  const { formatDate } = useDate();
  const { startDownload } = useDownload();
  const availability = getRepackAvailabilityStatus(repack);
  const tooltipId = `rom-source-orb-${repack.id}`;
  const { showErrorToast } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const [isStarting, setIsStarting] = useState(false);

  const start = async (event: React.MouseEvent<HTMLButtonElement>) => {
    const source = event.currentTarget;
    const downloadOptions = getDownloadOptions(repack, {
      userPreferences,
      hasActiveSubscription,
      isFeatureEnabled,
    });
    const downloader = getDefaultDownloader(
      downloadOptions
        .filter((option) => option.isAvailable)
        .map((option) => option.downloader),
      repack
    );
    const pickedUri =
      downloader === null ? null : pickUriForDownloader(repack, downloader);
    const uri =
      pickedUri && !(repack.unavailableUris ?? []).includes(pickedUri)
        ? pickedUri
        : undefined;
    if (downloader === null || !uri) {
      showErrorToast(t("rom_download_unavailable"));
      return;
    }

    const flight = beginDownloadFlight(source);
    setIsStarting(true);
    const response = await startDownload({
      objectId,
      title: gameTitle,
      downloader,
      shop: "launchbox",
      downloadPath,
      uri,
      parts: getRepackUriParts(repack, uri),
      automaticallyExtract: true,
      automaticallyDeleteArchiveFiles:
        userPreferences?.deleteArchiveFilesAfterExtractionByDefault ?? true,
      fileSize: repack.fileSize,
    });
    setIsStarting(false);

    if (response.ok) {
      flight.launch(null);
      onStarted();
    } else {
      flight.cancel();
      showErrorToast(t("rom_download_failed"));
    }
  };

  return (
    <Button
      theme="dark"
      className="repacks-modal__repack-button"
      onClick={start}
      disabled={!downloadPath || isStarting}
    >
      <span
        className={`repacks-modal__availability-orb repacks-modal__availability-orb--${availability}`}
        data-tooltip-id={tooltipId}
        data-tooltip-content={tGame(`source_${availability}`)}
      />
      <Tooltip id={tooltipId} />
      <p className="repacks-modal__repack-title">{repack.title}</p>
      <p className="repacks-modal__repack-info">
        {repack.fileSize} - {repack.downloadSourceName} -{" "}
        {repack.uploadDate ? formatDate(repack.uploadDate) : ""}
      </p>
    </Button>
  );
}

export function RomSourceList(props: Readonly<RomSourceListProps>) {
  const { t } = useTranslation("recompilation");
  const { repacks, isLoading } = useContext(gameDetailsContext);
  const { t: tGame } = useTranslation("game_details");
  const [filter, setFilter] = useState("");
  const [downloadSources, setDownloadSources] = useState<DownloadSource[]>([]);
  const [selectedFingerprints, setSelectedFingerprints] = useState<string[]>(
    []
  );
  const [isSourceFilterOpen, setIsSourceFilterOpen] = useState(false);
  const { isFeatureEnabled } = useFeature();
  const { hasActiveSubscription } = useUserDetails();

  useEffect(() => {
    void levelDBService
      .values("downloadSources")
      .then((sources) =>
        setDownloadSources(
          orderBy(sources as DownloadSource[], "createdAt", "desc")
        )
      );
  }, []);

  const visibleRepacks = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const selectedNames = new Set(
      downloadSources
        .filter(
          (source) =>
            source.fingerprint &&
            selectedFingerprints.includes(source.fingerprint)
        )
        .map((source) => source.name)
    );

    return orderBy(repacks, [(repack) => repack.uploadDate], ["desc"]).filter(
      (repack) =>
        (!term ||
          repack.title.toLowerCase().includes(term) ||
          repack.downloadSourceName.toLowerCase().includes(term)) &&
        (selectedFingerprints.length === 0 ||
          selectedNames.has(repack.downloadSourceName))
    );
  }, [repacks, filter, downloadSources, selectedFingerprints]);

  const toggleFingerprint = (fingerprint: string) =>
    setSelectedFingerprints((previous) =>
      previous.includes(fingerprint)
        ? previous.filter((value) => value !== fingerprint)
        : [...previous, fingerprint]
    );

  const filterableSources = downloadSources.filter(
    (source): source is DownloadSource & { fingerprint: string } =>
      source.fingerprint !== undefined
  );

  if (!isLoading && repacks.length === 0) {
    return <p className="rom-source-list__empty">{t("rom_no_sources")}</p>;
  }

  return (
    <div className="rom-source-list">
      <div className="repacks-modal__filter-top">
        <TextField
          placeholder={t("rom_filter_sources")}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        {filterableSources.length > 0 && (
          <Button
            type="button"
            theme="outline"
            className="repacks-modal__filter-toggle"
            onClick={() => setIsSourceFilterOpen((open) => !open)}
          >
            {tGame("filter_by_source")}
            {isSourceFilterOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
          </Button>
        )}
      </div>

      {isSourceFilterOpen && (
        <div className="repacks-modal__source-grid">
          {filterableSources.map((source) => {
            const label = source.name || source.url;
            return (
              <div
                key={source.fingerprint}
                className="repacks-modal__source-item"
              >
                <CheckboxField
                  label={label.length > 16 ? `${label.slice(0, 16)}...` : label}
                  checked={selectedFingerprints.includes(source.fingerprint)}
                  onChange={() => toggleFingerprint(source.fingerprint)}
                />
              </div>
            );
          })}
        </div>
      )}
      <div className="repacks-modal__repacks">
        {visibleRepacks.map((repack) => (
          <RomSourceRow
            key={repack.id}
            repack={repack}
            hasActiveSubscription={hasActiveSubscription}
            isFeatureEnabled={isFeatureEnabled}
            {...props}
          />
        ))}
      </div>
    </div>
  );
}

/** RomsFun's console slugs as people know them. */
const ROMSFUN_CONSOLE_NAMES: Record<string, string> = {
  xbox: "Xbox",
  "xbox-360": "Xbox 360",
  playstation: "PS1",
  "playstation-2": "PS2",
  ps3: "PS3",
  "playstation-portable": "PSP",
  "ps-vita": "PS Vita",
  "nintendo-64": "N64",
  gamecube: "GameCube",
  "nintendo-wii": "Wii",
  "wii-u": "Wii U",
  "nintendo-ds": "DS",
  "nintendo-3ds": "3DS",
  "game-boy-advance": "GBA",
  "game-boy-color": "GBC",
  "game-boy": "Game Boy",
  "super-nintendo": "SNES",
  nes: "NES",
  "sega-genesis": "Genesis",
  dreamcast: "Dreamcast",
  "sega-saturn": "Saturn",
};

/**
 * Free ROM / disc image downloads from RomsFun, found by the original game's
 * name. Nacho reads the real file link from RomsFun's pages when the download
 * starts, so it needs no debrid service.
 */
function RomsFunList({
  objectId,
  gameTitle,
  platform,
  downloadPath,
  onStarted,
}: Readonly<RomSourceListProps & { platform: string | null }>) {
  const { t } = useTranslation("recompilation");
  const { t: tGame } = useTranslation("game_details");
  const { startDownload } = useDownload();
  const { showErrorToast } = useToast();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const [results, setResults] = useState<RomsFunSearchResult[] | null>(null);
  const [startingUrl, setStartingUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    window.electron
      .searchRomsFun(gameTitle, platform)
      .then((found) => {
        if (!cancelled) setResults(found);
      })
      .catch(() => {
        if (!cancelled) setResults([]);
      });
    return () => {
      cancelled = true;
    };
  }, [gameTitle, platform]);

  const start = async (
    event: React.MouseEvent<HTMLButtonElement>,
    result: RomsFunSearchResult
  ) => {
    const flight = beginDownloadFlight(event.currentTarget);
    setStartingUrl(result.url);
    const response = await startDownload({
      objectId,
      title: gameTitle,
      downloader: Downloader.RomsFun,
      shop: "launchbox",
      downloadPath,
      uri: result.url,
      automaticallyExtract: true,
      automaticallyDeleteArchiveFiles:
        userPreferences?.deleteArchiveFilesAfterExtractionByDefault ?? true,
    }).catch(() => ({ ok: false, error: undefined }) as const);
    setStartingUrl(null);

    if (response.ok) {
      flight.launch(null);
      onStarted();
    } else {
      flight.cancel();
      const error = "error" in response ? response.error : undefined;
      showErrorToast(
        error && tGame(error) !== error
          ? tGame(error)
          : t("rom_download_failed")
      );
    }
  };

  return (
    <div className="rom-source-list">
      <h4 className="rom-source-list__heading">{t("romsfun_title")}</h4>
      <p className="rom-source-list__hint">{t("romsfun_hint")}</p>
      {results === null && (
        <p className="rom-source-list__empty">{t("romsfun_searching")}</p>
      )}
      {results?.length === 0 && (
        <p className="rom-source-list__empty">{t("romsfun_no_results")}</p>
      )}
      <div className="repacks-modal__repacks">
        {results?.map((result) => (
          <Button
            key={result.url}
            theme="dark"
            className="repacks-modal__repack-button"
            onClick={(event) => void start(event, result)}
            disabled={!downloadPath || startingUrl !== null}
          >
            <p className="repacks-modal__repack-title">{result.title}</p>
            <p className="repacks-modal__repack-info">
              {startingUrl === result.url
                ? t("romsfun_getting_link")
                : `${ROMSFUN_CONSOLE_NAMES[result.console] ?? result.console} - RomsFun - ${t("romsfun_free")}`}
            </p>
          </Button>
        ))}
      </div>
    </div>
  );
}

export function RomSourcesPanel({
  objectId,
  gameTitle,
  platform = null,
  onStarted,
}: Readonly<
  Omit<RomSourceListProps, "downloadPath"> & { platform?: string | null }
>) {
  const { t } = useTranslation("recompilation");
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const [downloadPath, setDownloadPath] = useState("");

  useEffect(() => {
    if (userPreferences?.downloadsPath) {
      setDownloadPath(userPreferences.downloadsPath);
      return;
    }
    void window.electron.getDefaultDownloadsPath().then(setDownloadPath);
  }, [userPreferences?.downloadsPath]);

  const changeDownloadPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: downloadPath,
      properties: ["openDirectory"],
    });
    const [folder] = filePaths ?? [];
    if (folder) setDownloadPath(folder);
  };

  return (
    <>
      <div className="recompilation-install__location">
        <span className="recompilation-install__choice-text">
          <span className="recompilation-install__choice-info">
            {t("rom_download_to")}
          </span>
          <span
            className="recompilation-install__location-path"
            title={downloadPath}
          >
            {downloadPath}
          </span>
        </span>
        <Button theme="outline" onClick={changeDownloadPath}>
          {t("rom_change_folder")}
        </Button>
      </div>
      <RomSourceList
        objectId={objectId}
        gameTitle={gameTitle}
        downloadPath={downloadPath}
        onStarted={onStarted}
      />
      <RomsFunList
        objectId={objectId}
        gameTitle={gameTitle}
        platform={platform}
        downloadPath={downloadPath}
        onStarted={onStarted}
      />
    </>
  );
}
