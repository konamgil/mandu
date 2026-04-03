/**
 * mandu check - Workflow Check Command
 *
 * Integrated check: FS Routes + Architecture Guard + Manifest Guard
 */

import {
  generateManifest,
  scanRoutes,
  checkDirectory,
  printReport,
  getPreset,
  validateAndReport,
  loadManifest,
  runGuardCheck,
  buildGuardReport,
  printReportSummary,
  runAutoCorrect,
  isAutoCorrectableViolation,
  guardConfig,
  formatConfigGuardResult,
  calculateHealthScore,
  type GuardConfig,
  type ConfigGuardResult,
} from "@mandujs/core";
import path from "path";
import { resolveFromCwd, isDirectory, pathExists } from "../util/fs";
import { resolveOutputFormat } from "../util/output";

interface ManifestCheckDeps {
  runGuardCheck: typeof runGuardCheck;
  runAutoCorrect: typeof runAutoCorrect;
  isAutoCorrectableViolation: typeof isAutoCorrectableViolation;
}

export async function runManifestGuardWithAutoHeal(
  manifest: Parameters<typeof runGuardCheck>[0],
  rootDir: string,
  deps: ManifestCheckDeps = { runGuardCheck, runAutoCorrect, isAutoCorrectableViolation }
): Promise<{
  passed: boolean;
  violations: number;
  autoHealed: boolean;
  nextAction?: string;
  checkResult: Awaited<ReturnType<typeof runGuardCheck>>;
}> {
  let checkResult = await deps.runGuardCheck(manifest, rootDir);
  let autoHealed = false;

  if (!checkResult.passed) {
    const hasAutoCorrectableViolation = checkResult.violations.some(
      deps.isAutoCorrectableViolation
    );

    if (hasAutoCorrectableViolation) {
      const autoCorrectResult = await deps.runAutoCorrect(
        checkResult.violations,
        manifest,
        rootDir
      );
      autoHealed = autoCorrectResult.fixed;
      checkResult = await deps.runGuardCheck(manifest, rootDir);
    }
  }

  return {
    passed: checkResult.passed,
    violations: checkResult.violations.length,
    autoHealed,
    nextAction: checkResult.passed ? undefined : "mandu guard",
    checkResult,
  };
}

