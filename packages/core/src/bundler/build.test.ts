import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { serializeProps } from "../client/serialize";
import { toMatchSnapshot } from "../testing/snapshot";
import { setupHappyDom } from "../../tests/setup";

setupHappyDom();

// 모든 테스트가 하나의 빌드 결과를 공유 — 병렬 Bun.build 충돌 방지
let rootDir: string;
let result: { success: boolean; errors: string[] };
const repoTempRoot = path.resolve(import.meta.dir, "../../../..", ".tmp-test-artifacts");

async function mkRepoTempDir(prefix: string): Promise<string> {
  await mkdir(repoTempRoot, { recursive: true });
  return mkdtemp(path.join(repoTempRoot, prefix));
}

async function importBuiltModule(relativePath: string): Promise<Record<string, unknown>> {
  const fileUrl = pathToFileURL(path.join(rootDir, relativePath)).href;
  return import(`${fileUrl}?t=${Date.now()}`);
}

async function evaluateGeneratedHydrationRuntime(): Promise<{ hydrateIslands: () => void }> {
  const sourcePath = path.join(rootDir, ".mandu", "client", "_runtime.src.js");
  const bundledPath = path.join(rootDir, ".mandu", "client", "_runtime.js");
  const runtimeSource = await readFile(await Bun.file(sourcePath).exists() ? sourcePath : bundledPath, "utf-8");
  const instrumented = runtimeSource
    .replace(
      /import\s+React,\s*\{\s*useState,\s*useEffect,\s*Component\s*\}\s+from\s+['"]react['"];?/,
      "const React = globalThis.__MANDU_TEST_REACT__; const { useState, useEffect, Component } = React;",
    )
    .replace(
      /import\s+\{\s*hydrateRoot,\s*createRoot\s*\}\s+from\s+['"]react-dom\/client['"];?/,
      "const { hydrateRoot, createRoot } = globalThis.__MANDU_TEST_REACT_DOM_CLIENT__;",
    )
    .replace(
      /export\s*\{[^}]*\};?/g,
      "globalThis.__MANDU_TEST_RUNTIME__ = { hydrateIslands, unmountIsland, hydratedRoots };",
    );

  const reactStub = {
    Component: class {},
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
      if (
        typeof type === "function" &&
        !(typeof type === "function" && "prototype" in type && (type as { prototype?: { render?: unknown } }).prototype?.render)
      ) {
        return (type as (props: Record<string, unknown>) => unknown)({
          ...(props ?? {}),
          children: children.length <= 1 ? children[0] : children,
        });
      }
      return { type, props: props ?? {}, children };
    },
    isValidElement(value: unknown) {
      return !!value && typeof value === "object" && "type" in value;
    },
    useEffect(effect: () => void) {
      effect();
    },
    useState<T>(initial: T) {
      return [initial, () => {}] as const;
    },
  };
  const rootStub = {
    render() {},
    unmount() {},
  };
  Object.assign(globalThis, {
    __MANDU_TEST_REACT__: reactStub,
    __MANDU_TEST_REACT_DOM_CLIENT__: {
      createRoot: () => rootStub,
      hydrateRoot: () => rootStub,
    },
  });

  new Function(instrumented)();
  return (globalThis as typeof globalThis & {
    __MANDU_TEST_RUNTIME__: { hydrateIslands: () => void };
  }).__MANDU_TEST_RUNTIME__;
}

