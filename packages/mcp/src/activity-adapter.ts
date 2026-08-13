/**
 * ActivityMonitor -> EventBus adapter
 * Emits MCP tool execution events into the unified observability bus.
 */

import { eventBus } from "@mandujs/core/compat/observability/index";

export function emitMcpEvent(
  toolName: string,
  args: unknown,
  result: unknown,
  duration: number,
  success: boolean,
): void {
  eventBus.emit({
    type: "mcp",
    severity: success ? "info" : "error",
    source: "mcp",
    message: `${toolName} ${success ? "ok" : "fail"} ${duration}ms`,
    duration,
    data: { tool: toolName, args, success },
  });
}
