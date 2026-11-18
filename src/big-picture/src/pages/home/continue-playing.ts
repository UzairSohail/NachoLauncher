import type { LibraryGame, ShopAssets } from "@types";
import { sortByLastPlayed } from "../../components/pages/library/library-data";

export const CONTINUE_PLAYING_GAMES_COUNT = 6;

export type ContinuePlayingGame = LibraryGame & ShopAssets;

/** The most recently played games still in the library, newest first. */
export function getContinuePlayingGames(
  library: LibraryGame[],
  count = CONTINUE_PLAYING_GAMES_COUNT
): ContinuePlayingGame[] {
  return library
    .filter((game) => game.lastTimePlayed != null && !game.isDeleted)
    .sort(sortByLastPlayed)
    .slice(0, count)
    .map((game) => ({
      ...game,
      iconUrl: game.iconUrl ?? null,
      libraryHeroImageUrl: game.libraryHeroImageUrl ?? null,
      libraryImageUrl: game.libraryImageUrl ?? null,
      logoImageUrl: game.logoImageUrl ?? null,
      logoPosition: game.logoPosition ?? null,
      coverImageUrl: game.coverImageUrl ?? null,
      downloadSources: game.downloadSources ?? [],
    }));
}
