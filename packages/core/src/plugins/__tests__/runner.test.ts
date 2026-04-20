/**
 * Phase 18.τ — canonical plugin runner tests.
 *
 * Covers every hook type and merge-semantics edge case the runner owns.
 * Real `ManduPlugin` objects, no mocks; the runner is pure so we can
 * assert outputs directly.
 */

import { describe, it, expect } from "bun:test";
import type { BunPlugin } from "bun";
import type { Middleware } from "../../middleware/define";
import type { RouteSpec, RoutesManifest } from "../../spec/schema";
import type { BundleStats } from "../../bundler/types";
import type { ManduPlugin } from "../hooks";
import {
  runOnRouteRegistered,
  runOnBundleComplete,
  runDefinePrerenderHook,
  runOnManifestBuilt,
  runDefineBundlerPlugin,
  runDefineMiddlewareChain,
  runDefineTestTransform,
  resolvePluginMiddleware,
  formatHookErrors,
} from "../runner";

// ───── Fixtures ─────

const sampleRoute: RouteSpec = {
  id: "sample",
  kind: "page",
  pattern: "/",
  module: "app/page.tsx",
  componentModule: "app/page.tsx",
};

const sampleManifest: RoutesManifest = {
  version: 1,
  routes: [sampleRoute],
};

const sampleStats: BundleStats = {
  totalSize: 1024,
  totalGzipSize: 512,
  largestBundle: { routeId: "sample", size: 1024 },
  buildTime: 50,
  bundleCount: 1,
};

const mkPluginContext = () => ({
  rootDir: "/tmp/project",
  mode: "production" as const,
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
});

