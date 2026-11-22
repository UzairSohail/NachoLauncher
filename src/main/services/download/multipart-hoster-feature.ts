import { Feature, isNachoFeatureEnabled } from "@shared";

export const isMultipartHosterDownloadsEnabled = async () =>
  isNachoFeatureEnabled(Feature.MultipartHosterDownloads);

export const assertMultipartHosterDownloadsEnabled = async () => {
  if (!(await isMultipartHosterDownloadsEnabled())) {
    throw new Error("Multi-part hoster downloads are turned off.");
  }
};
