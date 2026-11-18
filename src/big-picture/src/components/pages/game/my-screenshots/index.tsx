import "./styles.scss";

import {
  ArrowClockwiseIcon,
  ImageIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop, LocalScreenshot } from "@types";

import {
  Button,
  GridFocusGroup,
  Typography,
  VerticalFocusGroup,
} from "../../../common";
import { getItemFocusTarget } from "../../../../helpers";
import { Feature, useFeature } from "../../../../hooks";
import {
  NavigationService,
  type FocusOverrides,
  type FocusOverrideTarget,
} from "../../../../services";
import {
  GAME_MY_SCREENSHOTS_GRID_REGION_ID,
  GAME_MY_SCREENSHOTS_REGION_ID,
  GAME_MY_SCREENSHOTS_RETRY_ID,
  GAME_MY_SCREENSHOTS_VIEW_ALL_ID,
  getGameMyScreenshotItemId,
} from "../navigation";
import { ScreenshotHotkeyHint } from "./hotkey-hint";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import { LocalScreenshotViewer } from "./local-screenshot-viewer";
import { GameScreenshotsModal } from "./screenshots-modal";
import {
  useLocalScreenshotActions,
  type LocalScreenshotActions,
} from "./use-local-screenshot-actions";
import { useLocalGameScreenshots } from "./use-local-game-screenshots";

const SIDEBAR_SCREENSHOT_COUNT = 4;
const SIDEBAR_COLUMNS = 2;
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

const isFullWidthThumbnail = (index: number, count: number) =>
  count <= 2 || (count === 3 && index === 2);

const getThumbnailNavigation = (
  items: LocalScreenshot[],
  index: number,
  leftTarget: FocusOverrideTarget
): FocusOverrides => {
  if (isFullWidthThumbnail(index, items.length)) {
    return { left: leftTarget, right: BLOCK_TARGET };
  }

  return index % SIDEBAR_COLUMNS === 0
    ? { left: leftTarget }
    : {
        left: getItemFocusTarget(getItemFocusId(items[index - 1])),
        right: BLOCK_TARGET,
      };
};

interface MyScreenshotsGridProps {
  items: LocalScreenshot[];
  local: LocalScreenshotActions;
  leftTarget: FocusOverrideTarget;
  onOpen: (screenshot: LocalScreenshot) => void;
}

const resolveFocusTargetNodeId = (target: FocusOverrideTarget) => {
  if (target.type === "item") return target.itemId;
  if (target.type === "block") return null;

  return (
    target.initialFocusId ??
    NavigationService.getInstance()
      .getNodes()
      .find((node) => node.regionId === target.regionId)?.id ??
    null
  );
};

const getItemFocusId = (screenshot: LocalScreenshot) =>
  getGameMyScreenshotItemId(screenshot.clientId);

const getFocusAfterDeleteId = (
  items: LocalScreenshot[],
  index: number,
  leftTarget: FocusOverrideTarget
) => {
  const neighbour = items[index + 1] ?? items[index - 1];
  if (neighbour) return getItemFocusId(neighbour);

  return resolveFocusTargetNodeId(leftTarget);
};

function MyScreenshotsGrid({
  items,
  local,
  leftTarget,
  onOpen,
}: Readonly<MyScreenshotsGridProps>) {
  return (
    <GridFocusGroup
      regionId={GAME_MY_SCREENSHOTS_GRID_REGION_ID}
      className="game-my-screenshots__grid"
      navigationOrder={0}
    >
      {items.map((screenshot, index) => (
        <LocalScreenshotTile
          key={screenshot.clientId}
          screenshot={screenshot}
          focusId={getItemFocusId(screenshot)}
          alt={local.describe(screenshot)}
          isBusy={local.busyIds.has(screenshot.clientId)}
          variant="thumbnail"
          navigationOverrides={getThumbnailNavigation(items, index, leftTarget)}
          onOpen={onOpen}
          onDelete={(item) =>
            local.requestDelete(
              item,
              getFocusAfterDeleteId(items, index, leftTarget)
            )
          }
        />
      ))}
    </GridFocusGroup>
  );
}

