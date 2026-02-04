/**
 * mandu check - Workflow Check Command
 *
 * FS Routes + Architecture Guard + Legacy Guard 통합 검사
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
  guardConfig,
  formatConfigGuardResult,
  calculateHealthScore,
  type GuardConfig,
  type ConfigGuardResult,
} from "@mandujs/core";
import path from "path";
import { resolveFromCwd, isDirectory, pathExists } from "../util/fs";
import { resolveOutputFormat } from "../util/output";

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
  const specPath = resolveFromCwd("spec/routes.manifest.json");
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

  // 1) FS Routes 검사
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
          outputPath: ".mandu/routes.manifest.json",
          skipLegacy: true,
        });
        routesSummary.count = result.manifest.routes.length;
        routesSummary.warnings = result.warnings;

        if (quiet) {
          print(`✅ FS Routes: ${routesSummary.count}개`);
        } else {
          log(`✅ FS Routes: ${routesSummary.count}개`);
        }
        if (routesSummary.warnings.length > 0) {
          if (!quiet) {
            log("⚠️  경고:");
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
        console.error("❌ FS Routes 검사 실패:", error);
      }
    }
  } else {
    if (quiet) {
      print("ℹ️  app/ 폴더 없음 - FS Routes 검사 스킵");
    } else {
      log("ℹ️  app/ 폴더 없음 - FS Routes 검사 스킵\n");
    }
  }

  // 2) Architecture Guard 검사
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
      print(`📊 Architecture: ${report.totalViolations}개 위반 (Errors: ${report.bySeverity.error})`);
    } else {
      printReport(report, presetDef.hierarchy);
    }
  }

  // 3) Legacy Guard 검사 (spec 파일이 있을 때만)
  let legacySummary: { enabled: boolean; passed: boolean; violations: number; errors?: string[] } = {
    enabled: false,
    passed: true,
    violations: 0,
  };

  if (hasSpec) {
    legacySummary.enabled = true;

    const manifestResult = await loadManifest(specPath);
    if (!manifestResult.success || !manifestResult.data) {
      legacySummary.passed = false;
      legacySummary.errors = manifestResult.errors ?? ["Spec 로드 실패"];
      success = false;

      if (format === "console") {
        console.error("❌ Spec 로드 실패:");
        manifestResult.errors?.forEach((e) => console.error(`  - ${e}`));
      }
    } else {
      const checkResult = await runGuardCheck(manifestResult.data, rootDir);
      legacySummary.passed = checkResult.passed;
      legacySummary.violations = checkResult.violations.length;
      if (strictWarnings && checkResult.violations.length > 0) {
        success = false;
      } else {
        success = success && checkResult.passed;
      }

      if (format === "console") {
        const legacyReport = buildGuardReport(checkResult);
        if (quiet) {
          print(`📊 Legacy Guard: ${legacySummary.violations}개 위반`);
        } else {
          printReportSummary(legacyReport);
        }
      }
    }
  } else {
    if (quiet) {
      print("ℹ️  spec/routes.manifest.json 없음 - 레거시 Guard 스킵");
    } else {
      log("ℹ️  spec/routes.manifest.json 없음 - 레거시 Guard 스킵");
    }
  }

  // 4) Config Integrity 검사 (Lockfile)
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
        print(`✅ Config: 무결성 확인됨 (${configGuardResult.currentHash?.slice(0, 8) ?? "N/A"})`);
      } else if (!configGuardResult.lockfileExists) {
        print(`💡 Config: Lockfile 없음`);
      } else {
        print(`❌ Config: 무결성 실패`);
      }
    } else {
      log(formatConfigGuardResult(configGuardResult));
    }
  }

  // 5) 통합 헬스 점수
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
      legacy: legacySummary,
    };
    console.log(JSON.stringify(summary, null, 2));
  }

  return success;
}
