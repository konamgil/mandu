/**
 * Phase 7.0 — HMR perf marker names (B4 fix)
 *
 * Purpose: give Agent B (incremental bundled import), Agent A (reliability),
 * and Agent F (perf validation) a single vocabulary for marker names passed
 * to `mark()` / `measure()` / `withPerf()`.
 *
 * Why a shared module: in Phase 7.0 diagnostics we found that
 * `cli/commands/dev.ts:322-363`'s `handleSSRChange` chain has NO perf
 * markers — `dev:rebuild` wraps only `_doBuild`, so the true SSR rebuild
 * walltime (1.5~2 s vs 200ms target) is invisible. Without consistent
 * marker naming across agents, each would pick ad-hoc strings and
 * Agent F's benchmark script would have to grep for a hundred variants.
 *
 * When adding new markers:
 *   1. Add the constant here.
 *   2. Use it in production code as `mark(HMR_PERF.SSR_HANDLER_RELOAD)`
 *      (not a string literal).
 *   3. Update `docs/bun/phase-7-benchmarks.md` (Agent F owns it).
 *
 * References:
 *   docs/bun/phase-7-diagnostics/performance-reliability.md §2 B4
 *   docs/bun/phase-7-team-plan.md §3.2
 */

/**
 * All HMR-related perf markers. String literals are frozen — do not
 * mutate. Marker names follow the `<area>:<step>` convention so grep
 * and log aggregation work predictably.
 */
