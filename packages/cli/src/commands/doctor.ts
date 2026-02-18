/**
 * Mandu CLI - Doctor Command
 *
 * Analyzes Guard failures and suggests patches.
 * Works with or without LLM - template-based analysis is always available.
 */

import {
  loadManifest,
  runGuardCheck,
  analyzeViolations,
  printDoctorReport,
  generateDoctorMarkdownReport,
  initializeBrain,
  getBrain,
} from "../../../core/src/index";
import { resolveFromCwd, getRootDir } from "../util/fs";
import path from "path";
import fs from "fs/promises";

export interface DoctorOptions {
  /** Output format: console, json, or markdown */
  format?: "console" | "json" | "markdown";
  /** Whether to use LLM for enhanced analysis */
  useLLM?: boolean;
  /** Output file path (for json/markdown formats) */
  output?: string;
}

export async function doctor(options: DoctorOptions = {}): Promise<boolean> {
  const { format, useLLM = true, output } = options;
  const inferredFormat = format ?? (output ? (path.extname(output).toLowerCase() === ".json" ? "json" : "markdown") : undefined);
  const resolvedFormat = inferredFormat ?? "console";

  const specPath = resolveFromCwd(".mandu/routes.manifest.json");
  const rootDir = getRootDir();

  console.log(`🩺 Mandu Doctor`);
  console.log(`📄 Spec file: ${specPath}`);

  // Initialize Brain
  const brainEnabled = await initializeBrain();
  const brain = getBrain();
  const llmAvailable = await brain.isLLMAvailable();

  if (brainEnabled) {
    console.log(`🧠 Brain: ${llmAvailable ? "LLM enabled" : "template mode"}`);
  } else {
    console.log(`🧠 Brain: disabled`);
  }
  console.log();

  // Load manifest
  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Failed to load spec:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`✅ Spec loaded`);
  console.log(`🔍 Running guard check...\n`);

  // Run guard check
  const checkResult = await runGuardCheck(result.data, rootDir);

  if (checkResult.passed) {
    console.log(`✅ Guard passed - no violations found.`);
    console.log();
    console.log(`💡 Next step: bunx mandu dev`);
    return true;
  }

  console.log(
    `⚠️  ${checkResult.violations.length} violation(s) found - analyzing...\n`
  );

  // Analyze violations
  const analysis = await analyzeViolations(checkResult.violations, {
    useLLM: useLLM && brainEnabled && llmAvailable,
  });

  // Output based on format
  switch (resolvedFormat) {
    case "console":
      printDoctorReport(analysis);
      break;

    case "json": {
      const json = JSON.stringify(
        {
          summary: analysis.summary,
          violations: analysis.violations,
          patches: analysis.patches,
          nextCommand: analysis.nextCommand,
          llmAssisted: analysis.llmAssisted,
        },
        null,
        2
      );

      if (output) {
        await fs.writeFile(output, json, "utf-8");
        console.log(`📄 Report saved to: ${output}`);
      } else {
        console.log(json);
      }
      break;
    }

    case "markdown": {
      const md = generateDoctorMarkdownReport(analysis);

      if (output) {
        await fs.writeFile(output, md, "utf-8");
        console.log(`📄 Report saved to: ${output}`);
      } else {
        console.log(md);
      }
      break;
    }
  }

  return false;
}
