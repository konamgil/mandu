import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  runGuardCheck,
  runAutoCorrect,
  ErrorClassifier,
  type ManduError,
  type GeneratedMap,
  // Self-Healing Guard imports
  checkWithHealing,
  applyHealing,
  healAll,
  explainRule,
  type GuardConfig,
  type ViolationType,
  type GuardPreset,
} from "@mandujs/core";
import { getProjectPaths, readJsonFile, readConfig } from "../utils/project.js";

export const guardToolDefinitions: Tool[] = [
  {
    name: "mandu_guard_check",
    description:
      "Run guard checks to validate spec integrity, generated files, and slot files",
    inputSchema: {
      type: "object",
      properties: {
        autoCorrect: {
          type: "boolean",
          description: "If true, attempt to automatically fix violations",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_analyze_error",
    description:
      "Analyze a ManduError JSON to provide actionable fix guidance",
    inputSchema: {
      type: "object",
      properties: {
        errorJson: {
          type: "string",
          description: "The ManduError JSON string to analyze",
        },
      },
      required: ["errorJson"],
    },
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // Self-Healing Guard Tools (NEW)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "mandu_guard_heal",
    description:
      "Run Self-Healing Guard: detect architecture violations and provide actionable fix suggestions with auto-fix capabilities. " +
      "This tool not only detects violations but also explains WHY they are wrong and HOW to fix them.",
    inputSchema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["fsd", "clean", "hexagonal", "atomic", "mandu"],
          description: "Architecture preset to use (default: from config or 'mandu')",
        },
        autoFix: {
          type: "boolean",
          description: "If true, automatically apply the primary fix for all violations",
        },
        file: {
          type: "string",
          description: "Specific file to check (optional, checks entire project if not specified)",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_guard_explain",
    description:
      "Explain a specific guard rule in detail. " +
      "Provides WHY the rule exists, HOW to fix violations, and code examples.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["layer-violation", "circular-dependency", "cross-slice", "deep-nesting"],
          description: "The type of violation to explain",
        },
        fromLayer: {
          type: "string",
          description: "The source layer (e.g., 'features', 'shared')",
        },
        toLayer: {
          type: "string",
          description: "The target layer being imported",
        },
        preset: {
          type: "string",
          enum: ["fsd", "clean", "hexagonal", "atomic", "mandu"],
          description: "Architecture preset for context",
        },
      },
      required: ["type", "fromLayer", "toLayer"],
    },
  },
];

