/**
 * DNA-001: Plugin Registry Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  PluginRegistry,
  definePlugin,
  type Plugin,
  type GuardPresetPlugin,
} from "../../src/plugins";

describe("DNA-001: Plugin Registry", () => {
  let registry: PluginRegistry;

  beforeEach(async () => {
    registry = new PluginRegistry();
  });

  describe("definePlugin", () => {
    it("should create a valid plugin definition", () => {
      const plugin = definePlugin({
        meta: {
          id: "test-plugin",
          name: "Test Plugin",
          version: "1.0.0",
          category: "custom",
        },
        register: vi.fn(),
      });

      expect(plugin.meta.id).toBe("test-plugin");
      expect(plugin.meta.version).toBe("1.0.0");
    });
  });

  describe("register", () => {
    it("should register a plugin successfully", async () => {
      const registerFn = vi.fn();
      const plugin = definePlugin({
        meta: {
          id: "my-plugin",
          name: "My Plugin",
          version: "1.0.0",
          category: "custom",
        },
        register: registerFn,
      });

      await registry.register(plugin);

      expect(registerFn).toHaveBeenCalled();
      expect(registry.get("my-plugin")?.state).toBe("loaded");
    });

    it("should reject duplicate registration", async () => {
      const plugin = definePlugin({
        meta: {
          id: "duplicate",
          name: "Duplicate",
          version: "1.0.0",
          category: "custom",
        },
        register: vi.fn(),
      });

      await registry.register(plugin);
      await expect(registry.register(plugin)).rejects.toThrow(
        'Plugin "duplicate" is already registered'
      );
    });

    it("should validate config with schema", async () => {
      const createPlugin = () =>
        definePlugin({
          meta: {
            id: "with-config-" + Math.random().toString(36).slice(2),
            name: "With Config",
            version: "1.0.0",
            category: "custom",
          },
          configSchema: z.object({
            apiKey: z.string().min(1),
            timeout: z.number().default(5000),
          }),
          register: vi.fn(),
        });

      // Invalid config should throw
      const badPlugin = createPlugin();
      await expect(
        registry.register(badPlugin, { apiKey: "", timeout: 1000 })
      ).rejects.toThrow("Invalid config");

      // Valid config should succeed
      const goodPlugin = createPlugin();
      await registry.register(goodPlugin, { apiKey: "secret", timeout: 3000 });
      expect(registry.get(goodPlugin.meta.id)?.state).toBe("loaded");
    });

    it("should apply schema defaults when config is undefined", async () => {
      let captured: { timeout: number } | undefined;

      const plugin = definePlugin({
        meta: {
          id: "defaults-plugin",
          name: "Defaults Plugin",
          version: "1.0.0",
          category: "custom",
        },
        configSchema: z
          .object({
            timeout: z.number().default(5000),
          })
          .default({}),
        register: (_api, config) => {
          captured = config;
        },
      });

      await registry.register(plugin);
      expect(captured?.timeout).toBe(5000);
    });

    it("should throw when required config is missing", async () => {
      const plugin = definePlugin({
        meta: {
          id: "requires-config",
          name: "Requires Config",
          version: "1.0.0",
          category: "custom",
        },
        configSchema: z.object({
          apiKey: z.string().min(1),
        }),
        register: vi.fn(),
      });

      await expect(registry.register(plugin)).rejects.toThrow("Invalid config");
    });

    it("should call onLoad hook", async () => {
      const onLoad = vi.fn();
      const plugin = definePlugin({
        meta: {
          id: "with-hook",
          name: "With Hook",
          version: "1.0.0",
          category: "custom",
        },
        register: vi.fn(),
        onLoad,
      });

      await registry.register(plugin);
      expect(onLoad).toHaveBeenCalled();
    });
  });

  describe("unregister", () => {
    it("should unregister a plugin", async () => {
      const onUnload = vi.fn();
      const plugin = definePlugin({
        meta: {
          id: "removable",
          name: "Removable",
          version: "1.0.0",
          category: "custom",
        },
        register: vi.fn(),
        onUnload,
      });

      await registry.register(plugin);
      await registry.unregister("removable");

      expect(onUnload).toHaveBeenCalled();
      expect(registry.get("removable")).toBeUndefined();
    });

    it("should remove registered resources on unregister", async () => {
      const plugin = definePlugin({
        meta: {
          id: "resource-owner",
          name: "Resource Owner",
          version: "1.0.0",
          category: "custom",
        },
        register: (api) => {
          api.registerGuardPreset({
            id: "cleanup-fsd",
            name: "Cleanup Preset",
            getRules: () => [],
          });
          api.registerBuildPlugin({
            id: "cleanup-build",
            name: "Cleanup Build",
          });
        },
      });

      await registry.register(plugin);
      expect(registry.getGuardPreset("cleanup-fsd")).toBeDefined();
      expect(registry.getBuildPlugin("cleanup-build")).toBeDefined();

      await registry.unregister("resource-owner");
      expect(registry.getGuardPreset("cleanup-fsd")).toBeUndefined();
      expect(registry.getBuildPlugin("cleanup-build")).toBeUndefined();
    });

    it("should throw for non-existent plugin", async () => {
      await expect(registry.unregister("non-existent")).rejects.toThrow(
        'Plugin "non-existent" is not registered'
      );
    });
  });

  describe("Guard Preset", () => {
    it("should register guard preset via plugin API", async () => {
      const preset: GuardPresetPlugin = {
        id: "fsd",
        name: "Feature-Sliced Design",
        description: "FSD architecture preset",
        getRules: () => [
          {
            id: "no-cross-slice",
            name: "No Cross-Slice Import",
            severity: "error",
            check: () => [],
          },
        ],
        getLayers: () => [
          { name: "app", pattern: "app/**", allowedDependencies: [] },
          {
            name: "features",
            pattern: "features/**",
            allowedDependencies: ["shared"],
          },
        ],
      };

      const plugin = definePlugin({
        meta: {
          id: "guard-preset-fsd",
          name: "FSD Guard Preset",
          version: "1.0.0",
          category: "guard-preset",
        },
        register: (api) => {
          api.registerGuardPreset(preset);
        },
      });

      await registry.register(plugin);

      const registeredPreset = registry.getGuardPreset("fsd");
      expect(registeredPreset).toBeDefined();
      expect(registeredPreset?.name).toBe("Feature-Sliced Design");
      expect(registeredPreset?.getRules()).toHaveLength(1);
      expect(registeredPreset?.getLayers?.()).toHaveLength(2);
    });
  });

  describe("Build Plugin", () => {
    it("should register build plugin", async () => {
      const onBuildStart = vi.fn();
      const plugin = definePlugin({
        meta: {
          id: "build-analyzer",
          name: "Build Analyzer",
          version: "1.0.0",
          category: "build",
        },
        register: (api) => {
          api.registerBuildPlugin({
            id: "analyzer",
            name: "Bundle Analyzer",
            onBuildStart,
            onBuildEnd: vi.fn(),
          });
        },
      });

      await registry.register(plugin);

      const buildPlugin = registry.getBuildPlugin("analyzer");
      expect(buildPlugin).toBeDefined();
      expect(buildPlugin?.name).toBe("Bundle Analyzer");
    });
  });

  describe("Logger Transport", () => {
    it("should register logger transport", async () => {
      const sendFn = vi.fn();
      const plugin = definePlugin({
        meta: {
          id: "logger-file",
          name: "File Logger",
          version: "1.0.0",
          category: "logger",
        },
        register: (api) => {
          api.registerLoggerTransport({
            id: "file",
            name: "File Transport",
            send: sendFn,
          });
        },
      });

      await registry.register(plugin);

      const transport = registry.getLoggerTransport("file");
      expect(transport).toBeDefined();
      expect(transport?.name).toBe("File Transport");
    });
  });

  describe("MCP Tool", () => {
    it("should register MCP tool", async () => {
      const execute = vi.fn().mockResolvedValue({ result: "success" });
      const plugin = definePlugin({
        meta: {
          id: "mcp-custom",
          name: "Custom MCP Tool",
          version: "1.0.0",
          category: "mcp-tool",
        },
        register: (api) => {
          api.registerMcpTool({
            name: "custom_tool",
            description: "A custom tool",
            inputSchema: { type: "object", properties: {} },
            execute,
          });
        },
      });

      await registry.register(plugin);

      const tool = registry.getMcpTool("custom_tool");
      expect(tool).toBeDefined();
      expect(tool?.description).toBe("A custom tool");
    });
  });

  describe("Middleware", () => {
    it("should register and sort middlewares by order", async () => {
      const plugin = definePlugin({
        meta: {
          id: "middlewares",
          name: "Middlewares",
          version: "1.0.0",
          category: "middleware",
        },
        register: (api) => {
          api.registerMiddleware({
            id: "auth",
            name: "Auth",
            order: 10,
            handler: async (req, next) => next(),
          });
          api.registerMiddleware({
            id: "logging",
            name: "Logging",
            order: 5,
            handler: async (req, next) => next(),
          });
          api.registerMiddleware({
            id: "cors",
            name: "CORS",
            order: 1,
            handler: async (req, next) => next(),
          });
        },
      });

      await registry.register(plugin);

      const middlewares = registry.getAllMiddlewares();
      expect(middlewares).toHaveLength(3);
      expect(middlewares[0].id).toBe("cors"); // order: 1
      expect(middlewares[1].id).toBe("logging"); // order: 5
      expect(middlewares[2].id).toBe("auth"); // order: 10
    });
  });

  describe("Server Lifecycle", () => {
    it("should call onServerStart for all plugins", async () => {
      const onServerStart1 = vi.fn();
      const onServerStart2 = vi.fn();

      await registry.register(
        definePlugin({
          meta: { id: "p1", name: "P1", version: "1.0.0", category: "custom" },
          register: vi.fn(),
          onServerStart: onServerStart1,
        })
      );

      await registry.register(
        definePlugin({
          meta: { id: "p2", name: "P2", version: "1.0.0", category: "custom" },
          register: vi.fn(),
          onServerStart: onServerStart2,
        })
      );

      await registry.onServerStart();

      expect(onServerStart1).toHaveBeenCalled();
      expect(onServerStart2).toHaveBeenCalled();
    });

    it("should call onServerStop for all plugins", async () => {
      const onServerStop = vi.fn();

      await registry.register(
        definePlugin({
          meta: { id: "p1", name: "P1", version: "1.0.0", category: "custom" },
          register: vi.fn(),
          onServerStop,
        })
      );

      await registry.onServerStop();
      expect(onServerStop).toHaveBeenCalled();
    });
  });
});
