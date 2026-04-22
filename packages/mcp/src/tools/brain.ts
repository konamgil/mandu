/**
 * Mandu MCP - Brain Tools
 *
 * MCP tools for Brain functionality:
 * - mandu.brain.doctor: Guard failure analysis + patch suggestions
 * - mandu.watch.start: Start file watching
 * - mandu.watch.status: Get watch status
 * - mandu.brain.checkLocation: Check if file location is valid (v0.2)
 * - mandu.brain.checkImport: Check if imports are valid (v0.2)
 * - mandu.brain.architecture: Get project architecture rules (v0.2)
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ActivityMonitor } from "../activity-monitor.js";
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
} from "@mandujs/core";
import { getProjectPaths } from "../utils/project.js";

export const brainToolDefinitions: Tool[] = [
  {
    name: "mandu.brain.doctor",
    description:
      "Analyze Guard failures and suggest patches. Works with or without LLM - template-based analysis is always available.",
    annotations: {
      readOnlyHint: true,
    },
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
    name: "mandu.watch.start",
    description:
      "Start file watching with architecture rule warnings. Watches for common mistakes and emits warnings (no blocking).",
    annotations: {
      readOnlyHint: false,
    },
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
    name: "mandu.watch.status",
    description:
      "Get the current watch status including recent warnings and active rules.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu.watch.stop",
    description:
      "Stop file watching and clean up MCP notification subscriptions.",
    annotations: {
      readOnlyHint: false,
    },
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  // Architecture tools (v0.2)
  {
    name: "mandu.brain.checkLocation",
    description:
      "Check if a file location follows project architecture rules. Call this BEFORE creating or moving files to ensure proper placement.",
    annotations: {
      readOnlyHint: true,
    },
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
    name: "mandu.brain.checkImport",
    description:
      "Check if imports in a file follow architecture rules. Call this to validate imports before adding them.",
    annotations: {
      readOnlyHint: true,
    },
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
    name: "mandu.brain.architecture",
    description:
      "Get the project architecture rules and folder structure. Use this to understand where to place new files.",
    annotations: {
      readOnlyHint: true,
    },
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
  {
    name: "mandu.brain.status",
    description:
      "Check which LLM adapter is active for brain (openai / anthropic / ollama / template) and whether auth tokens are present. Read-only — does not call an LLM or spawn subprocesses.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu.brain.login",
    description:
      "Authenticate the brain to an LLM provider. For openai, spawns `npx @openai/codex login` which opens the user's default browser to the OpenAI OAuth page; on approval, the token lands in ~/.codex/auth.json and this tool returns. Anthropic path uses the Mandu OAuth flow with a local loopback listener.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["openai", "anthropic"],
          description: "Which provider to sign into. Default: openai.",
        },
        waitMs: {
          type: "number",
          description:
            "How long to wait for auth.json to appear after spawning the OAuth flow. Default 180000 (3 min). Increase if the user takes longer to approve in the browser.",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu.brain.logout",
    description:
      "Delete stored brain credentials for a provider. For openai, deletes the keychain-stored enterprise token only — the ~/.codex/auth.json owned by the Codex CLI is intentionally left in place (run `npx @openai/codex logout` to revoke that).",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["openai", "anthropic", "all"],
          description: "Which provider to log out of. Default: all.",
        },
      },
      required: [],
    },
  },
];

/** Module-level unsubscribe handle for MCP warning notifications */
let mcpWarningUnsubscribe: (() => void) | null = null;

/**
 * #236 — surface a clear error when a stale `@mandujs/core` resolves
 * under `node_modules/@mandujs/mcp/node_modules/` (Bun's installer
 * sometimes lands an older nested copy even with `linker=hoisted`).
 * Without this check the user saw `getCredentialStore is not a
 * function` / `undefined is not a constructor` with no hint.
 */
