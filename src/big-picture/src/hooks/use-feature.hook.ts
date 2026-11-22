import { useCallback } from "react";

import { ENABLED_FEATURES, Feature } from "@shared";

export { Feature };

/** The features are fixed in the build (see shared/features.ts). */
export function useFeature() {
  const isFeatureEnabled = useCallback(
    (feature: Feature) => ENABLED_FEATURES.includes(feature),
    []
  );

  return {
    features: ENABLED_FEATURES as string[],
    isFeatureEnabled,
    Feature,
  };
}
