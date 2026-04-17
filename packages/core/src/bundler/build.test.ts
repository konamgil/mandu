import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import type { RoutesManifest } from "../spec/schema";
import type { BundleResult } from "./types";
import { buildClientBundles } from "./build";

// 모든 테스트가 하나의 빌드 결과를 공유 — 병렬 Bun.build 충돌 방지
let rootDir: string;
let result: BundleResult;

async function importBuiltModule(relativePath: string): Promise<Record<string, unknown>> {
  const fileUrl = pathToFileURL(path.join(rootDir, relativePath)).href;
  return import(`${fileUrl}?t=${Date.now()}`);
}

beforeAll(async () => {
  rootDir = await mkdtemp(path.join(import.meta.dir, ".tmp-bundler-"));

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

  const manifest: RoutesManifest = {
    version: 1,
    routes: [
      {
        id: "demo",
        kind: "page",
        pattern: "/",
        module: "app/page.tsx",
        componentModule: "app/page.tsx",
        clientModule: "app/demo.client.tsx",
        hydration: {
          strategy: "island",
          priority: "visible",
          preload: false,
        },
      },
    ],
  };

  result = await buildClientBundles(manifest, rootDir, {
    minify: false,
    sourcemap: false,
    splitting: false,
  });
});

afterAll(async () => {
  if (rootDir) {
    await rm(rootDir, { recursive: true, force: true });
  }
});

// Bun.build has observed cross-worker races under bun:test's parallel file
// execution — when tests shuffle under --randomize, this file sometimes
// collides with another bundler test in a sibling worker and fails with
// "AggregateError: Bundle failed" + missing shim outputs. Gate on an env
// var so CI can run randomize-mode across everything else, then run this
// suite in a dedicated serial pass. Local `bun run test:core` (no env set)
// still runs these tests fully. Tracked as Phase 0.6.
describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")("buildClientBundles vendor shims", () => {
  test("build succeeds", () => {
    if (!result.success) {
      console.error("[build.test] errors:", result.errors);
    }
    expect(result.success).toBe(true);
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
    expect(runtimeSource).toContain("pointerdown");
  });
});
