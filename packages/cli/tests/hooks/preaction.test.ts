/**
 * DNA-016: Pre-Action Hooks Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  preActionRegistry,
  runPreAction,
  registerPreActionHook,
  setVerbose,
  isVerbose,
  setProcessTitle,
  type PreActionContext,
} from "../../src/hooks/preaction";

describe("DNA-016: Pre-Action Hooks", () => {
  beforeEach(() => {
    preActionRegistry.clear();
    setVerbose(false);
    // 배너 표시 방지
    process.env.MANDU_HIDE_BANNER = "1";
  });

  afterEach(() => {
    delete process.env.MANDU_HIDE_BANNER;
    delete process.env.MANDU_VERBOSE;
  });

  describe("preActionRegistry", () => {
    it("should register and run hooks", async () => {
      const hook = vi.fn();
      preActionRegistry.register(hook);

      await preActionRegistry.runAll({
        command: "test",
        options: {},
        verbose: false,
        cwd: process.cwd(),
      });

      expect(hook).toHaveBeenCalledTimes(1);
    });

    it("should unregister hooks", () => {
      const hook = vi.fn();
      preActionRegistry.register(hook);
      expect(preActionRegistry.size).toBe(1);

      const removed = preActionRegistry.unregister(hook);
      expect(removed).toBe(true);
      expect(preActionRegistry.size).toBe(0);
    });

    it("should run multiple hooks in order", async () => {
      const order: number[] = [];

      preActionRegistry.register(() => { order.push(1); });
      preActionRegistry.register(() => { order.push(2); });
      preActionRegistry.register(() => { order.push(3); });

      await preActionRegistry.runAll({
        command: "test",
        options: {},
        verbose: false,
        cwd: process.cwd(),
      });

      expect(order).toEqual([1, 2, 3]);
    });

    it("should handle async hooks", async () => {
      const results: string[] = [];

      preActionRegistry.register(async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push("async");
      });

      await preActionRegistry.runAll({
        command: "test",
        options: {},
        verbose: false,
        cwd: process.cwd(),
      });

      expect(results).toContain("async");
    });

    it("should clear all hooks", () => {
      preActionRegistry.register(() => {});
      preActionRegistry.register(() => {});

      preActionRegistry.clear();
      expect(preActionRegistry.size).toBe(0);
    });
  });

  describe("runPreAction", () => {
    it("should return PreActionContext", async () => {
      const ctx = await runPreAction({
        command: "dev",
        options: { port: "3000" },
      });

      expect(ctx.command).toBe("dev");
      expect(ctx.options.port).toBe("3000");
      expect(ctx.cwd).toBeDefined();
    });

    it("should set verbose mode from options", async () => {
      const ctx = await runPreAction({
        command: "dev",
        options: { verbose: "true" },
      });

      expect(ctx.verbose).toBe(true);
      expect(isVerbose()).toBe(true);
    });

    it("should set verbose mode from env", async () => {
      process.env.MANDU_VERBOSE = "true";

      const ctx = await runPreAction({
        command: "dev",
        options: {},
      });

      expect(ctx.verbose).toBe(true);
    });

    it("should skip config for init command", async () => {
      const ctx = await runPreAction({
        command: "init",
        options: {},
      });

      // init 명령어는 설정 로드 건너뜀
      expect(ctx.config).toBeUndefined();
    });

    it("should include subcommand", async () => {
      const ctx = await runPreAction({
        command: "routes",
        subcommand: "generate",
        options: {},
      });

      expect(ctx.command).toBe("routes");
      expect(ctx.subcommand).toBe("generate");
    });

    it("should run registered hooks", async () => {
      const hook = vi.fn();
      registerPreActionHook(hook);

      await runPreAction({
        command: "dev",
        options: {},
      });

      expect(hook).toHaveBeenCalled();
    });
  });

  describe("registerPreActionHook", () => {
    it("should return unregister function", async () => {
      const hook = vi.fn();
      const unregister = registerPreActionHook(hook);

      expect(preActionRegistry.size).toBe(1);

      unregister();
      expect(preActionRegistry.size).toBe(0);
    });
  });

  describe("setVerbose / isVerbose", () => {
    it("should get and set verbose mode", () => {
      expect(isVerbose()).toBe(false);

      setVerbose(true);
      expect(isVerbose()).toBe(true);

      setVerbose(false);
      expect(isVerbose()).toBe(false);
    });
  });

  describe("setProcessTitle", () => {
    it("should set process title for command", () => {
      setProcessTitle("dev");
      expect(process.title).toBe("mandu dev");
    });

    it("should include subcommand", () => {
      setProcessTitle("routes", "generate");
      expect(process.title).toBe("mandu routes generate");
    });
  });
});
