/**
 * Phase 7.1 R1 Agent B — React Fast Refresh tests.
 *
 * Split into four sections:
 *
 *   A — `appendBoundary` + `classifyBoundary` pure unit tests (fast).
 *   B — `manduHMR` runtime unit tests (no DOM required).
 *   C — `Bun.build({ reactFastRefresh: true })` + plugin integration.
 *   D — `dispatchReplacement` + `__MANDU_HMR__` end-to-end wiring.
 *
 * Bundler tests (Section C) run a real `Bun.build`, so they honor the
 * same `MANDU_SKIP_BUNDLER_TESTS` escape hatch used by `build.test.ts`
 * — on CI shards where cross-worker races have been observed.
 *
 * References:
 *   docs/bun/phase-7-1-diagnostics/fast-refresh-strategy.md §4
 *   docs/bun/phase-7-1-team-plan.md §4 Agent B
 *   packages/core/src/bundler/fast-refresh-plugin.ts
 *   packages/core/src/runtime/fast-refresh-runtime.ts
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "fs/promises";
import path from "path";

import {
  appendBoundary,
  classifyBoundary,
  fastRefreshPlugin,
  DEFAULT_INCLUDE,
  _testOnly_ALREADY_INJECTED,
} from "../fast-refresh-plugin";
import {
  manduHMR,
  installPreamble,
  bindRuntime,
  installGlobal,
  _resetForTests,
  _getBoundaryCountForTests,
  _isRefreshScheduledForTests,
  type ReactRefreshRuntime,
} from "../../runtime/fast-refresh-runtime";
import {
  createManduHot,
  dispatchReplacement,
  _resetRegistryForTests,
} from "../../runtime/hmr-client";
import { generateFastRefreshPreamble } from "../dev";

// ═══════════════════════════════════════════════════════════════════
// Section A — plugin pure unit tests
// ═══════════════════════════════════════════════════════════════════

describe("fast-refresh-plugin — classifyBoundary / appendBoundary", () => {
  test("[A1] DEFAULT_INCLUDE matches .client.tsx / .island.tsx / their .ts variants", () => {
    expect(DEFAULT_INCLUDE.test("/root/app/foo.client.tsx")).toBe(true);
    expect(DEFAULT_INCLUDE.test("/root/app/bar.island.tsx")).toBe(true);
    expect(DEFAULT_INCLUDE.test("/root/app/baz.client.ts")).toBe(true);
    expect(DEFAULT_INCLUDE.test("/root/app/qux.island.ts")).toBe(true);
    // These must NOT match — plain .tsx files are excluded by design.
    expect(DEFAULT_INCLUDE.test("/root/app/page.tsx")).toBe(false);
    expect(DEFAULT_INCLUDE.test("/root/app/layout.tsx")).toBe(false);
    expect(DEFAULT_INCLUDE.test("/root/app/regular.ts")).toBe(false);
  });

  test("[A2] classifyBoundary accepts client/island files", () => {
    const d = classifyBoundary("/app/counter.client.tsx");
    expect(d.accepted).toBe(true);
    if (d.accepted) {
      expect(d.reason).toBe("matched-include");
      expect(d.source).toBe("/app/counter.client.tsx");
    }
  });

  test("[A3] classifyBoundary rejects plain .tsx + node_modules + disabled", () => {
    // Excluded by include filter
    expect(classifyBoundary("/app/page.tsx").accepted).toBe(false);
    const excluded = classifyBoundary("/app/page.tsx");
    if (!excluded.accepted) expect(excluded.reason).toBe("excluded-by-include");

    // Under node_modules, even with matching name
    const nm = classifyBoundary("/root/node_modules/foo/bar.client.tsx");
    expect(nm.accepted).toBe(false);
    if (!nm.accepted) expect(nm.reason).toBe("non-react");

    // Disabled plugin (prod build)
    const d = classifyBoundary("/app/counter.client.tsx", { disabled: true });
    expect(d.accepted).toBe(false);
    if (!d.accepted) expect(d.reason).toBe("disabled");
  });

  test("[A4] appendBoundary emits window.__MANDU_HMR__.acceptFile with a JSON-safe URL literal", () => {
    const src = "export const x = 1;\n";
    const out = appendBoundary(src, "/app/counter.client.tsx");
    // Guard must be present
    expect(out).toContain('typeof window !== "undefined"');
    expect(out).toContain("window.__MANDU_HMR__");
    expect(out).toContain(".acceptFile(");
    // URL must be JSON-quoted
    expect(out).toContain('"/app/counter.client.tsx"');
  });

  test("[A5] appendBoundary is idempotent — second call does not stack", () => {
    const src = "export const x = 1;\n";
    const once = appendBoundary(src, "/app/counter.client.tsx");
    const twice = appendBoundary(once, "/app/counter.client.tsx");
    expect(twice).toBe(once);
    // And the guard regex ALREADY_INJECTED only matches once
    expect(_testOnly_ALREADY_INJECTED.test(once)).toBe(true);
  });

  test("[A6] appendBoundary escapes URLs with backslashes for Windows paths", () => {
    const src = "";
    // Note: appendBoundary does not normalize — it trusts the caller.
    // The plugin's onLoad hook normalizes before calling. Verify the
    // JSON.stringify escaping is correct for backslashes regardless.
    const out = appendBoundary(src, "C:\\app\\counter.client.tsx");
    // JSON.stringify double-escapes backslashes
    expect(out).toContain('"C:\\\\app\\\\counter.client.tsx"');
  });

  test("[A7] fastRefreshPlugin factory returns a plugin with the expected name", () => {
    const plugin = fastRefreshPlugin();
    expect(plugin.name).toBe("mandu:fast-refresh-boundary");
    expect(typeof plugin.setup).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section B — manduHMR runtime pure unit tests
// ═══════════════════════════════════════════════════════════════════

describe("manduHMR — __MANDU_HMR__ global behavior", () => {
  beforeEach(() => {
    _resetForTests();
  });

  test("[B1] acceptFile registers a URL as a boundary", () => {
    expect(manduHMR.isBoundary("/a.client.tsx")).toBe(false);
    manduHMR.acceptFile("/a.client.tsx");
    expect(manduHMR.isBoundary("/a.client.tsx")).toBe(true);
    expect(_getBoundaryCountForTests()).toBe(1);
  });

  test("[B2] acceptFile is idempotent — double-register does not increment", () => {
    manduHMR.acceptFile("/a.client.tsx");
    manduHMR.acceptFile("/a.client.tsx");
    manduHMR.acceptFile("/a.client.tsx");
    expect(_getBoundaryCountForTests()).toBe(1);
  });

  test("[B3] acceptFile rejects empty / non-string input", () => {
    manduHMR.acceptFile("");
    // @ts-expect-error — runtime guard
    manduHMR.acceptFile(null);
    // @ts-expect-error — runtime guard
    manduHMR.acceptFile(undefined);
    expect(_getBoundaryCountForTests()).toBe(0);
  });

  test("[B4] performReactRefresh coalesces multiple calls into one microtask", async () => {
    let refreshCalls = 0;
    const fakeRuntime: ReactRefreshRuntime = {
      injectIntoGlobalHook: () => undefined,
      register: () => undefined,
      createSignatureFunctionForTransform: () => (t) => t,
      performReactRefresh: () => {
        refreshCalls += 1;
      },
    };
    bindRuntime(fakeRuntime);

    // Call three times in the same tick
    manduHMR.performReactRefresh();
    manduHMR.performReactRefresh();
    manduHMR.performReactRefresh();
    expect(_isRefreshScheduledForTests()).toBe(true);
    expect(refreshCalls).toBe(0); // not yet — queued in microtask

    // Yield for microtasks to drain
    await Promise.resolve();
    await Promise.resolve();

    expect(refreshCalls).toBe(1);
    expect(_isRefreshScheduledForTests()).toBe(false);
  });

  test("[B5] performReactRefresh is a no-op when no runtime is bound", async () => {
    // _resetForTests() cleared the runtime, so state is un-bound
    manduHMR.performReactRefresh();
    await Promise.resolve();
    await Promise.resolve();
    // No throw, no effect — scheduled flag stays off
    expect(_isRefreshScheduledForTests()).toBe(false);
  });

  test("[B6] installPreamble installs inert $RefreshReg$ / $RefreshSig$ stubs", () => {
    const target = {} as typeof globalThis;
    installPreamble(target);
    const t = target as unknown as {
      $RefreshReg$?: unknown;
      $RefreshSig$?: unknown;
    };
    expect(typeof t.$RefreshReg$).toBe("function");
    expect(typeof t.$RefreshSig$).toBe("function");
    // $RefreshSig$ must return a function that behaves like identity
    const sig = (t.$RefreshSig$ as () => (x: unknown) => unknown)();
    expect(sig(42)).toBe(42);
  });

  test("[B7] installGlobal wires __MANDU_HMR__ onto globalThis with an injected fake runtime", async () => {
    let injectedHook: unknown = null;
    let registered: Array<[unknown, string]> = [];
    const fakeRuntime: ReactRefreshRuntime = {
      injectIntoGlobalHook: (t) => {
        injectedHook = t;
      },
      register: (type, id) => {
        registered.push([type, id]);
      },
      createSignatureFunctionForTransform: () => (t) => t,
      performReactRefresh: () => undefined,
    };
    await installGlobal({ runtime: fakeRuntime });
    const g = globalThis as unknown as {
      __MANDU_HMR__?: typeof manduHMR;
      $RefreshReg$?: (t: unknown, id: string) => void;
    };
    expect(g.__MANDU_HMR__).toBe(manduHMR);
    expect(injectedHook).toBe(globalThis);
    // $RefreshReg$ should now route through runtime.register
    g.$RefreshReg$?.({ name: "X" }, "X.tsx:default");
    expect(registered.length).toBe(1);
    expect(registered[0]?.[1]).toBe("X.tsx:default");
  });

  test("[B8] _testOnly_reset clears boundaries, runtime, and pending refresh", async () => {
    const fakeRuntime: ReactRefreshRuntime = {
      injectIntoGlobalHook: () => undefined,
      register: () => undefined,
      createSignatureFunctionForTransform: () => (t) => t,
      performReactRefresh: () => undefined,
    };
    bindRuntime(fakeRuntime);
    manduHMR.acceptFile("/a.client.tsx");
    manduHMR.performReactRefresh();
    expect(_isRefreshScheduledForTests()).toBe(true);

    manduHMR._testOnly_reset();
    expect(_getBoundaryCountForTests()).toBe(0);
    expect(_isRefreshScheduledForTests()).toBe(false);
    // After reset, performReactRefresh is a no-op until rebind
    manduHMR.performReactRefresh();
    await Promise.resolve();
    expect(_isRefreshScheduledForTests()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section C — Bun.build integration
// ═══════════════════════════════════════════════════════════════════

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "Bun.build({ reactFastRefresh: true }) + fastRefreshPlugin()",
  () => {
    let rootDir: string;

    beforeAll(async () => {
      rootDir = await mkdtemp(path.join(import.meta.dir, ".tmp-fr-build-"));
      // Three source files — one boundary, one plain, one .island.tsx —
      // give us the minimal matrix for the plugin's include filter.
      await writeFile(
        path.join(rootDir, "counter.client.tsx"),
        `import { useState } from 'react';
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
`,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "hero.island.tsx"),
        `export default function Hero() { return <div>hero</div>; }\n`,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "util.ts"),
        `export function add(a: number, b: number) { return a + b; }\n`,
        "utf-8",
      );
    });

    afterAll(async () => {
      if (rootDir) await rm(rootDir, { recursive: true, force: true });
    });

    test("[C1] `reactFastRefresh: true` injects $RefreshReg$ / $RefreshSig$ into the output", async () => {
      const result = await Bun.build({
        entrypoints: [path.join(rootDir, "counter.client.tsx")],
        target: "browser",
        reactFastRefresh: true,
        external: ["react", "react-dom", "react/jsx-dev-runtime"],
      });
      expect(result.success).toBe(true);
      const src = await result.outputs[0]!.text();
      expect(src).toContain("$RefreshReg$");
      expect(src).toContain("$RefreshSig$");
    });

    test("[C2] fastRefreshPlugin injects acceptFile call into .client.tsx output", async () => {
      const result = await Bun.build({
        entrypoints: [path.join(rootDir, "counter.client.tsx")],
        target: "browser",
        reactFastRefresh: true,
        plugins: [fastRefreshPlugin()],
        external: ["react", "react-dom", "react/jsx-dev-runtime"],
      });
      expect(result.success).toBe(true);
      const src = await result.outputs[0]!.text();
      expect(src).toContain("window.__MANDU_HMR__");
      expect(src).toContain(".acceptFile(");
    });

    test("[C3] fastRefreshPlugin injects acceptFile call into .island.tsx output", async () => {
      const result = await Bun.build({
        entrypoints: [path.join(rootDir, "hero.island.tsx")],
        target: "browser",
        reactFastRefresh: true,
        plugins: [fastRefreshPlugin()],
        external: ["react", "react-dom", "react/jsx-dev-runtime"],
      });
      expect(result.success).toBe(true);
      const src = await result.outputs[0]!.text();
      expect(src).toContain("__MANDU_HMR__");
      expect(src).toContain(".acceptFile(");
      // URL should contain hero.island.tsx — bundler normalizes to fwd slash
      expect(src).toMatch(/hero\.island\.tsx/);
    });

    test("[C4] plain .ts files are not transformed by the plugin (no acceptFile injection)", async () => {
      // util.ts is imported by counter.client.tsx would still be a
      // boundary. Here we build util.ts directly to prove the plugin's
      // include filter excludes it.
      const result = await Bun.build({
        entrypoints: [path.join(rootDir, "util.ts")],
        target: "browser",
        reactFastRefresh: true,
        plugins: [fastRefreshPlugin()],
      });
      expect(result.success).toBe(true);
      const src = await result.outputs[0]!.text();
      expect(src).not.toContain("__MANDU_HMR__");
    });

    test("[C5] disabled plugin emits nothing — production path", async () => {
      const result = await Bun.build({
        entrypoints: [path.join(rootDir, "counter.client.tsx")],
        target: "browser",
        // NOTE: not enabling reactFastRefresh here — prod uses both flags off
        plugins: [fastRefreshPlugin({ disabled: true })],
        external: ["react", "react-dom", "react/jsx-dev-runtime"],
      });
      expect(result.success).toBe(true);
      const src = await result.outputs[0]!.text();
      expect(src).not.toContain("__MANDU_HMR__");
      expect(src).not.toContain("$RefreshReg$");
    });
  },
);

// ═══════════════════════════════════════════════════════════════════
// Section D — End-to-end wiring (dispatchReplacement ↔ __MANDU_HMR__)
// ═══════════════════════════════════════════════════════════════════

describe("dispatchReplacement + __MANDU_HMR__ integration", () => {
  beforeEach(() => {
    _resetRegistryForTests();
    _resetForTests();
  });

  test("[D1] dispatchReplacement triggers performReactRefresh for a registered boundary", async () => {
    let refreshCalls = 0;
    const fakeRuntime: ReactRefreshRuntime = {
      injectIntoGlobalHook: () => undefined,
      register: () => undefined,
      createSignatureFunctionForTransform: () => (t) => t,
      performReactRefresh: () => {
        refreshCalls += 1;
      },
    };
    await installGlobal({ runtime: fakeRuntime });

    const url = "/app/counter.client.tsx";
    manduHMR.acceptFile(url);
    const hot = createManduHot(url);
    hot.accept();

    const applied = dispatchReplacement(url, { default: "new" });
    expect(applied).toBe(true);
    // Refresh is queued on a microtask
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshCalls).toBe(1);
  });

  test("[D2] dispatchReplacement does NOT trigger refresh for a non-boundary module", async () => {
    let refreshCalls = 0;
    const fakeRuntime: ReactRefreshRuntime = {
      injectIntoGlobalHook: () => undefined,
      register: () => undefined,
      createSignatureFunctionForTransform: () => (t) => t,
      performReactRefresh: () => {
        refreshCalls += 1;
      },
    };
    await installGlobal({ runtime: fakeRuntime });

    const url = "/app/not-boundary.ts";
    // NOTE: no acceptFile() call — url is never registered
    const hot = createManduHot(url);
    hot.accept();

    dispatchReplacement(url, { default: "new" });
    await Promise.resolve();
    await Promise.resolve();
    expect(refreshCalls).toBe(0);
  });

  test("[D3] dispatchReplacement swallows Fast Refresh runtime errors without breaking HMR", async () => {
    const fakeRuntime: ReactRefreshRuntime = {
      injectIntoGlobalHook: () => undefined,
      register: () => undefined,
      createSignatureFunctionForTransform: () => (t) => t,
      performReactRefresh: () => {
        throw new Error("simulated runtime failure");
      },
    };
    await installGlobal({ runtime: fakeRuntime });

    const url = "/app/counter.client.tsx";
    manduHMR.acceptFile(url);
    const hot = createManduHot(url);
    let cbFired = false;
    hot.accept(() => {
      cbFired = true;
    });

    // Should not throw — the user callback still ran and return is true
    const applied = dispatchReplacement(url, { default: "new" });
    expect(applied).toBe(true);
    expect(cbFired).toBe(true);

    // The throwing refresh happens on a microtask; catch it via unhandled
    // rejection suppression. Yield to let it fire.
    await Promise.resolve();
    await Promise.resolve();
    // No assertion on thrown error — only that dispatchReplacement
    // returned cleanly. A thrown performReactRefresh is logged but not
    // propagated.
  });

  test("[D4] HTML preamble string — snapshot shape", () => {
    const glue = "/.mandu/client/_fast-refresh-runtime.js";
    const runtime = "/.mandu/client/_vendor-react-refresh.js";
    const out = generateFastRefreshPreamble(glue, runtime);
    // Must be a <script>...</script> block
    expect(out.startsWith("<script>")).toBe(true);
    expect(out.trim().endsWith("</script>")).toBe(true);
    // Must install stubs
    expect(out).toContain("$RefreshReg$");
    expect(out).toContain("$RefreshSig$");
    // Must dynamic-import both URLs (as JSON string literals)
    expect(out).toContain('"/.mandu/client/_fast-refresh-runtime.js"');
    expect(out).toContain('"/.mandu/client/_vendor-react-refresh.js"');
    // Must call installGlobal
    expect(out).toContain("installGlobal");
  });

  test("[D5] HTML preamble guards against missing URLs (graceful degrade)", () => {
    expect(generateFastRefreshPreamble("", "")).toContain(
      "missing runtime assets",
    );
    expect(generateFastRefreshPreamble("", "/ok.js")).toContain(
      "missing runtime assets",
    );
  });

  test("[D6] react-refresh package is at a version compatible with React 19 (≥0.18.0)", async () => {
    // Load the upstream package.json dynamically so this test validates
    // the environment the build will actually consume. `require` via
    // import() keeps us off static resolver quirks.
    const pkgUrl = "react-refresh/package.json";
    const pkg = await import(/* @vite-ignore */ pkgUrl, { with: { type: "json" } });
    const version: string = (pkg as { default: { version: string } }).default.version;
    expect(typeof version).toBe("string");
    // Parse major.minor — must be ≥ 0.18. react-refresh uses 0.x
    // forever, so "major" is always 0.
    const m = version.match(/^(\d+)\.(\d+)\./);
    expect(m).not.toBeNull();
    const major = Number(m![1]);
    const minor = Number(m![2]);
    expect(major).toBe(0);
    expect(minor >= 18).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section E — Vendor shim smoke (emits _vendor-react-refresh.js path)
