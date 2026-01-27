import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  runGuardCheck,
  runAutoCorrect,
  ErrorClassifier,
  type ManduError,
  type GeneratedMap,
} from "@mandujs/core";
import { getProjectPaths, readJsonFile } from "../utils/project.js";

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
  };
}
