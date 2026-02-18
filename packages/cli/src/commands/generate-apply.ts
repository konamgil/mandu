import {
  loadManifest,
  generateManifest,
  generateRoutes,
  buildGenerateReport,
  printReportSummary,
  writeReport,
  parseResourceSchemas,
  generateResourcesArtifacts,
  logGeneratorResult,
} from "@mandujs/core";
import { resolveFromCwd, getRootDir } from "../util/fs";
import path from "path";
import fs from "fs/promises";

/**
 * Discover resource schema files in spec/resources/
 */
async function discoverResourceSchemas(rootDir: string): Promise<string[]> {
  const resourcesDir = path.join(rootDir, "spec/resources");

  try {
    await fs.access(resourcesDir);
  } catch {
    // spec/resources doesn't exist, no resources to discover
    return [];
  }

  const schemaPaths: string[] = [];

  async function scanDir(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        await scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".resource.ts")) {
        schemaPaths.push(fullPath);
      }
    }
  }

  await scanDir(resourcesDir);
  return schemaPaths;
}

export async function generateApply(options?: { force?: boolean }): Promise<boolean> {
  const rootDir = getRootDir();
  const manifestPath = resolveFromCwd(".mandu/routes.manifest.json");

  console.log(`🥟 Mandu Generate`);
  console.log(`📄 FS Routes + Resources code generation\n`);

  // ============================================
  // 1. Generate FS Routes artifacts
  // ============================================

  // Regenerate manifest from FS Routes
  const fsResult = await generateManifest(rootDir);
  console.log(`✅ Manifest generated (${fsResult.fsRoutesCount} routes)`);

  const result = await loadManifest(manifestPath);

  if (!result.success || !result.data) {
    console.error("❌ Failed to load manifest:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`🔄 Generating FS Routes code...\n`);

  const generateResult = await generateRoutes(result.data, rootDir);

  const report = buildGenerateReport(generateResult);
  printReportSummary(report);

  const reportPath = resolveFromCwd("mandu-report.json");
  await writeReport(report, reportPath);
  console.log(`📋 Report saved: ${reportPath}`);

  if (!generateResult.success) {
    console.log(`\n❌ FS Routes generate failed`);
    return false;
  }

  console.log(`\n✅ FS Routes generate complete`);

  // ============================================
  // 2. Generate Resource artifacts
  // ============================================

  console.log(`\n🔍 Searching for resource schemas...\n`);

  const schemaPaths = await discoverResourceSchemas(rootDir);

  if (schemaPaths.length === 0) {
    console.log(`📋 No resource schemas found (spec/resources/*.resource.ts)`);
    console.log(`💡 Create a resource: bunx mandu generate resource`);
  } else {
    console.log(`📋 ${schemaPaths.length} resource schema(s) found`);
    schemaPaths.forEach((p) =>
      console.log(`   - ${path.relative(rootDir, p)}`)
    );

    try {
      console.log(`\n🔄 Generating resource artifacts...\n`);

      const resources = await parseResourceSchemas(schemaPaths);
      const resourceResult = await generateResourcesArtifacts(resources, {
        rootDir,
        force: options?.force ?? false,
      });

      logGeneratorResult(resourceResult);

      if (!resourceResult.success) {
        console.log(`\n❌ Resource generate failed`);
        return false;
      }

      console.log(`\n✅ Resource generate complete`);
    } catch (error) {
      console.error(
        `\n❌ Resource generate error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  // ============================================
  // Final Summary
  // ============================================

  console.log(`\n✅ Generate complete`);
  console.log(`💡 Next step: bunx mandu guard`);

  return true;
}