function assertBrainAuthSurface(core: Record<string, unknown>): void {
  const missing: string[] = [];
  if (typeof core.getCredentialStore !== "function")
    missing.push("getCredentialStore");
  if (typeof core.resolveBrainAdapter !== "function")
    missing.push("resolveBrainAdapter");
  if (typeof core.ChatGPTAuth !== "function") missing.push("ChatGPTAuth");
  if (typeof core.AnthropicOAuthAdapter !== "function")
    missing.push("AnthropicOAuthAdapter");
  if (typeof core.revokeConsent !== "function") missing.push("revokeConsent");
  if (missing.length === 0) return;

  const pkgVersion =
    typeof core.__MANDU_CORE_VERSION__ === "string"
      ? core.__MANDU_CORE_VERSION__
      : "unknown";
  throw new Error(
    `[mandu-mcp] The resolved @mandujs/core (v${pkgVersion}) is missing brain-auth exports: ${missing.join(
      ", ",
    )}. ` +
      `This usually means Bun's installer placed a stale nested copy at ` +
      `node_modules/@mandujs/mcp/node_modules/@mandujs/core instead of hoisting to the top level. ` +
      `Fix: \`rm -rf node_modules bun.lock && bun install\` (or confirm linker=hoisted in bunfig.toml). ` +
      `See https://github.com/konamgil/mandu/issues/236 for details.`,
  );
}

