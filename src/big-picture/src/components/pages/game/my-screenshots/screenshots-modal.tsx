import type { LocalScreenshot } from "@types";
import { useTranslation } from "react-i18next";

import { GridFocusGroup, Modal, VerticalFocusGroup } from "../../../common";
import {
  GAME_SCREENSHOTS_MODAL_GRID_REGION_ID,
  GAME_SCREENSHOTS_MODAL_REGION_ID,
  getGameScreenshotsModalItemId,
} from "../navigation";
import { ScreenshotHotkeyHint } from "./hotkey-hint";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import type { LocalScreenshotActions } from "./use-local-screenshot-actions";

interface GameScreenshotsModalProps {
  visible: boolean;
  screenshots: LocalScreenshot[];
  local: LocalScreenshotActions;
  onOpen: (screenshot: LocalScreenshot) => void;
  onClose: () => void;
}

export function GameScreenshotsModal({
  visible,
  screenshots,
  local,
  onOpen,
  onClose,
}: Readonly<GameScreenshotsModalProps>) {
  const { t } = useTranslation("screenshots");

  return (
    <Modal
      visible={visible}
      title={t("my_screenshots")}
      className="game-screenshots-modal"
      onClose={onClose}
    >
      <VerticalFocusGroup regionId={GAME_SCREENSHOTS_MODAL_REGION_ID} asChild>
        <div className="game-screenshots-modal__content">
          {screenshots.length === 0 ? (
            <div className="game-screenshots-modal__message">
              <ScreenshotHotkeyHint className="game-screenshots-modal__hint" />
            </div>
          ) : (
            <div className="game-screenshots-modal__scroll">
              <GridFocusGroup
                regionId={GAME_SCREENSHOTS_MODAL_GRID_REGION_ID}
                className="game-screenshots-modal__grid"
              >
                <ul className="game-screenshots-modal__list game-screenshots-modal__list--large">
                  {screenshots.map((screenshot) => (
                    <li
                      key={screenshot.clientId}
                      className="game-screenshots-modal__local-item"
                    >
                      <LocalScreenshotTile
                        screenshot={screenshot}
                        focusId={getGameScreenshotsModalItemId(
                          screenshot.clientId
                        )}
                        alt={local.describe(screenshot)}
                        isBusy={local.busyIds.has(screenshot.clientId)}
                        variant="card"
                        onOpen={onOpen}
                        onDelete={(item) => local.requestDelete(item)}
                      />
                    </li>
                  ))}
                </ul>
              </GridFocusGroup>
            </div>
          )}
        </div>
      </VerticalFocusGroup>
    </Modal>
  );
}