export const HMR_PERF = {
  // ─── File detection → build invocation ─────────────────────────────────

  /** Raw fs event received (watcher). */
  FILE_DETECT: "hmr:file-detect",

  /** After per-file debounce, before `handleFileChange()` runs. */
  DEBOUNCE_FLUSH: "hmr:debounce-flush",

  /** Coalesced batch dispatched to the rebuild path. */
  BATCH_DISPATCH: "hmr:batch-dispatch",

  // ─── Rebuild outer frame ───────────────────────────────────────────────

  /** Wall-clock from batch dispatch → WS broadcast complete. The P95
   *  target (≤50 ms island / ≤200 ms SSR / ≤500 ms cold) is measured on
   *  this marker. */
  REBUILD_TOTAL: "hmr:rebuild-total",

  /** `_doBuild` body (covers both `buildClientBundles` + SSR path). */
  DO_BUILD: "hmr:do-build",

  // ─── SSR handler reload chain (B4 newly-instrumented) ──────────────────

  /** `handleSSRChange` mutex section — from enter to exit. */
  SSR_HANDLER_RELOAD: "ssr:handler-reload",

  /** `bundledImport` call — the single largest SSR cost today. Incremental
   *  path (Agent B) should target near-zero on cache hits. */
  SSR_BUNDLED_IMPORT: "ssr:bundled-import",

  /** `clearDefaultRegistry` + `registeredLayouts.clear` (fast). */
  SSR_CLEAR_REGISTRY: "ssr:clear-registry",

  /** `registerManifestHandlers(manifest, true)` — per-route re-registration. */
  SSR_REGISTER_HANDLERS: "ssr:register-handlers",

  /** Prerender regeneration (issue #188 fix). Measures only the prerender
   *  re-run, not the HTML delivery. */
  PRERENDER_REGEN: "prerender:regen",

  // ─── Client bundle path ────────────────────────────────────────────────

  /** Per-island rebuild. Sub-marker of DO_BUILD when kind === "islands-only". */
  ISLAND_REBUILD: "island:rebuild",

  /** Framework bundle (runtime/router/vendor/devtools). Should be SKIPPED
   *  on common-dir rebuild (fire when skipFrameworkBundles === false). */
  FRAMEWORK_REBUILD: "framework:rebuild",

  /** Vendor shim build. Sub-marker of FRAMEWORK_REBUILD. */
  VENDOR_SHIM_BUILD: "framework:vendor-shim",

  // ─── HMR transport ─────────────────────────────────────────────────────

  /** Time to serialize + send to all connected clients. */
  HMR_BROADCAST: "hmr:broadcast",

  /** Replay buffer enqueue (B8). */
  HMR_REPLAY_ENQUEUE: "hmr:replay-enqueue",

  /** Client reconnect — `?since=<id>` processing. */
  HMR_REPLAY_FLUSH: "hmr:replay-flush",

  // ─── Incremental bundled import internals (Agent B) ────────────────────

  /** Import graph lookup for a root path. */
  INCR_GRAPH_LOOKUP: "incr:graph-lookup",

  /** Cache hit (no rebuild needed — changed file not in descendants). */
  INCR_CACHE_HIT: "incr:cache-hit",

  /** Cache miss (rebuild required). */
  INCR_CACHE_MISS: "incr:cache-miss",

  /** Graph rebuild after new build — updates descendants map. */
  INCR_GRAPH_UPDATE: "incr:graph-update",

  // ─── Cold boot path (Phase 7.1 B_gap — R0.3 diagnostic identified 9
  //     unmeasured stages accounting for 150~210 ms of the 626 ms cold
  //     start. Instrumenting these unlocks Tier 1 / Tier 2 optimizations.) ─

  /** `validateAndReport(rootDir)` — mandu.config.ts load + schema check. */
  BOOT_VALIDATE_CONFIG: "boot:validate-config",

  /** `validateRuntimeLockfile` — bun.lock check + advisory warnings. */
  BOOT_LOCKFILE_CHECK: "boot:lockfile-check",

  /** `loadEnv({ rootDir, env: "development" })` — .env / .env.development. */
  BOOT_LOAD_ENV: "boot:load-env",

  /** `startSqliteStore(rootDir)` — observability store (optional). Should
   *  become fire-and-forget in Tier 1 so it doesn't block ready. */
  BOOT_SQLITE_START: "boot:sqlite-start",

  /** `checkDirectory(guardConfig, rootDir)` — Architecture Guard preflight. */
  BOOT_GUARD_PREFLIGHT: "boot:guard-preflight",

  /** `resolveAvailablePort(desiredPort, ...)` — port probe (may be slow on
   *  Windows due to TIME_WAIT; Phase 0 already added retry). */
  BOOT_RESOLVE_PORT: "boot:resolve-port",

  /** `createHMRServer(port, options?)` — Bun.serve + WebSocket + replay
   *  buffer setup. Phase 7.0.R4 added Origin allowlist + rate limit. */
  BOOT_HMR_SERVER: "boot:hmr-server",

  /** `startServer(manifest, ...)` — Bun.serve for the actual app. */
  BOOT_START_SERVER: "boot:start-server",

  /** `watchFSRoutes(...)` — chokidar watcher for spec/slots + app/ routes.
   *  Phase 7.1.A may not be able to remove this; it tracks new-route
   *  creation which `_doBuild` does not. */
  BOOT_WATCH_FS_ROUTES: "boot:watch-fs-routes",
} as const;

/**
 * Union of all marker names — useful when a function accepts an arbitrary
 * marker as a parameter and you want compile-time exhaustiveness.
 */
export type HMRPerfMarker = (typeof HMR_PERF)[keyof typeof HMR_PERF];

/**
 * Human-readable target thresholds. Source of truth for Agent F's hard
 * assertion pass/fail logic. Values in milliseconds.
 */
export const HMR_PERF_TARGETS = {
  /** Cold dev start (`mandu dev` → "ready" log). */
  COLD_START_MS: 500,

  /** Island-only rebuild P95, measured on REBUILD_TOTAL. */
  ISLAND_REBUILD_P95_MS: 50,

  /** SSR page rebuild P95, measured on REBUILD_TOTAL when kind === "ssr-only". */
  SSR_REBUILD_P95_MS: 200,

  /** Common-dir rebuild P95 (fan-out across multiple islands/SSR modules). */
  COMMON_DIR_REBUILD_P95_MS: 400,

  /** CSS-only rebuild P95. */
  CSS_REBUILD_P95_MS: 100,
} as const;
