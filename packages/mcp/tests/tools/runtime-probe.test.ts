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
});
