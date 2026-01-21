import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { validateManifest } from "../packages/core/src/spec/load";
import { generateRoutes } from "../packages/core/src/generator/generate";
import {
  startServer,
  registerApiHandler,
  registerPageLoader,
  clearRegistry,
} from "../packages/core/src/runtime/server";
import type { ManduServer } from "../packages/core/src/runtime/server";
import type { RoutesManifest } from "../packages/core/src/spec/schema";
import path from "path";
import fs from "fs/promises";
import os from "os";

const TEST_PORT = 4567;
const ROOT_DIR = path.resolve(import.meta.dir, "..");

// Test manifest
const testManifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "home",
      pattern: "/",
      kind: "page",
      module: "apps/server/generated/routes/home.route.ts",
      componentModule: "apps/web/generated/routes/home.route.tsx",
    },
    {
      id: "health",
      pattern: "/api/health",
      kind: "api",
      module: "apps/server/generated/routes/health.route.ts",
    },
  ],
};

describe("Mandu Framework Tests", () => {
  let tempDir: string;
  let server: ManduServer | null = null;

  beforeAll(async () => {
    // Create temp directory for test project
    tempDir = path.join(os.tmpdir(), `mandu-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    // Symlink node_modules from main project so imports work
    const srcNodeModules = path.join(ROOT_DIR, "node_modules");
    const destNodeModules = path.join(tempDir, "node_modules");
    try {
      await fs.symlink(srcNodeModules, destNodeModules, "junction");
    } catch (error) {
      // On some systems, copy might be needed instead of symlink
      console.log("Symlink failed, tests may fail for page routes");
    }

    // Write test manifest
    const specDir = path.join(tempDir, "spec");
    await fs.mkdir(specDir, { recursive: true });
    await fs.writeFile(
      path.join(specDir, "routes.manifest.json"),
      JSON.stringify(testManifest, null, 2)
    );

    // Generate routes
    await generateRoutes(testManifest, tempDir);

    // Clear any previous registrations
    clearRegistry();

    // Register handlers from generated files
    for (const route of testManifest.routes) {
      if (route.kind === "api") {
        const modulePath = path.join(tempDir, route.module);
        try {
          const module = await import(modulePath);
          registerApiHandler(route.id, module.default || module.handler);
        } catch (error) {
          console.error(`Failed to load API handler: ${route.id}`, error);
        }
      } else if (route.kind === "page" && route.componentModule) {
        const componentPath = path.join(tempDir, route.componentModule);
        registerPageLoader(route.id, () => import(componentPath));
      }
    }

    // Start server
    server = startServer(testManifest, { port: TEST_PORT, hostname: "127.0.0.1" });
  });

  afterAll(async () => {
    if (server) {
      server.stop();
    }
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("GET / should return SSR HTML with 200", async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/`);

    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<div id="root">');
    expect(html).toContain("Home");
  });

  it("GET /api/health should return JSON with 200", async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const json = await response.json();
    expect(json).toHaveProperty("status", "ok");
    expect(json).toHaveProperty("routeId", "health");
  });

  it("GET /unknown should return 404", async () => {
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/unknown`);

    expect(response.status).toBe(404);
  });
});

describe("Spec Validation", () => {
  it("should validate correct manifest", () => {
    const result = validateManifest(testManifest);

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data?.version).toBe(1);
    expect(result.data?.routes).toHaveLength(2);
  });

  it("should reject manifest with duplicate route ids", () => {
    const invalidManifest = {
      version: 1,
      routes: [
        { id: "home", pattern: "/", kind: "page", module: "a.ts", componentModule: "a.tsx" },
        { id: "home", pattern: "/about", kind: "page", module: "b.ts", componentModule: "b.tsx" },
      ],
    };

    const result = validateManifest(invalidManifest);
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });

  it("should reject page route without componentModule", () => {
    const invalidManifest = {
      version: 1,
      routes: [{ id: "home", pattern: "/", kind: "page", module: "a.ts" }],
    };

    const result = validateManifest(invalidManifest);
    expect(result.success).toBe(false);
  });

  it("should reject pattern not starting with /", () => {
    const invalidManifest = {
      version: 1,
      routes: [{ id: "home", pattern: "home", kind: "api", module: "a.ts" }],
    };

    const result = validateManifest(invalidManifest);
    expect(result.success).toBe(false);
  });
});
