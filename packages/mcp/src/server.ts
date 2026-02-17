/**
 * Mandu MCP Server v2
 *
 * DNA 기능 통합:
 * - DNA-001: 플러그인 기반 도구 등록
 * - DNA-006: 설정 핫 리로드
 * - DNA-007: 에러 추출 및 분류
 * - DNA-008: 구조화된 로깅
 * - DNA-016: Pre/Post 도구 훅
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadManduConfig, startWatcher, type ManduConfig } from "@mandujs/core";

// DNA-001: 플러그인 기반 도구 레지스트리
import { mcpToolRegistry } from "./registry/mcp-tool-registry.js";
import { registerBuiltinTools, getToolsSummary } from "./tools/index.js";

// DNA-007: 에러 처리
import { createToolResponse, logToolError } from "./executor/error-handler.js";
import { ToolExecutor, createToolExecutor } from "./executor/tool-executor.js";

// DNA-008: 로깅 통합
import { setupMcpLogging, teardownMcpLogging } from "./logging/mcp-transport.js";

// DNA-016: 훅 시스템
import { mcpHookRegistry, registerDefaultMcpHooks, type McpToolContext } from "./hooks/mcp-hooks.js";

// DNA-006: 설정 핫 리로드
import { startMcpConfigWatcher, type McpConfigWatcher } from "./hooks/config-watcher.js";

// 기존 컴포넌트
import { resourceHandlers, resourceDefinitions } from "./resources/handlers.js";
import { findProjectRoot } from "./utils/project.js";
import { applyWarningInjection } from "./utils/withWarnings.js";
import { ActivityMonitor } from "./activity-monitor.js";

/**
 * MCP 서버 버전
 */
const MCP_VERSION = "0.12.0";

/**
 * ManduMcpServer v2
 *
 * DNA 기능들을 통합한 MCP 서버
 */
export class ManduMcpServer {
  private server: Server;
  private projectRoot: string;
  private monitor: ActivityMonitor;
  private config?: ManduConfig;
  private configWatcher?: McpConfigWatcher;
  private toolExecutor: ToolExecutor;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.monitor = new ActivityMonitor(projectRoot);

