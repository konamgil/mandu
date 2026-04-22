import path from "path";
import { readJsonFile } from "../utils/bun";
import type { ManduAdapter } from "../runtime/adapter";
import type { ManduPlugin, ManduHooks } from "../plugins/hooks";
import type { Middleware } from "../middleware/define";
import type { RpcDefinition, RpcProcedureRecord } from "../contract/rpc";
import type { CronDef } from "../scheduler";
import type { GuardRule as CustomGuardRule } from "../guard/define-rule";
import type { I18nStrategy, LocaleCode } from "../i18n/types";

export type GuardRuleSeverity = "error" | "warn" | "warning" | "off";

/**
 * Test block configuration (Phase 12.1 — testing ecosystem).
 *
 * Shapes the CLI `mandu test` command's discovery, fixture, and reporter
 * behaviour. All fields are optional; omitting the block yields sensible
 * defaults that match Next.js / SvelteKit user expectations:
 *
 *   - unit    → `**\/*.test.ts` / `**\/*.test.tsx`, 30s timeout
 *   - integration → `tests/integration/**\/*.test.ts`, in-memory fixtures
 *   - e2e     → reserved for Phase 12.2 (ATE integration)
 *   - coverage → reserved for Phase 12.3 (bun + playwright merge)
 */
export interface TestUnitConfig {
  /** Glob patterns for unit test files. Default: `["**\/*.test.ts", "**\/*.test.tsx"]`. */
  include?: string[];
  /** Glob patterns to exclude (applied after `include`). Default: `["node_modules/**", ".mandu/**", "dist/**"]`. */
  exclude?: string[];
  /** Per-test timeout in milliseconds. Default: `30_000` (30s). */
  timeout?: number;
}

export interface TestIntegrationConfig {
  /** Glob patterns for integration test files. Default: `["tests/integration/**\/*.test.ts"]`. */
  include?: string[];
  /** Glob patterns to exclude. Default: same as unit defaults. */
  exclude?: string[];
  /**
   * Database URL for fixtures. Default: `"sqlite::memory:"` (in-memory SQLite).
   * Accepts any Bun.sql-compatible URL — see `@mandujs/core/db` for the schema matrix.
   */
  dbUrl?: string;
  /**
   * Session storage strategy for `createTestSession`.
   * - `"memory"` (default): CookieSessionStorage with ephemeral secret
   * - `"sqlite"`: bun:sqlite-backed (Phase 2.5 storage, requires Phase 4)
   */
  sessionStore?: "memory" | "sqlite";
  /** Per-test timeout. Default: `60_000` (60s — integration work is slower). */
  timeout?: number;
}

export interface TestE2EConfig {
  /** Reserved for Phase 12.2. Currently a typed placeholder. */
  reserved?: true;
}

export interface TestCoverageConfig {
  /** Minimum line coverage percentage (0-100). Reserved for Phase 12.3. */
  lines?: number;
  /** Minimum branch coverage percentage (0-100). Reserved for Phase 12.3. */
  branches?: number;
}

export interface TestConfig {
  unit?: TestUnitConfig;
  integration?: TestIntegrationConfig;
  e2e?: TestE2EConfig;
  coverage?: TestCoverageConfig;
}

