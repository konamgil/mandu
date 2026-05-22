import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

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
    bundles?: Record<string, { js?: string }>;
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
    expect(runtimeSource).toContain("deserializeManduProps");
    expect(runtimeSource).toContain("new Date");
    expect(runtimeSource).toContain("new Map");
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
