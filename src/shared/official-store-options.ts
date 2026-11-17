import type { LibraryGame } from "@types";

/** Catalogue availability does not prove that the current account owns a copy. */
export const getOfficialStoreMembers = (members: readonly LibraryGame[]) => {
  const active = members.filter((game) => !game.isDeleted);
  return {
    steam:
      active.find(
        (game) => game.shop === "steam" && game.hasActiveSteamImport === true
      ) ?? null,
  };
};

export const getInstalledStoreMembers = (members: readonly LibraryGame[]) => {
  const seen = new Set<string>();
  return members.filter((member) => {
    const key = `${member.shop}:${member.objectId}`;
    if (member.isDeleted || !member.executablePath || seen.has(key))
      return false;
    seen.add(key);
    return member.shop === "steam";
  });
};
