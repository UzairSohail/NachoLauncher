import { registerEvent } from "../register-event";
import { validateSteamGridDbApiKey } from "@main/services/steam-grid-db";

const validateSteamGridDbApiKeyEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  apiKey: string
) => validateSteamGridDbApiKey(apiKey);

registerEvent("validateSteamGridDbApiKey", validateSteamGridDbApiKeyEvent);
