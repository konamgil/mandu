/**
 * Brain v0.1 - Doctor Patcher
 *
 * Generates and applies minimal patches to fix violations.
 * Auto-apply is disabled by default - patches are suggestions only.
 */

import type { PatchSuggestion } from "../types";
import type { DoctorAnalysis } from "../types";
import {
  validatePatchSuggestion,
  filterSafePatchSuggestions,
} from "../permissions";
import path from "path";
import fs from "fs/promises";

/**
 * Patch application result
 */
export interface PatchResult {
  /** Whether the patch was applied */
  applied: boolean;
  /** The patch that was applied */
  patch: PatchSuggestion;
  /** Error message if failed */
  error?: string;
  /** Output from command (for command type) */
  output?: string;
}

/**
 * Batch patch result
 */
export interface BatchPatchResult {
  /** Total patches attempted */
  total: number;
  /** Successfully applied */
  applied: number;
  /** Failed patches */
  failed: number;
  /** Skipped (unsafe) patches */
  skipped: number;
  /** Individual results */
  results: PatchResult[];
}

/**
 * Prioritize patches by confidence and type
 */
export function prioritizePatches(patches: PatchSuggestion[]): PatchSuggestion[] {
  return [...patches].sort((a, b) => {
    // Commands before modifications
    if (a.type === "command" && b.type !== "command") return -1;
    if (b.type === "command" && a.type !== "command") return 1;

    // Higher confidence first
    return b.confidence - a.confidence;
  });
}

/**
 * Deduplicate patches by file and type
 */
