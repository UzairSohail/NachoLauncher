import { TrophyIcon, UserIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { FocusItem } from "../../../common";
import { animateNavigationScrollForElement } from "../../../../helpers";
import type { FocusOverrides } from "../../../../services";
import { useNavigationIsFocused } from "../../../../stores";
import { GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID } from "../navigation";

export interface UserAchievementsSummaryProps {
  unlockedCount: number;
  totalCount: number;
  navigationOverrides?: FocusOverrides;
  stealFocusOnAppear?: boolean;
}

export function UserAchievementsSummary({
  unlockedCount,
  totalCount,
  navigationOverrides,
  stealFocusOnAppear = false,
}: Readonly<UserAchievementsSummaryProps>) {
  const { t } = useTranslation("achievement");
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const isFocused = useNavigationIsFocused(GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID);

  useEffect(() => {
    if (!isFocused) return;

    animateNavigationScrollForElement(summaryRef.current, { top: 0 });
  }, [isFocused]);

  const percentage = totalCount > 0 ? (unlockedCount / totalCount) * 100 : 0;
  const formattedPercentage =
    percentage === 0 || Number.isInteger(percentage)
      ? `${percentage}%`
      : `${percentage.toFixed(1)}%`;

  return (
    <FocusItem
      id={GAME_ACHIEVEMENTS_SUMMARY_FOCUS_ID}
      actions={{ primary: "off" }}
      navigationOverrides={navigationOverrides}
      stealFocusOnAppear={stealFocusOnAppear}
      asChild
    >
      <div
        ref={summaryRef}
        className="game-achievements-page__summary"
        data-suppress-navigation-autoscroll="true"
      >
        <div className="game-achievements-page__summary-avatar">
          <UserIcon size={32} />
        </div>

        <div className="game-achievements-page__summary-content">
          <div className="game-achievements-page__summary-row">
            <div className="game-achievements-page__summary-info">
              <p className="game-achievements-page__summary-name">
                {t("your_achievements")}
              </p>
              <div className="game-achievements-page__summary-count">
                <TrophyIcon size={20} />
                <span>
                  {unlockedCount} / {totalCount}
                </span>
              </div>
            </div>

            <span className="game-achievements-page__summary-percentage">
              {formattedPercentage}
            </span>
          </div>

          <div className="game-achievements-page__summary-progress">
            <div className="game-achievements-page__summary-progress-track" />
            <div
              className="game-achievements-page__summary-progress-fill"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </div>
    </FocusItem>
  );
}
