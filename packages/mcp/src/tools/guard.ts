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
  // Decision Memory imports
  searchDecisions,
  saveDecision,
  checkConsistency,
  getCompactArchitecture,
  getNextDecisionId,
  type ArchitectureDecision,
  type DecisionStatus,
  // Semantic Slots imports
  validateSlotConstraints,
  validateSlots,
  DEFAULT_SLOT_CONSTRAINTS,
  API_SLOT_CONSTRAINTS,
  READONLY_SLOT_CONSTRAINTS,
  type SlotConstraints,
  // Architecture Negotiation imports
  negotiate,
  generateScaffold,
  analyzeExistingStructure,
  type NegotiationRequest,
  type FeatureCategory,
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
          enum: ["fsd", "clean", "hexagonal", "atomic", "cqrs", "mandu"],
          description: "Architecture preset for context",
        },
      },
      required: ["type", "fromLayer", "toLayer"],
    },
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // Decision Memory Tools
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "mandu_get_decisions",
    description:
      "Search and retrieve architecture decisions (ADRs) by tags. " +
      "Use this before implementing features to ensure consistency with past decisions. " +
      "Example: Before adding 'auth' feature, search for ['auth', 'security'] to find related decisions.",
    inputSchema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags to search for (e.g., ['auth', 'cache', 'api'])",
        },
      },
      required: ["tags"],
    },
  },
  {
    name: "mandu_save_decision",
    description:
      "Save a new architecture decision record (ADR). " +
      "Use this when making significant architectural choices that should be remembered for consistency.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Decision title (e.g., 'Use JWT for API Authentication')",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for searchability (e.g., ['auth', 'api', 'security'])",
        },
        context: {
          type: "string",
          description: "Why this decision was needed",
        },
        decision: {
          type: "string",
          description: "What was decided",
        },
        consequences: {
          type: "array",
          items: { type: "string" },
          description: "Impact and trade-offs of this decision",
        },
        status: {
          type: "string",
          enum: ["proposed", "accepted", "deprecated", "superseded"],
          description: "Decision status (default: proposed)",
        },
      },
      required: ["title", "tags", "context", "decision", "consequences"],
    },
  },
  {
    name: "mandu_check_consistency",
    description:
      "Check if a proposed change is consistent with existing architecture decisions. " +
      "Use this before implementing to catch potential conflicts with past decisions.",
    inputSchema: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          description: "What you're trying to do (e.g., 'Add Redis caching layer')",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Related tags to check against (e.g., ['cache', 'redis'])",
        },
      },
      required: ["intent", "tags"],
    },
  },
  {
    name: "mandu_get_architecture",
    description:
      "Get a compact summary of project architecture decisions. " +
      "Returns key decisions, tag statistics, and architecture rules for quick context.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // Semantic Slots Tools
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "mandu_validate_slot",
    description:
      "Validate a slot file against semantic constraints. " +
      "Checks code lines, complexity, required/forbidden patterns, and import rules.",
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
    name: "mandu_get_slot_constraints",
    description:
      "Get recommended slot constraints for different use cases. " +
      "Returns preset constraints that can be used with .constraints() in Filling API.",
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
  // ═══════════════════════════════════════════════════════════════════════════
  // Architecture Negotiation Tools
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: "mandu_negotiate",
    description:
      "Negotiate with the framework before implementing a feature. " +
      "Describes your intent and gets back the recommended project structure, " +
      "file templates, and related architecture decisions. " +
      "Use this BEFORE writing code to ensure architectural consistency. " +
      "IMPORTANT: Always provide 'featureName' as a short English slug (e.g., 'chat', 'user-auth', 'payment'). " +
      "Even if the user speaks Korean, YOU must translate the feature name to English.",
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
    name: "mandu_generate_scaffold",
    description:
      "Generate scaffold files from a negotiation plan. " +
      "Creates directories and file templates based on the approved structure.",
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
    name: "mandu_analyze_structure",
    description:
      "Analyze the existing project structure. " +
      "Returns detected layers, existing features, and recommendations.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
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
        ...(configLoadError && { configWarning: configLoadError }),
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

    // ═══════════════════════════════════════════════════════════════════════════
    // Decision Memory Tools Implementation
    // ═══════════════════════════════════════════════════════════════════════════

    mandu_get_decisions: async (args: Record<string, unknown>) => {
      const { tags } = args as { tags: string[] };

      if (!tags || tags.length === 0) {
        return {
          error: "Tags are required",
          tip: "Provide at least one tag to search for (e.g., ['auth', 'cache'])",
        };
      }

      const result = await searchDecisions(projectRoot, tags);

      if (result.decisions.length === 0) {
        return {
          found: false,
          message: `No decisions found for tags: ${tags.join(", ")}`,
          searchedTags: tags,
          tip: "Try broader tags or check spec/decisions/ directory",
        };
      }

      return {
        found: true,
        total: result.total,
        searchedTags: tags,
        decisions: result.decisions.map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          date: d.date,
          tags: d.tags,
          context: d.context.slice(0, 200) + (d.context.length > 200 ? "..." : ""),
          decision: d.decision,
          consequences: d.consequences,
          relatedDecisions: d.relatedDecisions,
        })),
        tip: "Follow these decisions for consistency. Use mandu_save_decision if you make a new architectural choice.",
      };
    },

    mandu_save_decision: async (args: Record<string, unknown>) => {
      const { title, tags, context, decision, consequences, status } = args as {
        title: string;
        tags: string[];
        context: string;
        decision: string;
        consequences: string[];
        status?: DecisionStatus;
      };

      // Validate required fields
      if (!title || !tags || !context || !decision || !consequences) {
        return {
          error: "Missing required fields",
          required: ["title", "tags", "context", "decision", "consequences"],
        };
      }

      // Get next ID
      const id = await getNextDecisionId(projectRoot);

      // Save decision
      const newDecision: Omit<ArchitectureDecision, "date"> = {
        id,
        title,
        status: status || "proposed",
        tags: tags.map((t) => t.toLowerCase()),
        context,
        decision,
        consequences,
      };

      const result = await saveDecision(projectRoot, newDecision);

      return {
        success: result.success,
        decision: {
          id,
          title,
          status: status || "proposed",
          tags,
        },
        filePath: result.filePath,
        message: result.message,
        tip: "Decision saved. It will be found when searching for related tags.",
      };
    },

    mandu_check_consistency: async (args: Record<string, unknown>) => {
      const { intent, tags } = args as {
        intent: string;
        tags: string[];
      };

      if (!intent || !tags || tags.length === 0) {
        return {
          error: "Intent and tags are required",
          tip: "Describe what you're trying to do and provide related tags",
        };
      }

      const result = await checkConsistency(projectRoot, intent, tags);

      return {
        consistent: result.consistent,
        intent,
        checkedTags: tags,
        relatedDecisions: result.relatedDecisions.map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          decision: d.decision.slice(0, 150) + "...",
        })),
        warnings: result.warnings,
        suggestions: result.suggestions,
        tip: result.consistent
          ? "No conflicts found. Proceed with implementation following the suggestions."
          : "⚠️ Review warnings before proceeding. Some decisions may conflict.",
      };
    },

    mandu_get_architecture: async () => {
      const compact = await getCompactArchitecture(projectRoot);

      if (!compact) {
        return {
          found: false,
          message: "No architecture information found",
          tip: "Save some decisions first using mandu_save_decision",
        };
      }

      return {
        found: true,
        project: compact.project,
        lastUpdated: compact.lastUpdated,
        summary: {
          totalDecisions: compact.keyDecisions.length,
          topTags: Object.entries(compact.tagCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([tag, count]) => ({ tag, count })),
        },
        keyDecisions: compact.keyDecisions,
        rules: compact.rules,
        tip: "Use mandu_get_decisions with specific tags for detailed information.",
      };
    },

    // ═══════════════════════════════════════════════════════════════════════════
    // Semantic Slots Tools Implementation
    // ═══════════════════════════════════════════════════════════════════════════

    mandu_validate_slot: async (args: Record<string, unknown>) => {
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
          : "Fix violations before deployment. Use mandu_get_slot_constraints for guidance.",
      };
    },

    mandu_get_slot_constraints: async (args: Record<string, unknown>) => {
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

    // ═══════════════════════════════════════════════════════════════════════════
    // Architecture Negotiation Tools Implementation
    // ═══════════════════════════════════════════════════════════════════════════

    mandu_negotiate: async (args: Record<string, unknown>) => {
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
        tip: "Use mandu_generate_scaffold to create the file structure, then implement the TODO sections.",
      };
    },

    mandu_generate_scaffold: async (args: Record<string, unknown>) => {
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
          tip: "Provide the same intent you used with mandu_negotiate",
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

    mandu_analyze_structure: async () => {
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
          ? "Use mandu_negotiate to add new features following the existing structure."
          : "Use mandu_negotiate to establish your project structure.",
      };
    },
  };
}
