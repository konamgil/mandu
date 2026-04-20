import path from "path";
import { readJsonFile } from "../utils/bun";
import type { ManduAdapter } from "../runtime/adapter";
import type { ManduPlugin, ManduHooks } from "../plugins/hooks";

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
    rules?: Record<string, GuardRuleSeverity>;
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
  };
  plugins?: ManduPlugin[];
  hooks?: Partial<ManduHooks>;
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
