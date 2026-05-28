import { afterEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  hydrationToolDefinitions,
  hydrationTools,
} from "../../src/tools/hydration";

async function writeFile(root: string, relPath: string, content: string): Promise<void> {
  const filePath = path.join(root, relPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

describe("hydration MCP tools", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("declares strict input schema for hydration.set", () => {
    const def = hydrationToolDefinitions.find((tool) => tool.name === "mandu.hydration.set");
    const schema = def?.inputSchema as {
      required?: string[];
      additionalProperties?: boolean;
    } | undefined;
    expect(schema?.required).toContain("routeId");
    expect(schema?.additionalProperties).toBe(false);
  });

  it("reports wrong route key as a missing routeId parameter", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-mcp-hydration-"));
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
          },
        ],
      }, null, 2),
    );

    const handlers = hydrationTools(root);
    const result = await handlers["mandu.hydration.set"]({
      route: "login",
      strategy: "full",
    }) as { error?: string };

    expect(result.error).toContain("missing required parameter 'routeId'");
    expect(result.error).toContain("unknown key 'route'");
    expect(result.error).not.toContain("Route not found: undefined");
  });

  it("marks hydrating routes without a clientModule as broken in island list", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-mcp-island-list-"));
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

    const handlers = hydrationTools(root);
    const result = await handlers["mandu.island.list"]({}) as {
      pageClientMounts?: Array<{ routeId: string; status: string; warning: string | null }>;
      islands?: Array<{ routeId: string; status: string; warning: string | null }>;
      terminology?: { pageClientMount?: string; island?: string };
    };

    expect(result.pageClientMounts?.[0]).toMatchObject({
      routeId: "login",
      status: "broken",
    });
    expect(result.pageClientMounts?.[0]?.warning).toContain("no clientModule");
    expect(result.islands?.[0]).toMatchObject({ routeId: "login" });
    expect(result.terminology?.pageClientMount).toContain("route-level clientModule");
  });

  it("exposes page client mount list as the preferred terminology", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-mcp-page-mount-list-"));
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
            boundaries: [
              {
                id: "home--0",
                routeId: "home",
                module: "src/client/Counter.client.tsx",
                importSpecifier: "@/client/Counter.client",
                exportName: "Counter",
                localName: "Counter",
                hydrate: "visible",
                ordinal: 0,
                propsSource: "inline",
                propsKeys: ["count"],
                hasSpreadProps: false,
                source: {
                  file: "app/page.tsx",
                  line: 4,
                  column: 8,
                },
              },
            ],
          },
        ],
      }, null, 2),
    );
    await writeFile(
      root,
      ".mandu/manifest.json",
      JSON.stringify({
        version: 1,
        buildTime: "2026-05-23T00:00:00.000Z",
        env: "production",
        bundles: {},
        partials: {
          "legacy-partial": {
            js: "/.mandu/client/legacy-partial.js",
            priority: "visible",
          },
        },
        shared: {
          runtime: "/.mandu/client/_runtime.js",
          vendor: "/.mandu/client/_react.js",
        },
      }, null, 2),
    );

    const handlers = hydrationTools(root);
    const result = await handlers["mandu.pageClientMount.list"]({}) as {
      pageClientMountCount?: number;
      clientBoundaryCount?: number;
      partialBoundaryCount?: number;
      boundarySummary?: {
        clientBoundaryCount: number;
        partialBoundaryCount: number;
        pageClientMountCount: number;
      };
      pageClientMounts?: Array<{
        routeId: string;
        status: string;
        isIsland: boolean;
        hasRouteLevelClientMount: boolean;
        clientBoundaryCount: number;
      }>;
      islandCount?: number;
      terminology?: { clientBoundary?: string; partialBoundary?: string };
    };

    expect(result.pageClientMountCount).toBe(1);
    expect(result.islandCount).toBe(1);
    expect(result.clientBoundaryCount).toBe(1);
    expect(result.partialBoundaryCount).toBe(1);
    expect(result.boundarySummary).toEqual({
      clientBoundaryCount: 1,
      partialBoundaryCount: 1,
      pageClientMountCount: 1,
    });
    expect(result.pageClientMounts?.[0]).toMatchObject({
      routeId: "home",
      status: "ready",
      isIsland: true,
      hasRouteLevelClientMount: true,
      clientBoundaryCount: 1,
    });
    expect(result.terminology?.clientBoundary).toContain("RouteSpec.boundaries");
    expect(result.terminology?.partialBoundary).toContain("partials");
  });
});
