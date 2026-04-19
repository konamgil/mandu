import {
  startServer,
  startDevBundler,
  SSR_CHANGE_WILDCARD,
  buildClientBundles,
  createHMRServer,
  needsHydration,
  loadEnv,
  watchFSRoutes,
  clearDefaultRegistry,
  createGuardWatcher,
  checkDirectory,
  printReport,
  formatReportForAgent,
  formatReportAsAgentJSON,
  getPreset,
  validateAndReport,
  isTailwindProject,
  startCSSWatch,
  runHook,
  type RoutesManifest,
  type GuardConfig,
  type Violation,
  type CSSWatcher,
} from "@mandujs/core";
import { newId } from "@mandujs/core/id";
import { HMR_PERF } from "@mandujs/core/perf/hmr-markers";
import { mark, measure, withPerf } from "@mandujs/core/perf";
import { resolveFromCwd } from "../util/fs";
import { resolveOutputFormat } from "../util/output";
import { CLI_ERROR_CODES, printCLIError } from "../errors";
import { createBundledImporter } from "../util/bun";
import { resolveManifest } from "../util/manifest";
import { resolveAvailablePort } from "../util/port";
import {
  validateRuntimeLockfile,
  handleBlockedLockfile,
  printRuntimeLockfileStatus,
} from "../util/lockfile";
import { registerManifestHandlers } from "../util/handlers";
import { getFsRoutesGuardPolicy } from "../util/guard-policy";
import { openBrowser } from "../util/browser";
import { resolveDisplayHost } from "../util/host";
import { startJitPrewarm, logPrewarmResult } from "../util/jit-prewarm";
import {
  handleDevShortcutInput,
  renderDevReadySummary,
  shouldEnableDevShortcuts,
} from "../util/dev-shortcuts";
import { removeRuntimeControl, writeRuntimeControl } from "../util/runtime-control";
import path from "path";
/**
 * Phase 7.3 L-02 — mask a slot file path for HMR broadcast.
 *
 * Returns a root-relative, forward-slash path. If the computed path
 * escapes rootDir (starts with "..") or is somehow absolute (e.g.
 * `path.relative` gives up on Windows cross-drive paths), we fall
 * back to the bare basename so the HDRPayload never leaks an
 * unrelated directory structure. Windows backslashes are normalized
 * to forward slashes so the wire format is platform-agnostic.
 *
 * Exported from this module so unit tests can exercise the pure
 * function without a live dev server.
 */
export function maskSlotPath(rootDir: string, filePath: string): string {
  try {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
      return path.basename(filePath);
    }
    return rel;
  } catch {
    return path.basename(filePath);
  }
}

export interface DevOptions {
  port?: number;
  /** 서버 시작 후 브라우저 자동 열기 */
  open?: boolean;
}

