import path from "path";
import {
  generateManifest,
  loadManifest,
  type RoutesManifest,
  type FSScannerConfig,
} from "@mandujs/core";
import { isDirectory } from "./fs";

export type ManifestSource = "fs" | "spec";

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

  if (hasApp) {
    const result = await generateManifest(rootDir, {
      scanner: options.fsRoutes,
      outputPath: options.outputPath,
      skipLegacy: true,
    });
    return {
      manifest: result.manifest,
      source: "fs",
      warnings: result.warnings,
    };
  }

  const specPath = path.join(rootDir, "spec", "routes.manifest.json");
  if (await Bun.file(specPath).exists()) {
    const result = await loadManifest(specPath);
    if (!result.success) {
      throw new Error(result.errors?.join(", ") || "Failed to load routes manifest");
    }
    return {
      manifest: result.data!,
      source: "spec",
      warnings: [],
    };
  }

  throw new Error("No routes found. Create app/ routes or spec/routes.manifest.json");
}
