/**
 * Mandu MCP Kitchen Tools
 * Bridge between Kitchen DevTools (browser) and MCP protocol.
 * Enables any MCP-compatible agent to read client-side errors in real-time.
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { loadManduConfig } from "@mandujs/core";
import { getDevServerState } from "./project.js";

export const kitchenToolDefinitions: Tool[] = [
  {
    name: "mandu.kitchen.errors",
    description:
      "Read client-side errors captured by Kitchen DevTools. Use clear=true to clear after reading.",
    annotations: {
      readOnlyHint: true,
    },
    inputSchema: {
      type: "object",
      properties: {
        clear: {
          type: "boolean",
          description: "Clear errors after reading (default: false)",
        },
      },
      required: [],
    },
  },
];

export function kitchenTools(projectRoot: string) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    "mandu.kitchen.errors": async (args: Record<string, unknown>) => {
      const { clear = false } = args as { clear?: boolean };

      // Detect port from the running dev server output first, then fall back to config
      let port: number | undefined;

      const serverState = getDevServerState();
      if (serverState) {
        // Parse the actual port from dev server stdout (e.g. "http://localhost:3333")
        for (const line of serverState.output) {
          const portMatch = line.match(/https?:\/\/localhost:(\d+)/);
          if (portMatch) {
            port = parseInt(portMatch[1], 10);
          }
        }
      }

      // Fall back to config if we couldn't detect from running server
      if (!port) {
        const config = await loadManduConfig(projectRoot);
        port = config.server?.port ?? 3333;
      }

      const baseUrl = `http://localhost:${port}`;

      try {
        // Fetch errors from Kitchen API
        const res = await fetch(`${baseUrl}/__kitchen/api/errors`);
        if (!res.ok) {
          return {
            success: false,
            message: `Dev server not reachable at ${baseUrl}. Is 'mandu dev' running?`,
            errors: [],
          };
        }

        const data = await res.json() as { errors: unknown[]; count: number };

        // Clear if requested
        if (clear && data.count > 0) {
          await fetch(`${baseUrl}/__kitchen/api/errors`, { method: "DELETE" });
        }

        if (data.count === 0) {
          return {
            success: true,
            message: "No client-side errors detected.",
            errors: [],
            count: 0,
          };
        }

        return {
          success: true,
          message: `${data.count} client-side error(s) captured.${clear ? " Errors cleared." : ""}`,
          errors: data.errors,
          count: data.count,
          relatedSkills: ["mandu-debug"],
        };
      } catch {
        return {
          success: false,
          message: `Cannot connect to dev server at ${baseUrl}. Make sure 'mandu dev' is running.`,
          errors: [],
        };
      }
    },
  };

  // Backward-compatible alias
  handlers["mandu_kitchen_errors"] = handlers["mandu.kitchen.errors"];

  return handlers;
}
