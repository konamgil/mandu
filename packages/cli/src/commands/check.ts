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
} from "@mandujs/core";
import {
  collectCompilerLintTargets,
  runReactCompilerLint,
  formatCompilerReport,
  type ReactCompilerDiagnostic,
} from "@mandujs/core/compat/bundler/index";
import { resolveReactCompilerConfig } from "@mandujs/core/compat/bundler/plugins/index";
import path from "path";
import { resolveFromCwd, isDirectory, pathExists } from "../util/fs";
import { getFsRoutesGuardPolicy } from "../util/guard-policy";
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

/**
 * Detect whether `oxlint` is reachable from the project — either via a
 * local devDependency (`node_modules/.bin/oxlint`) or the host's PATH.
 * Deliberately cheap: a single `stat()` on the local bin + a `bun x
 * oxlint --version` fallback. Returns `true` on first hit.
 */
async function isOxlintAvailable(rootDir: string): Promise<boolean> {
  const binName = process.platform === "win32" ? "oxlint.exe" : "oxlint";
  const localBin = path.resolve(rootDir, "node_modules", ".bin", binName);
  if (await Bun.file(localBin).exists()) return true;
  try {
    const proc = Bun.spawn({
      cmd: ["bun", "x", "oxlint", "--version"],
      cwd: rootDir,
      stdout: "ignore",
      stderr: "ignore",
    });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/**
 * Run oxlint once and parse the `Found N warnings and M errors` tail
 * from stderr. Returns `null` when the parser miss — we don't guess.
 */
async function runOxlintOnce(rootDir: string): Promise<{ errors: number; warnings: number } | null> {
  try {
    const proc = Bun.spawn({
      cmd: ["bun", "x", "oxlint", "."],
      cwd: rootDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr] = await Promise.all([
      new Response(proc.stderr).text(),
      new Response(proc.stdout).text(),
    ]);
    await proc.exited;
    const match = stderr.match(/Found (\d+) warnings? and (\d+) errors?/);
    if (!match) return null;
    return { warnings: Number(match[1]), errors: Number(match[2]) };
  } catch {
    return null;
  }
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
  // Issue #240 Phase 2 — the generated manifest is reused below by the
  // React Compiler bailout linter, which needs the hydrated-routes set
  // to know which files to feed ESLint. Stored here so we don't
  // regenerate the manifest twice.
  let fsRoutesManifest: Awaited<ReturnType<typeof generateManifest>>["manifest"] | null = null;

  if (enableFsRoutes) {
    routesSummary.enabled = true;

    try {
      if (format === "console") {
        const result = await generateManifest(rootDir, {
          scanner: config.fsRoutes,
        });
        routesSummary.count = result.manifest.routes.length;
        routesSummary.warnings = result.warnings;
        fsRoutesManifest = result.manifest;

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
    fsRoutes: getFsRoutesGuardPolicy(enableFsRoutes),
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

  // 5) Lint (oxlint) — default guardrail
  //
  // If the project has oxlint installed (as a local devDep or on
  // PATH), run it and surface the error/warning counts. Lint errors
  // flip `success = false`; warnings are reported but don't fail.
  // Missing oxlint → skip with a one-line hint so the message channel
  // stays unambiguous.
  let lintSummary: { enabled: boolean; errors: number; warnings: number; skipped: boolean } = {
    enabled: false,
    errors: 0,
    warnings: 0,
    skipped: false,
  };
  {
    const available = await isOxlintAvailable(rootDir);
    if (available) {
      lintSummary.enabled = true;
      const result = await runOxlintOnce(rootDir);
      if (result) {
        lintSummary.errors = result.errors;
        lintSummary.warnings = result.warnings;
        if (result.errors > 0) {
          success = false;
        }
        if (format === "console" && !quiet) {
          if (result.errors === 0 && result.warnings === 0) {
            log("✅ Lint: clean (oxlint, 0/0)");
          } else {
            log(
              `${result.errors === 0 ? "⚠️ " : "❌ "} Lint: ${result.errors} error(s) / ${result.warnings} warning(s) (oxlint)`,
            );
          }
          log("");
        } else if (quiet) {
          print(`📊 Lint: ${result.errors}/${result.warnings} (oxlint)`);
        }
      } else {
        lintSummary.skipped = true;
        if (format === "console" && !quiet) {
          log("⚠️  Lint: oxlint ran but output could not be parsed — skipped");
          log("");
        }
      }
    } else {
      lintSummary.skipped = true;
      if (format === "console" && !quiet) {
        log("ℹ️  Lint: oxlint not installed — skipping. Run `mandu lint --setup` to enable.");
        log("");
      }
    }
  }

  // 6) React Compiler bailout diagnostics (#240 Phase 2)
  //
  // Only runs when:
  //   - `experimental.reactCompiler.enabled: true` in mandu.config.ts
  //   - A manifest was generated above (needs hydrated routes)
  //   - Output format is console (JSON mode keeps a minimal summary)
  //
  // Peer deps (`eslint`, `eslint-plugin-react-compiler`) are optional;
  // the runner logs a single warning and returns `[]` when absent so
  // a user who enabled the flag but forgot to install ESLint never
  // sees `mandu check` blow up.
  const rcConfig = config.experimental?.reactCompiler;
  // #240 Phase 2 — auto-detect peer deps so `mandu check` runs the
  // bailout lint when the user installed `babel-plugin-react-compiler`
  // even without an explicit `enabled: true` in mandu.config.ts.
  const resolvedRc = resolveReactCompilerConfig(rcConfig, rootDir);
  let compilerDiagnostics: ReactCompilerDiagnostic[] = [];
  let compilerSkipped = false;
  if (resolvedRc.enabled && fsRoutesManifest) {
    try {
      const targets = await collectCompilerLintTargets(fsRoutesManifest, rootDir);
      if (targets.length === 0) {
        if (format === "console" && !quiet) {
          log("🧠 React Compiler — no hydrated-route files to lint");
          log("");
        }
      } else {
        const result = await runReactCompilerLint({
          projectRoot: rootDir,
          targetFiles: targets,
          severity: rcConfig?.strict === true ? "error" : "warning",
        });
        compilerDiagnostics = result.diagnostics;
        compilerSkipped = result.skipped;

        if (format === "console") {
          if (!quiet) {
            log(formatCompilerReport(compilerDiagnostics, { projectRoot: rootDir }));
            log("");
          } else if (compilerDiagnostics.length > 0) {
            print(
              `🧠 React Compiler: ${compilerDiagnostics.length} bailout(s) in ${new Set(compilerDiagnostics.map((d) => d.file)).size} file(s)`,
            );
          } else if (!compilerSkipped) {
            print("✅ React Compiler: no bailouts");
          }
        }

        if (rcConfig?.strict === true && compilerDiagnostics.length > 0) {
          success = false;
        }
      }
    } catch (err) {
      if (format === "console") {
        console.warn(
          `⚠️  React Compiler lint failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // 6) Combined health score
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
