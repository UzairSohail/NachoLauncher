import { Feature, isNachoFeatureEnabled } from "@shared";

type ScreenshotsFeatureListener = (enabled: boolean) => void;

/** Screenshots are switched on in the build; they are no longer remote. */
export const isScreenshotsFeatureEnabled = async () =>
  isNachoFeatureEnabled(Feature.Screenshots);

/** The switch never changes while running, so listeners are never called. */
export const onScreenshotsFeatureChange = (
  _listener: ScreenshotsFeatureListener
) => {
  return () => undefined;
};