export async function check(): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);
  if (!config) return false;

  const guardConfigFromFile = config.guard ?? {};
  const preset = guardConfigFromFile.preset ?? "mandu";
  const format = resolveOutputFormat();
  const quiet = false;
  const strictWarnings = process.env.CI === "true";
  const enableFsRoutes = await isDirectory(path.resolve(rootDir, "app"));
  const specPath = resolveFromCwd(".mandu/routes.manifest.json");
  const hasSpec = await pathExists(specPath);

  let success = true;

  const log = (message: string) => {
    if (format === "console" && !quiet) {
      console.log(message);
    }
  };

  const print = (message: string) => {
    if (format === "console") {
      console.log(message);
    }
  };

  if (format === "console") {
    log("🥟 Mandu Check\n");
  }

  // 1) FS Routes check
  let routesSummary: { enabled: boolean; count: number; warnings: string[] } = {
    enabled: false,
    count: 0,
    warnings: [],
  };

  if (enableFsRoutes) {
    routesSummary.enabled = true;

    try {
      if (format === "console") {
        const result = await generateManifest(rootDir, {
          scanner: config.fsRoutes,
        });
        routesSummary.count = result.manifest.routes.length;
        routesSummary.warnings = result.warnings;

        if (quiet) {
          print(`✅ FS Routes: ${routesSummary.count}`);
        } else {
          log(`✅ FS Routes: ${routesSummary.count}`);
        }
        if (routesSummary.warnings.length > 0) {
          if (!quiet) {
            log("⚠️  Warnings:");
          }
          for (const warning of routesSummary.warnings) {
            if (!quiet) {
              log(`   - ${warning}`);
            }
          }
        }
        if (!quiet) {
          log("");
        }
      } else {
        const scan = await scanRoutes(rootDir, config.fsRoutes);
        routesSummary.count = scan.routes.length;
        routesSummary.warnings = scan.errors.map((e) => `${e.type}: ${e.message}`);
      }
    } catch (error) {
      success = false;
      routesSummary.warnings.push(
        error instanceof Error ? error.message : String(error)
      );
      if (format === "console") {
        console.error("❌ FS Routes check failed:", error);
      }
    }
  } else {
    if (quiet) {
      print("ℹ️  No app/ directory - skipping FS Routes check");
    } else {
      log("ℹ️  No app/ directory - skipping FS Routes check\n");
    }
  }

  // 2) Architecture Guard check
  const archGuardConfig: GuardConfig = {
    preset,
    srcDir: guardConfigFromFile.srcDir ?? "src",
    exclude: guardConfigFromFile.exclude,
    fsRoutes: enableFsRoutes
      ? {
          noPageToPage: true,
          pageCanImport: [
            "client/pages",
            "client/widgets",
            "client/features",
            "client/entities",
            "client/shared",
            "shared/contracts",
            "shared/types",
            "shared/utils/client",
          ],
          layoutCanImport: [
            "client/app",
            "client/widgets",
            "client/shared",
            "shared/contracts",
            "shared/types",
            "shared/utils/client",
          ],
          routeCanImport: [
            "server/api",
            "server/application",
            "server/domain",
            "server/infra",
            "server/core",
            "shared/contracts",
            "shared/schema",
            "shared/types",
            "shared/utils/client",
            "shared/utils/server",
            "shared/env",
          ],
        }
      : undefined,
  };

  const report = await checkDirectory(archGuardConfig, rootDir);
  const hasArchErrors = report.bySeverity.error > 0;
  const hasArchWarnings = report.bySeverity.warn > 0;
  if (hasArchErrors || (strictWarnings && hasArchWarnings)) {
    success = false;
  }

  if (format === "console") {
    const presetDef = getPreset(preset);
    if (quiet) {
      print(`📊 Architecture: ${report.totalViolations} violation(s) (Errors: ${report.bySeverity.error})`);
    } else {
      printReport(report, presetDef.hierarchy);
    }
  }

  // 3) Manifest Guard check (only when spec file exists)
  let manifestGuardSummary: {
    enabled: boolean;
    passed: boolean;
    violations: number;
    errors?: string[];
    autoHealed?: boolean;
    nextAction?: string;
  } = {
    enabled: false,
    passed: true,
    violations: 0,
  };

  if (hasSpec) {
    manifestGuardSummary.enabled = true;

    const manifestResult = await loadManifest(specPath);
    if (!manifestResult.success || !manifestResult.data) {
      manifestGuardSummary.passed = false;
      manifestGuardSummary.errors = manifestResult.errors ?? ["Failed to load spec"];
      success = false;

      if (format === "console") {
        console.error("❌ Failed to load spec:");
        manifestResult.errors?.forEach((e) => console.error(`  - ${e}`));
      }
    } else {
      const guardResult = await runManifestGuardWithAutoHeal(manifestResult.data, rootDir);
      manifestGuardSummary.passed = guardResult.passed;
      manifestGuardSummary.violations = guardResult.violations;
      manifestGuardSummary.autoHealed = guardResult.autoHealed;
      manifestGuardSummary.nextAction = guardResult.nextAction;

      if (format === "console" && guardResult.autoHealed) {
        log("✅ Manifest guard drift auto-healed");
      }
      if (format === "console" && guardResult.nextAction) {
        log("💡 Manifest guard violations remain. Run `mandu guard` for detailed inspection/repair.");
      }

      if (strictWarnings && guardResult.violations > 0) {
        success = false;
      } else {
        success = success && guardResult.passed;
      }

      if (format === "console") {
        const guardReport = buildGuardReport(guardResult.checkResult);
        if (quiet) {
          print(`📊 Manifest Guard: ${manifestGuardSummary.violations} violation(s)`);
        } else {
          printReportSummary(guardReport);
        }
      }
    }
  } else {
    if (quiet) {
      print("ℹ️  No .mandu/routes.manifest.json - skipping Guard");
    } else {
      log("ℹ️  No .mandu/routes.manifest.json - skipping Guard");
    }
  }

  // 4) Config Integrity check (Lockfile)
  const configGuardResult = await guardConfig(rootDir, config);

  if (configGuardResult.action === "error" || configGuardResult.action === "block") {
    success = false;
  }

  if (format === "console") {
    if (!quiet) {
      log("");
    }
    if (quiet) {
      if (configGuardResult.lockfileValid) {
        print(`✅ Config: integrity verified (${configGuardResult.currentHash?.slice(0, 8) ?? "N/A"})`);
      } else if (!configGuardResult.lockfileExists) {
        print(`💡 Config: no lockfile`);
      } else {
        print(`❌ Config: integrity check failed`);
      }
    } else {
      log(formatConfigGuardResult(configGuardResult));
    }
  }

  // 5) Combined health score
  const healthScore = calculateHealthScore(
    report.totalViolations,
    report.bySeverity.error,
    configGuardResult
  );

  if (format === "console" && !quiet) {
    log("");
    log("═══════════════════════════════════════");
    log(`🏥 Health Score: ${healthScore}/100`);
    log("═══════════════════════════════════════");
  }

  if (format !== "console") {
    const summary = {
      ok: success,
      healthScore,
      routes: routesSummary,
      architecture: {
        totalViolations: report.totalViolations,
        bySeverity: report.bySeverity,
        byType: report.byType,
        report,
      },
      config: {
        valid: configGuardResult.lockfileValid,
        exists: configGuardResult.lockfileExists,
        action: configGuardResult.action,
        currentHash: configGuardResult.currentHash,
        lockedHash: configGuardResult.lockedHash,
        errors: configGuardResult.errors,
        warnings: configGuardResult.warnings,
      },
      legacy: manifestGuardSummary,
    };
    console.log(JSON.stringify(summary, null, 2));
  }

  return success;
}