function logDevEvent(title: string, details: string[] = []): void {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n[${timestamp}] ${title}`);
  for (const detail of details) {
    console.log(`  ${detail}`);
  }
}

export async function dev(options: DevOptions = {}): Promise<void> {
  const devStartTime = performance.now();
  const rootDir = resolveFromCwd(".");

  // Phase 7.1 R1 Agent C — B_gap marker #1: config validation.
  // `validateAndReport` is the boot seed — lockfile validation, env loading,
  // and SQLite observability all key off `config`. We must NOT parallelize
  // this with anything (line 68 in the pre-7.1 dev.ts was strictly serial).
  const config = await withPerf(HMR_PERF.BOOT_VALIDATE_CONFIG, () =>
    validateAndReport(rootDir),
  );

  if (!config) {
    printCLIError(CLI_ERROR_CODES.CONFIG_VALIDATION_FAILED);
    process.exit(1);
  }

  const serverConfig = config.server ?? {};
  const devConfig = config.dev ?? {};
  const guardConfigFromFile = config.guard ?? {};
  const plugins = config.plugins ?? [];
  const hooks = config.hooks;
  const HMR_OFFSET = 1;

  // Phase 7.3 A — JIT prewarm kick-off.
  //
  // Fire-and-forget — `startJitPrewarm` returns a Promise that we do NOT
  // await. See packages/cli/src/util/jit-prewarm.ts for the full rationale.
  // Placed here (after `validateAndReport`, before the boot-parallel
  // allSettled block) so that:
  //   1. The imports race alongside lockfile/env I/O instead of contending
  //      with the main thread while validateAndReport is still parsing
  //      the config.
  //   2. The catch handler attached via `.catch(() => {})` in the Promise
  //      factory itself means no "unhandled rejection" will ever surface
  //      even if a downstream await on this promise is forgotten.
  //
  // Promise is captured in a void-typed const so linters don't flag the
  // discarded return value; we re-attach a logging tap when MANDU_PERF=1.
  const jitPrewarmPromise = startJitPrewarm();
  if (process.env.MANDU_PERF === "1") {
    jitPrewarmPromise.then(logPrewarmResult).catch(() => {
      // startJitPrewarm never rejects — this catch is a belt-and-braces
      // guard for future refactors.
    });
  }

  // Phase 7.1 R1 Agent C — boot parallelization (Tier 1, -40~70ms).
  //
  // `validateAndReport` is the required seed — its `config` feeds the three
  // independent downstream tasks:
  //   1. `validateRuntimeLockfile(config, rootDir)` — reads `bun.lock` + runs
  //      hash validation against config. I/O bound, ~5-10 ms.
  //   2. `loadEnv({ rootDir, env: "development" })` — reads `.env*` files.
  //      I/O bound, ~3-8 ms. No runtime dependency on lockfile.
  //   3. `startSqliteStore(rootDir)` — dynamic-imports `bun:sqlite`, opens
  //      `.mandu/observability.db`, runs schema. I/O bound, ~20-40 ms.
  //      Previously awaited on the critical path — the observability store
  //      is an EventBus subscriber, so boot does not need to block on it.
  //
  // Ordering rules (still enforced):
  //   - `handleBlockedLockfile` MUST run before the server starts (exit 1
  //     on block). We check it as soon as the lockfile promise settles.
  //   - Env result log is printed once Promise.allSettled resolves, so the
  //     ordering of the "Env loaded:" line is preserved relative to other
  //     boot logs (no interleaving with the SQLite import).
  //
  // Failure handling: `Promise.allSettled` is used instead of `Promise.all`
  // so that a failure in one task (e.g. corrupt `.env`) does not silently
  // abort the others — each failure is reported individually by its own
  // handler, matching the pre-7.1 behaviour.
  console.log("Starting dev server...");

  mark(HMR_PERF.BOOT_SQLITE_START);
  // startSqliteStore is fire-and-forget: the SQLite store is an EventBus
  // subscriber and dropped events before ready return `[]` from
  // `queryEvents` (sqlite-store.ts:122). Promise is captured for cleanup
  // and is awaited during `stopSqliteStore` so we don't race on shutdown.
  const sqliteStorePromise: Promise<void> =
    devConfig.observability !== false
      ? import("@mandujs/core/observability")
          .then((m) => m.startSqliteStore(rootDir))
          .then(() => {
            measure(HMR_PERF.BOOT_SQLITE_START, HMR_PERF.BOOT_SQLITE_START);
          })
          .catch((err) => {
            // Silent in "SQLite unavailable" environments (e.g. non-Bun)
            // but surface the error when perf tracing is on so regressions
            // don't hide.
            if (process.env.MANDU_PERF === "1") {
              console.warn(
                "[perf] startSqliteStore failed (non-fatal):",
                err instanceof Error ? err.message : String(err),
              );
            }
          })
      : Promise.resolve();

  const [lockfileSettled, envSettled] = await Promise.allSettled([
    withPerf(HMR_PERF.BOOT_LOCKFILE_CHECK, () =>
      validateRuntimeLockfile(config, rootDir),
    ),
    withPerf(HMR_PERF.BOOT_LOAD_ENV, () =>
      loadEnv({ rootDir, env: "development" }),
    ),
  ]);

  // Lockfile validation is mandatory — failures here must not swallow the
  // original exception or bypass the `handleBlockedLockfile` exit.
  if (lockfileSettled.status === "rejected") {
    throw lockfileSettled.reason;
  }
  const { lockfile, lockResult, action, bypassed } = lockfileSettled.value;
  handleBlockedLockfile(action, lockResult);

  // Print lockfile status (preserves pre-7.1 log ordering).
  printRuntimeLockfileStatus(action, bypassed, lockfile, lockResult);

  // Env loading is advisory — a failure prints a warning but never blocks
  // dev start. This matches the pre-7.1 behaviour where `loadEnv` errors
  // were accumulated in `envResult.errors` (not thrown).
  if (envSettled.status === "fulfilled") {
    const envResult = envSettled.value;
    if (envResult.loaded.length > 0) {
      console.log(`Env loaded: ${envResult.loaded.join(", ")}`);
    }
  } else {
    console.warn(
      `[Mandu] loadEnv failed (non-fatal): ${
        envSettled.reason instanceof Error
          ? envSettled.reason.message
          : String(envSettled.reason)
      }`,
    );
  }

  // Scan routes (FS Routes first, fallback to spec manifest)
  console.log("Scanning routes...");
  let manifest: RoutesManifest;
  let enableFsRoutes = false;

  try {
    const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;
    enableFsRoutes = resolved.source === "fs";

    if (manifest.routes.length === 0) {
      printCLIError(CLI_ERROR_CODES.DEV_NO_ROUTES);
      console.log("Create a page.tsx file in the app/ directory:");
      console.log("");
      console.log("  app/page.tsx             -> /");
      console.log("  app/blog/page.tsx        -> /blog");
      console.log("  app/api/users/route.ts   -> /api/users");
      console.log("");
      process.exit(1);
    }

    console.log(`Routes found: ${manifest.routes.length}\n`);
  } catch (error) {
    printCLIError(CLI_ERROR_CODES.DEV_MANIFEST_NOT_FOUND);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const guardPreset = guardConfigFromFile.preset || "mandu";
  const guardFormat = resolveOutputFormat();
  const guardConfig: GuardConfig | null =
    guardConfigFromFile.realtime === false
      ? null
      : {
          preset: guardPreset,
          srcDir: guardConfigFromFile.srcDir || "src",
          realtime: guardConfigFromFile.realtime ?? true,
          exclude: guardConfigFromFile.exclude,
          realtimeOutput: guardFormat,
          fsRoutes: getFsRoutesGuardPolicy(enableFsRoutes),
        };

  if (guardConfig) {
    const preflightReport = await withPerf(HMR_PERF.BOOT_GUARD_PREFLIGHT, () =>
      checkDirectory(guardConfig, rootDir),
    );
    if (preflightReport.bySeverity.error > 0) {
      if (guardFormat === "json") {
        console.log(formatReportAsAgentJSON(preflightReport, guardPreset));
      } else if (guardFormat === "agent") {
        console.log(formatReportForAgent(preflightReport, guardPreset));
      } else {
        printReport(preflightReport, getPreset(guardPreset).hierarchy);
      }
      console.error("\nArchitecture Guard failed. Fix errors before starting dev server.");
      process.exit(1);
    }
  }

  // Track layout paths (prevent duplicate registration)
  const registeredLayouts = new Set<string>();

  // #184/#187: bundle-and-import 패턴으로 transitive ESM 캐시 우회.
  // Bun의 ESM 캐시는 프로세스 레벨이라 importFresh로 entry만 cache-bust해도
  // src/shared/* 같은 transitive 의존성은 첫 boot의 캐시된 버전을 계속 반환함.
  // bundled importer는 매 호출마다 user 코드를 단일 ESM bundle로 합쳐 새 파일로
  // 출력 → 새 URL로 import → Bun이 전혀 새 모듈로 인식 → 모든 변경이 반영.
  const bundledImport = createBundledImporter({ rootDir });

  // Handler registration function (uses shared utility).
  // Phase 7.0 B5 wire-up: `changedFile` threads through to
  // `createBundledImporter` so unrelated routes hit the incremental
  // cache instead of rebuilding (0.075 ms vs 20 ms).
  const registerHandlers = async (
    m: RoutesManifest,
    isReload = false,
    changedFile?: string,
  ) => {
    await registerManifestHandlers(m, rootDir, {
      importFn: bundledImport,
      registeredLayouts,
      isReload,
      changedFile,
    });
  };

  // Register initial handlers
  await registerHandlers(manifest);
  console.log("");

  const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
  const desiredPort =
    options.port ??
    (envPort && Number.isFinite(envPort) ? envPort : undefined) ??
    serverConfig.port ??
    3333;

  // Port is explicitly configured if it came from CLI flag, env var, or config file
  const isExplicitPort = !!(
    options.port ||
    (envPort && Number.isFinite(envPort)) ||
    serverConfig.port
  );

  const hasIslands = manifest.routes.some(
    (r) => r.kind === "page" && r.clientModule && needsHydration(r)
  );
  const routeStats = {
    pageCount: manifest.routes.filter((route) => route.kind === "page").length,
    apiCount: manifest.routes.filter((route) => route.kind === "api").length,
    islandCount: manifest.routes.filter((route) => route.kind === "page" && route.clientModule).length,
  };
  const hmrEnabled = devConfig.hmr ?? true;
  const managementToken = newId();

  let port: number;
  try {
    const resolved = await withPerf(HMR_PERF.BOOT_RESOLVE_PORT, () =>
      resolveAvailablePort(desiredPort, {
        hostname: serverConfig.hostname,
        // HMR 활성화 시 항상 HMR 포트 예약 (island 유무 무관)
        offsets: hmrEnabled ? [0, HMR_OFFSET] : [0],
        strict: isExplicitPort,
      }),
    );
    port = resolved.port;
  } catch (error) {
    if (isExplicitPort) {
      printCLIError(CLI_ERROR_CODES.DEV_PORT_IN_USE, { port: desiredPort });
      process.exit(1);
    }
    throw error;
  }

  if (port !== desiredPort) {
    console.warn(`Port ${desiredPort} is in use.`);
    console.warn(`  Dev server:    http://localhost:${port}`);
    console.warn(`  HMR WebSocket: ws://localhost:${port + HMR_OFFSET}`);
  }

  // Start HMR server (when client slots exist)
  let hmrServer: ReturnType<typeof createHMRServer> | null = null;
  let devBundler: Awaited<ReturnType<typeof startDevBundler>> | null = null;
  let cssWatcher: CSSWatcher | null = null;

  // Start CSS build (only when Tailwind v4 detected)
  const hasTailwind = await isTailwindProject(rootDir);
  if (hasTailwind) {
    cssWatcher = await startCSSWatch({
      rootDir,
      watch: true,
      onBuild: (result) => {
        if (result.success && hmrServer) {
          // Use cssWatcher.serverPath for path consistency
          hmrServer.broadcast({
            type: "css-update",
            data: {
              cssPath: cssWatcher?.serverPath || "/.mandu/client/globals.css",
              timestamp: Date.now(),
            },
          });
        }
      },
      onError: (error) => {
        if (hmrServer) {
          hmrServer.broadcast({
            type: "error",
            data: {
              message: `CSS Error: ${error.message}`,
            },
          });
        }
      },
    });
  }

  if (!hasIslands && !hmrEnabled) {
    // HMR 비활성 + island 없음: devBundler가 안 도니까 수동으로 DevTools 번들 빌드
    await buildClientBundles(manifest, rootDir, { minify: false });
  }

  // Dev bundler callbacks (extracted as named functions for restart reuse)
  const handleRebuild = (result: { routeId: string; success: boolean; error?: string; file?: string }) => {
    if (result.success) {
      // Broadcast file change for Kitchen Preview
      if (result.file) {
        hmrServer?.broadcast({
          type: "kitchen:file-change",
          data: {
            file: result.file,
            changeType: "change",
            timestamp: Date.now(),
          },
        });
      }

      if (result.routeId === "*") {
        hmrServer?.broadcast({
          type: "reload",
          data: { timestamp: Date.now() },
        });
      } else {
        hmrServer?.broadcast({
          type: "island-update",
          data: { routeId: result.routeId, timestamp: Date.now() },
        });
      }
    } else {
      hmrServer?.broadcast({
        type: "error",
        data: { routeId: result.routeId, message: result.error },
      });
    }
  };

  const handleBundlerError = (error: Error, routeId?: string) => {
    hmrServer?.broadcast({
      type: "error",
      data: { routeId, message: error.message },
    });
  };

  /**
   * Phase 7.2 — HDR (Hot Data Revalidation) routing helpers.
   *
   * When a `.slot.ts` / `.slot.tsx` file changes we want the browser
   * to re-invoke the route's loader WITHOUT a full reload: form
   * inputs, scroll position and focus all survive. This requires two
   * pieces of information that `handleSSRChange` otherwise doesn't
   * need:
   *
   *   1. "Is this a slot file?" — a path-shape check.
   *   2. "Which route owns this slot?" — a manifest lookup.
   *
   * The lookup walks `manifest.routes` for a `route.slotModule` whose
   * normalized absolute path equals the changed file. The search is
   * O(n) but n is the number of routes, which is small and bounded
   * by project size; every change runs it at most once per file
   * change event.
   *
   * HDR is gated on `MANDU_HDR !== "0"` — projects with unusual
   * setups can disable the optimization via env without losing dev
   * mode entirely (they keep the slot → reload path).
   */
  const HDR_ENABLED = process.env.MANDU_HDR !== "0";

  const isSlotFile = (filePath: string): boolean => {
    return filePath.endsWith(".slot.ts") || filePath.endsWith(".slot.tsx");
  };

  const findRouteIdForSlot = (filePath: string): string | null => {
    // Manifest slot modules are stored as project-relative forward-slash
    // paths; compare after normalizing both sides so Windows
    // backslashes and drive-letter case don't cause misses.
    const normalizeCompare = (p: string): string => {
      const resolved = path.resolve(rootDir, p).replace(/\\/g, "/");
      return process.platform === "win32" ? resolved.toLowerCase() : resolved;
    };
    const target = normalizeCompare(filePath);
    for (const route of manifest.routes) {
      if (!route.slotModule) continue;
      if (normalizeCompare(route.slotModule) === target) {
        return route.id;
      }
    }
    return null;
  };

  // SSR file change callback (page.tsx, layout.tsx -> re-register server handlers + browser reload)
  // #184: wildcard ("*") 입력 시 전체 레지스트리 invalidate (common dir 변경)
  // #186 hardening: 동시 호출 race 방지 — Promise-chain mutex로 직렬화.
  //   rapid fire 시 clearDefaultRegistry → registerHandlers가 interleave되면
  //   한 쪽이 다른 쪽의 in-progress 상태를 덮어쓰는 버그가 발생할 수 있음.
  let ssrChangeQueue: Promise<void> = Promise.resolve();
  const handleSSRChange = (filePath: string): Promise<void> => {
    ssrChangeQueue = ssrChangeQueue.then(() =>
      // B4 fix — wrap the entire handler body in SSR_HANDLER_RELOAD so
      // MANDU_PERF=1 can finally attribute the walltime that `dev:rebuild`
      // was hiding (it only covered `_doBuild`). All sub-markers fire inside
      // this withPerf so the totals add up.
      withPerf(HMR_PERF.SSR_HANDLER_RELOAD, async () => {
        const isWildcard = filePath === SSR_CHANGE_WILDCARD;
        if (isWildcard) {
          logDevEvent("Common dir changed", [
            "Action: clear SSR registry + re-register handlers",
            "Note: Bun의 transitive ESM 캐시 때문에 transitive 의존성까지 완전히 갱신되지 않을 수 있음",
          ]);
        } else {
          logDevEvent("SSR change detected", [
            `File: ${path.relative(rootDir, filePath)}`,
            "Action: re-register handlers",
            "Browser: full reload",
          ]);
        }

        // B4 — fine-grained markers so Agent F can bisect SSR walltime.
        mark(HMR_PERF.SSR_CLEAR_REGISTRY);
        clearDefaultRegistry();
        registeredLayouts.clear();
        measure(HMR_PERF.SSR_CLEAR_REGISTRY, HMR_PERF.SSR_CLEAR_REGISTRY);

        // Phase 7.0 B5 wire-up — pass the changed file to registerHandlers
        // so B's incremental `bundledImport` can cache-hit on routes whose
        // import graph doesn't contain this file. Wildcard stays undefined
        // = full invalidation (common-dir path is intentionally cold).
        await withPerf(HMR_PERF.SSR_REGISTER_HANDLERS, () =>
          registerHandlers(manifest, true, isWildcard ? undefined : filePath),
        );

        // Kitchen Preview에는 파일 경로가 있을 때만 broadcast (wildcard는 파일 경로 없음)
        if (!isWildcard) {
          hmrServer?.broadcast({
            type: "kitchen:file-change",
            data: {
              file: filePath,
              changeType: "change",
              timestamp: Date.now(),
            },
          });
        }

        // #188 fix — Phase 7.0 R1 Agent A.
        // Pure-SSR / hydration:none projects need the prerender output
        // regenerated when a common dir changes; dev-bundler's
        // `buildClientBundles({ skipFrameworkBundles: true })` is a no-op
        // when no islands exist, and the stale `.mandu/static/` HTML used
        // to persist until the next `mandu build`. We now re-emit HTML
        // through the running dev server's fetch handler for every
        // pure-SSR route in the manifest. This path fires only on the
        // wildcard (common-dir) signal to avoid pointless regen on a
        // single-page edit (full reload already handles that).
        if (isWildcard) {
          try {
            await withPerf(HMR_PERF.PRERENDER_REGEN, async () => {
              await regeneratePrerenderedStatics();
            });
          } catch (prerenderError) {
            // Prerender is advisory — never block the HMR broadcast.
            console.warn(
              "[handleSSRChange] prerender regen skipped:",
              prerenderError instanceof Error
                ? prerenderError.message
                : String(prerenderError),
            );
          }
        }

        // Phase 7.2 HDR — slot-refetch routing.
        //
        // If the changed file is a `.slot.ts` / `.slot.tsx` AND HDR is
        // enabled AND the route lookup succeeds, broadcast a custom
        // `mandu:slot-refetch` Vite event instead of the legacy
        // `reload`. The client script detects it, fetches the
        // current URL with X-Mandu-HDR: 1, receives loader JSON, and
        // applies it inside `React.startTransition` — no remount.
        //
        // Note: we STILL re-registered handlers above (that happens
        // before this broadcast section). A slot file *is* server
        // code that must be reloaded in the registry; HDR only
        // changes the client-side DELIVERY of fresh data, not the
        // server-side module refresh. The replay buffer also
        // captures this event so clients reconnecting right after
        // the slot edit see it.
        const slotRouteId =
          !isWildcard && HDR_ENABLED && isSlotFile(filePath)
            ? findRouteIdForSlot(filePath)
            : null;
        if (slotRouteId && hmrServer) {
          await withPerf(HMR_PERF.HMR_BROADCAST, async () => {
            // Phase 7.3 L-02 — emit a root-relative, forward-slash
            // slotPath so the HMR payload never leaks the developers
            // absolute filesystem path. The client uses this only for
            // console logging + dedup; it is not required to be
            // filesystem-resolvable on the browser side. If the
            // computed relative path tries to escape rootDir
            // (starts with ".."), we fall back to the bare basename
            // so even a misconfigured fs watcher cannot leak
            // unrelated directory structure. Windows paths are
            // normalized to forward slashes so the wire format is
            // platform-agnostic.
            const relSlotPath = maskSlotPath(rootDir, filePath);
            hmrServer!.broadcastVite({
              type: "custom",
              event: "mandu:slot-refetch",
              data: {
                routeId: slotRouteId,
                slotPath: relSlotPath,
                timestamp: Date.now(),
              },
            });
          });
          console.log(`  Status: HDR slot-refetch for route ${slotRouteId}`);
        } else {
          await withPerf(HMR_PERF.HMR_BROADCAST, async () => {
            hmrServer?.broadcast({
              type: "reload",
              data: { timestamp: Date.now() },
            });
          });
          console.log("  Status: SSR refresh complete");
        }
      }),
    ).catch((err) => {
      console.error("[handleSSRChange] error:", err instanceof Error ? err.message : err);
    });
    return ssrChangeQueue;
  };

  /**
   * #188 Fix — regenerate prerendered HTML for pure-SSR (hydration:none)
   * routes whenever the wildcard SSR signal fires.
   *
   * Design:
   *   - No-op when `.mandu/static/` does not exist. Projects that never
   *     invoked `mandu build --prerender` have no stale HTML to worry about.
   *   - No-op when the manifest has zero hydration:none page routes. Island
   *     projects rely on client bundle rebuilds, not stored HTML.
   *   - Uses the **already-running dev server** as the fetch handler
   *     (localhost loopback), so we stay compatible with the freshly
   *     re-registered handlers without spinning up a second server.
   *   - `prerenderRoutes` is imported lazily to keep the `dev` command
   *     cold-start budget untouched.
   *
   * This closes the "pure-SSR project: edit `src/shared/*` → `curl /` still
   * returns old HTML" report from issue #188.
   */
  const regeneratePrerenderedStatics = async (): Promise<void> => {
    const staticDir = path.join(rootDir, ".mandu", "static");
    // Lazy — we only need these when the project actually has prerender.
    const fsPromises = await import("node:fs/promises");
    const exists = await fsPromises
      .access(staticDir)
      .then(() => true)
      .catch(() => false);
    if (!exists) return;

    // Find pure-SSR routes (no hydration / strategy === "none").
    const pureSsrRoutes = manifest.routes.filter(
      (r) =>
        r.kind === "page" &&
        (!r.hydration || r.hydration.strategy === "none") &&
        !r.pattern.includes(":"), // skip dynamic patterns — too risky without generateStaticParams
    );
    if (pureSsrRoutes.length === 0) return;

    const { prerenderRoutes } = await import("@mandujs/core/bundler/prerender");

    const devServer = server; // captured via closure from outer scope
    const basePort = devServer.server.port;
    // For internal prerender fetch, use loopback — 0.0.0.0 is not a valid
    // destination. See #190.
    const hostname = resolveDisplayHost(serverConfig.hostname);

    const fetchHandler = async (req: Request) => {
      const url = new URL(req.url);
      return fetch(`http://${hostname}:${basePort}${url.pathname}${url.search}`);
    };

    const result = await prerenderRoutes(manifest, fetchHandler, {
      rootDir,
      routes: pureSsrRoutes.map((r) => r.pattern),
      crawl: false,
    });

    if (result.generated > 0) {
      console.log(`  Prerender: ${result.generated} page(s) regenerated`);
    }
    if (result.errors.length > 0) {
      console.warn(
        `  Prerender warnings (${result.errors.length}):`,
        result.errors.slice(0, 3).join("; "),
      );
    }
  };

  // API route file change callback (route.ts -> re-register API handler + browser reload)
  //
  // Phase 7.3 A — perf wrap added.
  //
  // `handleAPIChange` was missing a top-level `withPerf()` wrapping, which
  // meant MANDU_PERF=1 traces couldn't attribute the total walltime of an
  // API route reload (only the inner `register-handlers` marker fired).
  // Phase 7.2 §7.4 (docs/bun/phase-7-2-benchmarks.md) flagged this as a
  // Phase 7.3 follow-up.
  //
  // We use the NEW `API_HANDLER_RELOAD` marker rather than re-using
  // `SSR_HANDLER_RELOAD` so benchmarks can separate page-reload from
  // API-reload populations. The two code paths have different cost
  // profiles (API = single-module import; SSR = page + layout chain),
  // and commingling them hides API regressions behind page noise.
  const handleAPIChange = (filePath: string): Promise<void> =>
    withPerf(HMR_PERF.API_HANDLER_RELOAD, async () => {
      logDevEvent("API route changed", [
        `File: ${path.relative(rootDir, filePath)}`,
        "Action: re-register API handler",
      ]);
      // Phase 7.0 B5 wire-up — single-file change, let incremental path hit.
      await registerHandlers(manifest, true, filePath);

      // Broadcast file change for Kitchen Preview
      hmrServer?.broadcast({
        type: "kitchen:file-change",
        data: {
          file: filePath,
          changeType: "change",
          timestamp: Date.now(),
        },
      });

      hmrServer?.broadcast({
        type: "reload",
        data: { timestamp: Date.now() },
      });
      console.log("  Status: API handler refreshed");
    });

  // Phase 7.0 R2 Agent D — config/env reload → auto-restart the dev server.
  //
  // Wiring to `restartDevServer()` is the only reliable path because
  // `process.env.KEY` is cached per-process in Node; reloading `.env`
  // without a restart leaves stale values in any module that already
  // captured them. Same story for `mandu.config.ts` — plugin instances
  // and middleware stacks are built at boot.
  const handleConfigReload = async (filePath: string) => {
    const rel = path.relative(rootDir, filePath);
    logDevEvent("Config/env changed", [
      `File: ${rel}`,
      "Action: full dev server restart",
      "Browser: full reload after restart",
    ]);
    try {
      await restartDevServer();
    } catch (err) {
      console.error(
        `[Mandu HMR] config-reload restart failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  // Phase 7.0 R2 Agent D — resource/contract change → regenerate artifacts.
  //
  // For `.resource.ts` we run the full generator (contract + types + slot +
  // client + repo) so every derived file under `.mandu/generated/` stays
  // consistent. For `.contract.ts` we only need to re-register SSR handlers
  // because the Zod contract is imported lazily by the route — but the
  // same wildcard signal covers both paths cheaply.
  //
  // Imports are dynamic (lazy) so the `dev` command boot path doesn't pay
  // the parse cost when the project has no resources.
  const handleResourceChange = async (filePath: string) => {
    const rel = path.relative(rootDir, filePath);
    const isResource = filePath.endsWith(".resource.ts") || filePath.endsWith(".resource.tsx");
    logDevEvent("Resource/contract changed", [
      `File: ${rel}`,
      isResource ? "Action: regenerate artifacts + re-register handlers" : "Action: re-register handlers (contract)",
    ]);

    if (isResource) {
      try {
        // Lazy import from the core barrel (`@mandujs/core`) so projects
        // without any resources don't parse the generator at dev boot.
        // `generate-resource.ts` uses the same barrel for these exports.
        const core = await import("@mandujs/core");
        const parsed = await core.parseResourceSchema(filePath);
        const result = await core.generateResourceArtifacts(parsed, { rootDir });
        if (result.success) {
          console.log(
            `  Regenerated: ${result.created.length} artifact(s), skipped: ${result.skipped.length}`,
          );
        } else {
          console.warn(
            `  Regeneration errors (${result.errors.length}):`,
            result.errors.slice(0, 3).join("; "),
          );
        }
      } catch (err) {
        console.error(
          `[Mandu HMR] generateResourceArtifacts failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Kitchen Preview signal — so the devtools UI can highlight the change
    // even when the user is already looking at a page that doesn't import
    // the affected contract.
    hmrServer?.broadcast({
      type: "kitchen:file-change",
      data: {
        file: filePath,
        changeType: "change",
        timestamp: Date.now(),
      },
    });
  };

  // Phase 7.0 R2 Agent D — package.json change → advisory only.
  //
  // We intentionally do NOT auto-restart. `bun install` and friends write
  // `package.json` multiple times in quick succession; a naive auto-
  // restart would loop mid-install. Users who intend to pick up new
  // deps press 'r' (dev-shortcuts) or kill and restart manually.
  const handlePackageJsonChange = (filePath: string) => {
    const rel = path.relative(rootDir, filePath);
    logDevEvent("package.json changed", [
      `File: ${rel}`,
      "Action: restart required (press 'r' to restart manually)",
      "Note: automatic restart disabled — dependencies may be mid-install",
    ]);
  };

  const restartDevServer = async () => {
    clearDefaultRegistry();
    registeredLayouts.clear();

    const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;
    await registerHandlers(manifest, true);

    if (hmrServer) {
      devBundler?.close();
      devBundler = await startDevBundler({
        rootDir,
        manifest,
        watchDirs: devConfig.watchDirs,
        onRebuild: handleRebuild,
        onError: handleBundlerError,
        onSSRChange: handleSSRChange,
        onAPIChange: handleAPIChange,
        onConfigReload: handleConfigReload,
        onResourceChange: handleResourceChange,
        onPackageJsonChange: handlePackageJsonChange,
      });

      hmrServer.broadcast({
        type: "reload",
        data: { timestamp: Date.now() },
      });
    }

    console.log("Restart complete.");
  };

  if (hmrEnabled) {
    // HMR 서버는 island 유무와 무관하게 시작 (SSR 페이지에서도 CSS/페이지 리로드 필요)
    // Bind HMR to same hostname as main server so dual-stack/wildcard binds match (#190).
    mark(HMR_PERF.BOOT_HMR_SERVER);
    hmrServer = createHMRServer(port, {
      hostname: serverConfig.hostname,
    });
    measure(HMR_PERF.BOOT_HMR_SERVER, HMR_PERF.BOOT_HMR_SERVER);
    hmrServer.setRestartHandler(async () => {
      await restartDevServer();
    });

    // Dev bundler: 파일 감시 + 리빌드 (island이 있으면 island 리빌드, 없어도 SSR 변경 감지)
    devBundler = await startDevBundler({
      rootDir,
      manifest,
      watchDirs: devConfig.watchDirs,
      onRebuild: handleRebuild,
      onError: handleBundlerError,
      onSSRChange: handleSSRChange,
      onAPIChange: handleAPIChange,
      onConfigReload: handleConfigReload,
      onResourceChange: handleResourceChange,
      onPackageJsonChange: handlePackageJsonChange,
    });
  }

  // Start main server
  mark(HMR_PERF.BOOT_START_SERVER);
  const server = startServer(manifest, {
    port,
    hostname: serverConfig.hostname,
    rootDir,
    isDev: true,
    hmrPort: hmrServer ? port : undefined,
    bundleManifest: devBundler?.initialBuild.manifest,
    cors: serverConfig.cors,
    streaming: serverConfig.streaming,
    rateLimit: serverConfig.rateLimit,
    // Inject CSS link only when Tailwind detected
    cssPath: hasTailwind ? cssWatcher?.serverPath : false,
    guardConfig,
    cache: true,
    managementToken,
    // Issue #192 — smooth navigation primitives (View Transitions +
    // hover prefetch). Both default to true at SSR layer; pass through
    // from config so explicit opt-out (`transitions: false`) is honored.
    transitions: config.transitions,
    prefetch: config.prefetch,
    // Issue #191 — dev-only `_devtools.js` (~1.15 MB) injection override.
    // `undefined` keeps the default auto-detect (inject iff hasIslands).
    // Explicit `true` / `false` force on / off.
    devtools: config.dev?.devtools,
  });
  measure(HMR_PERF.BOOT_START_SERVER, HMR_PERF.BOOT_START_SERVER);

  const actualPort = server.server.port ?? port;
  if (actualPort !== port) {
    if (hmrServer) {
      hmrServer.close();
      hmrServer = createHMRServer(actualPort, {
        hostname: serverConfig.hostname,
      });
      hmrServer.setRestartHandler(async () => {
        await restartDevServer();
      });
      server.registry.settings.hmrPort = actualPort;
      console.log(`HMR port updated: ${actualPort + HMR_OFFSET}`);
    }
  }

  // For user-facing URL (browser open, runtime control), prefer `localhost`
  // when binding to wildcard — browsers can't navigate to 0.0.0.0. See #190.
  const displayHost = resolveDisplayHost(serverConfig.hostname);
  const openUrl = `http://${displayHost}:${actualPort}`;

  // --open 옵션: 브라우저 자동 열기
  if (options.open) {
    openBrowser(openUrl);
  }

  // 시작 시간 표시
  const elapsed = Math.round(performance.now() - devStartTime);
  const readySummary = renderDevReadySummary({
    url: openUrl,
    hmrUrl: hmrServer ? `ws://localhost:${actualPort + HMR_OFFSET}` : undefined,
    guardLabel: guardConfig ? `${guardPreset} (watching)` : "disabled",
    pageCount: routeStats.pageCount,
    apiCount: routeStats.apiCount,
    islandCount: routeStats.islandCount,
    readyMs: elapsed,
  });
  console.log(readySummary);

  await writeRuntimeControl(rootDir, {
    mode: "dev",
    port: actualPort,
    token: managementToken,
    baseUrl: openUrl,
    startedAt: new Date().toISOString(),
  });

  await runHook("onDevStart", plugins, hooks, {
    port: actualPort,
    hostname: displayHost,
  });

  // FS Routes real-time watching
  const routesWatcher = await withPerf(HMR_PERF.BOOT_WATCH_FS_ROUTES, () =>
    watchFSRoutes(rootDir, {
      onChange: async (result) => {
        // Clear registry (including layout cache)
        clearDefaultRegistry();

        // Update server with new manifest
        manifest = result.manifest;
        logDevEvent("Route manifest updated", [
          `Routes: ${manifest.routes.length}`,
          "Browser: full reload",
        ]);

        // Re-register routes (isReload = true)
        await registerHandlers(manifest, true);

        // HMR broadcast (full reload)
        if (hmrServer) {
          hmrServer.broadcast({
            type: "reload",
            data: { timestamp: Date.now() },
          });
        }
      },
    }),
  );

  // Architecture Guard real-time watch (optional)
  let archGuardWatcher: ReturnType<typeof createGuardWatcher> | null = null;
  let guardFailed = false;
  let shortcutCleanup: (() => void) | null = null;

  // Cleanup function
  const cleanup = () => {
    console.log("\nStopping dev server...");
    void runHook("onDevStop", plugins, hooks);
    server.stop();
    devBundler?.close();
    hmrServer?.close();
    cssWatcher?.close();
    routesWatcher.close();
    archGuardWatcher?.close();
    shortcutCleanup?.();
    // Phase 6-1: SQLite store 정리
    // Phase 7.1 R1 Agent C — wait for the fire-and-forget startSqliteStore
    // promise before calling stop. If the user hits Ctrl-C while the store
    // is still initializing, stopSqliteStore would be a no-op (dbInstance
    // still null), leaking the file descriptor. Awaiting first ensures we
    // either (a) stop a fully-open db, or (b) the promise rejection path
    // ran and stop is still a safe no-op.
    void sqliteStorePromise
      .then(() =>
        import("@mandujs/core/observability").then((m) => m.stopSqliteStore?.()),
      )
      .catch(() => {});
    void removeRuntimeControl(rootDir).finally(() => {
      process.exit(0);
    });
  };

  const stopOnGuardError = (violation: Violation) => {
    if (violation.severity !== "error" || guardFailed) {
      return;
    }
    guardFailed = true;
    console.error("\nArchitecture Guard violation detected. Stopping dev server.");
    cleanup();
  };

  if (guardConfig) {
    archGuardWatcher = createGuardWatcher({
      config: guardConfig,
      rootDir,
      onViolation: stopOnGuardError,
      onFileAnalyzed: (analysis, violations) => {
        if (violations.length > 0) {
          // Broadcast as HMR error
          hmrServer?.broadcast({
            type: "guard-violation",
            data: {
              file: analysis.filePath,
              violations: violations.map((v) => ({
                line: v.line,
                message: `${v.fromLayer} -> ${v.toLayer}: ${v.ruleDescription}`,
              })),
            },
          });
        }
      },
    });

    archGuardWatcher.start();
  }

  if (shouldEnableDevShortcuts()) {
    shortcutCleanup = attachDevShortcuts({
      openUrl,
      readySummary,
      rootDir,
      restart: restartDevServer,
      cleanup,
    });
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function attachDevShortcuts(options: {
  openUrl: string;
  readySummary: string;
  rootDir: string;
  restart: () => Promise<void>;
  cleanup: () => void;
}): (() => void) | null {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return null;
  }

  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  // MCP activity monitor state — Phase 2-2: EventBus 기반 (#ATIVITY-LOG)
  let mcpMonitorActive = false;
  let mcpUnsubscribe: (() => void) | null = null;

  const toggleMonitor = async () => {
    mcpMonitorActive = !mcpMonitorActive;
    if (mcpMonitorActive) {
      console.log("\n🤖 MCP activity: ON (press 'm' again to stop)");
      const { eventBus } = await import("@mandujs/core/observability");
      mcpUnsubscribe = eventBus.on("mcp", (event) => {
        if (!mcpMonitorActive) return;
        const ts = new Date().toLocaleTimeString();
        const dur = event.duration ? ` ${Math.round(event.duration)}ms` : "";
        console.log(`[${ts}] 🤖 ${event.message}${dur}`);
      });
    } else {
      mcpUnsubscribe?.();
      mcpUnsubscribe = null;
      console.log("\n🤖 MCP activity: OFF");
    }
  };

  const onData = async (chunk: string) => {
    if (chunk === "\u0003") {
      options.cleanup();
      return;
    }

    await handleDevShortcutInput(chunk, {
      clearScreen: () => {
        console.clear();
        console.log(options.readySummary);
      },
      openBrowser: () => openBrowser(options.openUrl),
      restartServer: options.restart,
      toggleMonitor,
      quit: options.cleanup,
    });
  };

  stdin.on("data", onData);

  return () => {
    stdin.off("data", onData);
    stdin.setRawMode?.(false);
    mcpUnsubscribe?.();
  };
}