interface MyScreenshotsMessageProps {
  isLoading: boolean;
  hasLoadError: boolean;
  leftTarget: FocusOverrideTarget;
  onRetry: () => void;
}

function MyScreenshotsMessage({
  isLoading,
  hasLoadError,
  leftTarget,
  onRetry,
}: Readonly<MyScreenshotsMessageProps>) {
  const { t } = useTranslation("big_picture");

  if (hasLoadError) {
    return (
      <div className="game-my-screenshots__message">
        <p>{t("screenshots_load_failed")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_MY_SCREENSHOTS_RETRY_ID}
          icon={<ArrowClockwiseIcon size={18} />}
          focusNavigationOverrides={{ left: leftTarget, right: BLOCK_TARGET }}
          focusNavigationOrder={1}
          onClick={onRetry}
        >
          {t("screenshots_retry")}
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="game-my-screenshots__message">
        <ImageIcon size={20} />
        <p>{t("screenshots_loading")}</p>
      </div>
    );
  }

  return (
    <div className="game-my-screenshots__message">
      <ImageIcon size={20} />
      <p>{t("screenshots_empty_filtered")}</p>
      <ScreenshotHotkeyHint className="game-my-screenshots__hint" />
    </div>
  );
}

export interface GameMyScreenshotsProps {
  shop: GameShop;
  objectId: string;
  navigationOrder: number;
  leftTarget: FocusOverrideTarget;
}

export function GameMyScreenshots({
  shop,
  objectId,
  navigationOrder,
  leftTarget,
}: Readonly<GameMyScreenshotsProps>) {
  const { t } = useTranslation("big_picture");
  const { isFeatureEnabled } = useFeature();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewing, setViewing] = useState<LocalScreenshot | null>(null);
  const isEnabled = isFeatureEnabled(Feature.Screenshots);
  const mine = useLocalGameScreenshots(shop, objectId, isEnabled);
  const local = useLocalScreenshotActions();
  const items = useMemo(
    () => mine.screenshots.slice(0, SIDEBAR_SCREENSHOT_COUNT),
    [mine.screenshots]
  );
  const title = t("my_screenshots", { ns: "screenshots" });
  const showGrid = mine.hasLoaded && !mine.hasFailed && items.length > 0;

  useEffect(() => {
    if (!viewing) return;
    const stillExists = mine.screenshots.some(
      (screenshot) => screenshot.clientId === viewing.clientId
    );
    if (!stillExists) setViewing(null);
  }, [mine.screenshots, viewing]);

  if (!isEnabled) return null;

  return (
    <VerticalFocusGroup
      regionId={GAME_MY_SCREENSHOTS_REGION_ID}
      navigationOrder={navigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section game-my-screenshots"
        aria-label={title}
      >
        <div className="game-my-screenshots__title">
          <Typography>{title}</Typography>
        </div>
        <div className="game-my-screenshots__body">
          {showGrid ? (
            <MyScreenshotsGrid
              items={items}
              local={local}
              leftTarget={leftTarget}
              onOpen={setViewing}
            />
          ) : (
            <MyScreenshotsMessage
              isLoading={!mine.hasLoaded}
              hasLoadError={mine.hasFailed}
              leftTarget={leftTarget}
              onRetry={() => void mine.retry()}
            />
          )}
          {showGrid ? (
            <Button
              variant="secondary"
              size="small"
              focusId={GAME_MY_SCREENSHOTS_VIEW_ALL_ID}
              className="game-my-screenshots__view-all"
              icon={<SquaresFourIcon size={18} />}
              focusNavigationOverrides={{
                left: leftTarget,
                right: BLOCK_TARGET,
              }}
              focusNavigationOrder={2}
              onClick={() => setIsModalOpen(true)}
            >
              {t("screenshots_view_all")}
            </Button>
          ) : null}
        </div>

        {local.elements}
        <GameScreenshotsModal
          visible={isModalOpen}
          screenshots={mine.screenshots}
          local={local}
          onOpen={setViewing}
          onClose={() => setIsModalOpen(false)}
        />
        <LocalScreenshotViewer
          screenshot={viewing}
          alt={viewing ? local.describe(viewing) : ""}
          onClose={() => setViewing(null)}
        />
      </section>
    </VerticalFocusGroup>
  );
}
