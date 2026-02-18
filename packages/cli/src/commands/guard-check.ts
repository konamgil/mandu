import {
  loadManifest,
  runGuardCheck,
  buildGuardReport,
  printReportSummary,
  writeReport,
  runAutoCorrect,
  isAutoCorrectableViolation,
} from "@mandujs/core";
import { resolveFromCwd, getRootDir } from "../util/fs";

export interface GuardCheckOptions {
  autoCorrect?: boolean;
}

export async function guardCheck(options: GuardCheckOptions = {}): Promise<boolean> {
  const { autoCorrect = true } = options;

  const specPath = resolveFromCwd(".mandu/routes.manifest.json");
  const rootDir = getRootDir();

  console.log(`🥟 Mandu Guard (Legacy Spec)`);
  console.log(`📄 Spec file: ${specPath}`);
  console.log(`🔧 Auto-correct: ${autoCorrect ? "ON" : "OFF"}\n`);

  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Failed to load spec:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`✅ Spec loaded`);
  console.log(`🔍 Running guard check...\n`);

  let checkResult = await runGuardCheck(result.data, rootDir);

  // Attempt auto-correct
  if (!checkResult.passed && autoCorrect) {
    const autoCorrectableCount = checkResult.violations.filter(isAutoCorrectableViolation).length;

    if (autoCorrectableCount > 0) {
      console.log(`⚠️  ${checkResult.violations.length} violation(s) detected (auto-correctable: ${autoCorrectableCount})`);
      console.log(`🔄 Running auto-correct...\n`);

      const autoCorrectResult = await runAutoCorrect(
        checkResult.violations,
        result.data,
        rootDir
      );

      // Print completed steps
      for (const step of autoCorrectResult.steps) {
        const icon = step.success ? "✅" : "❌";
        console.log(`  ${icon} [${step.action}] ${step.message}`);
      }

      if (autoCorrectResult.fixed) {
        console.log(`\n✅ Auto-correct complete (${autoCorrectResult.retriedCount} retries)`);
        if (autoCorrectResult.changeId) {
          console.log(`   Transaction: ${autoCorrectResult.changeId} (committed)`);
        }

        // Final guard re-check
        checkResult = await runGuardCheck(result.data, rootDir);
      } else if (autoCorrectResult.rolledBack) {
        console.log(`\n⚠️  Auto-correct failed - rolled back`);
        if (autoCorrectResult.changeId) {
          console.log(`   Transaction: ${autoCorrectResult.changeId} (rolled back)`);
        }
        console.log(`   Restored to original state.`);

        const manualViolations = autoCorrectResult.remainingViolations.filter(
          (v) => !isAutoCorrectableViolation(v)
        );

        if (manualViolations.length > 0) {
          console.log(`\n⚠️  Violations requiring manual fix:`);
          for (const v of manualViolations) {
            console.log(`  - [${v.ruleId}] ${v.file}`);
            console.log(`    💡 ${v.suggestion}`);
          }
        }

        // Update with remaining violations
        checkResult = {
          passed: false,
          violations: autoCorrectResult.remainingViolations,
        };
      } else {
        console.log(`\n⚠️  Some violations require manual fix:`);

        const manualViolations = autoCorrectResult.remainingViolations.filter(
          (v) => !isAutoCorrectableViolation(v)
        );

        for (const v of manualViolations) {
          console.log(`  - [${v.ruleId}] ${v.file}`);
          console.log(`    💡 ${v.suggestion}`);
        }

        // Update with remaining violations
        checkResult = {
          passed: autoCorrectResult.remainingViolations.length === 0,
          violations: autoCorrectResult.remainingViolations,
        };
      }

      console.log("");
    }
  }

  const report = buildGuardReport(checkResult);
  printReportSummary(report);

  const reportPath = resolveFromCwd("mandu-report.json");
  await writeReport(report, reportPath);
  console.log(`📋 Report saved: ${reportPath}`);

  if (!checkResult.passed) {
    console.log(`\n❌ Guard failed: ${checkResult.violations.length} violation(s) found`);
    return false;
  }

  console.log(`\n✅ Guard passed`);
  console.log(`💡 Next step: bunx mandu dev`);

  return true;
}
