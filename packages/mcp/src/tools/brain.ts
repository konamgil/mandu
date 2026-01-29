/**
 * Mandu MCP - Brain Tools
 *
 * MCP tools for Brain functionality:
 * - mandu_doctor: Guard failure analysis + patch suggestions
 * - mandu_watch_start: Start file watching
 * - mandu_watch_status: Get watch status
 * - mandu_check_location: Check if file location is valid (v0.2)
 * - mandu_check_import: Check if imports are valid (v0.2)
 * - mandu_get_architecture: Get project architecture rules (v0.2)
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  loadManifest,
  runGuardCheck,
  analyzeViolations,
  generateJsonReport,
  initializeBrain,
  getBrain,
  startWatcher,
  stopWatcher,
  getWatcher,
  generateJsonStatus,
  initializeArchitectureAnalyzer,
  getArchitectureAnalyzer,
} from "../../../core/src/index.js";
import { getProjectPaths } from "../utils/project.js";

export const brainToolDefinitions: Tool[] = [
  {
    name: "mandu_doctor",
    description:
      "Analyze Guard failures and suggest patches. Works with or without LLM - template-based analysis is always available.",
    inputSchema: {
      type: "object",
      properties: {
        useLLM: {
          type: "boolean",
          description:
            "Whether to use LLM for enhanced analysis (default: true if available)",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_watch_start",
    description:
      "Start file watching with architecture rule warnings. Watches for common mistakes and emits warnings (no blocking).",
    inputSchema: {
      type: "object",
      properties: {
        debounceMs: {
          type: "number",
          description: "Debounce delay in milliseconds (default: 300)",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_watch_status",
    description:
      "Get the current watch status including recent warnings and active rules.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_watch_stop",
    description:
      "Stop file watching and clean up MCP notification subscriptions.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // Architecture tools (v0.2)
  {
    name: "mandu_check_location",
    description:
      "Check if a file location follows project architecture rules. Call this BEFORE creating or moving files to ensure proper placement.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path to check (relative to project root)",
        },
        content: {
          type: "string",
          description: "Optional file content for import validation",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "mandu_check_import",
    description:
      "Check if imports in a file follow architecture rules. Call this to validate imports before adding them.",
    inputSchema: {
      type: "object",
      properties: {
        sourceFile: {
          type: "string",
          description: "Source file path (relative to project root)",
        },
        imports: {
          type: "array",
          items: { type: "string" },
          description: "List of import paths to check",
        },
      },
      required: ["sourceFile", "imports"],
    },
  },
  {
    name: "mandu_get_architecture",
    description:
      "Get the project architecture rules and folder structure. Use this to understand where to place new files.",
    inputSchema: {
      type: "object",
      properties: {
        includeStructure: {
          type: "boolean",
          description: "Include folder tree in response (default: true)",
        },
      },
      required: [],
    },
  },
];

/** Module-level unsubscribe handle for MCP warning notifications */
let mcpWarningUnsubscribe: (() => void) | null = null;