// ═══════════════════════════════════════════════════════════════════════
describe("runner — dispatch order", () => {
  it("runs config hook BEFORE plugin hooks", async () => {
    const log: string[] = [];
    const plugins: ManduPlugin[] = [
      {
        name: "p1",
        hooks: {
          onRouteRegistered: () => {
            log.push("p1");
          },
        },
      },
    ];
    const configHooks = {
      onRouteRegistered: () => {
        log.push("config");
      },
    };
    await runOnRouteRegistered(sampleRoute, { plugins, configHooks });
    expect(log).toEqual(["config", "p1"]);
  });

  it("runs plugin hooks in declaration order", async () => {
    const log: string[] = [];
    const plugins: ManduPlugin[] = [
      { name: "a", hooks: { onRouteRegistered: () => { log.push("a"); } } },
      { name: "b", hooks: { onRouteRegistered: () => { log.push("b"); } } },
      { name: "c", hooks: { onRouteRegistered: () => { log.push("c"); } } },
    ];
    await runOnRouteRegistered(sampleRoute, { plugins });
    expect(log).toEqual(["a", "b", "c"]);
  });

  it("skips undefined hooks silently", async () => {
    const plugins: ManduPlugin[] = [
      { name: "empty" },
      { name: "also-empty", hooks: {} },
    ];
    const report = await runOnRouteRegistered(sampleRoute, { plugins });
    expect(report.errors).toEqual([]);
  });

  it("handles empty plugin array gracefully", async () => {
    const report = await runOnBundleComplete(sampleStats, { plugins: [] });
    expect(report.errors).toEqual([]);
    expect(report.result).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("runner — error isolation", () => {
  it("captures errors without stopping sibling plugins", async () => {
    const log: string[] = [];
    const plugins: ManduPlugin[] = [
      {
        name: "ok1",
        hooks: { onRouteRegistered: () => { log.push("ok1"); } },
      },
      {
        name: "fails",
        hooks: {
          onRouteRegistered: () => {
            throw new Error("boom");
          },
        },
      },
      {
        name: "ok2",
        hooks: { onRouteRegistered: () => { log.push("ok2"); } },
      },
    ];
    const report = await runOnRouteRegistered(sampleRoute, { plugins });
    expect(log).toEqual(["ok1", "ok2"]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].source).toBe("fails");
    expect(report.errors[0].hook).toBe("onRouteRegistered");
    expect(report.errors[0].error.message).toBe("boom");
  });

  it("handles async errors", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "async-fails",
        hooks: {
          async onRouteRegistered() {
            await Promise.resolve();
            throw new Error("async boom");
          },
        },
      },
    ];
    const report = await runOnRouteRegistered(sampleRoute, { plugins });
    expect(report.errors[0].error.message).toBe("async boom");
  });

  it("stringifies non-Error throws", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "weird",
        hooks: {
          onRouteRegistered: () => {
            throw "just a string";
          },
        },
      },
    ];
    const report = await runOnRouteRegistered(sampleRoute, { plugins });
    expect(report.errors[0].error.message).toBe("just a string");
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("runner — definePrerenderHook merge", () => {
  it("spreads returns across plugins (last write wins)", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "first",
        hooks: {
          definePrerenderHook: () => ({ html: "<p>first</p>", skip: false }),
        },
      },
      {
        name: "second",
        hooks: {
          definePrerenderHook: () => ({ html: "<p>second</p>" }),
        },
      },
    ];
    const report = await runDefinePrerenderHook(
      {
        ...mkPluginContext(),
        pathname: "/",
        html: "<p>original</p>",
      },
      { plugins },
    );
    expect(report.result.html).toBe("<p>second</p>");
    expect(report.result.skip).toBe(false);
  });

  it("treats void returns as no-change", async () => {
    const plugins: ManduPlugin[] = [
      { name: "noop", hooks: { definePrerenderHook: () => {} } },
      {
        name: "sets",
        hooks: { definePrerenderHook: () => ({ skip: true }) },
      },
    ];
    const report = await runDefinePrerenderHook(
      { ...mkPluginContext(), pathname: "/", html: "x" },
      { plugins },
    );
    expect(report.result.skip).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("runner — onManifestBuilt pipe", () => {
  it("pipes manifest across plugins (each sees prev output)", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "add-version",
        hooks: {
          onManifestBuilt: (m) => ({ ...m, version: 2 }) as RoutesManifest,
        },
      },
      {
        name: "inspect",
        hooks: {
          onManifestBuilt: (m) => {
            expect(m.version).toBe(2);
            return m;
          },
        },
      },
    ];
    const report = await runOnManifestBuilt(sampleManifest, { plugins });
    expect(report.result.version).toBe(2);
  });

  it("void return passes through unchanged", async () => {
    const plugins: ManduPlugin[] = [
      { name: "noop", hooks: { onManifestBuilt: () => {} } },
    ];
    const report = await runOnManifestBuilt(sampleManifest, { plugins });
    expect(report.result).toBe(sampleManifest);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("runner — defineBundlerPlugin concat", () => {
  const mkPlugin = (name: string): BunPlugin => ({
    name,
    setup() {},
  });

  it("concatenates scalar + array returns", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "single",
        hooks: { defineBundlerPlugin: () => mkPlugin("one") },
      },
      {
        name: "multi",
        hooks: {
          defineBundlerPlugin: () => [mkPlugin("two"), mkPlugin("three")],
        },
      },
    ];
    const report = await runDefineBundlerPlugin({ plugins });
    expect(report.result.map((p) => p.name)).toEqual(["one", "two", "three"]);
  });

  it("skips undefined returns", async () => {
    const plugins: ManduPlugin[] = [
      { name: "nil", hooks: { defineBundlerPlugin: () => undefined } as any },
      { name: "one", hooks: { defineBundlerPlugin: () => mkPlugin("x") } },
    ];
    const report = await runDefineBundlerPlugin({ plugins });
    expect(report.result.map((p) => p.name)).toEqual(["x"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("runner — defineMiddlewareChain concat", () => {
  const mkMw = (name: string): Middleware => ({
    name,
    handler: async (_req, next) => next(),
  });

  it("concatenates middleware across plugins in order", async () => {
    const plugins: ManduPlugin[] = [
      { name: "p1", hooks: { defineMiddlewareChain: () => [mkMw("a"), mkMw("b")] } },
      { name: "p2", hooks: { defineMiddlewareChain: () => [mkMw("c")] } },
    ];
    const report = await runDefineMiddlewareChain(mkPluginContext(), { plugins });
    expect(report.result.map((m) => m.name)).toEqual(["a", "b", "c"]);
  });

  it("resolvePluginMiddleware returns flattened list", async () => {
    const plugins: ManduPlugin[] = [
      { name: "p", hooks: { defineMiddlewareChain: () => [mkMw("only")] } },
    ];
    const mw = await resolvePluginMiddleware({
      plugins,
      rootDir: "/tmp",
      mode: "production",
    });
    expect(mw.map((m) => m.name)).toEqual(["only"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("runner — defineTestTransform pipe", () => {
  it("pipes each plugin's output into the next", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "upper",
        hooks: {
          defineTestTransform: (ctx) => ctx.source.toUpperCase(),
        },
      },
      {
        name: "suffix",
        hooks: {
          defineTestTransform: (ctx) => ctx.source + "!",
        },
      },
    ];
    const report = await runDefineTestTransform(
      { testFile: "foo.test.ts", source: "hello" },
      { plugins },
    );
    expect(report.result).toBe("HELLO!");
  });

  it("preserves source when a plugin throws", async () => {
    const plugins: ManduPlugin[] = [
      {
        name: "bad",
        hooks: {
          defineTestTransform: () => { throw new Error("oops"); },
        },
      },
      {
        name: "good",
        hooks: {
          defineTestTransform: (ctx) => ctx.source + ":ok",
        },
      },
    ];
    const report = await runDefineTestTransform(
      { testFile: "foo.test.ts", source: "base" },
      { plugins },
    );
    expect(report.result).toBe("base:ok");
    expect(report.errors).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("runner — async hook timing", () => {
  it("awaits async hooks serially", async () => {
    const log: string[] = [];
    const plugins: ManduPlugin[] = [
      {
        name: "slow",
        hooks: {
          async onRouteRegistered() {
            await new Promise((r) => setTimeout(r, 10));
            log.push("slow");
          },
        },
      },
      {
        name: "fast",
        hooks: {
          onRouteRegistered: () => {
            log.push("fast");
          },
        },
      },
    ];
    await runOnRouteRegistered(sampleRoute, { plugins });
    expect(log).toEqual(["slow", "fast"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("runner — formatHookErrors", () => {
  it("returns null when the report is clean", () => {
    expect(
      formatHookErrors({ result: undefined, errors: [] }),
    ).toBeNull();
  });

  it("formats error rollup", () => {
    const formatted = formatHookErrors({
      result: undefined,
      errors: [
        { hook: "onRouteRegistered", source: "bad-plugin", error: new Error("boom") },
      ],
    });
    expect(formatted).toContain("1 hook failure(s)");
    expect(formatted).toContain("bad-plugin");
    expect(formatted).toContain("boom");
  });
});
