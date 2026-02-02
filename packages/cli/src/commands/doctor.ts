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
  const { format = "console", useLLM = true, output } = options;

  const specPath = resolveFromCwd("spec/routes.manifest.json");
  const rootDir = getRootDir();

  console.log(`🩺 Mandu Doctor`);
  console.log(`📄 Spec 파일: ${specPath}`);

  // Initialize Brain
  const brainEnabled = await initializeBrain();
  const brain = getBrain();
  const llmAvailable = await brain.isLLMAvailable();

  if (brainEnabled) {
    console.log(`🧠 Brain: ${llmAvailable ? "LLM 활성화" : "템플릿 모드"}`);
  } else {
    console.log(`🧠 Brain: 비활성화`);
  }
  console.log();

  // Load manifest
  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Spec 로드 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    return false;
  }

  console.log(`✅ Spec 로드 완료`);
  console.log(`🔍 Guard 검사 중...\n`);

  // Run guard check
  const checkResult = await runGuardCheck(result.data, rootDir);

  if (checkResult.passed) {
    console.log(`✅ Guard 통과 - 위반 사항이 없습니다.`);
    console.log();
    console.log(`💡 다음 단계: bunx mandu dev`);
    return true;
  }

  console.log(
    `⚠️  ${checkResult.violations.length}개 위반 발견 - 분석 중...\n`
  );

  // Analyze violations
  const analysis = await analyzeViolations(checkResult.violations, {
    useLLM: useLLM && brainEnabled && llmAvailable,
  });

  // Output based on format
  switch (format) {
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
