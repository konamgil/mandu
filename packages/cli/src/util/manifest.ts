import path from "path";
import {
  generateManifest,
  loadManifest,
  type RoutesManifest,
  type FSScannerConfig,
} from "@mandujs/core";
import { isDirectory } from "./fs";

export type ManifestSource = "fs";

export interface ResolvedManifest {
  manifest: RoutesManifest;
  source: ManifestSource;
  warnings: string[];
}

export async function resolveManifest(
  rootDir: string,
  options: { fsRoutes?: FSScannerConfig; outputPath?: string } = {}
): Promise<ResolvedManifest> {
  const appDir = path.resolve(rootDir, "app");
  const hasApp = await isDirectory(appDir);

  if (!hasApp) {
    throw new Error("No app/ directory found. Create app/ routes to get started.");
  }

  const result = await generateManifest(rootDir, {
    scanner: options.fsRoutes,
    outputPath: options.outputPath,
  });
  return {
    manifest: result.manifest,
    source: "fs",
    warnings: result.warnings,
  };
}
