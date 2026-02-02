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
  loadManifest,
  runGuardCheck,
  buildGuardReport,
  printReportSummary,
  type GuardConfig,
  type GuardPreset,
} from "@mandujs/core";
import path from "path";
import { resolveFromCwd, isDirectory, pathExists } from "../util/fs";
import { resolveOutputFormat, type OutputFormat } from "../util/output";

export interface CheckOptions {
  preset?: GuardPreset;
  format?: OutputFormat;
  ci?: boolean;
  quiet?: boolean;
  legacy?: boolean;
}

export async function check(options: CheckOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const preset = options.preset ?? "mandu";
  const format = resolveOutputFormat(options.format);
  const quiet = options.quiet === true;
  const strictWarnings = options.ci === true;
  const enableFsRoutes = !options.legacy && await isDirectory(path.resolve(rootDir, "app"));
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
        const scan = await scanRoutes(rootDir);
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
  const guardConfig: GuardConfig = {
    preset,
    srcDir: "src",
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

  const report = await checkDirectory(guardConfig, rootDir);
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

  if (format !== "console") {
    const summary = {
      ok: success,
      routes: routesSummary,
      architecture: {
        totalViolations: report.totalViolations,
        bySeverity: report.bySeverity,
        byType: report.byType,
        report,
      },
      legacy: legacySummary,
    };
    console.log(JSON.stringify(summary, null, 2));
  }

  return success;
}
