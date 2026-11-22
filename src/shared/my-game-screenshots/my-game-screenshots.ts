import type { LocalScreenshot } from "@types";

export const getLocalScreenshotTitle = (screenshot: LocalScreenshot) =>
  (screenshot.shop === "custom" && screenshot.customGameTitle) ||
  screenshot.gameTitle;
