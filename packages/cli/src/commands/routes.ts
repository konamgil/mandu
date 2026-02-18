/**
 * FS Routes CLI Commands
 *
 * File-system based route management commands
 */

import {
  scanRoutes,
  generateManifest,
  formatRoutesForCLI,
  watchFSRoutes,
  validateAndReport,
  type GenerateOptions,
  type FSScannerConfig,
} from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface RoutesGenerateOptions {
  /** Output file path */
  output?: string;
  /** Verbose output */
  verbose?: boolean;
}

export interface RoutesListOptions {
  /** Verbose output */
  verbose?: boolean;
}

export interface RoutesWatchOptions {
  /** Output file path */
  output?: string;
  /** Verbose output */
  verbose?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * routes generate - Scan FS Routes and generate manifest
 */
export async function routesGenerate(options: RoutesGenerateOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);
  if (!config) return false;

  console.log("🥟 Mandu FS Routes Generate\n");

  try {
    const generateOptions: GenerateOptions = {
      scanner: config.fsRoutes,
      outputPath: options.output,
    };

    const result = await generateManifest(rootDir, generateOptions);

    // Print results
    console.log(`✅ FS Routes scan complete`);
    console.log(`   📋 Routes: ${result.manifest.routes.length}\n`);

    // Print warnings
    if (result.warnings.length > 0) {
      console.log("⚠️  Warnings:");
      for (const warning of result.warnings) {
        console.log(`   - ${warning}`);
      }
      console.log("");
    }

    // Print route list
    if (options.verbose) {
      console.log(formatRoutesForCLI(result.manifest));
      console.log("");
    }

    // Output file path
    if (generateOptions.outputPath) {
      console.log(`📁 Manifest saved: ${generateOptions.outputPath}`);
    }

    return true;
  } catch (error) {
    console.error("❌ FS Routes generation failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * routes list - List current routes
 */
export async function routesList(options: RoutesListOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);
  if (!config) return false;

  console.log("🥟 Mandu Routes List\n");

  try {
    const result = await scanRoutes(rootDir, config.fsRoutes);

    if (result.errors.length > 0) {
      console.log("⚠️  Scan warnings:");
      for (const error of result.errors) {
        console.log(`   - ${error.type}: ${error.message}`);
      }
      console.log("");
    }

    if (result.routes.length === 0) {
      console.log("📭 No routes found.");
      console.log("");
      console.log("💡 Create a page.tsx or route.ts file in the app/ directory.");
      console.log("");
      console.log("Examples:");
      console.log("  app/page.tsx        → /");
      console.log("  app/blog/page.tsx   → /blog");
      console.log("  app/api/users/route.ts → /api/users");
      return true;
    }

    // Print route list
    console.log(`📋 Routes (${result.routes.length})`);
    console.log("─".repeat(70));

    for (const route of result.routes) {
      const icon = route.kind === "page" ? "📄" : "📡";
      const hydration = route.clientModule ? " 🏝️" : "";
      const pattern = route.pattern.padEnd(35);
      const id = route.id;

      console.log(`${icon} ${pattern} → ${id}${hydration}`);

      if (options.verbose) {
        console.log(`   📁 ${route.sourceFile}`);
        if (route.clientModule) {
          console.log(`   🏝️  ${route.clientModule}`);
        }
        if (route.layoutChain.length > 0) {
          console.log(`   📐 layouts: ${route.layoutChain.join(" → ")}`);
        }
      }
    }

    console.log("");

    // Statistics
    console.log("📊 Statistics");
    console.log(`   Pages: ${result.stats.pageCount}`);
    console.log(`   API: ${result.stats.apiCount}`);
    console.log(`   Layouts: ${result.stats.layoutCount}`);
    console.log(`   Islands: ${result.stats.islandCount}`);
    console.log(`   Scan time: ${result.stats.scanTime}ms`);

    return true;
  } catch (error) {
    console.error("❌ Failed to list routes:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * routes watch - Watch routes in real time
 */
export async function routesWatch(options: RoutesWatchOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);
  if (!config) return false;

  console.log("🥟 Mandu FS Routes Watch\n");
  console.log("👀 Watching for route changes... (Ctrl+C to stop)\n");

  try {
    // Initial scan
    const initialResult = await generateManifest(rootDir, {
      scanner: config.fsRoutes,
      outputPath: options.output ?? ".mandu/routes.manifest.json",
    });

    console.log(`✅ Initial scan: ${initialResult.manifest.routes.length} route(s)\n`);

    // Start watching
    const watcher = await watchFSRoutes(rootDir, {
      scanner: config.fsRoutes,
      outputPath: options.output ?? ".mandu/routes.manifest.json",
      onChange: (result) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n🔄 [${timestamp}] Route change detected`);
        console.log(`   📋 Total routes: ${result.manifest.routes.length}`);

        if (result.warnings.length > 0) {
          for (const warning of result.warnings) {
            console.log(`   ⚠️  ${warning}`);
          }
        }

        if (options.verbose) {
          console.log("");
          console.log(formatRoutesForCLI(result.manifest));
        }
      },
    });

    // Handle exit signals
    const cleanup = () => {
      console.log("\n\n🛑 Watch stopped");
      watcher.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // Wait indefinitely
    await new Promise(() => {});

    return true;
  } catch (error) {
    console.error("❌ Route watch failed:", error instanceof Error ? error.message : error);
    return false;
  }
}
