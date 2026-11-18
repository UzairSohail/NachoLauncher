import { AllDebridClient } from "../download/all-debrid";

/**
 * VikingFile links used to be unlocked by Hydra's paid API. Nacho unlocks them
 * through the user's AllDebrid account instead.
 */
export class VikingFileApi {
  public static async getDownloadUrl(uri: string): Promise<string> {
    if (!AllDebridClient.isAuthorized()) {
      throw new Error("VikingFile downloads need AllDebrid");
    }
    return AllDebridClient.unlockDownloadLink(uri);
  }
}
