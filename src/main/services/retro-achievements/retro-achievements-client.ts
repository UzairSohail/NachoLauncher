import axios, { AxiosInstance } from "axios";
import https from "node:https";

export interface RetroAchievementsApiAchievement {
  ID: number;
  Title: string;
  Description: string;
  Points: number;
  BadgeName: string;
  DateEarned?: string;
  DateEarnedHardcore?: string;
}

export interface RetroAchievementsGameInfoAndUserProgress {
  Achievements: Record<string, RetroAchievementsApiAchievement>;
}

interface GetGameInfoAndUserProgressParams {
  username: string;
  webApiKey: string;
  raGameId: number;
}

export class RetroAchievementsClient {
  private static readonly instance: AxiosInstance = axios.create({
    baseURL: "https://retroachievements.org/API",
    httpsAgent: new https.Agent({ family: 4 }),
  });

  static async getGameInfoAndUserProgress({
    username,
    webApiKey,
    raGameId,
  }: GetGameInfoAndUserProgressParams) {
    const response =
      await this.instance.get<RetroAchievementsGameInfoAndUserProgress>(
        "/API_GetGameInfoAndUserProgress.php",
        { params: { u: username, y: webApiKey, g: raGameId } }
      );

    return response.data;
  }

  /** Throws when the username and Web API key don't match an account. */
  static async getUserProfile(username: string, webApiKey: string) {
    const response = await this.instance.get<{ User?: string }>(
      "/API_GetUserProfile.php",
      { params: { u: username, y: webApiKey }, timeout: 15_000 }
    );
    if (!response.data?.User) {
      throw new Error("RetroAchievements did not return a profile");
    }
    return { username: response.data.User };
  }
}
