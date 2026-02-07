/**
 * MCP Tool Adapter
 *
 * MCP SDK Tool을 DNA-001 McpToolPlugin으로 변환
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpToolPlugin } from "@mandujs/core";

/**
 * MCP SDK Tool을 McpToolPlugin으로 변환
 *
 * @example
 * ```ts
 * const plugin = toolToPlugin(
 *   { name: "my_tool", description: "...", inputSchema: {} },
 *   async (args) => ({ success: true })
 * );
 * ```
 */
export function toolToPlugin(
  definition: Tool,
  handler: (args: Record<string, unknown>) => Promise<unknown>
): McpToolPlugin {
  return {
    name: definition.name,
    description: definition.description ?? "",
    inputSchema: definition.inputSchema as Record<string, unknown>,
    execute: handler,
  };
}

/**
 * McpToolPlugin을 MCP SDK Tool로 변환 (역방향)
 */
export function pluginToTool(plugin: McpToolPlugin): Tool {
  return {
    name: plugin.name,
    description: plugin.description,
    inputSchema: plugin.inputSchema,
  };
}

/**
 * 기존 도구 모듈(definitions + handlers)을 플러그인 배열로 변환
 *
 * @example
 * ```ts
 * const plugins = moduleToPlugins(
 *   specToolDefinitions,
 *   specTools(projectRoot)
 * );
 * ```
 */
export function moduleToPlugins(
  definitions: Tool[],
  handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>>
): McpToolPlugin[] {
  return definitions.map((def) => {
    const handler = handlers[def.name];
    if (!handler) {
      throw new Error(`Handler not found for tool: ${def.name}`);
    }
    return toolToPlugin(def, handler);
  });
}

/**
 * 플러그인 배열을 MCP SDK Tool 배열로 변환
 */
export function pluginsToTools(plugins: McpToolPlugin[]): Tool[] {
  return plugins.map(pluginToTool);
}

/**
 * 플러그인 배열을 핸들러 맵으로 변환
 */
export function pluginsToHandlers(
  plugins: McpToolPlugin[]
): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};

  for (const plugin of plugins) {
    handlers[plugin.name] = async (args) => plugin.execute(args);
  }

  return handlers;
}
