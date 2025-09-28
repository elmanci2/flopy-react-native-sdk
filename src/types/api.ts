// src/types/api.ts

export interface UpdatePackage {
  releaseId: string;
  bundleUrl: string;
  hash: string;
  isMandatory: boolean;
}

export interface UpdatePatch {
  url: string;
  hash: string;
}

export interface CheckForUpdateResponse {
  updateAvailable: boolean;
  package?: UpdatePackage;
  patch?: UpdatePatch;
}
