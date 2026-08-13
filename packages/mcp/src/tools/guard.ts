import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { type ManduError } from "@mandujs/core/error";
import {
  checkDirectory,
  getDefaultFsRoutesGuardPolicy,
  validateAndReport,
  loadManifest,
  runGuardCheck,
  runAutoCorrect,
  // Self-Healing Guard imports
  checkWithHealing,
  healAll,
  explainRule,
  // Follow-up E — type-aware lint bridge
  runTsgolint,
  type GuardConfig,
  type ViolationType,
  type GuardPreset,
  type Violation,
} from "@mandujs/core";
import type { GeneratedMap } from "@mandujs/core/compat/generator/index";
import { getProjectPaths, readJsonFile, readConfig } from "../utils/project.js";
import fs from "fs/promises";
import path from "path";

export const guardToolDefinitions: Tool[] = [
  {
    name: "mandu.guard.check",
    description:
      "Run the same architecture guard used by `mandu guard`, plus legacy spec/generated/slot checks. Set typeAware=true to additionally run `oxlint --type-aware` (tsgolint) and merge its results.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        autoCorrect: {
          type: "boolean",
          description: "If true, attempt to automatically fix violations",
        },
        typeAware: {
          type: "boolean",
          description:
            "If true, invoke `oxlint --type-aware` after the architecture check and include its violations in the response under `typeAware`. When the config has `guard.typeAware` set, this defaults to true; set false to opt out for a single call.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.guard.analyze",
    description:
      "Analyze a ManduError JSON to provide actionable fix guidance",
    annotations: {
      readOnlyHint: true,
    },
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
  {
    name: "mandu.guard.heal",
    description:
      "Detect architecture violations with auto-fix suggestions. Use autoFix=true to apply fixes automatically.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {
        preset: {
          type: "string",
          enum: ["fsd", "clean", "hexagonal", "atomic", "cqrs", "mandu"],
          description: "Architecture preset to use (default: from config or 'mandu'). Use 'cqrs' for Command/Query separation.",
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
    name: "mandu.guard.explain",
    description:
      "Explain a specific guard rule with rationale, fix guidance, and code examples.",
    annotations: {
      readOnlyHint: true,
    },
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
          enum: ["fsd", "clean", "hexagonal", "atomic", "cqrs", "mandu"],
          description: "Architecture preset for context",
        },
      },
      required: ["type", "fromLayer", "toLayer"],
    },
  },
];

