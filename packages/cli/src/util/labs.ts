import { theme } from "../terminal";

export interface LabsFeatureNotice {
  feature: string;
  packageName: string;
  alternative?: string;
}

/**
 * Keep compatibility command names actionable without pulling optional Labs
 * packages into the product CLI runtime graph.
 */
export function reportLabsFeature(notice: LabsFeatureNotice): false {
  console.error(theme.warn(`${notice.feature} is an optional Mandu Labs feature.`));
  console.error(theme.muted(`Install ${notice.packageName} explicitly to use it.`));
  if (notice.alternative) {
    console.error(theme.muted(`Product path: ${notice.alternative}`));
  }
  return false;
}