export function brainTools(projectRoot: string, server?: Server) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_doctor: async (args: Record<string, unknown>) => {
      const { useLLM = true } = args as { useLLM?: boolean };

      try {
        // Initialize Brain
        await initializeBrain();
        const brain = getBrain();
        const llmAvailable = await brain.isLLMAvailable();

        // Load manifest
        const manifestResult = await loadManifest(paths.manifestPath);
        if (!manifestResult.success || !manifestResult.data) {
          return {
            error: "Failed to load manifest",
            details: manifestResult.errors,
          };
        }

        // Run guard check
        const checkResult = await runGuardCheck(
          manifestResult.data,
          projectRoot
        );

        if (checkResult.passed) {
          return {
            passed: true,
            message: "All guard checks passed - no violations found",
            llmAvailable,
          };
        }

        // Analyze violations
        const analysis = await analyzeViolations(checkResult.violations, {
          useLLM: useLLM && brain.enabled && llmAvailable,
        });

        return {
          passed: false,
          summary: analysis.summary,
          violationCount: analysis.violations.length,
          violations: analysis.violations.map((v) => ({
            ruleId: v.ruleId,
            file: v.file,
            message: v.message,
            suggestion: v.suggestion,
            line: v.line,
            severity: v.severity || "error",
          })),
          patches: analysis.patches.map((p) => ({
            file: p.file,
            type: p.type,
            description: p.description,
            command: p.command,
            confidence: p.confidence,
          })),
          nextCommand: analysis.nextCommand,
          llmAssisted: analysis.llmAssisted,
          tip: "Run the suggested patches or nextCommand to fix violations",
        };
      } catch (error) {
        return {
          error: "Doctor analysis failed",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    mandu_watch_start: async (args: Record<string, unknown>) => {
      const { debounceMs } = args as { debounceMs?: number };

      try {
        // Check if already watching
        const existingWatcher = getWatcher();
        if (existingWatcher) {
          const status = existingWatcher.getStatus();
          if (status.active) {
            return {
              success: false,
              message: "Watch is already running",
              status: JSON.parse(generateJsonStatus(status)),
            };
          }
        }

        // Start watcher
        const watcher = await startWatcher({
          rootDir: projectRoot,
          debounceMs,
        });

        // Register MCP notification handler
        let notifications = false;
        if (server) {
          // Clean up previous subscription
          if (mcpWarningUnsubscribe) {
            mcpWarningUnsubscribe();
            mcpWarningUnsubscribe = null;
          }

          mcpWarningUnsubscribe = watcher.onWarning((warning) => {
            // Push logging message (Claude Code receives in real-time)
            server.sendLoggingMessage({
              level: "warning",
              logger: "mandu-watch",
              data: {
                type: "watch_warning",
                ruleId: warning.ruleId,
                file: warning.file,
                message: warning.message,
                event: warning.event,
                timestamp: warning.timestamp.toISOString(),
              },
            }).catch(() => {});

            // Resource update notification
            server.sendResourceUpdated({
              uri: "mandu://watch/warnings",
            }).catch(() => {});
          });

          notifications = true;
        }

        const status = watcher.getStatus();

        return {
          success: true,
          message: "Watch started successfully",
          notifications: notifications ? "enabled" : "disabled",
          status: {
            active: status.active,
            rootDir: status.rootDir,
            fileCount: status.fileCount,
            startedAt: status.startedAt?.toISOString(),
          },
          rules: [
            "GENERATED_DIRECT_EDIT - Generated 파일 직접 수정 감지",
            "WRONG_SLOT_LOCATION - 잘못된 위치의 Slot 파일 감지",
            "SLOT_NAMING - Slot 파일 네이밍 규칙",
            "CONTRACT_NAMING - Contract 파일 네이밍 규칙",
            "FORBIDDEN_IMPORT - Generated 파일의 금지된 import 감지",
          ],
          logFile: ".mandu/watch.log",
          tip: "Run `tail -f .mandu/watch.log` in another terminal for real-time warnings.",
        };
      } catch (error) {
        return {
          error: "Failed to start watch",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    mandu_watch_status: async () => {
      try {
        const watcher = getWatcher();

        if (!watcher) {
          return {
            active: false,
            message: "Watch is not running",
            tip: "Use mandu_watch_start to begin watching",
          };
        }

        const status = watcher.getStatus();

        return {
          active: status.active,
          rootDir: status.rootDir,
          fileCount: status.fileCount,
          startedAt: status.startedAt?.toISOString() || null,
          uptime: status.startedAt
            ? Math.floor((Date.now() - status.startedAt.getTime()) / 1000)
            : 0,
          recentWarnings: status.recentWarnings.map((w) => ({
            ruleId: w.ruleId,
            file: w.file,
            message: w.message,
            event: w.event,
            timestamp: w.timestamp.toISOString(),
          })),
          warningCount: status.recentWarnings.length,
        };
      } catch (error) {
        return {
          error: "Failed to get watch status",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    mandu_watch_stop: async () => {
      try {
        // Clean up MCP notification subscription
        if (mcpWarningUnsubscribe) {
          mcpWarningUnsubscribe();
          mcpWarningUnsubscribe = null;
        }

        stopWatcher();

        return {
          success: true,
          message: "Watch stopped and notifications cleaned up",
        };
      } catch (error) {
        return {
          error: "Failed to stop watch",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    // Architecture tools (v0.2)
    mandu_check_location: async (args: Record<string, unknown>) => {
      const { path: filePath, content } = args as {
        path: string;
        content?: string;
      };

      try {
        // Initialize analyzer if needed
        let analyzer = getArchitectureAnalyzer();
        if (!analyzer) {
          await initializeBrain();
          analyzer = initializeArchitectureAnalyzer(projectRoot);
        }

        const result = await analyzer.checkLocation({
          path: filePath,
          content,
        });

        if (result.allowed) {
          return {
            allowed: true,
            message: `✅ '${filePath}'는 올바른 위치입니다`,
            tip: "파일을 생성해도 됩니다",
          };
        }

        return {
          allowed: false,
          violations: result.violations.map((v) => ({
            rule: v.ruleId,
            message: v.message,
            severity: v.severity,
          })),
          suggestion: result.suggestion,
          recommendedPath: result.recommendedPath,
          tip: result.recommendedPath
            ? `권장 경로: ${result.recommendedPath}`
            : "위반 사항을 확인하고 적절한 위치에 파일을 생성하세요",
        };
      } catch (error) {
        return {
          error: "Location check failed",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    mandu_check_import: async (args: Record<string, unknown>) => {
      const { sourceFile, imports } = args as {
        sourceFile: string;
        imports: string[];
      };

      try {
        let analyzer = getArchitectureAnalyzer();
        if (!analyzer) {
          await initializeBrain();
          analyzer = initializeArchitectureAnalyzer(projectRoot);
        }

        const result = await analyzer.checkImports({
          sourceFile,
          imports,
        });

        if (result.allowed) {
          return {
            allowed: true,
            message: "✅ 모든 import가 허용됩니다",
            checkedImports: imports,
          };
        }

        return {
          allowed: false,
          violations: result.violations.map((v) => ({
            import: v.import,
            reason: v.reason,
            suggestion: v.suggestion,
          })),
          tip: "금지된 import를 제거하거나 대안을 사용하세요",
        };
      } catch (error) {
        return {
          error: "Import check failed",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },

    mandu_get_architecture: async (args: Record<string, unknown>) => {
      const { includeStructure = true } = args as {
        includeStructure?: boolean;
      };

      try {
        let analyzer = getArchitectureAnalyzer();
        if (!analyzer) {
          await initializeBrain();
          analyzer = initializeArchitectureAnalyzer(projectRoot);
        }

        const config = analyzer.getConfig();
        const structure = includeStructure
          ? await analyzer.getProjectStructure()
          : null;

        return {
          folders: Object.entries(config.folders || {}).map(([key, rule]) => {
            const folderRule =
              typeof rule === "string"
                ? { pattern: key, description: rule }
                : rule;
            return {
              pattern: folderRule.pattern,
              description: folderRule.description,
              readonly: folderRule.readonly || false,
              allowedFiles: folderRule.allowedFiles,
            };
          }),
          importRules: (config.imports || []).map((rule) => ({
            source: rule.source,
            forbid: rule.forbid,
            allow: rule.allow,
            reason: rule.reason,
          })),
          namingRules: (config.naming || []).map((rule) => ({
            folder: rule.folder,
            pattern: rule.filePattern,
            description: rule.description,
            examples: rule.examples,
          })),
          structure: structure
            ? {
                rootDir: structure.rootDir,
                folders: structure.folders,
                indexedAt: structure.indexedAt,
              }
            : null,
          tip: "이 규칙을 따라 파일을 생성하세요. mandu_check_location으로 검증할 수 있습니다.",
        };
      } catch (error) {
        return {
          error: "Failed to get architecture",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  };
}