export function guardTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  const pathExists = async (candidate: string): Promise<boolean> => {
    try {
      await fs.access(candidate);
      return true;
    } catch {
      return false;
    }
  };

  const guardViolationCode = (ruleId: string | undefined, type?: string) =>
    `MANDU_GUARD_${(ruleId || type || "VIOLATION").toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

  const explainViolation = (input: {
    type?: string;
    ruleId?: string;
    fromLayer?: string;
    toLayer?: string;
    suggestion?: string;
  }): string => {
    const source = input.fromLayer ? ` from ${input.fromLayer}` : "";
    const target = input.toLayer ? ` to ${input.toLayer}` : "";
    const rule = input.ruleId ?? input.type ?? "architecture rule";
    const fix = input.suggestion ? ` Suggested fix: ${input.suggestion}` : "";
    return `Violation of ${rule}${source}${target}.${fix}`.trim();
  };

  const summarizeArchitectureViolation = (violation: Violation) => ({
    code: guardViolationCode(violation.ruleName, violation.type),
    ruleId: violation.ruleName,
    type: violation.type,
    file: path.relative(projectRoot, violation.filePath).replace(/\\/g, "/") || violation.filePath,
    line: violation.line,
    column: violation.column,
    message: violation.ruleDescription,
    suggestion: violation.suggestions[0],
    explanation: explainViolation({
      type: violation.type,
      ruleId: violation.ruleName,
      fromLayer: violation.fromLayer,
      toLayer: violation.toLayer,
      suggestion: violation.suggestions[0],
    }),
    fromLayer: violation.fromLayer,
    toLayer: violation.toLayer,
    importStatement: violation.importStatement,
  });

  const summarizeLegacyViolation = (v: Awaited<ReturnType<typeof runGuardCheck>>["violations"][number]) => ({
    code: guardViolationCode(v.ruleId),
    ruleId: v.ruleId,
    file: v.file,
    message: v.message,
    suggestion: v.suggestion,
    explanation: explainViolation({ ruleId: v.ruleId, suggestion: v.suggestion }),
  });

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.guard.check": async (args: Record<string, unknown>) => {
      const { autoCorrect = false, typeAware: typeAwareArg } = args as {
        autoCorrect?: boolean;
        typeAware?: boolean;
      };

      // Load manifest
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return {
          error: "Failed to load manifest",
          details: manifestResult.errors,
        };
      }

      const projectConfig = await validateAndReport(projectRoot);
      const guardConfigFromFile = (projectConfig?.guard ?? {}) as GuardConfig;
      const preset = guardConfigFromFile.preset ?? "mandu";
      const enableFsRoutes = await pathExists(paths.appDir);

      const architectureReport = await checkDirectory(
        {
          preset,
          srcDir: guardConfigFromFile.srcDir ?? "src",
          exclude: guardConfigFromFile.exclude,
          fsRoutes: getDefaultFsRoutesGuardPolicy(enableFsRoutes),
        },
        projectRoot
      );
      const architecturePassed = architectureReport.bySeverity.error === 0;
      const architectureViolations = architectureReport.violations.map(
        summarizeArchitectureViolation
      );

      // Run guard check
      const checkResult = await runGuardCheck(manifestResult.data, projectRoot);

      // Follow-up E — resolve type-aware defaulting from config, then
      // run the bridge when enabled. Result envelope is always included
      // in the tool response so MCP clients have a single stable shape.
      let rawProjectConfig: Awaited<ReturnType<typeof readConfig>> | undefined;
      try {
        rawProjectConfig = projectConfig ?? await readConfig(projectRoot);
      } catch {
        rawProjectConfig = projectConfig ?? undefined;
      }
      const typeAwareCfg = (
        rawProjectConfig?.guard as
          | { typeAware?: Record<string, unknown> }
          | undefined
      )?.typeAware;
      const typeAwareEnabled =
        typeAwareArg !== undefined ? typeAwareArg : typeAwareCfg !== undefined;

      let typeAwareResponse: Record<string, unknown> | undefined;
      if (typeAwareEnabled) {
        const bridge = await runTsgolint({
          projectRoot,
          rules: typeAwareCfg?.rules as string[] | undefined,
          severity: typeAwareCfg?.severity as
            | "off"
            | "warn"
            | "error"
            | undefined,
          configPath: typeAwareCfg?.configPath as string | undefined,
        });
        typeAwareResponse = {
          skipped: bridge.skipped,
          summary: bridge.summary,
          violations: bridge.violations,
        };
      }

      const typeAwareViolations = typeAwareResponse
        ? typeAwareResponse.violations as Array<{ severity: string }>
        : [];
      const typeAwareErrorCount = typeAwareViolations.filter(
        (v) => v.severity === "error",
      ).length;
      const legacyViolations = checkResult.violations.map(summarizeLegacyViolation);
      const combinedViolations = [
        ...architectureViolations,
        ...legacyViolations,
      ];
      const allPassed = checkResult.passed && architecturePassed && typeAwareErrorCount === 0;
      const blockingViolationCount = combinedViolations.length + typeAwareErrorCount;

      if (allPassed) {
        return {
          passed: true,
          violations: [],
          message: "All guard checks passed",
          architecture: {
            passed: true,
            totalViolations: architectureReport.totalViolations,
            bySeverity: architectureReport.bySeverity,
          },
          legacy: {
            passed: true,
            violations: 0,
          },
          relatedSkills: ["mandu-guard-guide", "mandu-debug"],
          ...(typeAwareResponse ? { typeAware: typeAwareResponse } : {}),
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
          passed:
            autoCorrectResult.fixed &&
            architecturePassed &&
            typeAwareErrorCount === 0,
          violations: [
            ...architectureViolations,
            ...autoCorrectResult.remainingViolations.map(summarizeLegacyViolation),
          ],
          autoCorrect: {
            attempted: true,
            fixed: autoCorrectResult.fixed,
            steps: autoCorrectResult.steps,
            retriedCount: autoCorrectResult.retriedCount,
            rolledBack: autoCorrectResult.rolledBack,
            changeId: autoCorrectResult.changeId,
          },
          architecture: {
            passed: architecturePassed,
            totalViolations: architectureReport.totalViolations,
            bySeverity: architectureReport.bySeverity,
            violations: architectureViolations,
          },
          legacy: {
            passed: autoCorrectResult.fixed,
            violations: autoCorrectResult.remainingViolations.length,
          },
          ...(typeAwareResponse ? { typeAware: typeAwareResponse } : {}),
        };
      }

      return {
        passed: false,
        violations: combinedViolations,
        message: `Found ${blockingViolationCount} violation(s)`,
        architecture: {
          passed: architecturePassed,
          totalViolations: architectureReport.totalViolations,
          bySeverity: architectureReport.bySeverity,
          violations: architectureViolations,
        },
        legacy: {
          passed: checkResult.passed,
          violations: legacyViolations.length,
        },
        tip: "Use autoCorrect: true to attempt automatic fixes",
        relatedSkills: ["mandu-guard-guide", "mandu-debug"],
        ...(typeAwareResponse ? { typeAware: typeAwareResponse } : {}),
      };
    },

    "mandu.guard.analyze": async (args: Record<string, unknown>) => {
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
          analysis.fixLocation = error.fix?.file || ".mandu/routes.manifest.json";
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

    "mandu.guard.heal": async (args: Record<string, unknown>) => {
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
      let configLoadError: string | undefined;
      try {
        const projectConfig = await readConfig(projectRoot);
        if (projectConfig?.guard) {
          config = projectConfig.guard;
        }
      } catch (error) {
        // 설정 로드 실패 시 경고 메시지 저장 (기본값으로 계속 진행)
        configLoadError = `Config load warning: ${error instanceof Error ? error.message : String(error)}`;
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

        // 남은 위반 수 계산: 전체 - 성공적으로 수정된 수
        const remaining = items.length - healResult.fixed;
        const allFixed = remaining === 0;

        return {
          passed: allFixed,
          totalViolations: items.length,
          remaining,
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
          ...(configLoadError && { configWarning: configLoadError }),
          message: allFixed
            ? `✅ All ${healResult.fixed} violations fixed!`
            : `⚠️ Fixed ${healResult.fixed}, remaining ${remaining} (failed ${healResult.failed})`,
        };
      }

      // Return violations with healing suggestions
      if (items.length === 0) {
        return {
          passed: true,
          totalViolations: 0,
          message: "✅ No architecture violations found!",
          preset: config.preset,
          ...(configLoadError && { configWarning: configLoadError }),
        };
      }

      return {
        passed: false,
        totalViolations: items.length,
        autoFixable: items.filter((i) => i.healing.primary.autoFix).length,
        preset: config.preset,
        violations: items.map((item) => ({
          // Violation info
          code: guardViolationCode(item.violation.ruleName, item.violation.type),
          type: item.violation.type,
          file: item.violation.filePath,
          line: item.violation.line,
          message: item.violation.ruleDescription,
          explanation: explainViolation({
            type: item.violation.type,
            ruleId: item.violation.ruleName,
            fromLayer: item.violation.fromLayer,
            toLayer: item.violation.toLayer,
            suggestion: item.healing.primary.explanation,
          }),
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
        ...(configLoadError && { configWarning: configLoadError }),
      };
    },

    "mandu.guard.explain": async (args: Record<string, unknown>) => {
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

  // Backward-compatible aliases (deprecated)
  handlers["mandu_guard_check"] = handlers["mandu.guard.check"];
  handlers["mandu_analyze_error"] = handlers["mandu.guard.analyze"];
  handlers["mandu_guard_heal"] = handlers["mandu.guard.heal"];
  handlers["mandu_guard_explain"] = handlers["mandu.guard.explain"];

  return handlers;
}
