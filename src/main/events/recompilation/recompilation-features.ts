import { Feature, isNachoFeatureEnabled } from "@shared";

export const isRecompilationCloudSaveEnabled = async () =>
  isNachoFeatureEnabled(Feature.RecompilationCloudSaves);
