/**
 * DNA-001: Plugin System
 *
 * Mandu 플러그인 시스템
 * - Guard 프리셋 플러그인
 * - 빌드 플러그인
 * - 로거 전송 플러그인
 * - MCP 도구 플러그인
 * - 미들웨어 플러그인
 */

export {
  PluginRegistry,
  globalPluginRegistry,
  definePlugin,
} from "./registry";

export type {
  Plugin,
  PluginApi,
  PluginCategory,
  PluginMeta,
  PluginHooks,
  GuardPresetPlugin,
  GuardRule,
  GuardRuleContext,
  GuardViolation,
  LayerDefinition,
  ImportInfo,
  ExportInfo,
  BuildPlugin,
  BuildContext,
  BuildResult,
  LoggerTransportPlugin,
  LogEntry,
  McpToolPlugin,
  MiddlewarePlugin,
} from "./types";
