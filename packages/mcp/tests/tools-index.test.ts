import { afterEach, describe, expect, test } from "bun:test";
import { mcpToolRegistry } from "../src/registry/mcp-tool-registry.js";
import {
  TOOL_MODULES,
  getToolsSummary,
  registerBuiltinTools,
  validateBuiltinToolModules,
} from "../src/tools/index.js";

describe("builtin MCP tool module registry", () => {
  afterEach(() => {
    mcpToolRegistry.clear();
  });

  test("has no duplicate categories or tool definition names", () => {
    expect(validateBuiltinToolModules()).toEqual([]);
  });

  test("validator reports duplicate categories and tool names", () => {
    const duplicate = [
      {
        ...TOOL_MODULES[0],
        category: "dupe",
        definitions: [
          {
            ...TOOL_MODULES[0].definitions[0],
            name: "same.tool",
          },
        ],
      },
      {
        ...TOOL_MODULES[1],
        category: "dupe",
        definitions: [
          {
            ...TOOL_MODULES[1].definitions[0],
            name: "same.tool",
          },
        ],
      },
    ];

    expect(validateBuiltinToolModules(duplicate)).toEqual([
      "duplicate tool category: dupe",
      "duplicate tool definition: same.tool in dupe and dupe",
    ]);
  });

  test("every module declares at least one tool definition", () => {
    for (const module of TOOL_MODULES) {
      expect(module.definitions.length).toBeGreaterThan(0);
    }
  });

  test("agent-core profile exposes only agent workflow and docs categories", () => {
    registerBuiltinTools(process.cwd(), undefined, undefined, { profile: "agent-core" });

    const summary = getToolsSummary();
    expect(summary.categories.sort()).toEqual(["agent", "docs"]);
    expect(mcpToolRegistry.get("mandu.agent.context")).toBeTruthy();
    expect(mcpToolRegistry.get("mandu.agent.plan")).toBeTruthy();
    expect(mcpToolRegistry.get("mandu.agent.apply")).toBeTruthy();
    expect(mcpToolRegistry.get("mandu.agent.verify")).toBeTruthy();
    expect(mcpToolRegistry.get("mandu.agent.repair")).toBeTruthy();
    expect(mcpToolRegistry.get("mandu.agent.sync")).toBeTruthy();
    expect(mcpToolRegistry.get("mandu.route.list")).toBeUndefined();
  });
});