export function guardTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_guard_check: async (args: Record<string, unknown>) => {
      const { autoCorrect = false } = args as { autoCorrect?: boolean };

      // Load manifest
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return {
          error: "Failed to load manifest",
          details: manifestResult.errors,
        };
      }

      // Run guard check
      const checkResult = await runGuardCheck(manifestResult.data, projectRoot);

      if (checkResult.passed) {
        return {
          passed: true,
          violations: [],
          message: "All guard checks passed",
        };
      }

      // If auto-correct requested and there are violations
      if (autoCorrect && checkResult.violations.length > 0) {
        const autoCorrectResult = await runAutoCorrect(
          checkResult.violations,
          manifestResult.data,
          projectRoot
        );

        return {
          passed: autoCorrectResult.fixed,
          violations: autoCorrectResult.remainingViolations,
          autoCorrect: {
            attempted: true,
            fixed: autoCorrectResult.fixed,
            steps: autoCorrectResult.steps,
            retriedCount: autoCorrectResult.retriedCount,
            rolledBack: autoCorrectResult.rolledBack,
            changeId: autoCorrectResult.changeId,
          },
        };
      }

      return {
        passed: false,
        violations: checkResult.violations.map((v) => ({
          ruleId: v.ruleId,
          file: v.file,
          message: v.message,
          suggestion: v.suggestion,
        })),
        message: `Found ${checkResult.violations.length} violation(s)`,
        tip: "Use autoCorrect: true to attempt automatic fixes",
      };
    },

    mandu_analyze_error: async (args: Record<string, unknown>) => {
      const { errorJson } = args as { errorJson: string };

      let error: ManduError;
      try {
        error = JSON.parse(errorJson) as ManduError;
      } catch {
        return {
          error: "Invalid JSON format",
          tip: "Provide a valid ManduError JSON string",
        };
      }

      // Load generated map for better analysis
      const generatedMap = await readJsonFile<GeneratedMap>(paths.generatedMapPath);

      // Provide analysis based on error type
      const analysis: Record<string, unknown> = {
        errorType: error.errorType,
        code: error.code,
        summary: error.summary,
      };

      switch (error.errorType) {
        case "SPEC_ERROR":
          analysis.category = "Specification Error";
          analysis.fixLocation = error.fix?.file || "spec/routes.manifest.json";
          analysis.actions = [
            "Check the spec file for JSON syntax errors",
            "Validate route IDs are unique",
            "Ensure patterns start with /",
            "For page routes, verify componentModule is specified",
          ];
          break;

        case "LOGIC_ERROR":
          analysis.category = "Business Logic Error";
          analysis.fixLocation = error.fix?.file || "spec/slots/";
          analysis.actions = [
            "Review the slot file at the specified location",
            error.fix?.suggestion || "Check the handler logic",
            "Verify ctx.body() and ctx.params are used correctly",
            "Add proper error handling in the slot",
          ];
          if (error.fix?.line) {
            analysis.lineNumber = error.fix.line;
          }
          break;

        case "FRAMEWORK_BUG":
          analysis.category = "Framework Internal Error";
          analysis.fixLocation = error.fix?.file || "packages/core/";
          analysis.actions = [
            "This appears to be a framework bug",
            "Check GitHub issues for similar problems",
            "Consider filing a bug report with the error details",
          ];
          analysis.reportUrl = "https://github.com/konamgil/mandu/issues";
          break;

        default:
          analysis.category = "Unknown Error";
          analysis.actions = [
            "Review the error message for details",
            error.fix?.suggestion || "Check related files",
          ];
      }

      // Add route context if available
      if (error.route) {
        analysis.routeContext = {
          routeId: error.route.id,
          pattern: error.route.pattern,
          kind: error.route.kind,
        };

        // Try to find slot mapping
        if (generatedMap && error.route.id) {
          for (const [, entry] of Object.entries(generatedMap.files)) {
            if (entry.routeId === error.route.id && entry.slotMapping) {
              analysis.slotFile = entry.slotMapping.slotPath;
              break;
            }
          }
        }
      }

      // Add debug info if available
      if (error.debug) {
        analysis.debug = {
          hasStack: !!error.debug.stack,
          generatedFile: error.debug.generatedFile,
        };
      }

      return {
        analysis,
        originalError: {
          message: error.message,
          timestamp: error.timestamp,
        },
      };
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Self-Healing Guard Tools Implementation
    // ═══════════════════════════════════════════════════════════════════════════

    mandu_guard_heal: async (args: Record<string, unknown>) => {
      const {
        preset: inputPreset,
        autoFix = false,
        file,
      } = args as {
        preset?: GuardPreset;
        autoFix?: boolean;
        file?: string;
      };

      // Load config to get preset
      let config: GuardConfig = {};
      try {
        const projectConfig = await readConfig(projectRoot);
        if (projectConfig?.guard) {
          config = projectConfig.guard;
        }
      } catch {
        // Use defaults
      }

      // Override preset if specified
      if (inputPreset) {
        config.preset = inputPreset;
      }
      if (!config.preset) {
        config.preset = "mandu";
      }

      // Run Self-Healing check
      const result = await checkWithHealing(config, projectRoot);

      // Filter by file if specified
      let items = result.items;
      if (file) {
        items = items.filter((item) =>
          item.violation.filePath.includes(file)
        );
      }

      // Auto-fix if requested
      if (autoFix && items.length > 0) {
        const healResult = await healAll({
          ...result,
          items,
        });

        return {
          passed: healResult.failed === 0,
          totalViolations: items.length,
          autoFix: {
            attempted: true,
            fixed: healResult.fixed,
            failed: healResult.failed,
            results: healResult.results.map((r) => ({
              success: r.success,
              message: r.message,
              changedFiles: r.changedFiles,
            })),
          },
          message:
            healResult.failed === 0
              ? `✅ All ${healResult.fixed} violations fixed!`
              : `⚠️ Fixed ${healResult.fixed}, failed ${healResult.failed}`,
        };
      }

      // Return violations with healing suggestions
      if (items.length === 0) {
        return {
          passed: true,
          totalViolations: 0,
          message: "✅ No architecture violations found!",
          preset: config.preset,
        };
      }

      return {
        passed: false,
        totalViolations: items.length,
        autoFixable: items.filter((i) => i.healing.primary.autoFix).length,
        preset: config.preset,
        violations: items.map((item) => ({
          // Violation info
          type: item.violation.type,
          file: item.violation.filePath,
          line: item.violation.line,
          message: item.violation.ruleDescription,
          fromLayer: item.violation.fromLayer,
          toLayer: item.violation.toLayer,
          importStatement: item.violation.importStatement,

          // Healing info
          healing: {
            primary: {
              label: item.healing.primary.label,
              explanation: item.healing.primary.explanation,
              hasAutoFix: !!item.healing.primary.autoFix,
              codeChange: item.healing.primary.before
                ? {
                    before: item.healing.primary.before,
                    after: item.healing.primary.after,
                  }
                : undefined,
            },
            alternatives: item.healing.alternatives.map((alt) => ({
              label: alt.label,
              explanation: alt.explanation,
            })),
            context: {
              layerHierarchy: item.healing.context.layerHierarchy,
              allowedLayers: item.healing.context.allowedLayers,
              documentation: item.healing.context.documentation,
            },
          },
        })),
        tip: "Use autoFix: true to automatically apply fixes, or review suggestions and apply manually.",
      };
    },

    mandu_guard_explain: async (args: Record<string, unknown>) => {
      const { type, fromLayer, toLayer, preset } = args as {
        type: ViolationType;
        fromLayer: string;
        toLayer: string;
        preset?: GuardPreset;
      };

      const explanation = explainRule(
        type,
        fromLayer,
        toLayer,
        preset ?? "mandu"
      );

      return {
        rule: explanation.rule,
        explanation: {
          why: explanation.why,
          how: explanation.how,
        },
        documentation: explanation.documentation,
        examples: {
          bad: explanation.examples.bad,
          good: explanation.examples.good,
        },
        preset: preset ?? "mandu",
      };
    },
  };
}
