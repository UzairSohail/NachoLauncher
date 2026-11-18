import { AllDebridClient } from "../download/all-debrid";

/**
 * Datanodes links used to be unlocked by Hydra's paid API. Nacho unlocks them
 * through the user's AllDebrid account instead.
 */
export class DatanodesApi {
  public static async getDownloadUrl(uri: string): Promise<string> {
    if (!AllDebridClient.isAuthorized()) {
      throw new Error("Datanodes downloads need AllDebrid");
    }
    return AllDebridClient.unlockDownloadLink(uri);
  }
}
