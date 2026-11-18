export type RetroAchievementsIntegration =
  | { connected: false }
  | {
      connected: true;
      username: string;
      status: "active" | "invalid_credentials";
    };

export type RetroAchievementsConnectErrorField =
  | "password"
  | "webApiKey"
  | "form";

export const getRetroAchievementsConnectErrorField = (
  message?: string
): RetroAchievementsConnectErrorField => {
  if (message === "profile/retroachievements-invalid-password") {
    return "password";
  }

  if (message === "profile/retroachievements-invalid-web-api-key") {
    return "webApiKey";
  }

  return "form";
};