// ═══════════════════════════════════════════════════════════════════

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "buildVendorShims emits fast-refresh shims in dev mode",
  () => {
    let rootDir: string;

    beforeAll(async () => {
      rootDir = await mkdtemp(path.join(import.meta.dir, ".tmp-fr-vendor-"));
      await mkdir(path.join(rootDir, "app"), { recursive: true });
      await writeFile(
        path.join(rootDir, "package.json"),
        JSON.stringify({ name: "mandu-fr-vendor-test", type: "module" }),
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "app", "demo.client.tsx"),
        "export default function DemoIsland() { return null; }\n",
        "utf-8",
      );
    });

    afterAll(async () => {
      if (rootDir) await rm(rootDir, { recursive: true, force: true });
    });

    test("[E1] dev build produces _vendor-react-refresh.js + _fast-refresh-runtime.js + manifest.shared.fastRefresh entry", async () => {
      // Force dev-mode build by spawning `buildClientBundles` in a fresh
      // bun subprocess — see build-runner.ts header for the full story.
      // In short: Bun 1.3.x's bundler resolver state gets poisoned when
      // any sibling test file imports `react` / `react-dom`, making the
      // 7-parallel shim fan-out fail with `AggregateError: Bundle failed`
      // ~100 % of the time for the affected shim(s). A subprocess has a
      // clean module graph.
      const { spawn } = await import("node:child_process");
      const runner = path.join(import.meta.dir, "build-runner.ts");
      const cwd = path.resolve(import.meta.dir, "..", "..", "..");
      const out = await new Promise<string>((resolve) => {
        const proc = spawn(process.execPath, ["run", runner, rootDir], {
          cwd,
          stdio: ["ignore", "pipe", "inherit"],
        });
        let buf = "";
        proc.stdout.on("data", (d: Buffer) => (buf += d.toString("utf-8")));
        proc.on("close", () => resolve(buf));
      });
      const jsonLine =
        out
          .split(/\r?\n/)
          .filter((l) => l.trim().length > 0)
          .pop() ?? "";
      let parsed: {
        success: boolean;
        errors: string[];
        manifest: { shared: { fastRefresh: { runtime: string; glue: string } | null } } | null;
      };
      try {
        parsed = JSON.parse(jsonLine);
      } catch (e) {
        throw new Error(
          `build-runner stdout could not be parsed as JSON: ${String(e)}\nLast line: ${jsonLine}`,
        );
      }
      if (!parsed.success) {
        console.error("[fr-vendor] errors:", parsed.errors);
      }
      expect(parsed.success).toBe(true);
      // Both shim files must exist on disk
      const glueFile = path.join(
        rootDir,
        ".mandu",
        "client",
        "_fast-refresh-runtime.js",
      );
      const rtFile = path.join(
        rootDir,
        ".mandu",
        "client",
        "_vendor-react-refresh.js",
      );
      const glueContents = await readFile(glueFile, "utf-8");
      const rtContents = await readFile(rtFile, "utf-8");
      expect(glueContents.length).toBeGreaterThan(0);
      expect(rtContents.length).toBeGreaterThan(0);
      // Glue exports installGlobal (string-level smoke check on the
      // bundle output — avoids requiring a full evaluation)
      expect(glueContents).toContain("installGlobal");
      // Manifest exposes the paths
      expect(parsed.manifest?.shared.fastRefresh?.runtime).toBe(
        "/.mandu/client/_vendor-react-refresh.js",
      );
      expect(parsed.manifest?.shared.fastRefresh?.glue).toBe(
        "/.mandu/client/_fast-refresh-runtime.js",
      );
    });
  },
);
