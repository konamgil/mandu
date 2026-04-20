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
  /**
   * Phase 18.η — emit `.mandu/analyze/report.html` + `report.json`
   * after a successful build.
   *
   *   - `true`    → write both the HTML treemap and the JSON summary.
   *   - `"json"`  → JSON only (skip HTML render; useful in CI pipelines).
   *   - `false` / `undefined` → skip analyzer entirely. Still honours
   *                              `ManduConfig.build.analyze` if set.
   *
   * The HTML report is self-contained (no CDN, no webpack-bundle-analyzer
   * fork, no d3) — a single file you can open from a file:// URL or email.
   */
  analyze?: boolean | "json";
  /**
   * Issue #216 — downgrade prerender errors from build-failing to
   * warnings. Default `false` (any broken `generateStaticParams` or
   * module-load failure aborts the build with a non-zero exit code so
   * CI notices). Set `true` to let a build ship even if one or more
   * routes fail to prerender — the errors still appear in the console
   * summary, just non-fatally.
   */
  prerenderSkipErrors?: boolean;
  /**
   * Phase 18.φ — skip bundle-size budget enforcement for this run.
   *
   * One-off emergency bypass — CI / `mandu build` output logs the
   * skip prominently so a reviewer can spot an unexpected use. When
   * set, the budget section still runs the analyzer (so `--analyze`
   * output is unaffected) but neither warns nor errors on exceeded
   * limits.
   *
   * Per-project escape hatches: omit `ManduConfig.build.budget` or
   * set `build.budget.mode = "warning"`. This flag is intentionally
   * not available as a config field — it is strictly an override
   * that requires deliberate human intent.
   */
  noBudget?: boolean;
  /**
   * Phase 18.χ — run `@mandujs/core/a11y` axe-core audit against every
   * file in `.mandu/prerendered/**\/*.html` after all bundling, budget,
   * and analyzer steps complete.
   *
   *   - `false` / `undefined` → skip audit (default; a11y is opt-in).
   *   - `true`                → run axe-core on every prerendered HTML file.
   *
   * axe-core and a DOM provider (jsdom preferred, HappyDOM accepted)
   * are optional peer dependencies. When absent, the runner prints a
   * single informational line and exits 0 — the audit never blocks a
   * build unless the caller also opted into `--audit-fail-on`.
   */
  audit?: boolean;
  /**
   * Phase 18.χ — minimum impact severity that should cause `mandu build`
   * to exit non-zero when `--audit` finds a violation at or above that
   * threshold. Default `"critical"`. Set to `"minor"` for zero-tolerance
   * mode or explicitly `undefined` to run the audit informationally.
   *
   * Accepts axe-core's impact scale verbatim: `minor | moderate | serious | critical`.
   */
  auditFailOn?: "minor" | "moderate" | "serious" | "critical";
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

  // 5.4. OpenAPI artifact emission — .mandu/openapi.json + .mandu/openapi.yaml
  //
  // Emitted BEFORE prerender so that a transient server booted for
  // prerender rendering can (optionally) serve the artifacts via the
  // `/__mandu/openapi.*` endpoint without racing the build.
  //
  // Always emitted when at least one contract route is registered — the
  // artifact exists on disk as a deploy-time deliverable even if the
  // runtime endpoint is disabled by default. Consumers who never want
  // the artifact can skip the block entirely by shipping zero
  // `contractModule` routes (which is the only scenario where the spec
  // would be empty anyway).
  {
    const hasContracts = manifest.routes.some((r) => r.contractModule);
    if (hasContracts) {
      try {
        const { writeOpenAPIArtifacts } = await import("@mandujs/core/openapi/generator");
        const result = await writeOpenAPIArtifacts(
          manifest,
          cwd,
          ".mandu"
        );
        const relJson = path.relative(cwd, result.paths.json).replace(/\\/g, "/");
        const relYaml = path.relative(cwd, result.paths.yaml).replace(/\\/g, "/");
        console.log(
          `\n📜 OpenAPI spec written (${result.pathCount} path(s))`
        );
        console.log(`   ${relJson}`);
        console.log(`   ${relYaml}`);
        console.log(`   SHA-256: ${result.hash.slice(0, 12)}…`);
      } catch (error) {
        console.warn(
          `\n⚠️  OpenAPI artifact emission failed (non-fatal): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  // 5.5. Prerendering (SSG) — 정적 페이지를 HTML로 사전 생성
  const staticRoutes = manifest.routes.filter(
    r => r.kind === "page" && !r.pattern.includes(":")
  );
  const hasDynamicWithStaticParams = manifest.routes.some(
    r => r.kind === "page" && r.pattern.includes(":") // generateStaticParams 가능
  );
  // Phase 18 — honor `ManduConfig.build.prerender` (default: true).
  const prerenderEnabled = buildConfig.prerender !== false;

  if (prerenderEnabled && (staticRoutes.length > 0 || hasDynamicWithStaticParams)) {
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
        // Disable pass-through during the build-time render — we *are*
        // the thing generating the HTML, so serving previously-built
        // HTML back to ourselves would produce stale output.
        prerender: false,
        // #217 — suppress the "🥟 Mandu server listening" banner for this
        // transient prerender worker. The listener binds on port 0
        // (ephemeral) and is torn down as soon as prerender finishes, so
        // the URL the banner prints is unreachable by the time any human
        // or LLM reading build output tries to curl it. `mandu dev` and
        // `mandu start` never set `silent` and keep the normal banner.
        silent: true,
      });

      // fetchHandler 추출 — 서버의 내부 핸들러로 프리렌더
      const fetchHandler = async (req: Request) => {
        const url = new URL(req.url);
        const targetUrl = `http://localhost:${tempServer.server.port}${url.pathname}${url.search}`;
        return fetch(targetUrl);
      };

      let prerenderResult;
      let prerenderFatal: unknown = null;
      try {
        prerenderResult = await prerenderRoutes(manifest, fetchHandler, {
          rootDir: cwd,
          // Phase 18 — runtime-aware output dir + manifest index.
          outDir: ".mandu/prerendered",
          writeIndex: true,
          crawl: true,
          // Issue #213 — pass user-configured crawl denylist into engine.
          // Issue #219 — also pipe asset-extension overrides through so
          // the crawler doesn't enqueue `.webp`/`.pdf`/etc. URLs.
          crawlOptions: buildConfig.crawl
            ? {
                exclude: buildConfig.crawl.exclude,
                replaceDefaultExclude: buildConfig.crawl.replaceDefaultExclude,
                assetExtensions: buildConfig.crawl.assetExtensions,
                replaceDefaultAssetExtensions:
                  buildConfig.crawl.replaceDefaultAssetExtensions,
              }
            : undefined,
          // Issue #216 — surface aggregate errors unless the user opted
          // out via `--prerender-skip-errors`.
          skipErrors: options.prerenderSkipErrors === true,
        });
      } catch (err) {
        prerenderFatal = err;
      } finally {
        tempServer.stop();
      }

      if (prerenderFatal) {
        // Issue #216 — `PrerenderError` is an aggregate that already
        // prints a per-route summary. Log the full chain (name,
        // summary, and `cause` if present) and fail the build loudly.
        const err = prerenderFatal as Error & { errors?: Array<{ pattern: string; message: string; cause?: unknown }> };
        console.error(`\n❌ Prerender failed — build aborted.`);
        console.error(`   ${err.message}`);
        if (Array.isArray(err.errors)) {
          for (const routeErr of err.errors) {
            if (routeErr.cause instanceof Error && routeErr.cause.stack) {
              console.error(
                `   ↳ [${routeErr.pattern}] cause: ${routeErr.cause.stack.split("\n").slice(0, 3).join("\n       ")}`
              );
            }
          }
        }
        console.error(
          "   Pass --prerender-skip-errors to downgrade these to warnings."
        );
        await runHook("onAfterBuild", plugins, hooks, {
          success: false,
          duration: Math.round(performance.now() - buildStartTime),
        });
        return false;
      }

      if (prerenderResult!.generated > 0) {
        console.log(`   ✅ ${prerenderResult!.generated} page(s) prerendered`);
        for (const page of prerenderResult!.pages) {
          const sizeKB = (page.size / 1024).toFixed(1);
          console.log(`      ${page.path} (${sizeKB} KB, ${page.duration}ms)`);
        }
      }
      if (prerenderResult!.errors.length > 0) {
        console.warn(`   ⚠️  ${prerenderResult!.errors.length} error(s):`);
        for (const err of prerenderResult!.errors) {
          console.warn(`      ${err}`);
        }
      }

      // ─── Issue #214 ─────────────────────────────────────────────────────
      // Persist the manifest back to disk so the runtime picks up the
      // `dynamicParams` + `staticParams` fields that `prerenderRoutes`
      // stamped onto the in-memory route specs. Without this write, the
      // guard has nothing to consult on boot.
      const manifestJsonPath = path.join(cwd, ".mandu/routes.manifest.json");
      try {
        await fs.writeFile(
          manifestJsonPath,
          JSON.stringify(manifest, null, 2),
          "utf-8"
        );
      } catch (writeErr) {
        console.warn(
          `   ⚠️  Failed to update routes.manifest.json after prerender:`,
          writeErr instanceof Error ? writeErr.message : String(writeErr)
        );
      }
      // ─── End Issue #214 ─────────────────────────────────────────────────
    } catch (error) {
      // Outer catch — only surfaces errors from the transient server
      // boot path itself (handler registration, startServer). Prerender
      // engine errors are handled inside via `prerenderFatal`.
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
      // Phase 18.λ — extract workers-eligible cron schedules from
      // `mandu.config.ts` `scheduler.jobs`. `extractWorkersCrons` is
      // pure — it de-duplicates schedule strings, filters by `runOn`,
      // and collects advisory warnings (timezone mismatch, skipInDev
      // ignored on Workers, etc.) so we can surface them to the user.
      const { extractWorkersCrons } = await import("../util/cron-wrangler");
      const cronExtraction = extractWorkersCrons(config.scheduler?.jobs);
      if (cronExtraction.warnings.length > 0) {
        for (const w of cronExtraction.warnings) {
          console.warn(`⚠️  [scheduler] ${w}`);
        }
      }
      await emitWorkersBundle({
        rootDir: cwd,
        manifest,
        cssPath,
        workerName: options.workerName,
        crons: cronExtraction.crons,
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

  // Phase 18.φ + 18.η — Bundle-size budget enforcement + bundle analyzer.
  //
  // Ordering contract (important for CI log legibility):
  //   1. Bundle stats (above) — the raw "I built X KB of JS" line.
  //   2. Budget enforcement (this block) — fail fast if ceilings exceeded
  //      so downstream steps (analyzer HTML emit, prerender) don't run on
  //      a build that's about to exit non-zero. `--no-budget` skips the
  //      gate entirely but still logs the skip prominently.
  //   3. Analyzer HTML/JSON emit (this block) — the heavy artefact write
  //      that produces `.mandu/analyze/report.html` + `report.json` when
  //      `--analyze` (bare) or `--analyze=json` is set, or config has
  //      `build.analyze: true`.
  //
  // Implementation note: the analyzer's `analyzeBundle()` is an in-memory
  // pure function that reads files already on disk. Running it once for
  // the budget gate is cheap; we reuse the same report for the analyzer
  // emit below so we don't walk `.mandu/client/` twice. Both steps are
  // guarded by `bundleManifest` presence — pure-SSR stubs skip both.
  const analyzeFlag = options.analyze ?? buildConfig.analyze ?? false;
  const budgetConfig = buildConfig.budget;
  const budgetRequested = budgetConfig !== undefined;
  let analyzeReport: Awaited<
    ReturnType<typeof import("@mandujs/core/bundler/analyzer").analyzeBundle>
  > | null = null;
  if (bundleManifest && (analyzeFlag || budgetRequested)) {
    try {
      const { analyzeBundle } = await import("@mandujs/core/bundler/analyzer");
      analyzeReport = await analyzeBundle(cwd, bundleManifest);
    } catch (error) {
      console.warn(
        `\n⚠️  Bundle analyzer failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ── Budget enforcement ─────────────────────────────────────────────────────
  let budgetReport: Awaited<
    ReturnType<typeof import("@mandujs/core/bundler/budget").evaluateBudget>
  > | null = null;
  if (analyzeReport && budgetRequested) {
    if (options.noBudget === true) {
      // Log the bypass loud enough that a reviewer notices it on the CI
      // surface, per the spec. Emoji + two-line block to survive
      // log-line collapse.
      console.log("");
      console.log("🚫  --no-budget flag set: bundle-size budget enforcement SKIPPED.");
      console.log(
        "    Declared limits in `build.budget` are ignored for this run only."
      );
    } else {
      try {
        const { evaluateBudget, formatBudgetTable, formatBudgetBytes } =
          await import("@mandujs/core/bundler/budget");
        budgetReport = evaluateBudget(analyzeReport, budgetConfig);
        if (budgetReport) {
          console.log("");
          const raw = formatBudgetBytes(analyzeReport.summary.totalRaw);
          const gz = formatBudgetBytes(analyzeReport.summary.totalGz);
          const withinAll =
            budgetReport.withinCount + budgetReport.approachingCount;
          console.log(
            `📏 Budget check: ${withinAll}/${budgetReport.islandCount} islands within limits (${raw} total raw, ${gz} gz)`
          );
          if (budgetReport.exceededCount > 0 || budgetReport.approachingCount > 0) {
            console.log(formatBudgetTable(budgetReport));
          }
          if (budgetReport.hasExceeded) {
            if (budgetReport.mode === "error") {
              console.error(
                `\n❌ Bundle-size budget exceeded (${budgetReport.exceededCount} island(s) over limit). Build aborted.`
              );
              console.error(
                "   Investigate with `mandu build --analyze` or bypass once with `mandu build --no-budget`."
              );
              await runHook("onAfterBuild", plugins, hooks, {
                success: false,
                duration: Math.round(performance.now() - buildStartTime),
              });
              return false;
            }
            console.warn(
              `\n⚠️  Bundle-size budget exceeded (${budgetReport.exceededCount} island(s) over limit). Build continues in warning mode.`
            );
            console.warn(
              "   Set `build.budget.mode = 'error'` to fail the build, or investigate with `mandu build --analyze`."
            );
          }
        }
      } catch (error) {
        console.warn(
          `\n⚠️  Budget enforcement failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // ── Analyzer HTML/JSON emit (Phase 18.η) ───────────────────────────────────
  if (analyzeFlag && analyzeReport) {
    try {
      const { writeAnalyzeReport } = await import(
        "@mandujs/core/bundler/analyzer"
      );
      const jsonOnly = analyzeFlag === "json";
      const { jsonPath, htmlPath } = await writeAnalyzeReport(
        cwd,
        analyzeReport,
        { html: !jsonOnly, budget: budgetReport }
      );
      console.log("\n🔍 Bundle analyzer");
      console.log("=".repeat(50));
      console.log(
        `   ${analyzeReport.summary.islandCount} island(s), ${analyzeReport.summary.sharedCount} shared chunk(s)`
      );
      const { formatSize } = await import("@mandujs/core");
      console.log(
        `   Total: ${formatSize(analyzeReport.summary.totalRaw)} raw / ${formatSize(analyzeReport.summary.totalGz)} gzip`
      );
      if (analyzeReport.summary.largestIsland) {
        console.log(
          `   Largest island: ${analyzeReport.summary.largestIsland.name} (${formatSize(analyzeReport.summary.largestIsland.totalRaw)})`
        );
      }
      if (analyzeReport.summary.heaviestDep) {
        console.log(
          `   Heaviest module: ${analyzeReport.summary.heaviestDep.path} (${formatSize(analyzeReport.summary.heaviestDep.size)})`
        );
      }
      if (analyzeReport.summary.dedupeSavings > 0) {
        console.log(
          `   Dedupe savings: ${formatSize(analyzeReport.summary.dedupeSavings)} (shared chunks reused across islands)`
        );
      }
      console.log(`   JSON: ${path.relative(cwd, jsonPath).replace(/\\/g, "/")}`);
      if (htmlPath) {
        console.log(
          `   HTML: ${path.relative(cwd, htmlPath).replace(/\\/g, "/")} (open in browser)`
        );
      }
    } catch (error) {
      console.warn(
        `\n⚠️  Bundle analyzer failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ── Phase 18.χ — Accessibility audit (opt-in) ──────────────────────────────
  //
  // Runs LAST in the build pipeline, after every byte has been emitted and
  // every prerendered HTML file is on disk. Ordering rationale:
  //   - Depends on `.mandu/prerendered/**\/*.html`, which only exists after
  //     the prerender step above completes successfully.
  //   - Does NOT gate the bundle-size budget or analyzer emit — those belong
  //     to `φ` / `η` and are independent concerns.
  //   - May fail the build (exit non-zero) when `auditFailOn` is configured
  //     and the runner finds a violation at that severity or higher.
  //
  // axe-core + jsdom are optional peer deps. When absent the audit is a
  // graceful no-op that prints one informational line and exits 0 — the
  // quality-engineering mindset wins over blocking users who haven't
  // opted in yet. Enable with `bun add -d axe-core jsdom`.
  if (options.audit === true) {
    try {
      const { runAudit, formatAuditReport, impactAtLeast } = await import(
        "@mandujs/core/a11y"
      );

      // Discover prerendered HTML. We re-scan (rather than plumbing the
      // prerender result through the whole function) so `--audit` works
      // in rebuild scenarios where the user ran a previous build without
      // it. Missing directory → empty list → axe gets a clean no-op.
      const prerenderedDir = path.join(cwd, ".mandu", "prerendered");
      const htmlFiles: string[] = [];
      async function collect(dir: string, depth = 0): Promise<void> {
        if (depth > 8) return;
        let entries: import("fs").Dirent[];
        try {
          entries = (await fs.readdir(dir, { withFileTypes: true })) as import("fs").Dirent[];
        } catch {
          return;
        }
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await collect(full, depth + 1);
          } else if (entry.isFile() && entry.name.endsWith(".html")) {
            htmlFiles.push(full);
          }
        }
      }
      await collect(prerenderedDir);

      console.log("\n♿ Accessibility audit (Phase 18.χ)");
      console.log("=".repeat(50));

      if (htmlFiles.length === 0) {
        console.log("   No prerendered HTML to audit. Skipping.");
      } else {
        const report = await runAudit(htmlFiles, { minImpact: "minor" });
        console.log(formatAuditReport(report));

        // `--audit-fail-on` gates the exit code. Default severity is
        // `critical` so a bare `--audit` run never fails CI; callers
        // who want a hard gate add `--audit-fail-on=serious` (or
        // lower).
        const failOn = options.auditFailOn ?? "critical";
        if (options.auditFailOn !== undefined && report.outcome === "violations") {
          const hasBlocker = report.violations.some((v) =>
            impactAtLeast(v.impact ?? undefined, failOn)
          );
          if (hasBlocker) {
            console.error(
              `\n❌ Accessibility audit failed — at least one violation at ${failOn} or higher.`
            );
            console.error(
              "   Fix the violations above or raise --audit-fail-on to a stricter level."
            );
            await runHook("onAfterBuild", plugins, hooks, {
              success: false,
              duration: Math.round(performance.now() - buildStartTime),
            });
            return false;
          }
        }
      }
    } catch (error) {
      // Audit must NEVER fail the build via an internal exception —
      // that would be a worse DX than simply not running the audit.
      console.warn(
        `\n⚠️  Accessibility audit failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`
      );
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
