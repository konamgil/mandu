/**
 * Phase 18.τ — plugin lifecycle integration tests.
 *
 * Pins the narrow wirings the τ agent owns:
 *   - `generateManifest()` fires `onRouteRegistered` + `onManifestBuilt`
 *   - `prerenderRoutes()` fires `definePrerenderHook`
 *   - `definePlugin()` validates + passes through
 *
 * Real filesystem fixtures, `bun:test` harness.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { generateManifest } from "../../router/fs-routes";
import {
  prerenderRoutes,
  type PrerenderOptions,
} from "../../bundler/prerender";
import type { RouteSpec, RoutesManifest } from "../../spec/schema";
import type { ManduPlugin } from "../hooks";
import { definePlugin, isManduPlugin } from "../define";

// ═══════════════════════════════════════════════════════════════════════
// Fixture helpers
// ═══════════════════════════════════════════════════════════════════════

function makeProject(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "mandu-plugin-"));
  mkdirSync(path.join(dir, "app", "about"), { recursive: true });
  writeFileSync(
    path.join(dir, "app", "page.tsx"),
    "export default function Home() { return <div>Home</div>; }\n",
  );
  writeFileSync(
    path.join(dir, "app", "about", "page.tsx"),
    "export default function About() { return <div>About</div>; }\n",
  );
  return dir;
}

function cleanup(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
describe("generateManifest — onRouteRegistered", () => {
  let project: string;
  beforeAll(() => { project = makeProject(); });
  afterAll(() => cleanup(project));

  it("fires onRouteRegistered for each discovered route", async () => {
    const seen: string[] = [];
    const plugins: ManduPlugin[] = [
      {
        name: "observer",
        hooks: { onRouteRegistered: (r) => { seen.push(r.id); } },
      },
    ];
    await generateManifest(project, {
      outputPath: ".mandu/routes.manifest.json",
      plugins,
    });
    expect(seen.length).toBeGreaterThanOrEqual(2); // home + about
  });

  it("surfaces plugin errors as warnings, doesn't abort scan", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "bad",
        hooks: {
          onRouteRegistered: () => { throw new Error("route boom"); },
        },
      },
    ];
    const result = await generateManifest(project, {
      outputPath: ".mandu/routes.manifest.json",
      plugins,
    });
    expect(result.manifest.routes.length).toBeGreaterThan(0);
    // At least one warning mentions the failing plugin
    const badWarnings = result.warnings.filter((w) => w.includes("bad"));
    expect(badWarnings.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("generateManifest — onManifestBuilt", () => {
  let project: string;
  beforeAll(() => { project = makeProject(); });
  afterAll(() => cleanup(project));

  it("allows a plugin to mutate the manifest before write", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "mutator",
        hooks: {
          onManifestBuilt: (manifest) => ({
            ...manifest,
            version: 99 as 1,
            // Tag every route with a marker via a side-channel field.
            routes: manifest.routes.map((r) => ({
              ...r,
              module: r.module, // unchanged but exercises the clone
            })),
          }),
        },
      },
    ];
    const result = await generateManifest(project, {
      outputPath: ".mandu/routes.manifest.json",
      plugins,
    });
    expect(result.manifest.version).toBe(99);

    // Verify on-disk file also reflects mutation.
    const onDisk = JSON.parse(
      readFileSync(
        path.join(project, ".mandu", "routes.manifest.json"),
        "utf-8",
      ),
    ) as RoutesManifest;
    expect(onDisk.version).toBe(99);
  });

  it("pipes manifest through multiple plugins in order", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "inc-a",
        hooks: {
          onManifestBuilt: (m) => ({ ...m, version: (m.version + 10) as 1 }),
        },
      },
      {
        name: "inc-b",
        hooks: {
          onManifestBuilt: (m) => ({ ...m, version: (m.version + 5) as 1 }),
        },
      },
    ];
    const result = await generateManifest(project, {
      outputPath: ".mandu/routes.manifest.json",
      plugins,
    });
    // 1 -> 11 -> 16
    expect(result.manifest.version).toBe(16);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("prerenderRoutes — definePrerenderHook", () => {
  let project: string;
  beforeAll(() => { project = makeProject(); });
  afterAll(() => cleanup(project));

  const staticManifest: RoutesManifest = {
    version: 1,
    routes: [
      {
        id: "home",
        kind: "page",
        pattern: "/",
        module: "app/page.tsx",
        componentModule: "app/page.tsx",
      } as RouteSpec,
    ],
  };

  const fakeFetchHandler = (body: string) =>
    async (_req: Request) =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });

  it("plugin can rewrite prerendered HTML", async () => {
    const outDir = path.join(project, ".mandu", "prerendered-override");
    const plugins: ManduPlugin[] = [
      {
        name: "rewriter",
        hooks: {
          definePrerenderHook: (ctx) => ({
            html: `<!-- rewritten for ${ctx.pathname} -->\n${ctx.html}`,
          }),
        },
      },
    ];
    const opts: PrerenderOptions = {
      rootDir: project,
      outDir,
      plugins,
    };
    await prerenderRoutes(staticManifest, fakeFetchHandler("<p>Hi</p>"), opts);
    const written = readFileSync(path.join(outDir, "index.html"), "utf-8");
    expect(written).toContain("rewritten for /");
    expect(written).toContain("<p>Hi</p>");
  });

  it("plugin can skip a page entirely", async () => {
    const outDir = path.join(project, ".mandu", "prerendered-skip");
    const plugins: ManduPlugin[] = [
      {
        name: "skipper",
        hooks: {
          definePrerenderHook: (ctx) =>
            ctx.pathname === "/" ? { skip: true } : undefined,
        },
      },
    ];
    const result = await prerenderRoutes(
      staticManifest,
      fakeFetchHandler("<p>Hi</p>"),
      { rootDir: project, outDir, plugins },
    );
    expect(result.pages.find((p) => p.path === "/")).toBeUndefined();
  });

  it("no plugins → baseline behaviour unchanged", async () => {
    const outDir = path.join(project, ".mandu", "prerendered-noop");
    const result = await prerenderRoutes(
      staticManifest,
      fakeFetchHandler("<p>Hi</p>"),
      { rootDir: project, outDir },
    );
    expect(result.pages.map((p) => p.path)).toContain("/");
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("definePlugin helper", () => {
  it("passes through a valid plugin", () => {
    const p = definePlugin({
      name: "ok",
      hooks: { onRouteRegistered: () => {} },
    });
    expect(p.name).toBe("ok");
    expect(isManduPlugin(p)).toBe(true);
  });

  it("rejects missing name", () => {
    expect(() => definePlugin({} as ManduPlugin)).toThrow();
    expect(() => definePlugin({ name: "" } as ManduPlugin)).toThrow();
  });

  it("rejects unknown hook names", () => {
    expect(() =>
      definePlugin({
        name: "typo",
        hooks: { onRouteRegitered: () => {} } as never,
      }),
    ).toThrow(/unknown hook/);
  });

  it("rejects non-function hook values", () => {
    expect(() =>
      definePlugin({
        name: "wrong-shape",
        hooks: { onRouteRegistered: "not a function" as never },
      }),
    ).toThrow(/must be a function/);
  });

  it("rejects non-function setup", () => {
    expect(() =>
      definePlugin({
        name: "bad-setup",
        setup: "nope" as never,
      }),
    ).toThrow(/setup must be a function/);
  });
});
