import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import os from "os";
import path from "path";
import fs from "fs/promises";
import type { RoutesManifest } from "../../spec/schema";
import { buildClientBundles } from "../build";
import {
  __clearBuildGenerationCacheForTests,
  beginBuildGeneration,
  failBuildGeneration,
  publishBuildGeneration,
  readActiveBuildGeneration,
  resolveActiveBuildArtifacts,
  runSerializedClientBuild,
  scopeBundleManifestToGeneration,
} from "../generation";
import { serveStaticFile } from "../../runtime/static-files";

const EMPTY_ROUTES: RoutesManifest = {
  version: 1,
  routes: [],
};

describe("atomic client build generations", () => {
  let rootDir = "";

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-generation-"));
    await fs.mkdir(path.join(rootDir, ".mandu", "client"), { recursive: true });
    await fs.writeFile(path.join(rootDir, ".mandu", "client", "runtime.js"), "legacy-good");
    await fs.writeFile(
      path.join(rootDir, ".mandu", "manifest.json"),
      JSON.stringify({
        version: 1,
        buildTime: "2026-08-13T00:00:00.000Z",
        env: "development",
        bundles: {},
        shared: { runtime: "/.mandu/client/runtime.js", vendor: "" },
      }),
    );
    __clearBuildGenerationCacheForTests();
  });

  afterEach(async () => {
    __clearBuildGenerationCacheForTests();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  test("publishes the complete generation and updates compatibility artifacts", async () => {
    const generation = await beginBuildGeneration(rootDir);
    await fs.writeFile(path.join(generation.clientDir, "runtime.js"), "generation-good");
    await fs.writeFile(
      generation.manifestPath,
      JSON.stringify({
        version: 1,
        generationId: generation.id,
        buildTime: "2026-08-13T00:00:01.000Z",
        env: "development",
        bundles: {},
        shared: { runtime: "/.mandu/client/runtime.js", vendor: "" },
      }),
    );

    const pointer = await publishBuildGeneration(generation);
    const active = await resolveActiveBuildArtifacts(rootDir);

    expect(pointer.generationId).toBe(generation.id);
    expect(active.source).toBe("generation");
    expect(active.generationId).toBe(generation.id);
    expect(await fs.readFile(path.join(active.clientDir, "runtime.js"), "utf8")).toBe(
      "generation-good",
    );
    expect(
      await fs.readFile(path.join(rootDir, ".mandu", "client", "runtime.js"), "utf8"),
    ).toBe("generation-good");

    const manifest = JSON.parse(
      await fs.readFile(path.join(rootDir, ".mandu", "manifest.json"), "utf8"),
    ) as { generationId?: string };
    expect(manifest.generationId).toBe(generation.id);
  });

  test("failed generation keeps the active and compatibility artifacts unchanged", async () => {
    const first = await buildClientBundles(EMPTY_ROUTES, rootDir, { mode: "production" });
    expect(first.success).toBe(true);
    const activeBefore = await readActiveBuildGeneration(rootDir);
    expect(activeBefore?.generationId).toBe(first.manifest.generationId);

    await fs.mkdir(path.join(rootDir, "app"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, "app", "page.tsx"),
      "export default function Page() { return null; }\n",
    );
    const brokenManifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          id: "broken",
          kind: "page",
          pattern: "/",
          module: "app/page.tsx",
          componentModule: "app/page.tsx",
          clientModule: "app/page.tsx",
          hydration: { strategy: "island", priority: "visible", preload: false },
        },
      ],
    };

    const failed = await buildClientBundles(brokenManifest, rootDir, { mode: "production" });
    const activeAfter = await readActiveBuildGeneration(rootDir);
    const state = JSON.parse(
      await fs.readFile(path.join(rootDir, ".mandu", "build-state.json"), "utf8"),
    ) as { activeGenerationId: string | null; lastAttempt: { status: string } };

    expect(failed.success).toBe(false);
    expect(failed.errors.join("\n")).toContain('missing "use client"');
    expect(failed.manifest.generationId).toBe(activeBefore?.generationId);
    expect(activeAfter?.generationId).toBe(activeBefore?.generationId);
    expect(state.activeGenerationId).toBe(activeBefore?.generationId ?? null);
    expect(state.lastAttempt.status).toBe("failed");
    expect(
      await fs.readFile(path.join(rootDir, ".mandu", "client", "runtime.js"), "utf8"),
    ).toBe("legacy-good");
  });

  test("static serving ignores a poisoned compatibility JS file", async () => {
    const generation = await beginBuildGeneration(rootDir);
    await fs.writeFile(path.join(generation.clientDir, "runtime.js"), "active-generation");
    await fs.writeFile(path.join(generation.clientDir, "globals.css"), "generation-css");
    await fs.writeFile(
      generation.manifestPath,
      JSON.stringify({
        version: 1,
        generationId: generation.id,
        buildTime: "2026-08-13T00:00:01.000Z",
        env: "development",
        bundles: {},
        shared: { runtime: "/.mandu/client/runtime.js", vendor: "" },
      }),
    );
    await publishBuildGeneration(generation);

    await fs.writeFile(path.join(rootDir, ".mandu", "client", "runtime.js"), "poisoned");
    await fs.writeFile(path.join(rootDir, ".mandu", "client", "globals.css"), "watcher-css");

    const js = await serveStaticFile(
      "/.mandu/client/runtime.js",
      { rootDir, publicDir: "public", isDev: true },
    );
    const css = await serveStaticFile(
      "/.mandu/client/globals.css",
      { rootDir, publicDir: "public", isDev: true },
    );

    expect(await js.response?.text()).toBe("active-generation");
    expect(js.response?.headers.get("X-Mandu-Build-Generation")).toBe(generation.id);
    expect(await css.response?.text()).toBe("watcher-css");
    expect(css.response?.headers.get("X-Mandu-Build-Generation")).toBeNull();
  });

  test("unscoped legacy-only assets fall back without weakening scoped generation URLs", async () => {
    const generation = await beginBuildGeneration(rootDir);
    await fs.writeFile(path.join(generation.clientDir, "runtime.js"), "active-generation");
    await fs.writeFile(
      generation.manifestPath,
      JSON.stringify({
        version: 1,
        generationId: generation.id,
        buildTime: "2026-08-13T00:00:01.000Z",
        env: "development",
        bundles: {},
        shared: { runtime: "/.mandu/client/runtime.js", vendor: "" },
      }),
    );
    await publishBuildGeneration(generation);
    await fs.writeFile(
      path.join(rootDir, ".mandu", "client", "compat-only.js"),
      "compatibility-module",
    );

    const unscoped = await serveStaticFile(
      "/.mandu/client/compat-only.js",
      { rootDir, publicDir: "public", isDev: true },
    );
    const scoped = await serveStaticFile(
      "/.mandu/client/compat-only.js",
      { rootDir, publicDir: "public", isDev: true },
      new Request(
        `http://mandu.test/.mandu/client/compat-only.js?g=${generation.id}`,
      ),
    );

    expect(await unscoped.response?.text()).toBe("compatibility-module");
    expect(unscoped.response?.headers.get("X-Mandu-Build-Generation")).toBeNull();
    expect(scoped.response?.status).toBe(404);
  });

  test("an older document can still load every asset from its own generation", async () => {
    const first = await beginBuildGeneration(rootDir);
    await fs.writeFile(path.join(first.clientDir, "runtime.js"), "generation-one");
    await fs.writeFile(
      first.manifestPath,
      JSON.stringify({
        version: 1,
        generationId: first.id,
        buildTime: "2026-08-13T00:00:01.000Z",
        env: "development",
        bundles: {},
        shared: { runtime: "/.mandu/client/runtime.js", vendor: "" },
      }),
    );
    await publishBuildGeneration(first);

    const second = await beginBuildGeneration(rootDir);
    await fs.writeFile(path.join(second.clientDir, "runtime.js"), "generation-two");
    await fs.writeFile(
      second.manifestPath,
      JSON.stringify({
        version: 1,
        generationId: second.id,
        buildTime: "2026-08-13T00:00:02.000Z",
        env: "development",
        bundles: {},
        shared: { runtime: "/.mandu/client/runtime.js", vendor: "" },
      }),
    );
    await publishBuildGeneration(second);

    const oldAsset = await serveStaticFile(
      "/.mandu/client/runtime.js",
      { rootDir, publicDir: "public", isDev: true },
      new Request(`http://mandu.test/.mandu/client/runtime.js?g=${first.id}`),
    );
    const activeAsset = await serveStaticFile(
      "/.mandu/client/runtime.js",
      { rootDir, publicDir: "public", isDev: true },
      new Request("http://mandu.test/.mandu/client/runtime.js"),
    );
    const unknownAsset = await serveStaticFile(
      "/.mandu/client/runtime.js",
      { rootDir, publicDir: "public", isDev: true },
      new Request("http://mandu.test/.mandu/client/runtime.js?g=missing-generation"),
    );

    expect(await oldAsset.response?.text()).toBe("generation-one");
    expect(oldAsset.response?.headers.get("X-Mandu-Build-Generation")).toBe(first.id);
    expect(await activeAsset.response?.text()).toBe("generation-two");
    expect(activeAsset.response?.headers.get("X-Mandu-Build-Generation")).toBe(second.id);
    expect(unknownAsset.response?.status).toBe(404);
  });

  test("scopes all framework-owned manifest URLs without mutating the disk shape", () => {
    const manifest = {
      version: 1,
      generationId: "generation-123",
      buildTime: "2026-08-13T00:00:01.000Z",
      env: "development" as const,
      bundles: {
        home: {
          js: "/.mandu/client/home.js",
          css: "/.mandu/client/home.css",
          dependencies: [],
          priority: "visible" as const,
        },
      },
      islands: {
        card: {
          js: "/.mandu/client/card.js",
          route: "home",
          priority: "visible" as const,
        },
      },
      shared: {
        runtime: "/.mandu/client/runtime.js",
        vendor: "/.mandu/client/vendor.js",
        router: "/.mandu/client/router.js",
      },
      importMap: {
        imports: {
          react: "/.mandu/client/vendor.js",
          external: "external-package",
        },
      },
    };

    const scoped = scopeBundleManifestToGeneration(manifest)!;

    expect(scoped.bundles.home.js).toBe(
      "/.mandu/client/home.js?g=generation-123",
    );
    expect(scoped.bundles.home.css).toBe(
      "/.mandu/client/home.css?g=generation-123",
    );
    expect(scoped.islands?.card.js).toBe(
      "/.mandu/client/card.js?g=generation-123",
    );
    expect(scoped.shared.runtime).toBe(
      "/.mandu/client/runtime.js?g=generation-123",
    );
    expect(scoped.importMap?.imports.react).toBe(
      "/.mandu/client/vendor.js?g=generation-123",
    );
    expect(scoped.importMap?.imports.external).toBe("external-package");
    expect(manifest.bundles.home.js).toBe("/.mandu/client/home.js");
  });

  test("serializes client builds for the same project root", async () => {
    let active = 0;
    let maxActive = 0;
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map((id) =>
        runSerializedClientBuild(rootDir, async () => {
          active++;
          maxActive = Math.max(maxActive, active);
          order.push(id);
          await Bun.sleep(5);
          active--;
        }),
      ),
    );

    expect(maxActive).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  test("records an explicit failed attempt without publishing it", async () => {
    const generation = await beginBuildGeneration(rootDir);
    await fs.writeFile(path.join(generation.clientDir, "runtime.js"), "partial-output");
    await failBuildGeneration(generation, ["synthetic failure"]);

    expect(await readActiveBuildGeneration(rootDir)).toBeNull();
    expect(await Bun.file(generation.stagingRoot).exists()).toBe(false);
    expect(
      await fs.readFile(path.join(rootDir, ".mandu", "client", "runtime.js"), "utf8"),
    ).toBe("legacy-good");
  });

  test("100 injected build failures expose zero mixed generations", async () => {
    const baseline = await beginBuildGeneration(rootDir);
    await fs.writeFile(path.join(baseline.clientDir, "runtime.js"), "baseline");
    await fs.writeFile(path.join(baseline.clientDir, "home.js"), "baseline");
    await fs.writeFile(
      baseline.manifestPath,
      JSON.stringify({
        version: 1,
        generationId: baseline.id,
        buildTime: "2026-08-13T00:00:01.000Z",
        env: "development",
        bundles: {
          home: {
            js: "/.mandu/client/home.js",
            dependencies: [],
            priority: "visible",
          },
        },
        shared: { runtime: "/.mandu/client/runtime.js", vendor: "" },
      }),
    );
    await publishBuildGeneration(baseline);

    for (let attempt = 0; attempt < 100; attempt++) {
      const failed = await beginBuildGeneration(rootDir);
      await fs.writeFile(
        path.join(failed.clientDir, "runtime.js"),
        `candidate-${attempt}`,
      );
      if (attempt % 2 === 0) {
        await fs.rm(path.join(failed.clientDir, "home.js"), { force: true });
      }
      await failBuildGeneration(failed, [`injected failure ${attempt}`]);

      const [runtime, home] = await Promise.all([
        serveStaticFile(
          "/.mandu/client/runtime.js",
          { rootDir, publicDir: "public", isDev: true },
        ),
        serveStaticFile(
          "/.mandu/client/home.js",
          { rootDir, publicDir: "public", isDev: true },
        ),
      ]);
      expect(await runtime.response?.text()).toBe("baseline");
      expect(await home.response?.text()).toBe("baseline");
      expect(runtime.response?.headers.get("X-Mandu-Build-Generation")).toBe(
        baseline.id,
      );
      expect(home.response?.headers.get("X-Mandu-Build-Generation")).toBe(
        baseline.id,
      );
    }
  }, 60_000);
});
