import { setHeaderTitle } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
  isGameCompleted,
} from "@renderer/helpers";
import { TrophyIcon } from "@primer/octicons-react";
import { gameDetailsContext } from "@renderer/context";
import { Link, ProgressBar } from "@renderer/components";
import { AchievementList } from "./achievement-list";
import "./achievements-content.scss";

interface AchievementSummaryProps {
  totalAchievementCount: number;
  unlockedAchievementCount: number;
}

function AchievementSummary({
  totalAchievementCount,
  unlockedAchievementCount,
}: AchievementSummaryProps) {
  const { t } = useTranslation("achievement");
  const isCompleted = isGameCompleted(
    totalAchievementCount,
    unlockedAchievementCount
  );

  return (
    <div className="achievements-content__user-summary">
      <div className="achievements-content__user-summary__container">
        <div className="achievements-content__user-summary__container__stats">
          <div className="achievements-content__user-summary__container__stats__trophy-count">
            {!isCompleted && <TrophyIcon size={13} />}
            <span>
              {unlockedAchievementCount} / {totalAchievementCount}
            </span>
          </div>

          <span
            className={`achievements-content__user-summary__container__stats__percentage${isCompleted ? " achievements-content__user-summary__container__stats__percentage--completed" : ""}`}
          >
            {isCompleted ? (
              <TrophyIcon size={13} />
            ) : (
              formatDownloadProgress(
                totalAchievementCount > 0
                  ? unlockedAchievementCount / totalAchievementCount
                  : 0
              )
            )}
          </span>
        </div>
        <ProgressBar
          now={unlockedAchievementCount}
          max={totalAchievementCount}
          label={t("achievement_progress", {
            unlockedCount: unlockedAchievementCount,
            totalCount: totalAchievementCount,
          })}
          completed={isCompleted}
          trackClassName="achievements-content__user-summary__container__stats__progress-track"
          barClassName="achievements-content__user-summary__container__stats__progress-bar"
        />
      </div>
    </div>
  );
}

export function AchievementsContent() {
  const { gameTitle, objectId, shop, game, shopDetails, achievements } =
    useContext(gameDetailsContext);
  const dispatch = useAppDispatch();

  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    dispatch(setHeaderTitle(gameTitle));
  }, [dispatch, gameTitle]);

  const heroImage =
    game?.customHeroImageUrl || shopDetails?.assets?.libraryHeroImageUrl || "";

  const logoImage =
    game?.customLogoImageUrl || shopDetails?.assets?.logoImageUrl || "";

  if (!objectId || !shop || !gameTitle || !achievements) return null;

  return (
    <div className="achievements-content__achievements-list">
      <section
        ref={setScrollElement}
        className="achievements-content__achievements-list__section"
      >
        <div className="achievements-content__achievements-list__section__container">
          <div className="achievements-content__achievements-list__section__container__banner">
            {heroImage && (
              <img
                src={heroImage}
                className="achievements-content__achievements-list__section__container__banner-background"
                alt=""
                aria-hidden="true"
                loading="lazy"
              />
            )}
            <div className="achievements-content__achievements-list__section__container__hero">
              <div className="achievements-content__achievements-list__section__container__hero__content">
                <Link
                  to={buildGameDetailsPath({
                    shop,
                    objectId,
                    title: gameTitle,
                  })}
                >
                  {logoImage ? (
                    <img
                      src={logoImage}
                      className="achievements-content__achievements-list__section__container__hero__content__game-logo"
                      alt={gameTitle}
                    />
                  ) : (
                    <span className="achievements-content__achievements-list__section__container__hero__content__game-title">
                      {gameTitle}
                    </span>
                  )}
                </Link>
              </div>
            </div>

            <div className="achievements-content__achievements-list__section__container__achievements-summary-wrapper">
              <AchievementSummary
                totalAchievementCount={achievements.length}
                unlockedAchievementCount={
                  achievements.filter((achievement) => achievement.unlocked)
                    .length
                }
              />
            </div>
          </div>
        </div>

        <AchievementList
          scrollElement={scrollElement}
          achievements={achievements}
        />
      </section>
    </div>
  );
}
