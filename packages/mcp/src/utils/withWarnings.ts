/**
 * Watcher Warning Injection for Mutation Tools
 *
 * Mutation 도구(write_slot, add_route, generate 등) 실행 후
 * watcher 경고를 자동으로 응답에 포함시킨다.
 *
 * MCP notification이 Claude Code에 전달되지 않는 문제를 해결.
 */

import { getWatcher } from "../../../core/src/index.js";

const MUTATION_TOOLS = new Set([
  "mandu_write_slot",
  "mandu_add_route",
  "mandu_update_route",
  "mandu_delete_route",
  "mandu_generate",
  "mandu_build",
  "mandu_commit",
  "mandu_add_client_slot",
  "mandu_set_hydration",
  "mandu_create_contract",
  "mandu_update_route_contract",
  "mandu_sync_contract_slot",
]);

/** watcher debounce(300ms) + 여유분 */
const WARNING_WAIT_MS = 400;

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/**
 * Mutation 도구 핸들러를 감싸서, 실행 후 발생한 watcher 경고를
 * 응답 객체의 `_warnings` 필드에 자동 포함시킨다.
 */
export function applyWarningInjection(
  handlers: Record<string, ToolHandler>
): Record<string, ToolHandler> {
  const wrapped: Record<string, ToolHandler> = {};

  for (const [name, handler] of Object.entries(handlers)) {
    if (MUTATION_TOOLS.has(name)) {
      wrapped[name] = wrapWithWarnings(handler);
    } else {
      wrapped[name] = handler;
    }
  }

  return wrapped;
}

function wrapWithWarnings(handler: ToolHandler): ToolHandler {
  return async (args: Record<string, unknown>) => {
    const watcher = getWatcher();
    const beforeCount = watcher?.getRecentWarnings(100).length ?? 0;

    const result = await handler(args);

    // watcher debounce 대기
    await new Promise((resolve) => setTimeout(resolve, WARNING_WAIT_MS));

    const allWarnings = watcher?.getRecentWarnings(100) ?? [];
    const newWarnings = allWarnings.slice(beforeCount);

    if (
      newWarnings.length > 0 &&
      typeof result === "object" &&
      result !== null
    ) {
      return {
        ...(result as Record<string, unknown>),
        _warnings: newWarnings.map((w) => ({
          ruleId: w.ruleId,
          file: w.file,
          message: w.message,
          level: w.level ?? "warn",
        })),
      };
    }

    return result;
  };
}
