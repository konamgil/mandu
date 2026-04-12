/**
 * mandu build - Client bundle build
 *
 * Bundles Islands that require hydration.
 * Also builds CSS for Tailwind v4 projects.
 */

import {
  buildClientBundles,
  printBundleStats,
  validateAndReport,
  isTailwindProject,
  buildCSS,
  startServer,
  type RoutesManifest,
} from "@mandujs/core";
import { prerenderRoutes } from "../../../core/src/bundler/prerender";
import path from "path";
import fs from "fs/promises";
import { resolveManifest } from "../util/manifest";
import { registerManifestHandlers } from "../util/handlers";

export interface BuildOptions {
  /** Code minification (default: true in production) */
  minify?: boolean;
  /** Generate source maps */
  sourcemap?: boolean;
  /** Watch mode */
  watch?: boolean;
  /** Output directory */
  outDir?: string;
}

export async function build(options: BuildOptions = {}): Promise<boolean> {
  const cwd = process.cwd();

  console.log("📦 Mandu Build - Client Bundle Builder\n");

  const config = await validateAndReport(cwd);
  if (!config) {
    return false;
  }
  const buildConfig = config.build ?? {};

  // 1. Load route manifest (FS Routes first)
  let manifest: Awaited<ReturnType<typeof resolveManifest>>["manifest"];
  try {
    const resolved = await resolveManifest(cwd, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;
    console.log(`✅ Routes loaded (${resolved.source}): ${manifest.routes.length} route(s)`);
  } catch (error) {
    console.error("❌ Failed to load routes:");
    console.error(`   ${error instanceof Error ? error.message : error}`);
    return false;
  }

  // 2. Tailwind CSS build (runs first regardless of Island presence)
  const hasTailwind = await isTailwindProject(cwd);
  const resolvedMinify = options.minify ?? buildConfig.minify ?? true;

  if (hasTailwind) {
    console.log(`\n🎨 Building Tailwind CSS v4...`);
    const cssResult = await buildCSS({
      rootDir: cwd,
      minify: resolvedMinify,
    });

    if (!cssResult.success) {
      console.error(`\n❌ CSS build failed: ${cssResult.error}`);
      return false;
    }

    console.log(`   ✅ CSS build complete (${cssResult.buildTime?.toFixed(0)}ms)`);
    console.log(`   Output: ${cssResult.outputPath}`);
  }

  // 3. Check routes that require hydration
  const hydratedRoutes = manifest.routes.filter(
    (route) =>
      route.kind === "page" &&
      route.clientModule &&
      (!route.hydration || route.hydration.strategy !== "none")
  );

  if (hydratedRoutes.length === 0) {
    console.log("\n📭 No routes require hydration.");
    console.log("   (no clientModule or hydration.strategy: none)");

    // Treat as success even if only CSS was built
    if (hasTailwind) {
      console.log(`\n✅ CSS build complete`);
      console.log(`   CSS: .mandu/client/globals.css`);
    }
    return true;
  }

  console.log(`\n🏝️  Building ${hydratedRoutes.length} Island(s)...`);
  for (const route of hydratedRoutes) {
    const hydration = route.hydration || { strategy: "island", priority: "visible" };
    console.log(`   - ${route.id} (${hydration.strategy}, ${hydration.priority || "visible"})`);
  }

  // 4. Bundle build
  const startTime = performance.now();
  const resolvedBuildOptions: BuildOptions = {
    minify: options.minify ?? buildConfig.minify,
    sourcemap: options.sourcemap ?? buildConfig.sourcemap,
    outDir: options.outDir ?? buildConfig.outDir,
  };
  const result = await buildClientBundles(manifest, cwd, resolvedBuildOptions);

  // 5. Print results
  console.log("");
  printBundleStats(result);

  if (!result.success) {
    console.error("\n❌ Build failed");
    return false;
  }

  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log(`\n✅ Build complete (${elapsed}ms)`);
  console.log(`   Output: .mandu/client/`);
  if (hasTailwind) {
    console.log(`   CSS: .mandu/client/globals.css`);
  }

  // 5.5. Prerendering (SSG) — 정적 페이지를 HTML로 사전 생성
  const staticRoutes = manifest.routes.filter(
    r => r.kind === "page" && !r.pattern.includes(":")
  );
  const hasDynamicWithStaticParams = manifest.routes.some(
    r => r.kind === "page" && r.pattern.includes(":") // generateStaticParams 가능
  );

  if (staticRoutes.length > 0 || hasDynamicWithStaticParams) {
    console.log("\n📄 Prerendering static pages...");

    try {
      // 임시 서버 시작 (SSR 렌더링용 — 외부 접근 불가하도록 port 0)
      const cssPath = hasTailwind ? "/.mandu/client/globals.css" : false;
      await registerManifestHandlers(manifest, cwd, {
        importFn: (p: string) => import(p),
        registeredLayouts: new Set(),
      });
      const tempServer = startServer(manifest, {
        port: 0,
        rootDir: cwd,
        isDev: false,
        bundleManifest: result.manifest,
        cssPath,
      });

      // fetchHandler 추출 — 서버의 내부 핸들러로 프리렌더
      const fetchHandler = async (req: Request) => {
        const url = new URL(req.url);
        const targetUrl = `http://localhost:${tempServer.server.port}${url.pathname}${url.search}`;
        return fetch(targetUrl);
      };

      const prerenderResult = await prerenderRoutes(manifest, fetchHandler, {
        rootDir: cwd,
        crawl: true,
      });

      tempServer.stop();

      if (prerenderResult.generated > 0) {
        console.log(`   ✅ ${prerenderResult.generated} page(s) prerendered`);
        for (const page of prerenderResult.pages) {
          const sizeKB = (page.size / 1024).toFixed(1);
          console.log(`      ${page.path} (${sizeKB} KB, ${page.duration}ms)`);
        }
      }
      if (prerenderResult.errors.length > 0) {
        console.warn(`   ⚠️  ${prerenderResult.errors.length} error(s):`);
        for (const err of prerenderResult.errors) {
          console.warn(`      ${err}`);
        }
      }
    } catch (error) {
      console.warn("   ⚠️  Prerendering skipped:", error instanceof Error ? error.message : String(error));
    }
  }

  // 6. Watch mode
  if (options.watch) {
    console.log("\n👀 Watch mode...");
    console.log("   Press Ctrl+C to stop\n");

    await watchAndRebuild(cwd, resolvedBuildOptions, { fsRoutes: config.fsRoutes });
  }

  return true;
}

/**
 * Watch files and rebuild
 * FS Routes project: watches island files in app/ directory
 *
 * Re-invokes resolveManifest on each file change so that newly
 * added/deleted routes are reflected in the bundle.
 */
async function watchAndRebuild(
  rootDir: string,
  options: BuildOptions,
  resolveOptions: Parameters<typeof resolveManifest>[1] = {}
): Promise<void> {
  // Watch app/ for route changes, spec/slots/ for slot changes
  const fsRoutesDir = path.join(rootDir, "app");
  const slotsDir = path.join(rootDir, "spec", "slots");

  let watchDir: string;
  let watchMode: "fs-routes" | "slots";

  try {
    await fs.access(fsRoutesDir);
    watchDir = fsRoutesDir;
    watchMode = "fs-routes";
  } catch {
    try {
      await fs.access(slotsDir);
      watchDir = slotsDir;
      watchMode = "slots";
    } catch {
      console.warn(`⚠️  No directory to watch (app/ or spec/slots/)`);
      return;
    }
  }

  console.log(`👀 Watching: ${watchDir}`);

  const { watch } = await import("fs");

  const watcher = watch(watchDir, { recursive: true }, async (event, filename) => {
    if (!filename) return;

    const normalizedFilename = filename.replace(/\\/g, "/");

    // FS Routes: detect island file changes
    if (watchMode === "fs-routes") {
      const isIslandFile =
        normalizedFilename.endsWith(".island.tsx") ||
        normalizedFilename.endsWith(".island.ts") ||
        normalizedFilename.endsWith(".island.jsx") ||
        normalizedFilename.endsWith(".island.js");
      // Detect root level (page.tsx) and nested paths (/nested/page.tsx), including .js/.jsx
      const isPageFile = /(?:^|\/)page\.[jt]sx?$/.test(normalizedFilename);

      if (!isIslandFile && !isPageFile) return;
    } else {
      // Slots: watch only .client.ts files
      if (!normalizedFilename.endsWith(".client.ts")) return;
    }

    console.log(`\n🔄 Change detected: ${normalizedFilename}`);

    try {
      // Re-resolve manifest on each rebuild to reflect added/deleted files
      const { manifest: freshManifest } = await resolveManifest(rootDir, resolveOptions);

      const result = await buildClientBundles(freshManifest, rootDir, {
        minify: options.minify,
        sourcemap: options.sourcemap,
        outDir: options.outDir,
      });

      if (result.success) {
        console.log(`✅ Rebuild complete`);
      } else {
        console.error(`❌ Rebuild failed`);
        for (const error of result.errors) {
          console.error(`   ${error}`);
        }
      }
    } catch (error) {
      console.error(`❌ Rebuild error: ${error}`);
    }
  });

  // Cleanup on exit
  process.on("SIGINT", () => {
    console.log("\n\n👋 Build watch stopped");
    watcher.close();
    process.exit(0);
  });

  // Wait indefinitely
  await new Promise(() => {});
}