export function deduplicatePatches(patches: PatchSuggestion[]): PatchSuggestion[] {
  const seen = new Set<string>();
  const result: PatchSuggestion[] = [];

  for (const patch of patches) {
    const key = `${patch.file}:${patch.type}:${patch.command || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(patch);
    }
  }

  return result;
}

/**
 * Generate a minimal patch for a violation
 *
 * Returns a human-readable patch description.
 */
export function generatePatchDescription(patch: PatchSuggestion): string {
  const confidenceLabel =
    patch.confidence >= 0.8
      ? "높음"
      : patch.confidence >= 0.5
        ? "보통"
        : "낮음";

  switch (patch.type) {
    case "command":
      return `[명령어 실행] ${patch.command}\n  대상: ${patch.file}\n  설명: ${patch.description}\n  신뢰도: ${confidenceLabel}`;

    case "add":
      return `[파일 생성] ${patch.file}\n  설명: ${patch.description}\n  신뢰도: ${confidenceLabel}`;

    case "modify":
      const lineInfo = patch.line ? ` (라인 ${patch.line})` : "";
      return `[파일 수정] ${patch.file}${lineInfo}\n  설명: ${patch.description}\n  신뢰도: ${confidenceLabel}`;

    case "delete":
      return `[파일 삭제] ${patch.file}\n  설명: ${patch.description}\n  신뢰도: ${confidenceLabel}`;

    default:
      return `[${patch.type}] ${patch.file}\n  설명: ${patch.description}`;
  }
}

/**
 * Apply a single patch
 *
 * NOTE: This is experimental and disabled by default.
 * Only applies safe patches (commands like mandu generate).
 */
export async function applyPatch(
  patch: PatchSuggestion,
  rootDir: string
): Promise<PatchResult> {
  // Validate patch first
  const validation = validatePatchSuggestion(patch);

  if (!validation.valid) {
    return {
      applied: false,
      patch,
      error: validation.reason || "Patch validation failed",
    };
  }

  if (validation.requiresConfirmation) {
    return {
      applied: false,
      patch,
      error: `Manual confirmation required: ${validation.reason}`,
    };
  }

  try {
    switch (patch.type) {
      case "command": {
        if (!patch.command) {
          return {
            applied: false,
            patch,
            error: "No command specified",
          };
        }

        // Only allow mandu commands for safety
        if (!patch.command.startsWith("bunx mandu")) {
          return {
            applied: false,
            patch,
            error: "Only mandu commands are allowed for auto-apply",
          };
        }

        // Execute the command
        const proc = Bun.spawn(patch.command.split(" "), {
          cwd: rootDir,
          stdout: "pipe",
          stderr: "pipe",
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
          return {
            applied: false,
            patch,
            error: stderr || `Command exited with code ${exitCode}`,
            output: stdout,
          };
        }

        return {
          applied: true,
          patch,
          output: stdout,
        };
      }

      case "add":
      case "modify": {
        if (!patch.content) {
          return {
            applied: false,
            patch,
            error: "No content specified for file operation",
          };
        }

        const filePath = path.join(rootDir, patch.file);

        // Ensure directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        // Write content
        await fs.writeFile(filePath, patch.content, "utf-8");

        return {
          applied: true,
          patch,
        };
      }

      case "delete": {
        const filePath = path.join(rootDir, patch.file);

        try {
          await fs.unlink(filePath);
          return {
            applied: true,
            patch,
          };
        } catch (error) {
          return {
            applied: false,
            patch,
            error:
              error instanceof Error
                ? error.message
                : "Failed to delete file",
          };
        }
      }

      default:
        return {
          applied: false,
          patch,
          error: `Unknown patch type: ${patch.type}`,
        };
    }
  } catch (error) {
    return {
      applied: false,
      patch,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Apply multiple patches
 *
 * NOTE: Auto-apply is experimental and disabled by default.
 */
export async function applyPatches(
  patches: PatchSuggestion[],
  rootDir: string,
  options: { dryRun?: boolean; minConfidence?: number } = {}
): Promise<BatchPatchResult> {
  const { dryRun = true, minConfidence = 0.5 } = options;

  // Filter safe patches
  const safePatches = filterSafePatchSuggestions(patches);

  // Filter by confidence
  const confidentPatches = safePatches.filter(
    (p) => p.confidence >= minConfidence
  );

  // Deduplicate and prioritize
  const orderedPatches = prioritizePatches(deduplicatePatches(confidentPatches));

  const results: PatchResult[] = [];
  let applied = 0;
  let failed = 0;
  const skipped = patches.length - orderedPatches.length;

  for (const patch of orderedPatches) {
    if (dryRun) {
      // In dry run mode, just report what would be done
      results.push({
        applied: false,
        patch,
        error: "Dry run mode - patch not applied",
      });
      continue;
    }

    const result = await applyPatch(patch, rootDir);
    results.push(result);

    if (result.applied) {
      applied++;
    } else {
      failed++;
    }
  }

  return {
    total: patches.length,
    applied,
    failed,
    skipped,
    results,
  };
}

/**
 * Generate a patch report from analysis
 */
export function generatePatchReport(analysis: DoctorAnalysis): string {
  const lines: string[] = [];

  lines.push("# Mandu Doctor Report");
  lines.push("");
  lines.push(`## 요약`);
  lines.push(analysis.summary);
  lines.push("");

  if (analysis.explanation) {
    lines.push(`## 상세 분석`);
    lines.push(analysis.explanation);
    lines.push("");
  }

  if (analysis.patches.length > 0) {
    lines.push(`## 제안된 패치 (${analysis.patches.length}개)`);
    lines.push("");

    const prioritized = prioritizePatches(analysis.patches);

    for (let i = 0; i < prioritized.length; i++) {
      lines.push(`### ${i + 1}. ${prioritized[i].description}`);
      lines.push(generatePatchDescription(prioritized[i]));
      lines.push("");
    }
  }

  if (analysis.nextCommand) {
    lines.push(`## 권장 다음 명령어`);
    lines.push("```bash");
    lines.push(analysis.nextCommand);
    lines.push("```");
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`LLM 지원: ${analysis.llmAssisted ? "예" : "아니오"}`);

  return lines.join("\n");
}
