import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  validateSlotContent,
  correctSlotContent,
  runSlotCorrection,
  summarizeValidationIssues,
} from "@mandujs/core";
import { getProjectPaths, isInsideProject } from "../utils/project.js";
import path from "path";
import fs from "fs/promises";

export const slotToolDefinitions: Tool[] = [
  {
    name: "mandu_read_slot",
    description: "Read the contents of a slot file for a specific route",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID whose slot file to read",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_write_slot",
    description:
      "Write or update the contents of a slot file with optional auto-correction",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID whose slot file to write",
        },
        content: {
          type: "string",
          description: "The TypeScript content to write to the slot file",
        },
        autoCorrect: {
          type: "boolean",
          description:
            "If true, automatically fix correctable issues (default: false)",
        },
        maxRetries: {
          type: "number",
          description:
            "Maximum correction attempts when autoCorrect is true (default: 3)",
        },
        validateOnly: {
          type: "boolean",
          description:
            "If true, only validate without writing (default: false)",
        },
      },
      required: ["routeId", "content"],
    },
  },
  {
    name: "mandu_validate_slot",
    description:
      "Validate slot content without writing, get issues and suggestions",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The TypeScript content to validate",
        },
      },
      required: ["content"],
    },
  },
];

export function slotTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_read_slot: async (args: Record<string, unknown>) => {
      const { routeId } = args as { routeId: string };

      // Load manifest to find the route
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      const route = manifestResult.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      if (!route.slotModule) {
        return {
          error: `Route '${routeId}' does not have a slotModule defined`,
          tip: "Add slotModule to the route spec or use mandu_update_route",
        };
      }

      const slotPath = path.join(projectRoot, route.slotModule);

      // Security check
      if (!isInsideProject(slotPath, projectRoot)) {
        return { error: "Slot path is outside project directory" };
      }

      try {
        const file = Bun.file(slotPath);
        if (!(await file.exists())) {
          return {
            exists: false,
            slotPath: route.slotModule,
            message: "Slot file does not exist. Run mandu_generate to create it.",
          };
        }

        const content = await file.text();

        // 기존 슬롯 내용도 검증
        const validation = validateSlotContent(content);

        return {
          exists: true,
          slotPath: route.slotModule,
          content,
          lineCount: content.split("\n").length,
          validation: {
            valid: validation.valid,
            summary: summarizeValidationIssues(validation.issues),
            issues: validation.issues,
          },
        };
      } catch (error) {
        return {
          error: `Failed to read slot file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    mandu_write_slot: async (args: Record<string, unknown>) => {
      const {
        routeId,
        content,
        autoCorrect = false,
        maxRetries = 3,
        validateOnly = false,
      } = args as {
        routeId: string;
        content: string;
        autoCorrect?: boolean;
        maxRetries?: number;
        validateOnly?: boolean;
      };

      // Load manifest to find the route
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      const route = manifestResult.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      if (!route.slotModule) {
        return {
          error: `Route '${routeId}' does not have a slotModule defined`,
          tip: "Add slotModule to the route spec first",
        };
      }

      const slotPath = path.join(projectRoot, route.slotModule);

      // Security check
      if (!isInsideProject(slotPath, projectRoot)) {
        return { error: "Slot path is outside project directory" };
      }

      // 1. 초기 검증
      const initialValidation = validateSlotContent(content);

      // validateOnly 모드면 검증 결과만 반환
      if (validateOnly) {
        return {
          validateOnly: true,
          valid: initialValidation.valid,
          summary: summarizeValidationIssues(initialValidation.issues),
          issues: initialValidation.issues,
          tip: initialValidation.valid
            ? "Content is valid and ready to write"
            : "Fix the issues and try again, or use autoCorrect: true",
        };
      }

      // 2. autoCorrect 모드
      let finalContent = content;
      let correctionResult = null;

      if (autoCorrect && !initialValidation.valid) {
        correctionResult = await runSlotCorrection(
          content,
          validateSlotContent,
          maxRetries
        );
        finalContent = correctionResult.finalContent;

        // 여전히 에러가 있으면 쓰기 거부
        if (!correctionResult.success) {
          const errors = correctionResult.remainingIssues.filter(
            (i) => i.severity === "error"
          );
          if (errors.length > 0) {
            return {
              success: false,
              autoCorrectAttempted: true,
              attempts: correctionResult.attempts,
              appliedFixes: correctionResult.allFixes,
              remainingErrors: errors,
              summary: `${correctionResult.allFixes.length}개 문제 수정, ${errors.length}개 에러 남음`,
              tip: "수동으로 수정이 필요한 에러가 있습니다",
              suggestedContent: finalContent, // 부분적으로 수정된 내용 제공
            };
          }
        }
      } else if (!autoCorrect && !initialValidation.valid) {
        // autoCorrect 없이 에러가 있으면 경고와 함께 진행 여부 결정
        const errors = initialValidation.issues.filter(
          (i) => i.severity === "error"
        );
        if (errors.length > 0) {
          return {
            success: false,
            valid: false,
            errors,
            summary: summarizeValidationIssues(initialValidation.issues),
            tip: "Use autoCorrect: true to attempt automatic fixes, or fix manually",
            autoFixable: initialValidation.issues
              .filter((i) => i.autoFixable)
              .map((i) => i.code),
          };
        }
      }

      // 3. 파일 쓰기
      try {
        // Ensure directory exists
        const slotDir = path.dirname(slotPath);
        await fs.mkdir(slotDir, { recursive: true });

        // Check if file exists (for backup/warning)
        const file = Bun.file(slotPath);
        const existed = await file.exists();
        let previousContent: string | null = null;

        if (existed) {
          previousContent = await file.text();
        }

        // Write the new content
        await Bun.write(slotPath, finalContent);

        // 최종 검증
        const finalValidation = validateSlotContent(finalContent);

        const result: Record<string, unknown> = {
          success: true,
          slotPath: route.slotModule,
          action: existed ? "updated" : "created",
          lineCount: finalContent.split("\n").length,
          previousLineCount: previousContent
            ? previousContent.split("\n").length
            : null,
          validation: {
            valid: finalValidation.valid,
            summary: summarizeValidationIssues(finalValidation.issues),
            warnings: finalValidation.issues.filter(
              (i) => i.severity === "warning"
            ),
          },
        };

        // autoCorrect 결과 추가
        if (correctionResult) {
          result.autoCorrection = {
            applied: true,
            attempts: correctionResult.attempts,
            fixes: correctionResult.allFixes,
          };
        }

        return result;
      } catch (error) {
        return {
          error: `Failed to write slot file: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    mandu_validate_slot: async (args: Record<string, unknown>) => {
      const { content } = args as { content: string };

      const validation = validateSlotContent(content);

      // 자동 수정 가능한 항목 분류
      const autoFixable = validation.issues.filter((i) => i.autoFixable);
      const manualFix = validation.issues.filter((i) => !i.autoFixable);

      // 수정 미리보기 제공
      let correctionPreview = null;
      if (autoFixable.length > 0) {
        const correction = correctSlotContent(content, validation.issues);
        correctionPreview = {
          wouldFix: correction.appliedFixes.length,
          fixes: correction.appliedFixes,
          resultingContent:
            correction.corrected
              ? `(${correction.content.split("\n").length} lines after correction)`
              : null,
        };
      }

      return {
        valid: validation.valid,
        summary: summarizeValidationIssues(validation.issues),
        errors: validation.issues.filter((i) => i.severity === "error"),
        warnings: validation.issues.filter((i) => i.severity === "warning"),
        autoFixable: autoFixable.map((i) => ({
          code: i.code,
          message: i.message,
          line: i.line,
        })),
        manualFixRequired: manualFix.map((i) => ({
          code: i.code,
          message: i.message,
          suggestion: i.suggestion,
          line: i.line,
        })),
        correctionPreview,
        tip: validation.valid
          ? "Content is valid"
          : autoFixable.length > 0
            ? "Use mandu_write_slot with autoCorrect: true to auto-fix"
            : "Manual fixes required before writing",
      };
    },
  };
}
