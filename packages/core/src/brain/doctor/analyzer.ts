/**
 * Brain v0.1 - Doctor Analyzer
 *
 * Analyzes Guard violations to determine root causes.
 * Works with or without LLM - template-based analysis is always available.
 */

import type { GuardViolation } from "../../guard/rules";
import { GUARD_RULES } from "../../guard/rules";
import type { DoctorAnalysis, PatchSuggestion } from "../types";
import { getBrain } from "../brain";
import { getSessionMemory } from "../memory";

/**
 * Violation category for grouping
 */
export type ViolationCategory =
  | "spec"
  | "generated"
  | "slot"
  | "contract"
  | "unknown";

/**
 * Categorize a violation by its rule ID
 */
export function categorizeViolation(ruleId: string): ViolationCategory {
  if (ruleId.includes("SPEC") || ruleId === "SPEC_HASH_MISMATCH") {
    return "spec";
  }
  if (ruleId.includes("GENERATED") || ruleId.includes("FORBIDDEN_IMPORT")) {
    return "generated";
  }
  if (ruleId.includes("SLOT")) {
    return "slot";
  }
  if (ruleId.includes("CONTRACT")) {
    return "contract";
  }
  return "unknown";
}

/**
 * Template-based root cause analysis
 *
 * Provides analysis without requiring LLM.
 */
export function analyzeRootCauseTemplate(
  violations: GuardViolation[]
): { summary: string; explanation: string } {
  if (violations.length === 0) {
    return {
      summary: "No violations detected",
      explanation: "All Guard checks passed successfully.",
    };
  }

  // Group violations by category
  const grouped = new Map<ViolationCategory, GuardViolation[]>();
  for (const v of violations) {
    const category = categorizeViolation(v.ruleId);
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(v);
  }

  // Build summary
  const summaryParts: string[] = [];
  const explanationParts: string[] = [];

  // Spec issues
  const specViolations = grouped.get("spec") || [];
  if (specViolations.length > 0) {
    summaryParts.push(`${specViolations.length} spec 관련 위반`);
    explanationParts.push(
      `## Spec 관련 문제\n` +
        specViolations.map((v) => `- ${v.message}`).join("\n") +
        `\n\n원인: spec 파일이 변경되었거나 lock 파일과 동기화가 필요합니다.`
    );
  }

  // Generated issues
  const generatedViolations = grouped.get("generated") || [];
  if (generatedViolations.length > 0) {
    summaryParts.push(`${generatedViolations.length} generated 파일 위반`);
    explanationParts.push(
      `## Generated 파일 문제\n` +
        generatedViolations.map((v) => `- ${v.message}`).join("\n") +
        `\n\n원인: generated 파일이 수동으로 수정되었거나 금지된 import가 있습니다.`
    );
  }

  // Slot issues
  const slotViolations = grouped.get("slot") || [];
  if (slotViolations.length > 0) {
    summaryParts.push(`${slotViolations.length} slot 파일 위반`);
    explanationParts.push(
      `## Slot 파일 문제\n` +
        slotViolations.map((v) => `- ${v.message}`).join("\n") +
        `\n\n원인: slot 파일이 없거나 필수 패턴이 누락되었습니다.`
    );
  }

  // Contract issues
  const contractViolations = grouped.get("contract") || [];
  if (contractViolations.length > 0) {
    summaryParts.push(`${contractViolations.length} contract 위반`);
    explanationParts.push(
      `## Contract 문제\n` +
        contractViolations.map((v) => `- ${v.message}`).join("\n") +
        `\n\n원인: contract와 slot 간의 불일치가 있습니다.`
    );
  }

  // Unknown issues
  const unknownViolations = grouped.get("unknown") || [];
  if (unknownViolations.length > 0) {
    summaryParts.push(`${unknownViolations.length} 기타 위반`);
    explanationParts.push(
      `## 기타 문제\n` + unknownViolations.map((v) => `- ${v.message}`).join("\n")
    );
  }

  return {
    summary: summaryParts.join(", "),
    explanation: explanationParts.join("\n\n"),
  };
}

/**
 * Generate template-based patch suggestions
 */