async function waitForRuntimeAssertion(assertion: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt++) {
    if (assertion()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(assertion()).toBe(true);
}

/**
 * Run `buildClientBundles` in an isolated `bun` subprocess.
 *
 * Bun 1.3.x exhibits a deterministic `AggregateError: Bundle failed` when
 * `buildClientBundles` is called from a test file AND the same `bun test`
 * process has previously imported `react` / `react-dom` through any sibling
 * test file (happens transitively through almost every `src/testing/*` or
 * `src/runtime/*` consumer). Retrying in-process does not recover — the
 * resolver state is sticky. A fresh subprocess has a clean module graph.
 * See `__tests__/build-runner.ts` for the subprocess entrypoint and more
 * background.
 */
async function runBuildInSubprocess(root: string, mode?: string): Promise<{
  success: boolean;
  errors: string[];
  manifest?: {
    routes?: Array<{
      id?: string;
      module?: string;
      componentModule?: string;
      boundaries?: Array<{
        id?: string;
        routeId?: string;
        module?: string;
        importSpecifier?: string;
        exportName?: string;
        localName?: string;
        hydrate?: string;
        ordinal?: number;
        propsSource?: string;
        propsKeys?: string[];
        hasSpreadProps?: boolean;
        source?: {
          file?: string;
          line?: number;
          column?: number;
        };
      }>;
    }>;
    bundles?: Record<string, { js?: string }>;
    boundaries?: Record<string, { js?: string; route?: string; module?: string; exportName?: string; hydrate?: string }>;
  } | null;
}> {
  const runner = path.join(
    import.meta.dir,
    "__tests__",
    "build-runner.ts",
  );
  try {
    const args = [process.execPath, "run", runner, root];
    if (mode) args.push(mode);
    const proc = Bun.spawn(args, {
      cwd: path.resolve(import.meta.dir, "..", ".."),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;

    // Find the final JSON line — the runner may log Mandu dev banners
    // (e.g. "[Mandu] DevTools …") before emitting the payload. The
    // contract is: last non-empty line is the JSON blob.
    const lines = out.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const last = lines[lines.length - 1] ?? "";
    try {
      const parsed = JSON.parse(last);
      return {
        success: parsed.success === true,
        errors: Array.isArray(parsed.errors) ? parsed.errors : [],
        manifest: parsed.manifest ?? null,
      };
    } catch (e) {
      return {
        success: false,
        errors: [
          `build-runner output could not be parsed as JSON: ${String(e)}\nLast stdout line: ${last}`,
        ],
        manifest: null,
      };
    }
  } catch (err) {
    return { success: false, errors: [`spawn failed: ${String(err)}`], manifest: null };
  }
}

beforeAll(async () => {
  rootDir = await mkRepoTempDir("bundler-");

  await mkdir(path.join(rootDir, "app"), { recursive: true });
  await writeFile(
    path.join(rootDir, "package.json"),
    JSON.stringify({ name: "mandu-build-test", type: "module" }, null, 2),
    "utf-8",
  );
  await writeFile(
    path.join(rootDir, "app", "demo.client.tsx"),
    "export default function DemoIsland() { return null; }\n",
    "utf-8",
  );

  result = await runBuildInSubprocess(rootDir);
});

afterAll(async () => {
  if (rootDir) {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// Historical note — `MANDU_SKIP_BUNDLER_TESTS` gate REMOVED.
//
// A previous revision gated this describe block behind
// `describe.skipIf(MANDU_SKIP_BUNDLER_TESTS === "1")` because running
// `bun test src/bundler/` without the gate hung indefinitely on Windows
// (see Phase 0.6 and `docs/qa/wave-R2-integration-report.md`). Root cause
// was NOT actually in THIS file — it was a deadlock in `safe-build.test.ts`'s
// "slot handoff" regression test, which drove Bun's microtask queue with a
// `while (!stop) { await Promise.resolve() }` sampler. That starved libuv
// I/O callbacks, so the 7 parallel `safeBuild()` calls never completed, the
// whole test process hung, and downstream test files (including this one
// when run in the same invocation) looked flaky when they were simply
// never reached. The handoff sampler now yields via `setImmediate`, which
// unblocks Bun.build completion and makes `bun test src/bundler/` finish
// deterministically in ~35s on Windows. Confirmed green 3/3 runs without
// the gate on 2026-04-20. If you are tempted to re-introduce the skip here,
// first check whether a sibling test is starving the event loop.
//
// A second, independent flake — Bun.build `AggregateError: Bundle failed`
// when another test file in the same invocation has imported `react` —
// is now sidestepped by running `buildClientBundles` in a spawned `bun`
// subprocess via `__tests__/build-runner.ts`. In-process retry does not
// recover from that one; a fresh module graph does.
describe("buildClientBundles vendor shims", () => {
  test("build succeeds", () => {
    if (!result.success) {
      console.error("[build.test] errors:", result.errors);
    }
    expect(result.success).toBe(true);
  });

  test("runtime reads canonical data-hydrate strategies", async () => {
    const runtimePath = path.join(rootDir, ".mandu", "client", "_runtime.js");
    const runtimeSource = await readFile(runtimePath, "utf-8");

    expect(runtimeSource).toContain("data-hydrate");
    expect(runtimeSource).toContain("matchMedia");
    expect(runtimeSource).toContain("200px");
    expect(runtimeSource).toContain('"click"');
    expect(runtimeSource).not.toContain("mouseenter");
    expect(runtimeSource).not.toContain("pointerdown");
  });

  test("re-exports modern React 19 APIs used by islands", async () => {
    const reactShim = await importBuiltModule(".mandu/client/_react.js");
    const requiredExports = [
      "Activity",
      "__COMPILER_RUNTIME",
      "cache",
      "cacheSignal",
      "startTransition",
      "use",
      "useActionState",
      "useEffectEvent",
      "useOptimistic",
      "unstable_useCacheRefresh",
    ];

    for (const exportName of requiredExports) {
      expect(exportName in reactShim).toBe(true);
    }
  });

  test("re-exports modern react-dom and react-dom/client APIs", async () => {
    const reactDomShim = await importBuiltModule(".mandu/client/_react-dom.js");
    for (const exportName of [
      "preconnect",
      "prefetchDNS",
      "preinit",
      "preinitModule",
      "preload",
      "preloadModule",
      "requestFormReset",
      "unstable_batchedUpdates",
      "useFormState",
      "useFormStatus",
    ]) {
      expect(exportName in reactDomShim).toBe(true);
    }

    const reactDomClientShim = await importBuiltModule(".mandu/client/_react-dom-client.js");
    for (const exportName of ["createRoot", "hydrateRoot", "version"]) {
      expect(exportName in reactDomClientShim).toBe(true);
    }
  });

  test("embeds hydration guards for deferred trigger strategies", async () => {
    const runtimeSource = await readFile(path.join(rootDir, ".mandu", "client", "_runtime.js"), "utf-8");
    expect(runtimeSource).toContain("function resolveHydrationTarget");
    expect(runtimeSource).toContain("function hasHydratableMarkup");
    expect(runtimeSource).toContain("function shouldHydrateCompiledIsland");
    expect(runtimeSource).toContain("onRecoverableError");
    expect(runtimeSource).toContain("data-mandu-hydrating");
    expect(runtimeSource).toContain("data-mandu-render-mode");
    expect(runtimeSource).toContain("data-mandu-recoverable-error");
    expect(runtimeSource).toContain('"click"');
    expect(runtimeSource).not.toContain("pointerdown");
  });

  test("runtime parses SSR data script before island setup", async () => {
    const runtimeSource = await readFile(path.join(rootDir, ".mandu", "client", "_runtime.js"), "utf-8");
    expect(runtimeSource).toContain("function readManduData");
    expect(runtimeSource).toContain("document.getElementById(\"__MANDU_DATA__\")");
    expect(runtimeSource).toContain("function parsePropsScript");
    expect(runtimeSource).toContain("data-mandu-props");
    expect(runtimeSource).toContain("Missing boundary-local props for transformed client boundary");
    expect(runtimeSource).toContain("warnedBoundaryPropFallbacks");
    expect(runtimeSource).toContain("deserializeManduProps");
    expect(runtimeSource).toContain("new Date");
    expect(runtimeSource).toContain("new Map");
  });

  test("runtime hydrates named client boundary from boundary-local props before route data", async () => {
    const modulePath = path.join(rootDir, ".mandu", "client", "runtime-named-boundary.js");
    await writeFile(
      modulePath,
      `
        export default function WrongDefault(props) {
          globalThis.__MANDU_TEST_DEFAULT_PROPS__ = props;
          return null;
        }
        export function NamedBoundary(props) {
          globalThis.__MANDU_TEST_NAMED_PROPS__ = props;
          return null;
        }
      `,
      "utf-8",
    );
    Object.assign(globalThis, {
      __MANDU_TEST_NAMED_PROPS__: undefined,
      __MANDU_TEST_DEFAULT_PROPS__: undefined,
    });
    document.body.innerHTML = `
      <div
        data-mandu-island="named--0"
        data-mandu-boundary-id="named--0"
        data-mandu-route-id="named-route"
        data-mandu-client-export="NamedBoundary"
        data-mandu-src="${pathToFileURL(modulePath).href}?t=${Date.now()}"
        data-hydrate="load"
      ></div>
      <script type="application/json" data-mandu-props="named--0">${serializeProps({ label: "boundary-local" })}</script>
    `;
    (window as typeof window & { __MANDU_DATA__?: unknown; __MANDU_ROOTS__?: Map<string, unknown> }).__MANDU_DATA__ = {
      "named-route": { serverData: { label: "route-data" } },
    };
    (window as typeof window & { __MANDU_ROOTS__?: Map<string, unknown> }).__MANDU_ROOTS__ = new Map();

    const runtime = await evaluateGeneratedHydrationRuntime();
    runtime.hydrateIslands();

    await waitForRuntimeAssertion(() =>
      (globalThis as typeof globalThis & { __MANDU_TEST_NAMED_PROPS__?: { label?: string } }).__MANDU_TEST_NAMED_PROPS__?.label === "boundary-local"
    );
    expect((globalThis as typeof globalThis & { __MANDU_TEST_DEFAULT_PROPS__?: unknown }).__MANDU_TEST_DEFAULT_PROPS__).toBeUndefined();
  });

  test("runtime hydrates default client boundary from boundary-local props", async () => {
    const modulePath = path.join(rootDir, ".mandu", "client", "runtime-default-boundary.js");
    await writeFile(
      modulePath,
      `
        export default function DefaultBoundary(props) {
          globalThis.__MANDU_TEST_DEFAULT_BOUNDARY_PROPS__ = props;
          return null;
        }
      `,
      "utf-8",
    );
    Object.assign(globalThis, {
      __MANDU_TEST_DEFAULT_BOUNDARY_PROPS__: undefined,
    });
    document.body.innerHTML = `
      <div
        data-mandu-island="default--0"
        data-mandu-boundary-id="default--0"
        data-mandu-route-id="default-route"
        data-mandu-client-export="default"
        data-mandu-src="${pathToFileURL(modulePath).href}?t=${Date.now()}"
        data-hydrate="load"
      ></div>
      <script type="application/json" data-mandu-props="default--0">${serializeProps({ label: "default-boundary" })}</script>
    `;
    (window as typeof window & { __MANDU_DATA__?: unknown; __MANDU_ROOTS__?: Map<string, unknown> }).__MANDU_DATA__ = {};
    (window as typeof window & { __MANDU_ROOTS__?: Map<string, unknown> }).__MANDU_ROOTS__ = new Map();

    const runtime = await evaluateGeneratedHydrationRuntime();
    runtime.hydrateIslands();

    await waitForRuntimeAssertion(() =>
      (globalThis as typeof globalThis & { __MANDU_TEST_DEFAULT_BOUNDARY_PROPS__?: { label?: string } }).__MANDU_TEST_DEFAULT_BOUNDARY_PROPS__?.label === "default-boundary"
    );
  });

  test("runtime keeps explicit island API data-props fallback working", async () => {
    const modulePath = path.join(rootDir, ".mandu", "client", "runtime-explicit-island.js");
    await writeFile(
      modulePath,
      `
        export default {
          __mandu_island: true,
          definition: {
            setup(data) {
              globalThis.__MANDU_TEST_EXPLICIT_ISLAND_DATA__ = data;
              return data;
            },
            render() {
              return null;
            }
          }
        };
      `,
      "utf-8",
    );
    Object.assign(globalThis, {
      __MANDU_TEST_EXPLICIT_ISLAND_DATA__: undefined,
    });
    document.body.innerHTML = `
      <div
        data-mandu-island="explicit-island"
        data-mandu-src="${pathToFileURL(modulePath).href}?t=${Date.now()}"
        data-props="${serializeProps({ label: "data-props" }).replace(/"/g, "&quot;")}"
        data-hydrate="load"
      ></div>
    `;
    (window as typeof window & { __MANDU_DATA__?: unknown; __MANDU_ROOTS__?: Map<string, unknown> }).__MANDU_DATA__ = {};
    (window as typeof window & { __MANDU_ROOTS__?: Map<string, unknown> }).__MANDU_ROOTS__ = new Map();

    const runtime = await evaluateGeneratedHydrationRuntime();
    runtime.hydrateIslands();

    await waitForRuntimeAssertion(() =>
      (globalThis as typeof globalThis & { __MANDU_TEST_EXPLICIT_ISLAND_DATA__?: { label?: string } }).__MANDU_TEST_EXPLICIT_ISLAND_DATA__?.label === "data-props"
    );
  });

  test("does not bundle a server page when stale manifest marks page.tsx as clientModule", async () => {
    const staleRoot = await mkRepoTempDir("stale-client-module-");
    try {
      await mkdir(path.join(staleRoot, "app"), { recursive: true });
      await mkdir(path.join(staleRoot, "src", "shared", "contracts"), { recursive: true });
      await writeFile(
        path.join(staleRoot, "package.json"),
        JSON.stringify({ name: "mandu-stale-client-module-test", type: "module" }, null, 2),
        "utf-8",
      );
      await writeFile(
        path.join(staleRoot, "src", "shared", "contracts", "api.ts"),
        'export const INTERNAL_BASE = process.env.MANDU_INTERNAL_URL ?? "http://localhost:3333";\n',
        "utf-8",
      );
      await writeFile(
        path.join(staleRoot, "app", "page.tsx"),
        'import { INTERNAL_BASE } from "../src/shared/contracts/api";\n' +
          "export default async function HomePage() {\n" +
          "  return <main>{INTERNAL_BASE}</main>;\n" +
          "}\n",
        "utf-8",
      );

      const staleResult = await runBuildInSubprocess(staleRoot, "server-page-client-module");
      expect(staleResult.success).toBe(false);
      expect(staleResult.errors.join("\n")).toContain("missing \"use client\"");
      expect(await Bun.file(path.join(staleRoot, ".mandu", "client", "index.island.js")).exists()).toBe(false);
    } finally {
      await rm(staleRoot, { recursive: true, force: true });
    }
  });

  test("rewrites route-component clientModule to the real client import before bundling", async () => {
    const routeClientRoot = await mkRepoTempDir("route-client-import-");
    try {
      await mkdir(path.join(routeClientRoot, "app", "login"), { recursive: true });
      await mkdir(path.join(routeClientRoot, "src", "client", "pages", "login"), { recursive: true });
      await writeFile(
        path.join(routeClientRoot, "package.json"),
        JSON.stringify({ name: "mandu-route-client-import-test", type: "module" }, null, 2),
        "utf-8",
      );
      await writeFile(
        path.join(routeClientRoot, "app", "login", "page.tsx"),
        'import LoginPage from "@/client/pages/login/LoginPage.client";\n' +
          "export default function Page() {\n" +
          "  return <LoginPage />;\n" +
          "}\n",
        "utf-8",
      );
      await writeFile(
        path.join(routeClientRoot, "src", "client", "pages", "login", "LoginPage.client.tsx"),
        '"use client";\n' +
          'import { useState } from "react";\n' +
          "export default function LoginPage() {\n" +
          '  const [email, setEmail] = useState("");\n' +
          '  return <form><input value={email} onChange={(event) => setEmail(event.currentTarget.value)} /></form>;\n' +
          "}\n",
        "utf-8",
      );

      const routeClientResult = await runBuildInSubprocess(routeClientRoot, "server-page-route-client-import");
      expect(routeClientResult.success).toBe(true);
      const bundlePath = path.join(routeClientRoot, ".mandu", "client", "login.island.js");
      expect(await Bun.file(bundlePath).exists()).toBe(true);

      const bundleSource = await readFile(bundlePath, "utf-8");
      expect(bundleSource).not.toContain("var LoginPage = LoginPage;");
      const parseResult = await Bun.build({
        entrypoints: [bundlePath],
        target: "browser",
        external: ["react", "react-dom", "react-dom/client", "react/jsx-dev-runtime"],
      });
      expect(parseResult.success).toBe(true);
    } finally {
      await rm(routeClientRoot, { recursive: true, force: true });
    }
  });

  test("bundles route-level named client exports without requiring a default export", async () => {
    const routeClientRoot = await mkRepoTempDir("route-named-client-import-");
    try {
      await mkdir(path.join(routeClientRoot, "app", "login"), { recursive: true });
      await mkdir(path.join(routeClientRoot, "src", "client", "pages", "login"), { recursive: true });
      await writeFile(
        path.join(routeClientRoot, "package.json"),
        JSON.stringify({ name: "mandu-route-named-client-import-test", type: "module" }, null, 2),
        "utf-8",
      );
      await writeFile(
        path.join(routeClientRoot, "app", "login", "page.tsx"),
        'import { LoginPage } from "@/client/pages/login/LoginPage.client";\n' +
          "export default function Page() {\n" +
          "  return <LoginPage />;\n" +
          "}\n",
        "utf-8",
      );
      await writeFile(
        path.join(routeClientRoot, "src", "client", "pages", "login", "LoginPage.client.tsx"),
        '"use client";\n' +
          'import { useState } from "react";\n' +
          "export function LoginPage() {\n" +
          '  const [email, setEmail] = useState("");\n' +
          '  return <form><input value={email} onChange={(event) => setEmail(event.currentTarget.value)} /></form>;\n' +
          "}\n",
        "utf-8",
      );

      const routeClientResult = await runBuildInSubprocess(routeClientRoot, "server-page-route-named-client-import");
      if (!routeClientResult.success) {
        console.error("[named route client] errors:", routeClientResult.errors);
      }
      expect(routeClientResult.success).toBe(true);
      const bundlePath = path.join(routeClientRoot, ".mandu", "client", "login.island.js");
      expect(await Bun.file(bundlePath).exists()).toBe(true);

      const bundleSource = await readFile(bundlePath, "utf-8");
      expect(bundleSource).toContain("LoginPage");
      expect(bundleSource).not.toContain("Client islands cannot use server-side modules");
      const parseResult = await Bun.build({
        entrypoints: [bundlePath],
        target: "browser",
        external: ["react", "react-dom", "react-dom/client", "react/jsx-dev-runtime"],
      });
      expect(parseResult.success).toBe(true);
    } finally {
      await rm(routeClientRoot, { recursive: true, force: true });
    }
  });

  test("uses Windows-safe asset filenames for locale-prefixed route ids", async () => {
    const localeRoot = await mkRepoTempDir("i18n-locale-route-id-");
    try {
      await mkdir(path.join(localeRoot, "app"), { recursive: true });
      await writeFile(
        path.join(localeRoot, "package.json"),
        JSON.stringify({ name: "mandu-i18n-route-id-test", type: "module" }, null, 2),
        "utf-8",
      );
      await writeFile(
        path.join(localeRoot, "app", "demo.client.tsx"),
        "export default function DemoIsland() { return null; }\n",
        "utf-8",
      );

      const localeResult = await runBuildInSubprocess(localeRoot, "i18n-locale-route-id");
      expect(localeResult.success).toBe(true);
      const bundle = localeResult.manifest?.bundles?.["ko::demo"];
      expect(bundle?.js).toBe("/.mandu/client/ko_3a__3a_demo.island.js");
      expect(bundle?.js).not.toContain(":");
      expect(await Bun.file(path.join(localeRoot, ".mandu", "client", "ko_3a__3a_demo.island.js")).exists()).toBe(true);
    } finally {
      await rm(localeRoot, { recursive: true, force: true });
    }
  });

  test("fails when hydration is enabled but no clientModule can be resolved", async () => {
    const missingRoot = await mkRepoTempDir("hydration-no-client-");
    try {
      await mkdir(path.join(missingRoot, "app", "login"), { recursive: true });
      await mkdir(path.join(missingRoot, "src", "client", "widgets", "login-form"), { recursive: true });
      await writeFile(
        path.join(missingRoot, "package.json"),
        JSON.stringify({ name: "mandu-hydration-no-client-test", type: "module" }, null, 2),
        "utf-8",
      );
      await writeFile(
        path.join(missingRoot, "app", "login", "page.tsx"),
        'import { LoginForm } from "../../src/client/widgets/login-form/LoginForm.client";\n' +
          "export default function LoginPage() {\n" +
          "  return <main><LoginForm /></main>;\n" +
          "}\n",
        "utf-8",
      );
      await writeFile(
        path.join(missingRoot, "src", "client", "widgets", "login-form", "LoginForm.client.tsx"),
        "export function LoginForm() { return <form />; }\n",
        "utf-8",
      );

      const noClientResult = await runBuildInSubprocess(missingRoot, "hydration-no-client-module");
      const errors = noClientResult.errors.join("\n");
      expect(noClientResult.success).toBe(false);
      expect(errors).toContain("no clientModule could be resolved");
      expect(errors).toContain("LoginForm.client");
      expect(errors).toContain("run mandu generate");
    } finally {
      await rm(missingRoot, { recursive: true, force: true });
    }
  });
});

describe("buildClientBundles client boundaries", () => {
  async function createBoundaryFixture(prefix: string): Promise<string> {
    const boundaryRoot = await mkRepoTempDir(prefix);
    await mkdir(path.join(boundaryRoot, "app", "boundary"), { recursive: true });
    await mkdir(path.join(boundaryRoot, "src", "client"), { recursive: true });
    await writeFile(
      path.join(boundaryRoot, "package.json"),
      JSON.stringify({ name: "mandu-boundary-test", type: "module" }, null, 2),
      "utf-8",
    );
    await writeFile(
      path.join(boundaryRoot, "app", "boundary", "page.tsx"),
      "export default function Page() { return null; }\n",
      "utf-8",
    );
    await writeFile(
      path.join(boundaryRoot, "src", "client", "BoundaryWidget.client.tsx"),
      `
        import React from "react";

        export default function WrongDefault({ label }) {
          return React.createElement("p", null, "default:" + label);
        }

        export function BoundaryWidget({ label }) {
          return React.createElement("button", null, "named:" + label);
        }
      `,
      "utf-8",
    );
    return boundaryRoot;
  }

  test("emits boundary bundle manifest entries", async () => {
    const boundaryRoot = await createBoundaryFixture("bundler-boundary-");
    try {
      const boundaryResult = await runBuildInSubprocess(boundaryRoot, "client-boundary");

      if (!boundaryResult.success) {
        console.error("[build.test boundary] errors:", boundaryResult.errors);
      }
      expect(boundaryResult.success).toBe(true);
      expect(boundaryResult.manifest?.boundaries?.["boundary-demo--0"]).toMatchObject({
        route: "boundary-demo",
        module: "src/client/BoundaryWidget.client.tsx",
        exportName: "BoundaryWidget",
        hydrate: "visible",
      });
      expect(boundaryResult.manifest?.boundaries?.["boundary-demo--0"]?.js).toMatch(
        /^\/\.mandu\/client\/boundary-demo--0\.boundary\.js$/,
      );
      expect(boundaryResult.manifest?.bundles?.["boundary-demo"]).toBeUndefined();

      const refreshGlobal = globalThis as typeof globalThis & {
        $RefreshReg$?: unknown;
        $RefreshSig$?: unknown;
      };
      refreshGlobal.$RefreshReg$ = () => {};
      refreshGlobal.$RefreshSig$ = () => (type: unknown) => type;
      try {
        const boundaryBundle = await import(
          `${pathToFileURL(path.join(boundaryRoot, ".mandu", "client", "boundary-demo--0.boundary.js")).href}?t=${Date.now()}`
        );
        const React = await import("react");
        const { renderToStaticMarkup } = await import("react-dom/server");

        expect(typeof boundaryBundle.default).toBe("function");
        expect(typeof boundaryBundle.BoundaryWidget).toBe("function");
        expect(renderToStaticMarkup(React.createElement(boundaryBundle.default, { label: "ok" }))).toContain("named:ok");
        expect(renderToStaticMarkup(React.createElement(boundaryBundle.BoundaryWidget, { label: "ok" }))).toContain("named:ok");
      } finally {
        delete refreshGlobal.$RefreshReg$;
        delete refreshGlobal.$RefreshSig$;
      }
    } finally {
      await rm(boundaryRoot, { recursive: true, force: true });
    }
  });

  test("snapshots route and bundle boundary metadata", async () => {
    const boundaryRoot = await createBoundaryFixture("bundler-boundary-snapshot-");
    try {
      const boundaryResult = await runBuildInSubprocess(boundaryRoot, "client-boundary");
      expect(boundaryResult.success).toBe(true);

      toMatchSnapshot(
        {
          routes: boundaryResult.manifest?.routes?.map((route) => ({
            id: route.id,
            module: route.module,
            componentModule: route.componentModule,
            boundaries: route.boundaries,
          })),
          bundleBoundaries: boundaryResult.manifest?.boundaries,
        },
        {
          testFile: path.join(import.meta.dir, "build.test.ts"),
          name: "client boundary manifest metadata",
        },
      );
    } finally {
      await rm(boundaryRoot, { recursive: true, force: true });
    }
  });

  test("updates boundary manifest entries in target-route builds", async () => {
    const boundaryRoot = await createBoundaryFixture("bundler-boundary-target-");
    try {
      const boundaryResult = await runBuildInSubprocess(boundaryRoot, "client-boundary-target");
      expect(boundaryResult.success).toBe(true);
      expect(boundaryResult.manifest?.boundaries?.["boundary-demo--0"]?.js).toBe(
        "/.mandu/client/boundary-demo--0.boundary.js",
      );
    } finally {
      await rm(boundaryRoot, { recursive: true, force: true });
    }
  });

  test("fails before manifest generation when boundary ids are duplicated", async () => {
    const boundaryRoot = await createBoundaryFixture("bundler-boundary-duplicate-");
    try {
      const boundaryResult = await runBuildInSubprocess(boundaryRoot, "client-boundary-duplicate-id");

      expect(boundaryResult.success).toBe(false);
      expect(boundaryResult.errors.join("\n")).toContain("MANDU_BOUNDARY_DUPLICATE_ID");
      expect(boundaryResult.errors.join("\n")).toContain("boundary-demo--0");
    } finally {
      await rm(boundaryRoot, { recursive: true, force: true });
    }
  });

  test("updates boundary manifest entries when framework bundles are skipped", async () => {
    const boundaryRoot = await createBoundaryFixture("bundler-boundary-skip-");
    try {
      const boundaryResult = await runBuildInSubprocess(boundaryRoot, "client-boundary-skip-framework");
      expect(boundaryResult.success).toBe(true);
      expect(boundaryResult.manifest?.boundaries?.["boundary-demo--0"]?.js).toBe(
        "/.mandu/client/boundary-demo--0.boundary.js",
      );
    } finally {
      await rm(boundaryRoot, { recursive: true, force: true });
    }
  });

  test("builds manifest-generated boundaries from route-owned server wrappers", async () => {
    const boundaryRoot = await mkRepoTempDir("bundler-boundary-generated-wrapper-");
    try {
      await mkdir(path.join(boundaryRoot, "app", "account", "components"), { recursive: true });
      await writeFile(
        path.join(boundaryRoot, "package.json"),
        JSON.stringify({ name: "mandu-boundary-generated-wrapper-test", type: "module" }, null, 2),
        "utf-8",
      );
      await writeFile(
        path.join(boundaryRoot, "app", "account", "page.tsx"),
        `
          import { AccountShell } from "./components/AccountShell";

          export default function Page() {
            return <main><AccountShell name="Ada" /></main>;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(boundaryRoot, "app", "account", "components", "AccountShell.tsx"),
        `
          import { AccountCard } from "./AccountCard.client";

          export function AccountShell({ name }) {
            return <AccountCard name={name} />;
          }
        `,
        "utf-8",
      );
      await writeFile(
        path.join(boundaryRoot, "app", "account", "components", "AccountCard.client.tsx"),
        `
          import React from "react";
          export function AccountCard({ name }) {
            return React.createElement("button", null, name);
          }
        `,
        "utf-8",
      );

      const boundaryResult = await runBuildInSubprocess(boundaryRoot, "client-boundary-generated-transitive");

      if (!boundaryResult.success) {
        console.error("[build.test generated boundary] errors:", boundaryResult.errors);
      }
      expect(boundaryResult.success).toBe(true);
      expect(boundaryResult.manifest?.boundaries?.["account--0"]).toMatchObject({
        route: "account",
        module: "app/account/components/AccountCard.client.tsx",
        exportName: "AccountCard",
        hydrate: "visible",
      });
      expect(boundaryResult.manifest?.boundaries?.["account--0"]?.js).toBe(
        "/.mandu/client/account--0.boundary.js",
      );
      expect(boundaryResult.manifest?.bundles?.account).toBeUndefined();
      expect(await Bun.file(path.join(boundaryRoot, ".mandu", "client", "account--0.boundary.js")).exists()).toBe(true);
    } finally {
      await rm(boundaryRoot, { recursive: true, force: true });
    }
  });
});