export interface ManduConfig {
  adapter?: ManduAdapter;
  /**
   * Issue #192 — Enable CSS View Transitions for cross-document
   * navigations. When `true` (default) Mandu injects
   * `<style>@view-transition { navigation: auto; }</style>` into the SSR
   * `<head>`, which lets supporting browsers (Chrome/Edge ≥ 111) play a
   * crossfade between the outgoing and incoming pages. Non-supporting
   * browsers ignore the at-rule and fall back to the classic
   * full-reload — zero regression.
   *
   * Set to `false` to opt out entirely (e.g. if your app ships a
   * hand-rolled navigation animation or a conflicting CSS rule).
   *
   * Default: `true`.
   */
  transitions?: boolean;
  /**
   * Issue #192 — Enable hover-based link prefetch. When `true` (default)
   * Mandu injects a ~500-byte inline script that listens for `mouseover`
   * events on internal links (`<a href="/...">`) and issues a
   * `<link rel="prefetch">` for each unique target. The browser's HTTP
   * cache services the subsequent navigation, removing most of the TTFB
   * for above-the-fold links.
   *
   * Per-link opt-out: add `data-no-prefetch` to an `<a>` tag to skip it.
   * Global opt-out: set this field to `false`.
   *
   * Default: `true`.
   */
  prefetch?: boolean;
  /**
   * Issue #193 — Enable opt-out SPA navigation. When `true` (default)
   * Mandu intercepts every internal same-origin `<a href="/...">` click
   * and routes it through the client-side router, using the View
   * Transitions API where available for a zero-flash experience. Plain
   * `<a href="/about">` tags "just work" without a component wrapper.
   *
   * Escape hatches (the anchor always falls through to the browser):
   *   - Per-link opt-out: `data-no-spa` on the `<a>` tag.
   *   - External / cross-origin `href`.
   *   - `mailto:` / `tel:` / `javascript:` / etc. (non-http schemes).
   *   - `target="_blank"` (any `target` other than `_self`).
   *   - `download` attribute.
   *   - Modifier keys (Ctrl / Cmd / Shift / Alt) or middle/right-click.
   *
   * Global opt-out: set this field to `false` to revert to the legacy
   * opt-in behavior, where only `<a data-mandu-link href="/...">` is
   * intercepted. This is a breaking-change escape hatch for projects
   * that relied on the pre-v0.22 default.
   *
   * Default: `true`.
   */
  spa?: boolean;
  server?: {
    port?: number;
    /**
     * Bind hostname for the HTTP server.
     *
     * Default: `"::"` (IPv6 wildcard, dual-stack). Bun leaves
     * `IPV6_V6ONLY` off, so this one socket accepts both IPv6 clients
     * (e.g. Node 17+ `fetch("localhost:PORT")` on Windows resolves to
     * `::1`) and IPv4 clients (as IPv4-mapped IPv6) — you effectively
     * get `0.0.0.0` + `::` for free.
     *
     * Set `"0.0.0.0"` to bind IPv4 only (container/firewall setups that
     * need it). Note: on Windows, an IPv4-only bind makes Node's
     * `fetch("localhost:PORT")` fail with `ECONNREFUSED ::1:PORT`
     * because Node prefers the IPv6 address for `localhost`. `curl`
     * and browsers silently fall back to IPv4, hiding the bug — Mandu
     * emits a one-line warning on Windows when you pick this value
     * explicitly so the trap is discoverable.
     *
     * Set `"127.0.0.1"` or `"::1"` to bind loopback-only (no LAN
     * visibility). Set any other value (e.g. `"10.0.0.2"`,
     * `"myhost.example.com"`) to bind that specific interface.
     *
     * @see issues #190 #223 #225
     */
    hostname?: string;
    cors?:
      | boolean
      | {
          origin?: string | string[];
          methods?: string[];
          credentials?: boolean;
        };
    streaming?: boolean;
    rateLimit?:
      | boolean
      | {
          windowMs?: number;
          max?: number;
          message?: string;
          statusCode?: number;
          headers?: boolean;
        };
  };
  guard?: {
    preset?: "mandu" | "fsd" | "clean" | "hexagonal" | "atomic" | "cqrs";
    srcDir?: string;
    exclude?: string[];
    realtime?: boolean;
    /**
     * Built-in rule severity overrides (map) OR consumer-defined
     * custom rules (array). The Guard runner dispatches on shape:
     *
     *   - `Record<string, GuardRuleSeverity>` → override severity of
     *     Mandu's built-in rules by id.
     *   - `GuardRule[]` (Phase 18.ν) → register consumer-defined rules
     *     alongside the built-in presets. See `@mandujs/core/guard/define-rule`.
     *
     * Passing both at once is not supported; pick one shape per config.
     * Mixed input falls back to "custom rules only" and the built-in
     * rule severity overrides become unreachable.
     */
    rules?: Record<string, GuardRuleSeverity> | CustomGuardRule[];
    contractRequired?: GuardRuleSeverity;
    /**
     * Issue #207 — hard-fail on direct `__generated__/` imports at the
     * bundler level. When `true` (default), every `mandu dev` /
     * `mandu build` pass installs the
     * `mandu:block-generated-imports` Bun plugin, which throws
     * `ForbiddenGeneratedImportError` the moment any source file
     * resolves an import whose specifier contains `__generated__`.
     *
     * Set to `false` only when a migration path literally requires
     * the legacy barrel re-export pattern. User code should always
     * prefer `getGenerated()` from `@mandujs/core/runtime`; see
     * https://mandujs.com/docs/architect/generated-access.
     *
     * Default: `true`.
     */
    blockGeneratedImport?: boolean;
  };
  build?: {
    outDir?: string;
    minify?: boolean;
    sourcemap?: boolean;
    splitting?: boolean;
    /**
     * Phase 18.η — emit `.mandu/analyze/report.html` + `report.json` after
     * a successful build. Equivalent to `mandu build --analyze`. Default:
     * `false`. Report artefacts are self-contained (no CDN, no external
     * JS) and safe to commit to a private dashboard or inspect locally.
     *
     * The CLI `--analyze` flag wins over this field; `--analyze=json`
     * writes JSON only (useful for CI, skips the HTML render cost).
     */
    analyze?: boolean;
    /**
     * Issue #213 — tune the prerender link-crawler.
     *
     * The crawler (enabled by `mandu build` when `build.prerender !== false`)
     * scans rendered HTML for `<a href="/...">` and enqueues those paths
     * for prerendering. Doc sites that ship code examples (`<pre><code>
     * &lt;Link href="/path" /&gt;</code></pre>`) previously leaked those
     * illustrative URLs into the render queue, producing spurious
     * `.mandu/static/path/index.html` files.
     *
     * The engine strips `<pre>`, `<code>`, fenced markdown, and inline
     * code spans before scanning. It also applies a small default
     * denylist of placeholder paths (`/path`, `/example`, `/your-*`,
     * etc.). Use this block to extend or replace the denylist for your
     * project.
     */
    /**
     * Phase 18.φ — bundle-size budget. Declaring any field turns on
     * framework-level size-ceiling enforcement during `mandu build`.
     *
     *   - `maxRawBytes`      : per-island raw-byte cap.
     *   - `maxGzBytes`       : per-island gzip-byte cap.
     *   - `maxTotalRawBytes` : project-wide raw cap (islands + shared).
     *   - `maxTotalGzBytes`  : project-wide gzip cap.
     *   - `perIsland`        : per-island overrides, additive per axis.
     *                          `{ home: { gz: 50_000 } }` tightens only
     *                          `home`'s gzip and leaves its raw cap at
     *                          the global `maxRawBytes`.
     *   - `mode`             : `'warning'` (default) prints a table and
     *                          continues; `'error'` exits non-zero.
     *
     * Declaring the empty block `budget: {}` is interpreted as "I know
     * about budgets" and auto-applies a 250 KB gzip per-island ceiling
     * (matches Next.js `largePageDataBytes` + Astro rules of thumb).
     * Omitting the block entirely is the zero-overhead opt-out.
     *
     * CLI override: `mandu build --no-budget` skips enforcement for a
     * single run regardless of config.
     *
     * @see `docs/architect/bundle-budget.md`
     * @see `@mandujs/core/bundler/budget`
     */
    budget?: {
      maxRawBytes?: number;
      maxGzBytes?: number;
      maxTotalRawBytes?: number;
      maxTotalGzBytes?: number;
      perIsland?: Record<string, { raw?: number; gz?: number }>;
      mode?: "error" | "warning";
    };
    crawl?: {
      /**
       * Extra pathnames or simple globs (`*`) to exclude when crawling.
       * Merged with the built-in default denylist unless
       * {@link replaceDefaultExclude} is `true`.
       */
      exclude?: string[];
      /**
       * When `true`, `exclude` replaces the built-in denylist entirely.
       * Default `false`.
       */
      replaceDefaultExclude?: boolean;
      /**
       * Issue #219 — file extensions treated as non-HTML assets. When
       * a discovered href's pathname ends with one of these, the
       * crawler skips it instead of enqueuing it for prerender.
       *
       * Example: `<picture><source srcset="/hero.avif"><img
       * src="/hero.webp"></picture>` used to make the engine render
       * the asset URL as HTML and overwrite the real `.webp` on disk.
       * The default set covers common image / font / document /
       * media / text-asset extensions.
       *
       * Entries may be written with or without a leading dot
       * (`"webp"` and `".webp"` are equivalent). Matching is
       * case-insensitive; query strings and hash fragments are
       * stripped before comparison.
       *
       * Merged with the built-in default set unless
       * {@link replaceDefaultAssetExtensions} is `true`.
       */
      assetExtensions?: string[];
      /**
       * When `true`, `assetExtensions` replaces the built-in set
       * entirely. Default `false`.
       */
      replaceDefaultAssetExtensions?: boolean;
    };
  };
  dev?: {
    hmr?: boolean;
    watchDirs?: string[];
    /** Observability SQLite 영구 저장 (기본: true) */
    observability?: boolean;
    /**
     * Issue #191 — Dev-only `_devtools.js` (~1.15 MB React dev runtime +
     * Mandu Kitchen panel) injection override.
     *
     *   - `true`      → force inject on every page (SSR-only projects that
     *                   still want the Kitchen panel in dev).
     *   - `false`     → force skip on every page (Kitchen-off dev loop).
     *   - `undefined` → default. Inject iff the page's bundle manifest
     *                   has at least one island. Pure-SSR pages download
     *                   zero devtools bytes.
     *
     * Production builds never emit `_devtools.js`, so this flag is
     * a no-op in prod regardless of value.
     */
    devtools?: boolean;
    /**
     * Issue #196 — Auto-run `scripts/prebuild-*.ts` before `mandu dev`
     * boots, and re-run them when files under `contentDir` change in
     * watch mode.
     *
     *   - `true`      → always run discovered prebuild scripts, regardless
     *                   of whether `content/` exists (useful for projects
     *                   that ship generators that write outside `content/`).
     *   - `false`     → never auto-run. User stays responsible for the
     *                   chain (`bun scripts/prebuild-*.ts && mandu dev`).
     *   - `undefined` → default. Auto-enabled iff the project has a
     *                   `content/` directory OR at least one
     *                   `scripts/prebuild-*.ts`. Silent no-op otherwise.
     *
     * See `@mandujs/core/content/prebuild` for the discovery + execution
     * contract.
     */
    autoPrebuild?: boolean;
    /**
     * Issue #196 — Directory whose changes trigger a watch-mode
     * prebuild re-run. Defaults to `"content"`. Ignored when
     * `autoPrebuild === false`. Relative to project root.
     */
    contentDir?: string;
    /**
     * Issue #203 — Per-script wall-clock timeout for prebuild scripts
     * (milliseconds). Default: `120_000` (2 minutes), matching the MCP
     * `runCommand()` convention (#136). Override for projects that ship
     * slow seed generators (e.g. large docs indexers, image pipelines).
     *
     * Precedence at runtime, highest first:
     *   1. `MANDU_PREBUILD_TIMEOUT_MS` env var — useful for one-off CI
     *      overrides without committing to the config.
     *   2. This field (`dev.prebuildTimeoutMs`).
     *   3. Default 120_000 ms.
     *
     * When the timeout fires, `runPrebuildScripts` throws a
     * `PrebuildTimeoutError` whose message names the failing script path,
     * the limit, AND the two override paths — so the user does not need
     * to re-read this comment to recover.
     */
    prebuildTimeoutMs?: number;
    /**
     * Phase 18.α — Dev-only full-screen error overlay (Next.js / Astro
     * style). When `true` (default) Mandu injects a ~10 KB inline
     * `<style>` + `<script>` block into every dev SSR response that
     * renders a modal on:
     *
     *   - `window.onerror` — uncaught script errors
     *   - `unhandledrejection` — unhandled Promise rejections
     *   - custom `__MANDU_ERROR__` CustomEvent — used by the server's
     *     500 path to surface SSR render failures directly in the
     *     browser instead of only in the terminal
     *
     * The overlay ships a "Copy for AI" button that formats a markdown
     * snapshot of the error + stack for paste-into-Claude triage.
     *
     * Production builds NEVER emit the overlay regardless of this flag:
     * `shouldInjectOverlay()` triple-gates against `isDev`,
     * `NODE_ENV=production`, and explicit opt-out.
     *
     * Set `false` to disable in dev (e.g. when capturing screenshots
     * for docs). Default: `true`.
     */
    errorOverlay?: boolean;
  };
  fsRoutes?: {
    routesDir?: string;
    extensions?: string[];
    exclude?: string[];
    islandSuffix?: string;
  };
  seo?: {
    enabled?: boolean;
    defaultTitle?: string;
    titleTemplate?: string;
  };
  /** Phase 12.1 — `mandu test` configuration block. */
  test?: TestConfig;
  /**
   * Phase 17 — observability endpoint toggles.
   *
   * Both fields default to `undefined`, which means "use mode default":
   *   - dev mode → endpoint exposed
   *   - prod mode → endpoint hidden unless `MANDU_DEBUG_HEAP=1`
   *
   * Explicit `true` / `false` overrides the mode default, so operators
   * can opt-in to exposing metrics in prod (for a trusted internal
   * network) or opt-out in dev (for a clean test harness).
   */
  observability?: {
    /** `/_mandu/heap` JSON exposure toggle. */
    heapEndpoint?: boolean;
    /** `/_mandu/metrics` Prometheus text exposure toggle. */
    metricsEndpoint?: boolean;
    /**
     * Phase 18.θ — OpenTelemetry-compatible request tracing.
     *
     * When enabled, every request opens a root server span
     * (`http.request`) that chains child spans for middleware, loader,
     * SSR, and sandbox execution. The root span's trace-id is
     * propagated across AsyncLocalStorage and stamped onto outgoing
     * fetches via `traceparent`.
     *
     * Exporters:
     *   - `"console"` (default) — pretty-prints spans to stderr, useful
     *     in `mandu dev`.
     *   - `"otlp"` — POSTs OTLP/HTTP JSON to `endpoint/v1/traces`.
     *     Compatible with Honeycomb, Grafana Tempo, AWS X-Ray (via the
     *     OTel Collector), and the standalone OpenTelemetry Collector.
     *
     * Setting the `MANDU_OTEL_ENDPOINT` env var overrides both
     * `enabled` and `exporter` at runtime (shortcut for ops that want
     * to enable tracing without a config change).
     *
     * Default: disabled (zero overhead when `observability.tracing` is
     * omitted).
     */
    tracing?: {
      enabled?: boolean;
      exporter?: "console" | "otlp";
      endpoint?: string;
      headers?: Record<string, string>;
      serviceName?: string;
    };
  };
  /**
   * Phase 18.ζ — ISR / tag-based cache invalidation.
   *
   *   - `defaultMaxAge`   : fresh TTL (seconds) applied when a loader
   *                         does not emit its own `_cache` / `ctx.cache`
   *                         metadata. Set to a positive integer to enable
   *                         automatic caching across every non-dynamic
   *                         route (Next.js `export const revalidate`
   *                         equivalent). Default `undefined` (no auto).
   *   - `defaultSwr`      : stale-while-revalidate window (seconds)
   *                         appended after the fresh TTL. Serves stale
   *                         HTML instantly while background regeneration
   *                         runs. Default `0`.
   *   - `maxEntries`      : LRU bound for the in-memory store. Default
   *                         `1000`.
   *   - `store`           : backend. Currently `"memory"` only; reserved
   *                         for future `"redis"` adapter.
   *
   * Disable entirely by omitting this block. Revalidation APIs live in
   * `@mandujs/core/runtime`: `revalidate(tag)`, `revalidateTag(tag)`,
   * `revalidatePath(path)`.
   */
  cache?: {
    defaultMaxAge?: number;
    defaultSwr?: number;
    maxEntries?: number;
    store?: "memory";
  };
  plugins?: ManduPlugin[];
  hooks?: Partial<ManduHooks>;
  /**
   * Phase 18.ε — canonical request-level middleware chain.
   *
   * Array of {@link Middleware} executed in declaration order (outermost
   * first) BEFORE route dispatch. Each middleware may short-circuit by
   * returning a Response without calling `next()`, or mutate the
   * downstream Response after `next()` returns. This is the Next.js
   * `middleware.ts` / SvelteKit `handle` sequence analogue.
   *
   * Compose with {@link defineMiddleware} + bridge wrappers
   * (`csrfMiddleware`, `sessionMiddleware`, `secureMiddleware`,
   * `rateLimitMiddleware`) from `@mandujs/core/middleware`.
   *
   * @see `docs/architect/middleware-composition.md`
   */
  middleware?: Middleware[];
  /**
   * Phase 18.κ — tRPC-like typed RPC endpoints.
   *
   * Keys become URL segments: `endpoints.posts` is served from
   * `/api/rpc/posts/<method>`. Each value is a `defineRpc()` result —
   * a tagged object carrying Zod input/output schemas and handler
   * functions. The runtime dispatcher (`runtime/server.ts`) registers
   * every declared endpoint at `startServer()` time and validates
   * both request inputs and handler outputs against the schemas.
   *
   * Wire protocol: `POST /api/rpc/<name>/<method>` with JSON body
   * `{ "input": <value> }`; returns `{ ok: true, data }` or
   * `{ ok: false, error: { code, message, issues? } }`.
   *
   * Client: `createRpcClient<typeof postsRpc>({ baseUrl: "/api/rpc/posts" })`.
   *
   * @see `docs/architect/typed-rpc.md`
   * @see `@mandujs/core/contract/rpc` for `defineRpc`.
   * @see `@mandujs/core/client/rpc` for `createRpcClient`.
   */
  rpc?: {
    endpoints?: Record<string, RpcDefinition<RpcProcedureRecord>>;
  };
  /**
   * Phase 18.λ — declarative cron job scheduler.
   *
   * `scheduler.jobs` is an array of {@link CronDef} objects (from
   * `@mandujs/core/scheduler`). At `startServer()` boot time the runtime
   * filters the set by `runOn === "bun"` (or `runOn` omitted) and registers
   * each surviving job with `Bun.cron`. At build time, when
   * `--target=workers` is set, the CLI filters by `runOn === "workers"` (or
   * omitted) and emits the schedule strings into the generated
   * `wrangler.toml` `[triggers] crons = [...]` block.
   *
   * Schedule strings are validated synchronously at `defineCron` time, so
   * malformed crontabs fail boot instead of silently never firing.
   *
   * `scheduler.disabled` is an escape hatch for environments where cron
   * should not fire (e.g., a read-only replica). Default: `false`.
   *
   * @see `docs/architect/cron-scheduler.md`
   * @see `@mandujs/core/scheduler` for `defineCron`.
   */
  scheduler?: {
    jobs?: CronDef[];
    disabled?: boolean;
  };
  /**
   * Production-grade OpenAPI endpoint.
   *
   * When enabled, the runtime serves the contracts-derived OpenAPI 3.0.3
   * document at `<path>.json` / `<path>.yaml` (default base path
   * `/__mandu/openapi`). The spec is materialized from `.mandu/openapi.json`
   * (emitted by `mandu build`) on first request and cached for the
   * lifetime of the server instance.
   *
   *   - `enabled` — default `false`. Do NOT leak the API surface on
   *     every internet-facing deployment. Operators must opt in
   *     explicitly, or set `MANDU_OPENAPI_ENABLED=1` in the environment
   *     for a one-off probe without editing config.
   *   - `path` — base URL path (with or without `.json` suffix). The
   *     runtime appends `.json` / `.yaml` to serve each variant.
   *     Default `/__mandu/openapi`.
   *
   * The response stamps `Cache-Control: public, max-age=0,
   * must-revalidate` plus a SHA-256 ETag over the JSON body so CDNs and
   * browsers revalidate cheaply after every deploy without serving
   * stale specs.
   *
   * @see `docs/runtime/openapi.md`
   */
  openapi?: {
    enabled?: boolean;
    path?: string;
  };
  /**
   * Phase 18.μ — first-class internationalization.
   *
   * Declaring this block opts the project into the framework's built-in
   * locale resolution + route synthesis. The CLI (`mandu build` /
   * `mandu dev`) materializes per-locale route variants when
   * `strategy === "path-prefix"` so a single `app/docs/page.tsx`
   * serves `/en/docs`, `/ko/docs`, etc. without file duplication.
   *
   * At runtime, the server dispatcher attaches `ctx.locale`
   * ({@link ResolvedLocale}) + `ctx.t` (typed translator, when a
   * message registry is wired) to every loader and stamps
   * `Vary: Accept-Language` on responses so CDNs cache correctly.
   *
   * Coexists with the legacy `app/[lang]/...` manual pattern — users
   * migrate only when ready. See `docs/architect/i18n.md`.
   *
   * @example
   * ```ts
   * export default {
   *   i18n: {
   *     locales: ['en', 'ko'],
   *     defaultLocale: 'en',
   *     strategy: 'path-prefix',
   *   },
   * } satisfies ManduConfig;
   * ```
   */
  i18n?: {
    /** Non-empty list of supported locale codes. */
    locales: LocaleCode[];
    /** Fallback when no signal matches. MUST be in `locales`. */
    defaultLocale: LocaleCode;
    /** Optional fallback chain between request locale and defaultLocale. */
    fallback?: LocaleCode;
    /** Locale detection strategy. See {@link I18nStrategy}. */
    strategy: I18nStrategy;
    /** Cookie name (default: "mandu_locale"). */
    cookieName?: string;
    /** Domain → locale map; required when strategy === "domain". */
    domains?: Record<string, LocaleCode>;
  };
  /**
   * Issue #235 — Brain LLM adapter selection.
   *
   * Mandu is a CONNECTOR for third-party LLMs, not an LLM owner. Cloud
   * adapters forward requests using the user's own OAuth credentials,
   * obtained via `mandu brain login --provider=<name>` and stored in
   * the OS keychain. No API keys ever live in Mandu's process memory;
   * Mandu-controlled billing is not a thing.
   *
   * Fields:
   *   - `adapter`          — Which connector to use. Default `"auto"`.
   *                          Auto resolves in priority order:
   *                          openai → anthropic → ollama → template.
   *                          Explicit values pin the choice but still
   *                          degrade to template when the dependency is
   *                          unreachable (no hard failures).
   *   - `openai.model`     — Override the OpenAI model (default
   *                          `"gpt-4o-mini"`).
   *   - `anthropic.model`  — Override the Anthropic model (default
   *                          `"claude-haiku-4-5-20251001"`).
   *   - `ollama.model`     — Override the local Ollama model (default
   *                          `"ministral-3:3b"`).
   *   - `telemetryOptOut`  — When `true`, cloud adapters are disabled
   *                          entirely regardless of stored tokens. The
   *                          resolver falls to ollama/template. Use for
   *                          privacy-strict environments.
   *
   * Omitting this block is equivalent to `{ adapter: "auto" }`.
   *
   * @see `@mandujs/core/brain/adapters` for the resolver implementation.
   * @see `docs/brain/oauth-adapters.md` (when authored).
   */
  brain?: {
    adapter?: "auto" | "openai" | "anthropic" | "ollama" | "template";
    openai?: { model?: string };
    anthropic?: { model?: string };
    ollama?: { model?: string; baseUrl?: string };
    telemetryOptOut?: boolean;
  };
}

export const CONFIG_FILES = [
  "mandu.config.ts",
  "mandu.config.js",
  "mandu.config.json",
  path.join(".mandu", "guard.json"),
];

export function coerceConfig(raw: unknown, source: string): ManduConfig {
  if (!raw || typeof raw !== "object") return {};

  // .mandu/guard.json can be guard-only
  if (source.endsWith("guard.json") && !("guard" in (raw as Record<string, unknown>))) {
    return { guard: raw as ManduConfig["guard"] };
  }

  return raw as ManduConfig;
}

export async function loadManduConfig(rootDir: string): Promise<ManduConfig> {
  for (const fileName of CONFIG_FILES) {
    const filePath = path.join(rootDir, fileName);
    if (!(await Bun.file(filePath).exists())) {
      continue;
    }

    if (fileName.endsWith(".json")) {
      try {
        const parsed = await readJsonFile(filePath);
        return coerceConfig(parsed, fileName);
      } catch {
        return {};
      }
    }

    try {
      const module = await import(filePath);
      const raw = module?.default ?? module;
      return coerceConfig(raw, fileName);
    } catch {
      return {};
    }
  }

  return {};
}
