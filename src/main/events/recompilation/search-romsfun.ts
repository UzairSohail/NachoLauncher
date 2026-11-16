import { rankRomsFunResults, toRomsFunConsole } from "@shared";
import type { RomsFunSearchResult } from "@shared";
import { logger } from "@main/services";
import { registerEvent } from "../register-event";

const MAX_RESULTS = 8;

/** Drops edition words RomsFun leaves out of its names, for a wider search. */
const toQuery = (title: string) =>
  title
    .replaceAll(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replaceAll(/[:™®]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

/**
 * RomsFun pages for a game's ROM or disc image, best first, by the original
 * game's name and console (e.g. "Burnout 3: Takedown", "xbox").
 */
export const searchRomsFun = async (
  _event: Electron.IpcMainInvokeEvent,
  gameTitle: unknown,
  platform: unknown
): Promise<RomsFunSearchResult[]> => {
  if (typeof gameTitle !== "string" || !gameTitle.trim()) return [];
  const console = toRomsFunConsole(
    typeof platform === "string" ? platform : null
  );
  try {
    const { searchRomsFunPages } = await import(
      "@main/services/hosters/romsfun-browser"
    );
    const results = await searchRomsFunPages(toQuery(gameTitle));
    return rankRomsFunResults(results, gameTitle, console).slice(
      0,
      MAX_RESULTS
    );
  } catch (error) {
    logger.warn(`[RomsFun] Search for ${gameTitle} failed`, error);
    return [];
  }
};

registerEvent("searchRomsFun", searchRomsFun);
