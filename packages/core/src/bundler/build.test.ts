import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import type { RoutesManifest } from "../spec/schema";
import { buildClientBundles } from "./build";

const tempDirs: string[] = [];

async function createBundlerFixture(): Promise<{ rootDir: string; manifest: RoutesManifest }> {
  const rootDir = await mkdtemp(path.join(import.meta.dir, ".tmp-bundler-"));
  tempDirs.push(rootDir);

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

  return { rootDir, manifest };
}

async function importBuiltModule(rootDir: string, relativePath: string): Promise<Record<string, unknown>> {
  const fileUrl = pathToFileURL(path.join(rootDir, relativePath)).href;
  return import(`${fileUrl}?t=${Date.now()}`);
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("buildClientBundles vendor shims", () => {
  test("re-exports modern React 19 APIs used by islands", async () => {
    const { rootDir, manifest } = await createBundlerFixture();
    const result = await buildClientBundles(manifest, rootDir, {
      minify: false,
      sourcemap: false,
      splitting: false,
    });

    expect(result.success).toBe(true);

    const reactShim = await importBuiltModule(rootDir, ".mandu/client/_react.js");
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
    const { rootDir, manifest } = await createBundlerFixture();
    const result = await buildClientBundles(manifest, rootDir, {
      minify: false,
      sourcemap: false,
      splitting: false,
    });

    expect(result.success).toBe(true);

    const reactDomShim = await importBuiltModule(rootDir, ".mandu/client/_react-dom.js");
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

    const reactDomClientShim = await importBuiltModule(rootDir, ".mandu/client/_react-dom-client.js");
    for (const exportName of ["createRoot", "hydrateRoot", "version"]) {
      expect(exportName in reactDomClientShim).toBe(true);
    }
  });

  test("embeds hydration guards for deferred trigger strategies", async () => {
    const { rootDir, manifest } = await createBundlerFixture();
    const result = await buildClientBundles(manifest, rootDir, {
      minify: false,
      sourcemap: false,
      splitting: false,
    });

    expect(result.success).toBe(true);

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
