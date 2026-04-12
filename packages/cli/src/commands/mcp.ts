/**
 * mandu mcp <tool> [args] -- MCP-CLI Bridge
 *
 * Exposes all MCP tools to human developers via terminal.
 * Reuses the existing tool registry so every registered tool is available.
 */

import type { McpToolRegistry } from "@mandujs/mcp";
import { theme } from "../terminal";

interface McpCommandOptions {
  tool?: string;
  args?: Record<string, string>;
  json?: boolean;
  list?: boolean;
}

/**
 * Bootstrap the MCP tool registry for CLI use.
 * Skips server-requiring modules (brain, project) since there is no MCP Server.
 */
export async function ensureRegistry(): Promise<McpToolRegistry> {
  const { registerBuiltinTools, mcpToolRegistry } = await import("@mandujs/mcp");
  if (mcpToolRegistry.size === 0) {
    registerBuiltinTools(process.cwd());
  }
  return mcpToolRegistry;
}

export function buildMcpInput(args?: Record<string, string>): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  if (!args) {
    return input;
  }

  for (const [key, value] of Object.entries(args)) {
    if (key.startsWith("_") || key === "json" || key === "list") continue;
    if (value === "true") input[key] = true;
    else if (value === "false") input[key] = false;
    else if (/^\d+$/.test(value)) input[key] = Number(value);
    else input[key] = value;
  }

  return input;
}

export async function executeMcpTool(
  tool: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const registry = await ensureRegistry();
  const plugin = registry.get(tool);

  if (!plugin) {
    throw new Error(`Tool not found: ${tool}`);
  }

  return plugin.execute(input);
}

export async function mcp(options: McpCommandOptions): Promise<boolean> {
  const { tool, json = false, list = false } = options;

  const registry = await ensureRegistry();

  // ── List mode ──────────────────────────────────────────────────────
  if (list || !tool) {
    const categories = registry.getCategories();

    if (json) {
      const dump = registry.dump();
      console.log(JSON.stringify(dump, null, 2));
      return true;
    }

    console.log(theme.heading("\nAvailable MCP Tools") + theme.muted(` (${registry.enabledCount} tools)\n`));

    for (const category of categories.sort()) {
      const plugins = registry.getByCategory(category);
      if (plugins.length === 0) continue;

      console.log(theme.heading(`  [${category}]`));
      for (const p of plugins) {
        const desc = p.description.length > 72
          ? p.description.slice(0, 69) + "..."
          : p.description;
        console.log(`    ${theme.command(p.name)}  ${theme.muted(desc)}`);
      }
      console.log();
    }

    console.log(theme.muted("  Run: bunx mandu mcp <tool_name> [--arg value ...]\n"));
    return true;
  }

  // ── Execute a specific tool ────────────────────────────────────────
  const plugin = registry.get(tool);

  if (!plugin) {
    // Fuzzy-match suggestions
    const all = registry.names;
    const suggestions = all
      .filter((name: string) => name.includes(tool) || tool.includes(name))
      .slice(0, 5);

    console.error(`Error: tool "${tool}" not found.`);
    if (suggestions.length > 0) {
      console.error(`\nDid you mean?\n${suggestions.map((s: string) => `  - ${s}`).join("\n")}`);
    }
    console.error(`\nRun "bunx mandu mcp --list" to see all available tools.`);
    return false;
  }

  try {
    const result = await executeMcpTool(tool, buildMcpInput(options.args));

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (typeof result === "string") {
      console.log(result);
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error executing "${tool}": ${message}`);
    if (err instanceof Error && err.stack && !json) {
      console.error(theme.muted(err.stack));
    }
    return false;
  }
}
