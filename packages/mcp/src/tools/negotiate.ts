import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  negotiate,
  generateScaffold,
  analyzeExistingStructure,
  type NegotiationRequest,
  type FeatureCategory,
  type GuardPreset,
} from "@mandujs/core";

export const negotiateToolDefinitions: Tool[] = [
  {
    name: "mandu.negotiate",
    description:
      "Negotiate recommended structure and file templates before implementing a feature. " +
      "IMPORTANT: featureName must be a short English kebab-case slug.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "What you want to implement, in any language (e.g., '사용자 인증 기능 추가', 'Add payment integration')",
        },
        featureName: {
          type: "string",
          description: "REQUIRED: Short English slug for the feature name (e.g., 'chat', 'user-auth', 'payment', 'file-upload'). " +
            "You MUST translate the user's intent to a concise English identifier. " +
            "Use lowercase kebab-case. This becomes the directory/module name.",
        },
        requirements: {
          type: "array",
          items: { type: "string" },
          description: "Specific requirements (e.g., ['JWT-based', 'OAuth support'])",
        },
        constraints: {
          type: "array",
          items: { type: "string" },
          description: "Constraints to respect (e.g., ['use existing User model', 'Redis sessions'])",
        },
        category: {
          type: "string",
          enum: ["auth", "crud", "api", "ui", "integration", "data", "util", "config", "other"],
          description: "Feature category (auto-detected if not specified)",
        },
        preset: {
          type: "string",
          enum: ["fsd", "clean", "hexagonal", "atomic", "cqrs", "mandu"],
          description: "Architecture preset (default: mandu). Use 'cqrs' for Command/Query separation.",
        },
      },
      required: ["intent"],
    },
  },
  {
    name: "mandu.negotiate.scaffold",
    description:
      "Generate scaffold files from a negotiation plan. Use after mandu.negotiate.",
    annotations: {
      destructiveHint: true,
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "Feature intent (used to get the structure plan)",
        },
        category: {
          type: "string",
          enum: ["auth", "crud", "api", "ui", "integration", "data", "util", "config", "other"],
          description: "Feature category",
        },
        dryRun: {
          type: "boolean",
          description: "If true, only show what would be created without actually creating files",
        },
        overwrite: {
          type: "boolean",
          description: "If true, overwrite existing files (default: false)",
        },
        preset: {
          type: "string",
          enum: ["fsd", "clean", "hexagonal", "atomic", "cqrs", "mandu"],
          description: "Architecture preset (default: mandu)",
        },
      },
      required: ["intent"],
    },
  },
  {
    name: "mandu.negotiate.analyze",
    description:
      "Analyze the existing project structure and return detected layers, features, and recommendations.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function negotiateTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.negotiate": async (args: Record<string, unknown>) => {
      const { intent, featureName, requirements, constraints, category, preset } = args as {
        intent: string;
        featureName?: string;
        requirements?: string[];
        constraints?: string[];
        category?: FeatureCategory;
        preset?: GuardPreset;
      };

      if (!intent) {
        return {
          error: "Intent is required",
          tip: "Describe what you want to implement (e.g., '사용자 인증 기능 추가')",
        };
      }

      const request: NegotiationRequest = {
        intent,
        featureName,
        requirements,
        constraints,
        category,
        preset,
      };

      const result = await negotiate(request, projectRoot);

      return {
        approved: result.approved,
        intent,
        detectedCategory: category || "auto",
        preset: result.preset,

        // Structure summary
        structure: result.structure.map((dir) => ({
          path: dir.path,
          purpose: dir.purpose,
          layer: dir.layer,
          files: dir.files.map((f) => ({
            name: f.name,
            purpose: f.purpose,
            isSlot: f.isSlot || false,
          })),
        })),

        // Slots to implement
        slots: result.slots,

        // Context
        relatedDecisions: result.relatedDecisions,
        warnings: result.warnings,
        recommendations: result.recommendations,

        // Summary
        summary: {
          estimatedFiles: result.estimatedFiles,
          slotsToImplement: result.slots.length,
          relatedDecisionsCount: result.relatedDecisions.length,
        },

        // Next steps
        nextSteps: result.nextSteps,
        tip: "Use mandu.negotiate.scaffold to create the file structure, then implement the TODO sections.",
        relatedSkills: ["mandu-create-feature", "mandu-guard-guide"],
      };
    },

    "mandu.negotiate.scaffold": async (args: Record<string, unknown>) => {
      const { intent, featureName, category, dryRun = false, overwrite = false, preset } = args as {
        intent: string;
        featureName?: string;
        category?: FeatureCategory;
        dryRun?: boolean;
        overwrite?: boolean;
        preset?: GuardPreset;
      };

      if (!intent) {
        return {
          error: "Intent is required",
          tip: "Provide the same intent you used with mandu.negotiate",
        };
      }

      // 먼저 협상하여 구조 계획 얻기
      const plan = await negotiate({ intent, featureName, category, preset }, projectRoot);

      if (!plan.approved) {
        return {
          error: "Negotiation not approved",
          reason: plan.rejectionReason,
        };
      }

      // Scaffold 생성
      const result = await generateScaffold(plan.structure, projectRoot, {
        dryRun,
        overwrite,
      });

      return {
        success: result.success,
        dryRun,
        created: {
          directories: result.createdDirs,
          files: result.createdFiles,
        },
        skipped: result.skippedFiles,
        errors: result.errors,
        summary: {
          dirsCreated: result.createdDirs.length,
          filesCreated: result.createdFiles.length,
          filesSkipped: result.skippedFiles.length,
        },
        nextSteps: [
          "1. Review the generated files",
          "2. Implement the TODO sections in each file",
          "3. Run mandu_guard_heal to verify architecture compliance",
          "4. Add tests for your implementation",
        ],
        tip: dryRun
          ? "This was a dry run. Remove dryRun: true to actually create files."
          : "Files created! Start implementing the TODO sections.",
      };
    },

    "mandu.negotiate.analyze": async () => {
      const result = await analyzeExistingStructure(projectRoot);

      return {
        projectRoot,
        detected: {
          layers: result.layers,
          layerCount: result.layers.length,
          existingFeatures: result.existingFeatures,
          featureCount: result.existingFeatures.length,
        },
        recommendations: result.recommendations,
        tip: result.layers.length > 0
          ? "Use mandu.negotiate to add new features following the existing structure."
          : "Use mandu.negotiate to establish your project structure.",
      };
    },
  };

  // Backward-compatible aliases
  handlers["mandu_negotiate"] = handlers["mandu.negotiate"];
  handlers["mandu_generate_scaffold"] = handlers["mandu.negotiate.scaffold"];
  handlers["mandu_analyze_structure"] = handlers["mandu.negotiate.analyze"];

  return handlers;
}