export function brainTools(projectRoot: string, server?: Server, monitor?: ActivityMonitor) {
  const paths = getProjectPaths(projectRoot);

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.brain.doctor": async (args: Record<string, unknown>) => {
      const { useLLM = false } = args as { useLLM?: boolean };

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
            ...(p.type === "command" ? { command: p.command } : {}),
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

    "mandu.watch.start": async (args: Record<string, unknown>) => {
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
            // Log to activity monitor
            if (monitor) {
              monitor.logWatch(
                warning.level || "warn",
                warning.ruleId,
                warning.file,
                warning.message,
              );
            }

            // Push logging message (MCP client receives in real-time)
            server.sendLoggingMessage({
              level: "warning",
              logger: "mandu-watch",
              data: {
                type: "watch_warning",
                severity: warning.level || "warn",
                ruleId: warning.ruleId,
                file: warning.file,
                message: warning.message,
                event: warning.event,
                timestamp: warning.timestamp.toISOString(),
                agentAction: warning.agentAction || null,
                agentCommand: warning.agentCommand || null,
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
            "SLOT_MODIFIED - Slot 파일 수정 감지 (info)",
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

    "mandu.watch.status": async () => {
      try {
        const watcher = getWatcher();

        if (!watcher) {
          return {
            active: false,
            message: "Watch is not running",
            tip: "Use mandu.watch.start to begin watching",
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

    "mandu.watch.stop": async () => {
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
    "mandu.brain.checkLocation": async (args: Record<string, unknown>) => {
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

    "mandu.brain.checkImport": async (args: Record<string, unknown>) => {
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

    "mandu.brain.architecture": async (args: Record<string, unknown>) => {
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
          tip: "이 규칙을 따라 파일을 생성하세요. mandu.brain.checkLocation으로 검증할 수 있습니다.",
        };
      } catch (error) {
        return {
          error: "Failed to get architecture",
          details: error instanceof Error ? error.message : "Unknown error",
        };
      }
    },
  };

  // #235 followup — brain auth tools (status / login / logout).
  handlers["mandu.brain.status"] = async () => {
    const core = await import("@mandujs/core");
    assertBrainAuthSurface(core);
    const store = core.getCredentialStore();
    const resolution = await core.resolveBrainAdapter({
      adapter: "auto",
      credentialStore: store,
      projectRoot,
    });

    // Check ChatGPT session token (managed by @openai/codex, not the keychain).
    const chatgpt = new core.ChatGPTAuth();
    const chatgptFile = chatgpt.locateAuthFile();

    const providers: Record<string, unknown> = {};
    for (const provider of ["openai", "anthropic"] as const) {
      const token = await store.load(provider);
      providers[provider] = token
        ? {
            logged_in: true,
            source: "keychain",
            model: token.default_model ?? null,
            expires_at: token.expires_at
              ? new Date(token.expires_at * 1000).toISOString()
              : null,
            last_used_at: token.last_used_at ?? null,
          }
        : provider === "openai" && chatgptFile
          ? {
              logged_in: true,
              source: "chatgpt_session",
              auth_file: chatgptFile,
              note: "Managed by `@openai/codex` CLI. Mandu reads + auto-refreshes.",
            }
          : { logged_in: false };
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              active_tier: resolution.resolved,
              reason: resolution.reason,
              backend: store.backendName,
              providers,
            },
            null,
            2,
          ),
        },
      ],
    };
  };

  handlers["mandu.brain.login"] = async (args) => {
    const { provider = "openai", waitMs = 180000 } = args as {
      provider?: "openai" | "anthropic";
      waitMs?: number;
    };

    if (provider === "openai") {
      const core = await import("@mandujs/core");
      assertBrainAuthSurface(core);
      const auth = new core.ChatGPTAuth();
      const existing = auth.locateAuthFile();
      if (existing) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  provider: "openai",
                  already_authenticated: true,
                  auth_file: existing,
                  note:
                    "ChatGPT session already present. Call mandu.brain.logout + mandu.brain.login again to re-authenticate.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // Spawn `npx @openai/codex login` detached from the MCP process.
      // Codex itself opens the user's default browser (`start` on
      // Windows, `open` on macOS, `xdg-open` on Linux) — no TTY needed
      // on our side. We poll for ~/.codex/auth.json to appear and
      // return once it does.
      const { spawn } = await import("node:child_process");
      const child = spawn("npx", ["-y", "@openai/codex", "login"], {
        cwd: projectRoot,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });

      let stdoutBuffer = "";
      let stderrBuffer = "";
      child.stdout?.on("data", (d) => {
        stdoutBuffer += d.toString();
      });
      child.stderr?.on("data", (d) => {
        stderrBuffer += d.toString();
      });

      const deadline = Date.now() + Math.max(15_000, Math.min(waitMs, 600_000));
      let file: string | null = null;
      while (Date.now() < deadline) {
        file = auth.locateAuthFile();
        if (file) break;
        await new Promise((r) => setTimeout(r, 1000));
      }

      // Kill the codex process if it's still running (normally it exits
      // on its own once auth.json is written).
      if (!child.killed) {
        try { child.kill(); } catch { /* ignore */ }
      }

      const urlMatch = stdoutBuffer.match(
        /https:\/\/auth\.openai\.com\/oauth\/authorize\?[^\s]+/,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: Boolean(file),
                provider: "openai",
                auth_file: file,
                oauth_url: urlMatch ? urlMatch[0] : undefined,
                stdout_tail: stdoutBuffer.slice(-500),
                stderr_tail: stderrBuffer.slice(-500),
                note: file
                  ? "auth.json written; Mandu brain will now use the OpenAI tier."
                  : "No auth.json detected before waitMs expired. If the OAuth URL is present above, open it in a browser; otherwise rerun with a larger waitMs or run `npx @openai/codex login` in your own terminal.",
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    // Anthropic — Mandu-managed OAuth loopback flow.
    const core = await import("@mandujs/core");
    assertBrainAuthSurface(core);
    try {
      const adapter = new core.AnthropicOAuthAdapter({
        credentialStore: core.getCredentialStore(),
        projectRoot,
        strict: true,
        skipConsent: true,
      });
      const token = await adapter.login({});
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: true,
                provider: "anthropic",
                model: token.default_model ?? null,
                expires_at: token.expires_at
                  ? new Date(token.expires_at * 1000).toISOString()
                  : null,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: false,
                provider: "anthropic",
                error: err instanceof Error ? err.message : String(err),
              },
              null,
              2,
            ),
          },
        ],
      };
    }
  };

  handlers["mandu.brain.logout"] = async (args) => {
    const { provider = "all" } = args as {
      provider?: "openai" | "anthropic" | "all";
    };
    const core = await import("@mandujs/core");
    assertBrainAuthSurface(core);
    const store = core.getCredentialStore();
    const targets =
      provider === "all"
        ? (["openai", "anthropic"] as const)
        : ([provider] as const);
    for (const p of targets) {
      await store.delete(p);
      await core.revokeConsent(p, projectRoot);
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              logged_out: targets,
              note: targets.includes("openai")
                ? "Keychain-stored openai token cleared. To revoke the Codex CLI session (~/.codex/auth.json), run `npx @openai/codex logout`."
                : undefined,
            },
            null,
            2,
          ),
        },
      ],
    };
  };

  // Backward-compatible aliases (deprecated)
  handlers["mandu_doctor"] = handlers["mandu.brain.doctor"];
  handlers["mandu_watch_start"] = handlers["mandu.watch.start"];
  handlers["mandu_watch_stop"] = handlers["mandu.watch.stop"];
  handlers["mandu_watch_status"] = handlers["mandu.watch.status"];
  handlers["mandu_check_location"] = handlers["mandu.brain.checkLocation"];
  handlers["mandu_check_import"] = handlers["mandu.brain.checkImport"];
  handlers["mandu_get_architecture"] = handlers["mandu.brain.architecture"];

  return handlers;
}
