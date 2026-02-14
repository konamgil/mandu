#!/usr/bin/env bun

/**
 * @mandujs/mcp - MCP Server for Mandu Framework
 *
 * DNA 기능 통합:
 * - DNA-001: 플러그인 기반 도구 등록
 * - DNA-006: 설정 핫 리로드
 * - DNA-007: 에러 추출 및 분류
 * - DNA-008: 구조화된 로깅
 * - DNA-016: Pre/Post 도구 훅
 */

// Main exports
export { ManduMcpServer, startServer } from "./server.js";

// Registry exports (DNA-001)
export {
  McpToolRegistry,
  mcpToolRegistry,
  type ToolRegistration,
  type RegistryEvent,
  type RegistryDump,
} from "./registry/index.js";

// Adapter exports
export {
  toolToPlugin,
  pluginToTool,
  moduleToPlugins,
  pluginsToTools,
  pluginsToHandlers,
  monitorEventToRecord,
  recordToMonitorEvent,
} from "./adapters/index.js";

// Executor exports (DNA-007)
export {
  formatMcpError,
  createToolResponse,
  isErrorResponse,
  extractErrorFromResponse,
  logToolError,
  ToolExecutor,
  createToolExecutor,
  type McpErrorResponse,
  type McpToolResponse,
  type ToolExecutorOptions,
  type ExecutionResult,
} from "./executor/index.js";

// Hook exports (DNA-016)
export {
  mcpHookRegistry,
  registerDefaultMcpHooks,
  slowToolLoggingHook,
  statsCollectorHook,
  getToolStats,
  resetToolStats,
  createArgValidationHook,
  startMcpConfigWatcher,
  type McpToolContext,
  type McpPreToolHook,
  type McpPostToolHook,
  type McpConfigWatcherOptions,
} from "./hooks/index.js";

// Logging exports (DNA-008)
export {
  createMcpActivityTransport,
  setupMcpLogging,
  teardownMcpLogging,
  dispatchMonitorEvent,
  createMcpLogRecord,
  MCP_TRANSPORT_ID,
  type McpTransportOptions,
} from "./logging/index.js";

// Tools exports
export {
  registerBuiltinTools,
  getToolCounts,
  getToolsSummary,
} from "./tools/index.js";

// CLI entry point
import { startServer } from "./server.js";
import path from "path";

// Start server if run directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const globalMode = args.includes("--global");
  const rootIndex = args.indexOf("--root");
  const rootArg = rootIndex >= 0 ? args[rootIndex + 1] : undefined;
  const projectRoot = rootArg
    ? path.resolve(rootArg)
    : globalMode
      ? process.cwd()
      : undefined;

  startServer(projectRoot).catch((error) => {
    console.error("Failed to start Mandu MCP server:", error);
    process.exit(1);
  });
}
