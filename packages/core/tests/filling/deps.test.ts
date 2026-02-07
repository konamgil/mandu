/**
 * DNA-002: Dependency Injection Pattern Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createDefaultDeps,
  createMockDeps,
  mergeDeps,
  globalDeps,
  type FillingDeps,
} from "../../src/filling/deps";
import { ManduContext } from "../../src/filling/context";
import { ManduFilling } from "../../src/filling/filling";

describe("DNA-002: Dependency Injection", () => {
  beforeEach(() => {
    globalDeps.reset();
  });

  describe("createDefaultDeps", () => {
    it("should create deps with fetch", () => {
      const deps = createDefaultDeps();
      expect(deps.fetch).toBe(globalThis.fetch);
    });

    it("should create deps with logger", () => {
      const deps = createDefaultDeps();
      expect(deps.logger).toBeDefined();
      expect(deps.logger?.debug).toBeDefined();
      expect(deps.logger?.info).toBeDefined();
      expect(deps.logger?.warn).toBeDefined();
      expect(deps.logger?.error).toBeDefined();
    });

    it("should create deps with now()", () => {
      const deps = createDefaultDeps();
      const now = deps.now?.();
      expect(now).toBeInstanceOf(Date);
    });

    it("should create deps with uuid()", () => {
      const deps = createDefaultDeps();
      const uuid = deps.uuid?.();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe("createMockDeps", () => {
    it("should create mock deps with defaults", () => {
      const deps = createMockDeps();

      expect(deps.db).toBeDefined();
      expect(deps.cache).toBeDefined();
      expect(deps.logger).toBeDefined();
      expect(deps.now?.()).toEqual(new Date("2025-01-01T00:00:00Z"));
      expect(deps.uuid?.()).toBe("00000000-0000-0000-0000-000000000000");
    });

    it("should allow overriding specific deps", () => {
      const mockQuery = vi.fn().mockResolvedValue([{ id: 1 }]);
      const deps = createMockDeps({
        db: {
          query: mockQuery,
          transaction: async (fn) => fn(),
        },
      });

      expect(deps.db?.query).toBe(mockQuery);
    });

    it("should allow custom now() for time-sensitive tests", () => {
      const fixedDate = new Date("2026-06-15T12:00:00Z");
      const deps = createMockDeps({
        now: () => fixedDate,
      });

      expect(deps.now?.()).toBe(fixedDate);
    });
  });

  describe("mergeDeps", () => {
    it("should merge base and override deps", () => {
      const base = createDefaultDeps();
      const fixedDate = new Date("2025-05-01");

      const merged = mergeDeps(base, {
        now: () => fixedDate,
      });

      expect(merged.fetch).toBe(globalThis.fetch); // base preserved
      expect(merged.now?.()).toBe(fixedDate); // override applied
    });
  });

  describe("globalDeps", () => {
    it("should start with default deps", () => {
      const deps = globalDeps.get();
      expect(deps.fetch).toBe(globalThis.fetch);
    });

    it("should allow setting custom deps", () => {
      const customLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      globalDeps.set({ logger: customLogger });

      expect(globalDeps.get().logger).toBe(customLogger);
    });

    it("should reset to defaults", () => {
      globalDeps.set({ now: () => new Date("2020-01-01") });
      globalDeps.reset();

      const now = globalDeps.get().now?.();
      expect(now?.getFullYear()).toBeGreaterThan(2020);
    });
  });

  describe("ManduContext with deps", () => {
    it("should use globalDeps by default", () => {
      const request = new Request("http://localhost/test");
      const ctx = new ManduContext(request);

      expect(ctx.deps.fetch).toBe(globalThis.fetch);
    });

    it("should accept custom deps", () => {
      const request = new Request("http://localhost/test");
      const customDeps = createMockDeps({
        now: () => new Date("2025-12-25"),
      });

      const ctx = new ManduContext(request, {}, customDeps);

      expect(ctx.deps.now?.()).toEqual(new Date("2025-12-25"));
    });

    it("should allow accessing db from context", async () => {
      const mockQuery = vi.fn().mockResolvedValue([{ id: 1, name: "Test" }]);
      const deps = createMockDeps({
        db: {
          query: mockQuery,
          transaction: async (fn) => fn(),
        },
      });

      const request = new Request("http://localhost/users");
      const ctx = new ManduContext(request, {}, deps);

      const users = await ctx.deps.db?.query("SELECT * FROM users");
      expect(users).toEqual([{ id: 1, name: "Test" }]);
      expect(mockQuery).toHaveBeenCalledWith("SELECT * FROM users");
    });
  });

  describe("ManduFilling with deps", () => {
    it("should pass deps to handler context", async () => {
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      const filling = new ManduFilling()
        .get(async (ctx) => {
          ctx.deps.logger?.info("Handler executed");
          return ctx.ok({ success: true });
        });

      const request = new Request("http://localhost/test");
      await filling.handle(request, {}, undefined, {
        deps: createMockDeps({ logger: mockLogger }),
      });

      expect(mockLogger.info).toHaveBeenCalledWith("Handler executed");
    });

    it("should allow mocking time in tests", async () => {
      const fixedTime = new Date("2025-01-01T00:00:00Z");

      const filling = new ManduFilling()
        .get(async (ctx) => {
          const timestamp = ctx.deps.now?.() ?? new Date();
          return ctx.ok({ timestamp: timestamp.toISOString() });
        });

      const request = new Request("http://localhost/test");
      const response = await filling.handle(request, {}, undefined, {
        deps: createMockDeps({ now: () => fixedTime }),
      });

      const data = await response.json();
      expect(data.timestamp).toBe("2025-01-01T00:00:00.000Z");
    });
  });
});
