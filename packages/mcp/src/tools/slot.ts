import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  validateSlotContent,
  correctSlotContent,
  summarizeValidationIssues,
} from "@mandujs/core";
import { getProjectPaths, isInsideProject } from "../utils/project.js";
import path from "path";

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
          ? "Content is valid. Use Edit tool to write the slot file."
          : autoFixable.length > 0
            ? "Auto-fixable issues found. Apply corrections and use Edit tool to write."
            : "Manual fixes required before writing. Use Edit tool after fixing.",
      };
    },
  };
}
