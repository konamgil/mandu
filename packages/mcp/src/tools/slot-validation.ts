import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  DEFAULT_SLOT_CONSTRAINTS,
  API_SLOT_CONSTRAINTS,
  READONLY_SLOT_CONSTRAINTS,
} from "@mandujs/core";

export const slotValidationToolDefinitions: Tool[] = [
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
  void projectRoot;
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
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
  handlers["mandu_get_slot_constraints"] = handlers["mandu.slot.constraints"];

  return handlers;
}
