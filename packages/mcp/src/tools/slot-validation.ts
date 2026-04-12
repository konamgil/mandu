import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  validateSlotConstraints,
  validateSlots,
  DEFAULT_SLOT_CONSTRAINTS,
  API_SLOT_CONSTRAINTS,
  READONLY_SLOT_CONSTRAINTS,
  type SlotConstraints,
} from "@mandujs/core";

export const slotValidationToolDefinitions: Tool[] = [
  {
    name: "mandu.slot.validate",
    description:
      "Validate a slot file against semantic constraints (lines, complexity, patterns, imports).",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Path to the slot file to validate",
        },
        preset: {
          type: "string",
          enum: ["default", "api", "readonly"],
          description: "Constraint preset to use (default: 'default')",
        },
        constraints: {
          type: "object",
          description: "Custom constraints (overrides preset)",
          properties: {
            maxLines: { type: "number" },
            maxCyclomaticComplexity: { type: "number" },
            requiredPatterns: { type: "array", items: { type: "string" } },
            forbiddenPatterns: { type: "array", items: { type: "string" } },
            allowedImports: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["file"],
    },
  },
  {
    name: "mandu.slot.constraints",
    description:
      "Get recommended slot constraint presets (default, api, readonly).",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["default", "api", "readonly"],
          description: "Constraint preset to retrieve",
        },
      },
      required: [],
    },
  },
];

export function slotValidationTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.slot.validate": async (args: Record<string, unknown>) => {
      const { file, preset, constraints: customConstraints } = args as {
        file: string;
        preset?: "default" | "api" | "readonly";
        constraints?: SlotConstraints;
      };

      if (!file) {
        return {
          error: "File path is required",
          tip: "Provide the path to the slot file to validate",
        };
      }

      // 프리셋 선택
      let constraints: SlotConstraints;
      if (customConstraints) {
        constraints = customConstraints;
      } else {
        switch (preset) {
          case "api":
            constraints = API_SLOT_CONSTRAINTS;
            break;
          case "readonly":
            constraints = READONLY_SLOT_CONSTRAINTS;
            break;
          default:
            constraints = DEFAULT_SLOT_CONSTRAINTS;
        }
      }

      // 파일 경로 정규화 및 보안 검증 (LFI 방지)
      const path = await import("path");
      const rawPath = file.startsWith("/") || file.includes(":")
        ? file
        : path.join(projectRoot, file);
      const filePath = path.normalize(path.resolve(rawPath));
      const normalizedRoot = path.normalize(path.resolve(projectRoot));

      // 경로가 프로젝트 루트 내에 있는지 검증
      if (!filePath.startsWith(normalizedRoot)) {
        return {
          error: "Access denied: File path is outside project root",
          tip: "Only files within the project directory can be validated",
          requestedPath: file,
          projectRoot: projectRoot,
        };
      }

      const result = await validateSlotConstraints(filePath, constraints);

      return {
        valid: result.valid,
        file: result.filePath,
        stats: result.stats,
        violations: result.violations.map((v) => ({
          type: v.type,
          severity: v.severity,
          message: v.message,
          suggestion: v.suggestion,
          line: v.line,
        })),
        suggestions: result.suggestions,
        constraintsUsed: constraints,
        tip: result.valid
          ? "✅ Slot passes all constraints"
          : "Fix violations before deployment. Use mandu.slot.constraints for guidance.",
      };
    },

    "mandu.slot.constraints": async (args: Record<string, unknown>) => {
      const { preset } = args as { preset?: "default" | "api" | "readonly" };

      const presets = {
        default: {
          name: "Default",
          description: "Basic constraints for general slots",
          constraints: DEFAULT_SLOT_CONSTRAINTS,
        },
        api: {
          name: "API Slot",
          description: "Constraints for API handlers with validation requirements",
          constraints: API_SLOT_CONSTRAINTS,
        },
        readonly: {
          name: "Read-only Slot",
          description: "Strict constraints for read-only operations (no DB writes)",
          constraints: READONLY_SLOT_CONSTRAINTS,
        },
      };

      if (preset) {
        const selected = presets[preset];
        return {
          preset: preset,
          ...selected,
          usage: `
.constraints(${JSON.stringify(selected.constraints, null, 2)})
          `.trim(),
        };
      }

      return {
        available: Object.entries(presets).map(([key, value]) => ({
          preset: key,
          name: value.name,
          description: value.description,
          constraints: value.constraints,
        })),
        tip: "Use these constraints with Mandu.filling().constraints({...}) to enforce slot rules.",
        example: `
Mandu.filling()
  .purpose("사용자 목록 조회 API")
  .constraints({
    maxLines: 50,
    maxCyclomaticComplexity: 10,
    requiredPatterns: ["input-validation", "error-handling"],
    forbiddenPatterns: ["direct-db-write"],
    allowedImports: ["server/domain/*", "shared/utils/*"],
  })
  .get(async (ctx) => { ... });
        `.trim(),
      };
    },
  };

  // Backward-compatible aliases
  handlers["mandu_validate_slot"] = handlers["mandu.slot.validate"];
  handlers["mandu_get_slot_constraints"] = handlers["mandu.slot.constraints"];

  return handlers;
}
