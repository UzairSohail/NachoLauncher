import type { LibraryGame } from "@types";
import { platformToEmulationSavePlatform } from "@renderer/helpers";
import { GameEmulationSaves } from "../../cloud-sync/game-emulation-saves";

interface EmulatorSavesSectionProps {
  game: LibraryGame;
}

/** Memory-card and save-folder backups kept in the user's Google Drive. */
export function EmulatorSavesSection({
  game,
}: Readonly<EmulatorSavesSectionProps>) {
  const platform = platformToEmulationSavePlatform(game.platform);
  if (!platform) return null;

  return (
    <div className="game-options-modal__cloud-panel">
      <GameEmulationSaves platform={platform} objectId={game.objectId} />
    </div>
  );
}
