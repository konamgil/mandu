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
  runHook,
  type RoutesManifest,
  type BundleManifest,
  type ServerOptions,
} from "@mandujs/core";
import { prerenderRoutes } from "@mandujs/core/bundler/prerender";
import path from "path";
import fs from "fs/promises";
import { resolveManifest } from "../util/manifest";
import { registerManifestHandlers } from "../util/handlers";
import { createBuildSummaryRows, renderBuildSummaryTable } from "../util/build-summary";

export interface BuildOptions {
  /** Code minification (default: true in production) */
  minify?: boolean;
  /** Generate source maps */
  sourcemap?: boolean;
  /** Watch mode */
  watch?: boolean;
  /** Output directory */
  outDir?: string;
  /**
   * Deployment target. Leave undefined for the default Bun/Node adapter.
   *
   *   - `"workers"`      — Cloudflare Workers (`.mandu/workers/worker.js` + `wrangler.toml`)
   *   - `"deno"`         — Deno Deploy (`.mandu/deno/server.ts` + `deno.json`)
   *   - `"vercel-edge"`  — Vercel Edge Functions (`api/_mandu.ts` + `vercel.json`)
   *   - `"netlify-edge"` — Netlify Edge Functions (`netlify/edge-functions/ssr.ts` + `netlify.toml`)
   */
  target?: "workers" | "deno" | "vercel-edge" | "netlify-edge";
  /**
   * Override the Worker project name (defaults to the host `package.json`
   * `name` field, lowered and slugified). Used only by `--target=workers`.
   */
  workerName?: string;
  /**
   * Override the project name for Deno/Vercel/Netlify edge targets.
   * Defaults to the host `package.json` `name` field, slugified.
   */
  projectName?: string;
}