export function generateTemplatePatches(
  violations: GuardViolation[]
): PatchSuggestion[] {
  const patches: PatchSuggestion[] = [];

  for (const violation of violations) {
    switch (violation.ruleId) {
      case GUARD_RULES.SPEC_HASH_MISMATCH?.id:
        patches.push({
          file: ".mandu/spec.lock.json",
          description: "Spec lock 파일 갱신",
          type: "command",
          command: "bunx mandu spec-upsert",
          confidence: 0.9,
        });
        break;

      case GUARD_RULES.GENERATED_MANUAL_EDIT?.id:
        patches.push({
          file: violation.file,
          description: "Generated 파일 재생성",
          type: "command",
          command: "bunx mandu generate",
          confidence: 0.9,
        });
        break;

      case GUARD_RULES.SLOT_NOT_FOUND?.id:
        patches.push({
          file: violation.file,
          description: "Slot 파일 생성",
          type: "command",
          command: "bunx mandu generate",
          confidence: 0.8,
        });
        break;

      case GUARD_RULES.SLOT_MISSING_DEFAULT_EXPORT?.id:
        patches.push({
          file: violation.file,
          description: "Default export 추가",
          type: "modify",
          content: `// Add default export to your slot file:\nexport default Mandu.filling()...`,
          confidence: 0.7,
        });
        break;

      case GUARD_RULES.SLOT_MISSING_FILLING_PATTERN?.id:
        patches.push({
          file: violation.file,
          description: "Mandu.filling() 패턴 추가",
          type: "modify",
          content: `import { Mandu } from "@mandujs/core";\n\nexport default Mandu.filling()\n  .get(async (ctx) => {\n    return ctx.json({ message: "Hello" });\n  });`,
          confidence: 0.6,
        });
        break;

      case GUARD_RULES.CONTRACT_METHOD_NOT_IMPLEMENTED?.id:
        patches.push({
          file: violation.file,
          description: "Contract 메서드 구현 또는 sync",
          type: "command",
          command: `bunx mandu contract validate --verbose`,
          confidence: 0.7,
        });
        break;

      case GUARD_RULES.FORBIDDEN_IMPORT_IN_GENERATED?.id:
        patches.push({
          file: violation.file,
          description: "Generated 파일 재생성 (금지된 import 제거)",
          type: "command",
          command: "bunx mandu generate",
          confidence: 0.8,
        });
        break;

      default:
        // Generic suggestion based on violation.suggestion
        if (violation.suggestion) {
          if (violation.suggestion.includes("generate")) {
            patches.push({
              file: violation.file,
              description: violation.suggestion,
              type: "command",
              command: "bunx mandu generate",
              confidence: 0.5,
            });
          } else {
            patches.push({
              file: violation.file,
              description: violation.suggestion,
              type: "modify",
              confidence: 0.4,
            });
          }
        }
    }
  }

  return patches;
}

/**
 * LLM-enhanced prompt for root cause analysis
 */
export function buildAnalysisPrompt(violations: GuardViolation[]): string {
  const violationList = violations
    .map(
      (v, i) =>
        `${i + 1}. [${v.ruleId}] ${v.file}\n   Message: ${v.message}\n   Suggestion: ${v.suggestion || "None"}`
    )
    .join("\n\n");

  return `You are analyzing Mandu framework Guard violations.
Mandu is a spec-driven fullstack framework where:
- spec/ contains route manifests and slot files
- generated/ contains auto-generated code (DO NOT EDIT)
- slots handle business logic
- contracts define API schemas

Analyze these violations and provide:
1. A brief summary (1-2 sentences) of the root cause
2. A detailed explanation of why these violations occurred
3. The recommended fix order

Violations:
${violationList}

Respond in Korean. Be concise and actionable.`;
}

/**
 * Parse LLM analysis response
 */
export function parseLLMAnalysis(
  response: string,
  fallback: { summary: string; explanation: string }
): { summary: string; explanation: string } {
  if (!response || response.trim().length === 0) {
    return fallback;
  }

  // Try to extract summary (first paragraph or sentence)
  const lines = response.split("\n").filter((l) => l.trim());
  const summary = lines[0]?.trim() || fallback.summary;

  // Rest is explanation
  const explanation = lines.slice(1).join("\n").trim() || fallback.explanation;

  return { summary, explanation };
}

/**
 * Analyze Guard violations
 *
 * Uses LLM if available for enhanced analysis,
 * falls back to template-based analysis otherwise.
 */
export async function analyzeViolations(
  violations: GuardViolation[],
  options: { useLLM?: boolean } = {}
): Promise<DoctorAnalysis> {
  const { useLLM = true } = options;

  // Store in memory
  const memory = getSessionMemory();
  memory.setGuardResult(violations);

  // Template-based analysis (always available)
  const templateAnalysis = analyzeRootCauseTemplate(violations);
  const templatePatches = generateTemplatePatches(violations);

  // Determine recommended next command
  let nextCommand = "bunx mandu generate";
  if (violations.some((v) => v.ruleId === GUARD_RULES.SPEC_HASH_MISMATCH?.id)) {
    nextCommand = "bunx mandu spec-upsert";
  }

  // If LLM is not requested or not available, return template analysis
  if (!useLLM) {
    return {
      violations,
      summary: templateAnalysis.summary,
      explanation: templateAnalysis.explanation,
      patches: templatePatches,
      llmAssisted: false,
      nextCommand,
    };
  }

  // Try LLM-enhanced analysis
  const brain = getBrain();
  const llmAvailable = await brain.isLLMAvailable();

  if (!llmAvailable || !brain.enabled) {
    return {
      violations,
      summary: templateAnalysis.summary,
      explanation: templateAnalysis.explanation,
      patches: templatePatches,
      llmAssisted: false,
      nextCommand,
    };
  }

  // Generate LLM analysis
  const prompt = buildAnalysisPrompt(violations);
  const llmResponse = await brain.generate(prompt);

  if (llmResponse) {
    const llmAnalysis = parseLLMAnalysis(llmResponse, templateAnalysis);

    return {
      violations,
      summary: llmAnalysis.summary,
      explanation: llmAnalysis.explanation,
      patches: templatePatches, // Still use template patches (LLM for analysis, not patches)
      llmAssisted: true,
      nextCommand,
    };
  }

  // Fallback to template
  return {
    violations,
    summary: templateAnalysis.summary,
    explanation: templateAnalysis.explanation,
    patches: templatePatches,
    llmAssisted: false,
    nextCommand,
  };
}
