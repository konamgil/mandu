import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { specToolDefinitions, specTools } from "../../src/tools/spec.js";

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

describe("mandu.route.boundaries", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-mcp-boundaries-"));
    await writeJson(path.join(root, ".mandu", "routes.manifest.json"), {
      version: 1,
      routes: [
        {
          id: "pledges-$id",
          pattern: "/pledges/:id",
          kind: "page",
          module: "app/pledges/[id]/page.tsx",
          componentModule: "app/pledges/[id]/page.tsx",
          hydration: { strategy: "island", priority: "visible", preload: false },
          boundaries: [
            {
              id: "pledges-$id--0",
              routeId: "pledges-$id",
              module: "src/client/CommentsSection.client.tsx",
              importSpecifier: "@/client/CommentsSection.client",
              exportName: "CommentsSection",
              localName: "CommentsSection",
              hydrate: "visible",
              ordinal: 0,
              propsSource: "inline",
              propsKeys: ["pledgeId", "initialComments"],
              hasSpreadProps: false,
              source: {
                file: "app/pledges/[id]/page.tsx",
                line: 6,
                column: 18,
              },
            },
          ],
        },
        {
          id: "about",
          pattern: "/about",
          kind: "page",
          module: "app/about/page.tsx",
          componentModule: "app/about/page.tsx",
        },
      ],
    });
    await writeJson(path.join(root, ".mandu", "manifest.json"), {
      version: 1,
      buildTime: "2026-05-23T00:00:00.000Z",
      env: "production",
      bundles: {},
      boundaries: {
        "pledges-$id--0": {
          route: "pledges-$id",
          js: "/.mandu/client/pledges-$id--0.boundary.js",
          module: "src/client/CommentsSection.client.tsx",
          exportName: "CommentsSection",
          priority: "visible",
          hydrate: "visible",
        },
      },
      shared: {
        runtime: "/.mandu/client/_runtime.js",
        vendor: "/.mandu/client/_react.js",
      },
    });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns route boundary metadata with bundle manifest details", async () => {
    const tools = specTools(root);
    const result = await tools["mandu.route.boundaries"]({
      routeId: "pledges-$id",
      includeBundle: true,
    }) as {
      routeId: string | null;
      includeBundle: boolean;
      boundaryCount: number;
      routes: Array<{
        routeId: string;
        boundaryCount: number;
        boundaries: Array<{
          id: string;
          module: string;
          exportName: string;
          ordinal: number;
          propsKeys: string[];
          source: { file: string; line: number; column: number };
          bundle: { js: string; hydrate: string } | null;
        }>;
        diagnostics: unknown[];
      }>;
    };

    expect(result.routeId).toBe("pledges-$id");
    expect(result.includeBundle).toBe(true);
    expect(result.boundaryCount).toBe(1);
    expect(result.routes[0]).toMatchObject({
      routeId: "pledges-$id",
      boundaryCount: 1,
      diagnostics: [],
    });
    expect(result.routes[0]?.boundaries[0]).toMatchObject({
      id: "pledges-$id--0",
      module: "src/client/CommentsSection.client.tsx",
      exportName: "CommentsSection",
      ordinal: 0,
      propsKeys: ["pledgeId", "initialComments"],
      source: {
        file: "app/pledges/[id]/page.tsx",
        line: 6,
        column: 18,
      },
      bundle: {
        js: "/.mandu/client/pledges-$id--0.boundary.js",
        hydrate: "visible",
      },
    });
  });

  it("lists all routes without requiring a bundle manifest by default", async () => {
    await fs.rm(path.join(root, ".mandu", "manifest.json"), { force: true });

    const tools = specTools(root);
    const result = await tools["mandu.route.boundaries"]({}) as {
      routeCount: number;
      boundaryCount: number;
      includeBundle: boolean;
      source: { bundleManifest: string | null };
      routes: Array<{ routeId: string; boundaryCount: number; diagnostics: Array<{ code: string }> }>;
    };

    expect(result.routeCount).toBe(2);
    expect(result.boundaryCount).toBe(1);
    expect(result.includeBundle).toBe(false);
    expect(result.source.bundleManifest).toBeNull();
    expect(result.routes.find((route) => route.routeId === "pledges-$id")?.diagnostics).toEqual([]);
    expect(result.routes.find((route) => route.routeId === "about")?.boundaryCount).toBe(0);
  });

  it("reports missing bundle manifest entries when bundle correlation is requested", async () => {
    await fs.rm(path.join(root, ".mandu", "manifest.json"), { force: true });

    const tools = specTools(root);
    const result = await tools["mandu.route.boundaries"]({ includeBundle: true }) as {
      includeBundle: boolean;
      source: { bundleManifest: string | null };
      routes: Array<{ routeId: string; diagnostics: Array<{ code: string }> }>;
    };

    expect(result.includeBundle).toBe(true);
    expect(result.source.bundleManifest).toBeNull();
    expect(result.routes.find((route) => route.routeId === "pledges-$id")?.diagnostics).toEqual([
      expect.objectContaining({ code: "MANDU_BOUNDARY_BUNDLE_MANIFEST_MISSING" }),
    ]);
  });

  it("returns a route-not-found error for unknown route IDs", async () => {
    const tools = specTools(root);
    const result = await tools["mandu.route.boundaries"]({
      routeId: "missing",
    }) as { error: string };

    expect(result.error).toBe("Route not found: missing");
  });

  it("declares the tool as read-only", () => {
    const definition = specToolDefinitions.find((tool) => tool.name === "mandu.route.boundaries");
    expect(definition?.annotations?.readOnlyHint).toBe(true);
  });
});