export async function build(options: BuildOptions = {}): Promise<boolean> {
  const cwd = process.cwd();

  console.log("📦 Mandu Build - Client Bundle Builder\n");

  const config = await validateAndReport(cwd);
  if (!config) {
    return false;
  }
  const buildConfig = config.build ?? {};
  const serverConfig = config.server ?? {};
  const adapter = config.adapter;
  const plugins = config.plugins ?? [];
  const hooks = config.hooks;

  await runHook("onBeforeBuild", plugins, hooks);

  const buildStartTime = performance.now();

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

  const cssPath = hasTailwind ? "/.mandu/client/globals.css" : false;
  let bundleManifest: BundleManifest | undefined;
  const resolvedBuildOptions: BuildOptions = {
    minify: options.minify ?? buildConfig.minify,
    sourcemap: options.sourcemap ?? buildConfig.sourcemap,
    outDir: options.outDir ?? buildConfig.outDir,
  };

  if (hydratedRoutes.length === 0) {
    console.log("\n📭 No routes require hydration.");
    console.log("   (no clientModule or hydration.strategy: none)");
    // Pure-SSR projects still need `.mandu/manifest.json` for `mandu start`
    // to boot. Emit a stub manifest with empty bundles — the start path reads
    // it only for bundle asset lookup, which is a no-op when nothing hydrates.
    const stubManifest: BundleManifest = {
      version: 1,
      buildTime: new Date().toISOString(),
      env: "production",
      bundles: {},
      shared: { runtime: "", vendor: "" },
      importMap: { imports: {} },
    };
    const manifestPath = path.join(cwd, ".mandu/manifest.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(stubManifest, null, 2));
    bundleManifest = stubManifest;
  } else {
    console.log(`\n🏝️  Building ${hydratedRoutes.length} Island(s)...`);
    for (const route of hydratedRoutes) {
      const hydration = route.hydration || { strategy: "island", priority: "visible" };
      console.log(`   - ${route.id} (${hydration.strategy}, ${hydration.priority || "visible"})`);
    }

    // 4. Bundle build
    const startTime = performance.now();
    const result = await buildClientBundles(manifest, cwd, resolvedBuildOptions);

    // 5. Print results
    console.log("");
    printBundleStats(result);

    if (!result.success) {
      console.error("\n❌ Build failed");
      await runHook("onAfterBuild", plugins, hooks, {
        success: false,
        duration: Math.round(performance.now() - buildStartTime),
      });
      return false;
    }

    bundleManifest = result.manifest;
    const elapsed = (performance.now() - startTime).toFixed(0);
    console.log(`\n✅ Build complete (${elapsed}ms)`);
    console.log(`   Output: .mandu/client/`);
    if (hasTailwind) {
      console.log(`   CSS: .mandu/client/globals.css`);
    }

    const summaryRows = await createBuildSummaryRows(
      cwd,
      hydratedRoutes,
      result.outputs,
      result.manifest
    );
    console.log("");
    console.log(renderBuildSummaryTable(summaryRows, Number(elapsed)));
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
      await registerManifestHandlers(manifest, cwd, {
        importFn: (p: string) => import(p),
        registeredLayouts: new Set(),
      });
      const tempServer = startServer(manifest, {
        port: 0,
        hostname: serverConfig.hostname,
        rootDir: cwd,
        isDev: false,
        bundleManifest,
        cors: serverConfig.cors,
        streaming: serverConfig.streaming,
        rateLimit: serverConfig.rateLimit,
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

  if (adapter?.build) {
    console.log(`\n🔌 Running adapter build: ${adapter.name}`);
    const adapterServerOptions: ServerOptions = {
      port: 0,
      hostname: serverConfig.hostname,
      rootDir: cwd,
      isDev: false,
      bundleManifest,
      cors: serverConfig.cors,
      streaming: serverConfig.streaming,
      rateLimit: serverConfig.rateLimit,
      cssPath,
    };
    await adapter.build({
      manifest,
      bundleManifest,
      rootDir: cwd,
      serverOptions: adapterServerOptions,
    });
  }

  // Phase 15.1 — Cloudflare Workers target
  if (options.target === "workers") {
    try {
      const { emitWorkersBundle } = await import("../util/workers-emitter");
      await emitWorkersBundle({
        rootDir: cwd,
        manifest,
        cssPath,
        workerName: options.workerName,
      });
    } catch (error) {
      console.error(
        `\n❌ Workers build failed: ${error instanceof Error ? error.message : String(error)}`
      );
      await runHook("onAfterBuild", plugins, hooks, {
        success: false,
        duration: Math.round(performance.now() - buildStartTime),
      });
      return false;
    }
  }

  // Phase 15.2 — Deno Deploy target
  if (options.target === "deno") {
    try {
      const { emitDenoBundle } = await import("../util/deno-emitter");
      await emitDenoBundle({
        rootDir: cwd,
        manifest,
        cssPath,
        projectName: options.projectName,
      });
    } catch (error) {
      console.error(
        `\n❌ Deno build failed: ${error instanceof Error ? error.message : String(error)}`
      );
      await runHook("onAfterBuild", plugins, hooks, {
        success: false,
        duration: Math.round(performance.now() - buildStartTime),
      });
      return false;
    }
  }

  // Phase 15.2 — Vercel Edge target
  if (options.target === "vercel-edge") {
    try {
      const { emitVercelEdgeBundle } = await import("../util/vercel-edge-emitter");
      await emitVercelEdgeBundle({
        rootDir: cwd,
        manifest,
        cssPath,
        projectName: options.projectName,
      });
    } catch (error) {
      console.error(
        `\n❌ Vercel Edge build failed: ${error instanceof Error ? error.message : String(error)}`
      );
      await runHook("onAfterBuild", plugins, hooks, {
        success: false,
        duration: Math.round(performance.now() - buildStartTime),
      });
      return false;
    }
  }

  // Phase 15.2 — Netlify Edge target
  if (options.target === "netlify-edge") {
    try {
      const { emitNetlifyEdgeBundle } = await import("../util/netlify-edge-emitter");
      await emitNetlifyEdgeBundle({
        rootDir: cwd,
        manifest,
        cssPath,
        projectName: options.projectName,
      });
    } catch (error) {
      console.error(
        `\n❌ Netlify Edge build failed: ${error instanceof Error ? error.message : String(error)}`
      );
      await runHook("onAfterBuild", plugins, hooks, {
        success: false,
        duration: Math.round(performance.now() - buildStartTime),
      });
      return false;
    }
  }

  await runHook("onAfterBuild", plugins, hooks, {
    success: true,
    duration: Math.round(performance.now() - buildStartTime),
  });

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