    // MCP Server 초기화
    this.server = new Server(
      {
        name: "mandu-mcp",
        version: MCP_VERSION,
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          logging: {},
        },
      }
    );

    // DNA-001: 플러그인 기반 도구 등록
    registerBuiltinTools(projectRoot, this.server, this.monitor);

    // DNA-008: 로깅 통합
    setupMcpLogging({ consoleOutput: false });

    // DNA-016: 기본 훅 등록
    registerDefaultMcpHooks();

    // Tool Executor 생성
    this.toolExecutor = createToolExecutor({
      projectRoot,
      logTool: (name, args, result, error) => this.monitor.logTool(name, args, result, error),
      logResult: (name, result) => this.monitor.logResult(name, result),
    });

    // 핸들러 등록
    this.registerToolHandlers();
    this.registerResourceHandlers();
  }

  /**
   * 도구 핸들러 등록 (DNA-001 레지스트리 사용)
   */
  private registerToolHandlers(): void {
    // 도구 목록 요청
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: mcpToolRegistry.toToolDefinitions(),
      };
    });

    // 도구 실행 요청
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // DNA-007 + DNA-016: Tool Executor로 실행
      const result = await this.toolExecutor.execute(name, args || {});

      return result.response;
    });
  }

  /**
   * 리소스 핸들러 등록 (기존 유지)
   */
  private registerResourceHandlers(): void {
    const handlers = resourceHandlers(this.projectRoot);

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: resourceDefinitions,
      };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      const handler = handlers[uri];
      if (!handler) {
        // 동적 리소스 패턴 매칭
        for (const [pattern, h] of Object.entries(handlers)) {
          if (pattern.includes("{") && matchResourcePattern(pattern, uri)) {
            const params = extractResourceParams(pattern, uri);
            const result = await h(params);
            return {
              contents: [
                {
                  uri,
                  mimeType: "application/json",
                  text: JSON.stringify(result, null, 2),
                },
              ],
            };
          }
        }

        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({ error: `Unknown resource: ${uri}` }),
            },
          ],
        };
      }

      try {
        const result = await handler({});
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    });
  }

  /**
   * 서버 실행
   */
  async run(): Promise<void> {
    // 설정 로드
    try {
      this.config = await loadManduConfig(this.projectRoot);
      this.toolExecutor.updateConfig(this.config);
    } catch {
      // 설정 로드 실패 시 기본값 사용
      console.error("[MCP] Config load failed, using defaults");
    }

    // DNA-006: 설정 핫 리로드 시작
    try {
      this.configWatcher = await startMcpConfigWatcher(this.projectRoot, {
        server: this.server,
        onReload: (newConfig) => {
          this.config = newConfig;
          this.toolExecutor.updateConfig(newConfig);
        },
        onMcpConfigChange: async () => {
          // MCP 설정 변경 시 도구 재등록 가능
          // 현재는 알림만 전송
        },
      });
    } catch {
      console.error("[MCP] Config watcher start failed (non-critical)");
    }

    // 서버 연결
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // 모니터 시작
    this.monitor.start();

    // 와처 자동 시작
    try {
      const watcher = await startWatcher({ rootDir: this.projectRoot });
      watcher.onWarning((warning) => {
        this.monitor.logWatch(
          warning.level || "warn",
          warning.ruleId,
          warning.file,
          warning.message
        );

        // Claude Code에 알림
        this.server.sendLoggingMessage({
          level: "warning",
          logger: "mandu-watch",
          data: {
            type: "watch_warning",
            severity: warning.level || "warn",
            ruleId: warning.ruleId,
            file: warning.file,
            message: warning.message,
            event: warning.event,
            agentAction: warning.agentAction || null,
            agentCommand: warning.agentCommand || null,
          },
        }).catch(() => {});
      });

      this.monitor.logEvent("SYSTEM", "Watcher auto-started");
    } catch {
      this.monitor.logEvent("SYSTEM", "Watcher auto-start failed (non-critical)");
    }

    // 시작 로그
    const summary = getToolsSummary();
    console.error(`Mandu MCP Server v${MCP_VERSION} running`);
    console.error(`  Project: ${this.projectRoot}`);
    console.error(`  Tools: ${summary.total} (${summary.categories.join(", ")})`);
  }

  /**
   * 서버 종료
   */
  async stop(): Promise<void> {
    // 설정 감시 중지
    this.configWatcher?.stop();

    // 로깅 해제
    teardownMcpLogging();

    // 모니터 종료
    this.monitor.stop();

    // 훅 정리
    mcpHookRegistry.clear();

    // 도구 레지스트리 정리
    mcpToolRegistry.clear();
  }

  /**
   * 현재 설정 반환
   */
  getConfig(): ManduConfig | undefined {
    return this.config;
  }

  /**
   * 도구 레지스트리 접근
   */
  getToolRegistry(): typeof mcpToolRegistry {
    return mcpToolRegistry;
  }

  /**
   * 훅 레지스트리 접근
   */
  getHookRegistry(): typeof mcpHookRegistry {
    return mcpHookRegistry;
  }
}

// ============================================
// 유틸리티 함수
// ============================================

/**
 * 리소스 패턴 매칭
 */
function matchResourcePattern(pattern: string, uri: string): boolean {
  const regexPattern = pattern
    .split(/\{[^}]+\}/)
    .map(part => part.replace(/[.+*?^${}()|[\]\\]/g, "\\$&"))
    .join("([^/]+)");
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(uri);
}

/**
 * 리소스 파라미터 추출
 */
function extractResourceParams(pattern: string, uri: string): Record<string, string> {
  const paramNames: string[] = [];
  const regexPattern = pattern
    .split(/\{([^}]+)\}/)
    .map((part, index) => {
      if (index % 2 === 1) {
        paramNames.push(part);
        return "([^/]+)";
      }
      return part.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");

  const regex = new RegExp(`^${regexPattern}$`);
  const match = uri.match(regex);

  if (!match) return {};

  const params: Record<string, string> = {};
  paramNames.forEach((name, index) => {
    params[name] = match[index + 1];
  });

  return params;
}

/**
 * MCP 서버 시작
 */
export async function startServer(projectRoot?: string): Promise<void> {
  const root = projectRoot || (await findProjectRoot()) || process.cwd();
  const server = new ManduMcpServer(root);
  await server.run();
}

// Re-exports
export { mcpToolRegistry } from "./registry/mcp-tool-registry.js";
export { mcpHookRegistry } from "./hooks/mcp-hooks.js";
export { registerBuiltinTools } from "./tools/index.js";
