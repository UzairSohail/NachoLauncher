import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";

import { Button, Modal } from "@renderer/components";
import { useFeature } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  GalleryLightbox,
  GalleryLightboxImage,
} from "@renderer/pages/game-details/gallery-slider/gallery-lightbox";
import type { GalleryMediaItem } from "@renderer/pages/game-details/gallery-slider/gallery-slider";
import { toLocalScreenshotUrl } from "@shared";
import type { GameShop, LocalScreenshot } from "@types";

import { SidebarSection } from "../sidebar-section/sidebar-section";
import { GameScreenshotsHotkeyTip } from "./game-screenshots-hotkey-tip";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import { useLocalScreenshotActions } from "./use-local-screenshot-actions";

import "./game-screenshots.scss";

const SIDEBAR_SCREENSHOT_COUNT = 4;

export interface ScreenshotsGame {
  shop: GameShop;
  objectId: string;
}

interface GameScreenshotsProps {
  libraryGame: ScreenshotsGame;
}

const byNewest = (a: LocalScreenshot, b: LocalScreenshot) =>
  b.capturedAt - a.capturedAt;

function useLocalGameScreenshots({ shop, objectId }: ScreenshotsGame) {
  const [screenshots, setScreenshots] = useState<LocalScreenshot[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  const load = useCallback(async () => {
    setHasFailed(false);
    try {
      const next = await window.electron.getLocalScreenshotsForGame(
        shop,
        objectId
      );
      setScreenshots([...next].sort(byNewest));
    } catch (error) {
      logger.error("Failed to load local screenshots", error);
      setHasFailed(true);
    } finally {
      setHasLoaded(true);
    }
  }, [objectId, shop]);

  useEffect(() => {
    void load();
    return window.electron.onLocalScreenshotsChange(() => void load());
  }, [load]);

  return { screenshots, hasLoaded, hasFailed, retry: load };
}

function GameScreenshotsBox({ libraryGame }: Readonly<GameScreenshotsProps>) {
  const { t } = useTranslation("screenshots");
  const { screenshots, hasLoaded, hasFailed, retry } =
    useLocalGameScreenshots(libraryGame);
  const local = useLocalScreenshotActions();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const galleryItems = useMemo<GalleryMediaItem[]>(
    () =>
      screenshots.map((screenshot) => ({
        id: screenshot.clientId,
        type: "image",
        src: toLocalScreenshotUrl(screenshot.path),
        thumbnail: toLocalScreenshotUrl(
          screenshot.previewPath ?? screenshot.path
        ),
        alt: local.describe(screenshot),
      })),
    [local, screenshots]
  );

  useEffect(() => {
    if (openIndex !== null && openIndex >= screenshots.length) {
      setOpenIndex(screenshots.length > 0 ? screenshots.length - 1 : null);
    }
  }, [openIndex, screenshots.length]);

  const open = (screenshot: LocalScreenshot) => {
    const index = screenshots.findIndex(
      (item) => item.clientId === screenshot.clientId
    );
    if (index >= 0) setOpenIndex(index);
  };

  const renderTile = (screenshot: LocalScreenshot, className?: string) => (
    <LocalScreenshotTile
      screenshot={screenshot}
      alt={local.describe(screenshot)}
      isBusy={local.busyIds.has(screenshot.clientId)}
      className={className}
      onOpen={open}
      onDelete={local.requestDelete}
    />
  );

  const renderContent = () => {
    if (!hasLoaded) {
      return (
        <div className="game-screenshots-box__grid" aria-busy="true">
          {Array.from({ length: SIDEBAR_SCREENSHOT_COUNT }, (_, index) => (
            <Skeleton
              key={`game-screenshots-box-skeleton-${index}`}
              className="game-screenshots-box__skeleton"
            />
          ))}
        </div>
      );
    }

    if (hasFailed) {
      return (
        <output className="game-screenshots-box__empty">
          <span className="game-screenshots-box__empty-title">
            <ImageIcon size={16} />
            {t("screenshots_load_failed")}
          </span>
          <Button theme="outline" onClick={() => void retry()}>
            {t("retry")}
          </Button>
        </output>
      );
    }

    if (screenshots.length === 0) {
      return (
        <output className="game-screenshots-box__empty">
          <span className="game-screenshots-box__empty-title">
            <ImageIcon size={16} />
            {t("no_game_screenshots_yet")}
          </span>
          <GameScreenshotsHotkeyTip />
        </output>
      );
    }

    return (
      <>
        <ul className="game-screenshots-box__grid">
          {screenshots.slice(0, SIDEBAR_SCREENSHOT_COUNT).map((screenshot) => (
            <li key={screenshot.clientId}>{renderTile(screenshot)}</li>
          ))}
        </ul>

        {screenshots.length > SIDEBAR_SCREENSHOT_COUNT ? (
          <Button
            theme="outline"
            className="game-screenshots-box__view-all"
            onClick={() => setIsModalOpen(true)}
          >
            {t("view_all")}
          </Button>
        ) : null}
      </>
    );
  };

  return (
    <SidebarSection title={t("my_screenshots")}>
      <div className="game-screenshots-box">{renderContent()}</div>

      <Modal
        visible={isModalOpen}
        title={t("my_screenshots")}
        large
        className="game-screenshots-modal"
        onClose={() => setIsModalOpen(false)}
      >
        <ul className="game-screenshots-box__grid game-screenshots-modal__grid">
          {screenshots.map((screenshot) => (
            <li key={screenshot.clientId}>
              {renderTile(screenshot, "local-screenshot-tile--card")}
            </li>
          ))}
        </ul>
      </Modal>

      {openIndex !== null && galleryItems.length > 0 ? (
        <GalleryLightbox
          visible
          items={galleryItems}
          index={openIndex}
          showFilmstrip={false}
          trapFocus
          renderImage={(item, context) => (
            <GalleryLightboxImage
              key={item.id}
              item={item}
              imageClassName="screenshot-stage__image"
              onImageError={context.onReady}
              {...context}
            />
          )}
          onNavigate={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}

      {local.elements}
    </SidebarSection>
  );
}

export function GameScreenshots({
  libraryGame,
}: Readonly<GameScreenshotsProps>) {
  const { isFeatureEnabled, Feature } = useFeature();

  if (!isFeatureEnabled(Feature.Screenshots)) return null;

  return <GameScreenshotsBox libraryGame={libraryGame} />;
}
