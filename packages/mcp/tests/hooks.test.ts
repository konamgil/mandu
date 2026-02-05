/**
 * MCP Hooks Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mcpHookRegistry,
  registerDefaultMcpHooks,
  getToolStats,
  resetToolStats,
  createArgValidationHook,
  type McpToolContext,
} from "../src/hooks/mcp-hooks.js";

describe("MCP Hooks", () => {
  beforeEach(() => {
    mcpHookRegistry.clear();
    resetToolStats();
  });

  describe("mcpHookRegistry", () => {
    it("should register pre-hook", async () => {
      const hook = vi.fn();
      mcpHookRegistry.registerPreHook(hook);

      const ctx: McpToolContext = {
        toolName: "test_tool",
        args: {},
        projectRoot: "/test",
        startTime: Date.now(),
      };

      await mcpHookRegistry.runPreHooks(ctx);

      expect(hook).toHaveBeenCalledWith(ctx);
    });

    it("should register post-hook", async () => {
      const hook = vi.fn();
      mcpHookRegistry.registerPostHook(hook);

      const ctx: McpToolContext = {
        toolName: "test_tool",
        args: {},
        projectRoot: "/test",
        startTime: Date.now(),
      };

      await mcpHookRegistry.runPostHooks(ctx, { result: true });

      expect(hook).toHaveBeenCalledWith(ctx, { result: true }, undefined);
    });

    it("should run hooks in priority order", async () => {
      const order: number[] = [];

      mcpHookRegistry.registerPreHook(() => { order.push(2); }, 200);
      mcpHookRegistry.registerPreHook(() => { order.push(1); }, 100);
      mcpHookRegistry.registerPreHook(() => { order.push(3); }, 300);

      const ctx: McpToolContext = {
        toolName: "test",
        args: {},
        projectRoot: "/test",
        startTime: Date.now(),
      };

      await mcpHookRegistry.runPreHooks(ctx);

      expect(order).toEqual([1, 2, 3]);
    });

    it("should return unregister function", async () => {
      const hook = vi.fn();
      const unregister = mcpHookRegistry.registerPreHook(hook);

      unregister();

      const ctx: McpToolContext = {
        toolName: "test",
        args: {},
        projectRoot: "/test",
        startTime: Date.now(),
      };

      await mcpHookRegistry.runPreHooks(ctx);

      expect(hook).not.toHaveBeenCalled();
    });

    it("should stop execution on pre-hook error", async () => {
      mcpHookRegistry.registerPreHook(() => {
        throw new Error("Pre-hook error");
      });

      const ctx: McpToolContext = {
        toolName: "test",
        args: {},
        projectRoot: "/test",
        startTime: Date.now(),
      };

      await expect(mcpHookRegistry.runPreHooks(ctx)).rejects.toThrow("Pre-hook error");
    });

    it("should continue on post-hook error", async () => {
      const secondHook = vi.fn();

      mcpHookRegistry.registerPostHook(() => {
        throw new Error("Post-hook error");
      }, 100);
      mcpHookRegistry.registerPostHook(secondHook, 200);

      const ctx: McpToolContext = {
        toolName: "test",
        args: {},
        projectRoot: "/test",
        startTime: Date.now(),
      };

      // Should not throw
      await mcpHookRegistry.runPostHooks(ctx, {});

      // Second hook should still run
      expect(secondHook).toHaveBeenCalled();
    });

    it("should report hook counts", () => {
      mcpHookRegistry.registerPreHook(() => {});
      mcpHookRegistry.registerPreHook(() => {});
      mcpHookRegistry.registerPostHook(() => {});

      const counts = mcpHookRegistry.counts;
      expect(counts.pre).toBe(2);
      expect(counts.post).toBe(1);
    });
  });

  describe("registerDefaultMcpHooks", () => {
    it("should register default hooks", () => {
      registerDefaultMcpHooks();

      const counts = mcpHookRegistry.counts;
      expect(counts.post).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Tool Statistics", () => {
    it("should collect tool stats", async () => {
      registerDefaultMcpHooks();

      const ctx: McpToolContext = {
        toolName: "test_tool",
        args: {},
        projectRoot: "/test",
        startTime: Date.now() - 100, // 100ms ago
      };

      await mcpHookRegistry.runPostHooks(ctx, { result: true });
      await mcpHookRegistry.runPostHooks(ctx, null, new Error("Error"));

      const stats = getToolStats();
      expect(stats["test_tool"]).toBeDefined();
      expect(stats["test_tool"].calls).toBe(2);
      expect(stats["test_tool"].errors).toBe(1);
    });

    it("should reset stats", async () => {
      registerDefaultMcpHooks();

      const ctx: McpToolContext = {
        toolName: "test_tool",
        args: {},
        projectRoot: "/test",
        startTime: Date.now(),
      };

      await mcpHookRegistry.runPostHooks(ctx, {});

      resetToolStats();

      const stats = getToolStats();
      expect(stats["test_tool"]).toBeUndefined();
    });
  });

  describe("createArgValidationHook", () => {
    it("should validate arguments", async () => {
      const validationHook = createArgValidationHook({
        test_tool: (args) => args.required !== undefined || "required field is missing",
      });

      mcpHookRegistry.registerPreHook(validationHook);

      const ctx: McpToolContext = {
        toolName: "test_tool",
        args: {},
        projectRoot: "/test",
        startTime: Date.now(),
      };

      await expect(mcpHookRegistry.runPreHooks(ctx)).rejects.toThrow("required field is missing");
    });

    it("should pass valid arguments", async () => {
      const validationHook = createArgValidationHook({
        test_tool: (args) => args.required !== undefined || "required field is missing",
      });

      mcpHookRegistry.registerPreHook(validationHook);

      const ctx: McpToolContext = {
        toolName: "test_tool",
        args: { required: "value" },
        projectRoot: "/test",
        startTime: Date.now(),
      };

      await expect(mcpHookRegistry.runPreHooks(ctx)).resolves.toBeUndefined();
    });

    it("should skip unknown tools", async () => {
      const validationHook = createArgValidationHook({
        other_tool: () => false,
      });

      mcpHookRegistry.registerPreHook(validationHook);

      const ctx: McpToolContext = {
        toolName: "test_tool",
        args: {},
        projectRoot: "/test",
        startTime: Date.now(),
      };

      await expect(mcpHookRegistry.runPreHooks(ctx)).resolves.toBeUndefined();
    });
  });
});
