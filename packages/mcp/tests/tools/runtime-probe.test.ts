import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { runtimeToolDefinitions, runtimeTools } from "../../src/tools/runtime";

async function writeFile(root: string, relPath: string, content: string): Promise<void> {
  const filePath = path.join(root, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

describe("mandu.runtime.probe", () => {
  const tempDirs: string[] = [];
  const originalFetch = globalThis.fetch;
  let fetchCalls: string[] = [];
  let fetchMap: Map<string, Response>;

  beforeEach(() => {
    fetchCalls = [];
    fetchMap = new Map();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchCalls.push(url);
      const parsed = new URL(url);
      const key = `${parsed.pathname}${parsed.search}`;
      const response = fetchMap.get(key) ?? fetchMap.get(parsed.pathname);
      if (!response) {
        return new Response("not found", { status: 404 });
      }
      return response.clone();
    }) as typeof fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("is registered as a read-only runtime tool", () => {
    const def = runtimeToolDefinitions.find((tool) => tool.name === "mandu.runtime.probe");
    expect(def?.annotations?.readOnlyHint).toBe(true);
    const schema = def?.inputSchema as { properties?: Record<string, unknown> } | undefined;
    expect(schema?.properties).toHaveProperty("baseURL");
    expect(schema?.properties).toHaveProperty("checkBundleUrls");

    const statusDef = runtimeToolDefinitions.find((tool) => tool.name === "mandu.runtime.status");
    expect(statusDef?.annotations?.readOnlyHint).toBe(true);
  });

  it("fails when an island marker has an empty data-mandu-src", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-runtime-probe-"));
    tempDirs.push(root);
    await writeFile(
      root,
      ".mandu/routes.manifest.json",
      JSON.stringify({
        version: 1,
        routes: [
          {
            id: "login",
            kind: "page",
            pattern: "/login",
            module: "app/login/page.tsx",
            componentModule: "app/login/page.tsx",
            clientModule: "app/login.client.tsx",
            hydration: {
              strategy: "island",
              priority: "immediate",
              preload: false,
            },
          },
        ],
      }, null, 2),
    );
    fetchMap.set(
      "/login",
      new Response('<div data-mandu-island="login" data-mandu-src=""></div>', {
        status: 200,
      }),
    );

    const handlers = runtimeTools(root);
    const result = await handlers["mandu.runtime.probe"]({
      baseURL: "http://localhost:3333",
    }) as { success: boolean; failures: Array<{ code: string; routeId: string }> };

    expect(result.success).toBe(false);
    expect(result.failures).toContainEqual(
      expect.objectContaining({ code: "empty_island_src", routeId: "login" }),
    );
  });

  it("passes when page and island bundle respond successfully", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-runtime-probe-ok-"));
    tempDirs.push(root);
    await writeFile(
      root,
      ".mandu/routes.manifest.json",
      JSON.stringify({
        version: 1,
        routes: [
          {
            id: "home",
            kind: "page",
            pattern: "/",
            module: "app/page.tsx",
            componentModule: "app/page.tsx",
            clientModule: "app/home.client.tsx",
            hydration: {
              strategy: "island",
              priority: "visible",
              preload: false,
            },
          },
        ],
      }, null, 2),
    );
    fetchMap.set(
      "/",
      new Response('<div data-mandu-island="home" data-mandu-src="/.mandu/client/home.island.js?t=1"></div>', {
        status: 200,
      }),
    );
    fetchMap.set("/.mandu/client/home.island.js?t=1", new Response("export default {}", { status: 200 }));

    const handlers = runtimeTools(root);
    const result = await handlers["mandu.runtime.probe"]({
      baseURL: "http://localhost:3333",
    }) as { success: boolean; failureCount: number };

    expect(result.success).toBe(true);
    expect(result.failureCount).toBe(0);
    expect(fetchCalls).toContain("http://localhost:3333/.mandu/client/home.island.js?t=1");
  });

  it("skips dynamic routes by default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-runtime-probe-dynamic-"));
    tempDirs.push(root);
    await writeFile(
      root,
      ".mandu/routes.manifest.json",
      JSON.stringify({
        version: 1,
        routes: [
          {
            id: "pledges-$id",
            kind: "page",
            pattern: "/pledges/:id",
            module: "app/pledges/[id]/page.tsx",
            componentModule: "app/pledges/[id]/page.tsx",
          },
        ],
      }, null, 2),
    );

    const handlers = runtimeTools(root);
    const result = await handlers["mandu.runtime.probe"]({
      baseURL: "http://localhost:3333",
    }) as { checkedRoutes: number; skippedRoutes: number };

    expect(result.checkedRoutes).toBe(0);
    expect(result.skippedRoutes).toBe(1);
  });

  it("reports one runtime status across routes, bundles, generated routes, and terminology", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-runtime-status-broken-"));
    tempDirs.push(root);
    await writeFile(
      root,
      ".mandu/routes.manifest.json",
      JSON.stringify({
        version: 1,
        routes: [
          {
            id: "login",
            kind: "page",
            pattern: "/login",
            module: "app/login/page.tsx",
            componentModule: "app/login/page.tsx",
            hydration: {
              strategy: "full",
              priority: "immediate",
              preload: false,
            },
          },
        ],
      }, null, 2),
    );
    await writeFile(
      root,
      ".mandu/generated/web/routes/login.route.tsx",
      `import React from "react";
export default function LoginPage() {
  return React.createElement("div", null,
    React.createElement("h1", null, "Login Page"),
    React.createElement("p", null, "Route ID: login")
  );
}
`,
    );

    const handlers = runtimeTools(root);
    const result = await handlers["mandu.runtime.status"]({}) as {
      success: boolean;
      summary: { pageClientMountCount: number; brokenPageClientMountCount: number };
      pageClientMounts: Array<{ routeId: string; status: string; reasons: string[] }>;
      consistencyChecks: Array<{ check: string; status: string; failingRoutes?: string[] }>;
      terminology: { pageClientMount: string; island: string };
    };

    expect(result.success).toBe(false);
    expect(result.summary.pageClientMountCount).toBe(1);
    expect(result.summary.brokenPageClientMountCount).toBe(1);
    expect(result.pageClientMounts[0]).toMatchObject({
      routeId: "login",
      status: "broken",
    });
    expect(result.pageClientMounts[0].reasons).toContain("missing_client_module");
    expect(result.pageClientMounts[0].reasons).toContain("generated_placeholder_for_hydrating_route");
    expect(result.consistencyChecks).toContainEqual(
      expect.objectContaining({
        check: "hydrating-routes-have-client-module",
        status: "fail",
        failingRoutes: ["login"],
      }),
    );
    expect(result.terminology.pageClientMount).toContain("whole page");
    expect(result.terminology.island).toContain("nested");
  });

  it("reports healthy page client mounts separately from nested islands", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-runtime-status-healthy-"));
    tempDirs.push(root);
    await writeFile(
      root,
      ".mandu/routes.manifest.json",
      JSON.stringify({
        version: 1,
        routes: [
          {
            id: "home",
            kind: "page",
            pattern: "/",
            module: "app/page.tsx",
            componentModule: "app/page.tsx",
            clientModule: "app/page.client.tsx",
            hydration: {
              strategy: "island",
              priority: "visible",
              preload: false,
            },
          },
        ],
      }, null, 2),
    );
    await writeFile(
      root,
      ".mandu/manifest.json",
      JSON.stringify({
        version: 1,
        buildTime: new Date().toISOString(),
        env: "development",
        bundles: {
          home: {
            js: "/.mandu/client/home.island.js",
            dependencies: [],
            priority: "visible",
          },
        },
        islands: {
          counter: {
            js: "/.mandu/client/counter.island.js",
            route: "home",
            priority: "idle",
          },
        },
        shared: {
          runtime: "/.mandu/client/_runtime.js",
          vendor: "/.mandu/client/_vendor.js",
        },
      }, null, 2),
    );
    await writeFile(
      root,
      ".mandu/generated/web/routes/home.route.tsx",
      `// Client Module: app/page.client.tsx
import islandModule from "../../../../app/page.client";
export default function HomePage() {
  return islandModule.definition.render(islandModule.definition.setup({}));
}
`,
    );

    const handlers = runtimeTools(root);
    const result = await handlers["mandu.runtime.status"]({}) as {
      success: boolean;
      summary: { pageClientMountCount: number; nestedIslandCount: number };
      pageClientMounts: Array<{ routeId: string; status: string; bundleUrl: string | null }>;
      islands: Array<{ islandId: string; routeId: string }>;
    };

    expect(result.success).toBe(true);
    expect(result.summary.pageClientMountCount).toBe(1);
    expect(result.summary.nestedIslandCount).toBe(1);
    expect(result.pageClientMounts[0]).toMatchObject({
      routeId: "home",
      status: "healthy",
      bundleUrl: "/.mandu/client/home.island.js",
    });
    expect(result.islands[0]).toMatchObject({
      islandId: "counter",
      routeId: "home",
    });
  });
});
