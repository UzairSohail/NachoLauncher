import { registerEvent } from "../register-event";
import { RecompCatalog } from "@main/services/recomp-catalog";

const text = (value: unknown) => (typeof value === "string" ? value : "");

registerEvent(
  "getCatalogRecompilations",
  (_event: Electron.IpcMainInvokeEvent, gameTitle: unknown) =>
    RecompCatalog.findForGame(text(gameTitle))
);

registerEvent(
  "getCatalogRecompilation",
  (_event: Electron.IpcMainInvokeEvent, objectId: unknown, slug: unknown) =>
    RecompCatalog.getDetails(text(objectId), text(slug))
);

registerEvent(
  "getCatalogRecompilationReleases",
  async (_event: Electron.IpcMainInvokeEvent, slug: unknown) => ({
    releases: await RecompCatalog.getReleases(text(slug)),
  })
);

registerEvent(
  "getCatalogRecompilationReadme",
  (_event: Electron.IpcMainInvokeEvent, slug: unknown) =>
    RecompCatalog.getReadme(text(slug))
);

registerEvent(
  "getRecompCatalog",
  (_event: Electron.IpcMainInvokeEvent, force: unknown) =>
    RecompCatalog.listAll(force === true)
);
