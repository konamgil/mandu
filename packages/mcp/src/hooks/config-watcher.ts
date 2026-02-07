/**
 * MCP Config Watcher
 *
 * DNA-006 설정 핫 리로드와 MCP 서버 통합
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { watchConfig, hasConfigChanged, type ManduConfig } from "@mandujs/core";
import { mcpToolRegistry } from "../registry/mcp-tool-registry.js";

/**
 * MCP Config Watcher 옵션
 */
export interface McpConfigWatcherOptions {
  /** MCP Server 인스턴스 */
  server?: Server;
  /** 설정 변경 콜백 */
  onReload?: (config: ManduConfig) => void | Promise<void>;
  /** MCP 설정 변경 시 콜백 */
  onMcpConfigChange?: (config: ManduConfig) => void | Promise<void>;
  /** 에러 콜백 */
  onError?: (error: unknown) => void;
  /** 디바운스 딜레이 (ms) */
  debounceMs?: number;
}

/**
 * Config Watcher 결과
 */
export interface McpConfigWatcher {
  /** 감시 중지 */
  stop: () => void;
  /** 수동 리로드 */
  reload: () => Promise<ManduConfig | undefined>;
  /** 현재 설정 */
  getConfig: () => ManduConfig | undefined;
}

/**
 * MCP 서버 설정 감시 시작
 *
 * @example
 * ```ts
 * const watcher = await startMcpConfigWatcher(projectRoot, {
 *   server,
 *   onReload: (config) => {
 *     console.log("Config reloaded:", config);
 *   },
 * });
 *
 * // 나중에 중지
 * watcher.stop();
 * ```
 */
export async function startMcpConfigWatcher(
  projectRoot: string,
  options: McpConfigWatcherOptions = {}
): Promise<McpConfigWatcher> {
  const {
    server,
    onReload,
    onMcpConfigChange,
    onError,
    debounceMs = 200,
  } = options;

  const watcher = await watchConfig(
    projectRoot,
    async (newConfig, event) => {
      // MCP 서버에 알림
      if (server) {
        try {
          await server.sendLoggingMessage({
            level: "info",
            logger: "mandu-config",
            data: {
              type: "config_reload",
              changedSections: event.changedSections,
              path: event.path,
            },
          });
        } catch {
          // 알림 실패 무시
        }
      }

      // MCP 관련 설정 변경 확인
      if (event.previous && event.current) {
        if (hasConfigChanged(event.previous, event.current, "mcp")) {
          // MCP 설정 변경 시 도구 재초기화 등 필요한 작업
          if (server) {
            try {
              await server.sendLoggingMessage({
                level: "warning",
                logger: "mandu-config",
                data: {
                  type: "mcp_config_changed",
                  message: "MCP configuration changed. Some tools may need reinitialization.",
                },
              });
            } catch {
              // 알림 실패 무시
            }
          }

          await onMcpConfigChange?.(newConfig);
        }

        // Guard 설정 변경 확인
        if (hasConfigChanged(event.previous, event.current, "guard")) {
          if (server) {
            try {
              await server.sendLoggingMessage({
                level: "info",
                logger: "mandu-config",
                data: {
                  type: "guard_config_changed",
                  message: "Guard configuration changed. Architecture rules updated.",
                },
              });
            } catch {
              // 알림 실패 무시
            }
          }
        }
      }

      // 일반 콜백
      await onReload?.(newConfig);
    },
    {
      debounceMs,
      immediate: false,
      onError: (err) => {
        console.error("[MCP:ConfigWatcher] Error:", err);

        if (server) {
          server.sendLoggingMessage({
            level: "error",
            logger: "mandu-config",
            data: {
              type: "config_error",
              error: err instanceof Error ? err.message : String(err),
            },
          }).catch(() => {});
        }

        onError?.(err);
      },
    }
  );

  return watcher;
}

/**
 * 설정 변경 시 도구 재등록이 필요한지 확인
 */
export function needsToolReregistration(
  previous: ManduConfig | undefined,
  current: ManduConfig | undefined
): boolean {
  if (!previous || !current) return false;

  // MCP 플러그인 설정 변경
  const prevPlugins = (previous as Record<string, unknown>).mcpPlugins;
  const currPlugins = (current as Record<string, unknown>).mcpPlugins;

  if (JSON.stringify(prevPlugins) !== JSON.stringify(currPlugins)) {
    return true;
  }

  return false;
}
