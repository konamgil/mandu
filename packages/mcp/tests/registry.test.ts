/**
 * MCP Tool Registry Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  McpToolRegistry,
  mcpToolRegistry,
  type RegistryEvent,
} from "../src/registry/mcp-tool-registry.js";
import type { McpToolPlugin } from "@mandujs/core";

describe("McpToolRegistry", () => {
  let registry: McpToolRegistry;

  const mockTool: McpToolPlugin = {
    name: "test_tool",
    description: "A test tool",
    inputSchema: { type: "object", properties: {} },
    execute: vi.fn().mockResolvedValue({ success: true }),
  };

  beforeEach(() => {
    registry = new McpToolRegistry();
  });

  describe("register", () => {
    it("should register a tool", () => {
      registry.register(mockTool);

      expect(registry.has("test_tool")).toBe(true);
      expect(registry.size).toBe(1);
    });

    it("should register a tool with category", () => {
      registry.register(mockTool, "test-category");

      expect(registry.getByCategory("test-category")).toHaveLength(1);
      expect(registry.getCategories()).toContain("test-category");
    });

    it("should return unregister function", () => {
      const unregister = registry.register(mockTool);

      expect(registry.has("test_tool")).toBe(true);

      unregister();
      expect(registry.has("test_tool")).toBe(false);
    });

    it("should emit register event", () => {
      const listener = vi.fn();
      registry.on(listener);

      registry.register(mockTool, "test-category");

      expect(listener).toHaveBeenCalledWith({
        type: "register",
        toolName: "test_tool",
        category: "test-category",
      });
    });
  });

  describe("registerAll", () => {
    it("should register multiple tools", () => {
      const tools: McpToolPlugin[] = [
        { ...mockTool, name: "tool_1" },
        { ...mockTool, name: "tool_2" },
        { ...mockTool, name: "tool_3" },
      ];

      registry.registerAll(tools, "batch");

      expect(registry.size).toBe(3);
      expect(registry.getByCategory("batch")).toHaveLength(3);
    });
  });

  describe("unregister", () => {
    it("should unregister a tool", () => {
      registry.register(mockTool);
      const result = registry.unregister("test_tool");

      expect(result).toBe(true);
      expect(registry.has("test_tool")).toBe(false);
    });

    it("should return false for non-existent tool", () => {
      const result = registry.unregister("nonexistent");
      expect(result).toBe(false);
    });

    it("should remove from category", () => {
      registry.register(mockTool, "test-category");
      registry.unregister("test_tool");

      expect(registry.getByCategory("test-category")).toHaveLength(0);
    });
  });

  describe("unregisterCategory", () => {
    it("should unregister all tools in a category", () => {
      registry.register({ ...mockTool, name: "tool_1" }, "cat");
      registry.register({ ...mockTool, name: "tool_2" }, "cat");
      registry.register({ ...mockTool, name: "other" }, "other-cat");

      const count = registry.unregisterCategory("cat");

      expect(count).toBe(2);
      expect(registry.size).toBe(1);
      expect(registry.has("other")).toBe(true);
    });
  });

  describe("get", () => {
    it("should return registered tool", () => {
      registry.register(mockTool);
      const tool = registry.get("test_tool");

      expect(tool).toBeDefined();
      expect(tool?.name).toBe("test_tool");
    });

    it("should return undefined for non-existent tool", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  describe("setEnabled", () => {
    it("should disable a tool", () => {
      registry.register(mockTool);
      registry.setEnabled("test_tool", false);

      expect(registry.enabledCount).toBe(0);
      expect(registry.toToolDefinitions()).toHaveLength(0);
    });

    it("should re-enable a tool", () => {
      registry.register(mockTool);
      registry.setEnabled("test_tool", false);
      registry.setEnabled("test_tool", true);

      expect(registry.enabledCount).toBe(1);
    });
  });

  describe("toToolDefinitions", () => {
    it("should return MCP SDK Tool format", () => {
      registry.register(mockTool);
      const tools = registry.toToolDefinitions();

      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        name: "test_tool",
        description: "A test tool",
        inputSchema: { type: "object", properties: {} },
      });
    });

    it("should only return enabled tools", () => {
      registry.register({ ...mockTool, name: "enabled" });
      registry.register({ ...mockTool, name: "disabled" });
      registry.setEnabled("disabled", false);

      const tools = registry.toToolDefinitions();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("enabled");
    });
  });

  describe("toHandlers", () => {
    it("should return handler map", async () => {
      registry.register(mockTool);
      const handlers = registry.toHandlers();

      expect(handlers["test_tool"]).toBeDefined();
      const result = await handlers["test_tool"]({});
      expect(result).toEqual({ success: true });
    });
  });

  describe("clear", () => {
    it("should remove all tools", () => {
      registry.register({ ...mockTool, name: "tool_1" });
      registry.register({ ...mockTool, name: "tool_2" });

      registry.clear();

      expect(registry.size).toBe(0);
      expect(registry.getCategories()).toHaveLength(0);
    });
  });

  describe("dump", () => {
    it("should return registry state", () => {
      registry.register(mockTool, "test-category");
      const dump = registry.dump();

      expect(dump.totalTools).toBe(1);
      expect(dump.enabledTools).toBe(1);
      expect(dump.categories).toContain("test-category");
      expect(dump.tools["test_tool"]).toBeDefined();
      expect(dump.tools["test_tool"].enabled).toBe(true);
    });
  });
});

describe("Global mcpToolRegistry", () => {
  beforeEach(() => {
    mcpToolRegistry.clear();
  });

  it("should be a singleton", () => {
    mcpToolRegistry.register({
      name: "global_tool",
      description: "Global tool",
      inputSchema: {},
      execute: async () => ({}),
    });

    expect(mcpToolRegistry.has("global_tool")).toBe(true);
  });
});
