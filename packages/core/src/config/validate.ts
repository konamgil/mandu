import { z, ZodError, ZodIssueCode } from "zod";
import path from "path";
import { pathToFileURL } from "url";
import { CONFIG_FILES, coerceConfig } from "./mandu";
import { readJsonFile } from "../utils/bun";
import type { ManduAdapter } from "../runtime/adapter";
import type { ManduPlugin, ManduHooks } from "../plugins/hooks";
import type { Middleware } from "../middleware/define";
import type { CronDef } from "../scheduler";
import { isGuardRuleLike, type GuardRule as CustomGuardRule } from "../guard/define-rule";

/**
 * DNA-003: Strict mode schema helper
 *
 * Creates a schema that warns about unknown keys instead of failing
 * This provides the benefits of .strict() while maintaining compatibility
 */
function strictWithWarnings<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  schemaName: string
): z.ZodEffects<z.ZodObject<T>> {
  return schema.superRefine((data, ctx) => {
    if (typeof data !== "object" || data === null) return;

    const knownKeys = new Set(Object.keys(schema.shape));
    const unknownKeys = Object.keys(data).filter((key) => !knownKeys.has(key));

    if (unknownKeys.length > 0 && process.env.MANDU_STRICT !== "0") {
      // In strict mode (default), add warnings to issues
      for (const key of unknownKeys) {
        ctx.addIssue({
          code: ZodIssueCode.unrecognized_keys,
          keys: [key],
          message: `Unknown key '${key}' in ${schemaName}. Did you mean one of: ${[...knownKeys].join(", ")}?`,
        });
      }
    }
  });
}

/**
 * Server 설정 스키마 (strict)
 */
const ServerConfigSchema = z
  .object({
    port: z.number().min(1).max(65535).default(3000),
    // Default 0.0.0.0 so IPv4 `localhost` resolution (Windows default) succeeds.
    // Users may pin "::1" or "127.0.0.1" explicitly. See issue #190.
    hostname: z.string().default("0.0.0.0"),
    cors: z
      .union([
        z.boolean(),
        z.object({
          origin: z.union([z.string(), z.array(z.string())]).optional(),
          methods: z.array(z.string()).optional(),
          credentials: z.boolean().optional(),
        }).strict(),
      ])
      .default(false),
    streaming: z.boolean().default(false),
    rateLimit: z
      .union([
        z.boolean(),
        z.object({
          windowMs: z.number().int().positive().optional(),
          max: z.number().int().positive().optional(),
          message: z.string().min(1).optional(),
          statusCode: z.number().int().min(400).max(599).optional(),
          headers: z.boolean().optional(),
        }).strict(),
      ])
      .default(false),
  })
  .strict();

/**
 * Phase 18.ν — consumer-defined Guard rule (structural check).
 *
 * Rule objects carry closures (`check`) that Zod cannot introspect, so
 * we validate structurally: must be a non-null object with a non-empty
 * `id` string and a `check` function. Deeper validation (severity enum,
 * description type) happens at `defineGuardRule()` time for the clearest
 * DX error; the Guard runner catches any in-band violations.
 */
const CustomGuardRuleSchema = z.custom<CustomGuardRule>(
  (v) => isGuardRuleLike(v),
  {
    message:
      "Each custom guard rule must be an object with a non-empty `id` string and a `check` function. Use `defineGuardRule({...})` from `@mandujs/core/guard/define-rule` to construct.",
  }
);

/**
 * Guard 설정 스키마 (strict)
 *
 * `guard.rules` is a discriminated union of two shapes:
 *   - `Record<string, GuardRuleSeverity>` → built-in rule severity overrides.
 *   - `GuardRule[]` (Phase 18.ν) → consumer-defined custom rules.
 * The runner dispatches on `Array.isArray()`.
 */
const GuardConfigSchema = z
  .object({
    preset: z.enum(["mandu", "fsd", "clean", "hexagonal", "atomic", "cqrs"]).default("mandu"),
    srcDir: z.string().default("src"),
    exclude: z.array(z.string()).default([]),
    realtime: z.boolean().default(true),
    rules: z
      .union([
        z.record(z.enum(["error", "warn", "warning", "off"])),
        z.array(CustomGuardRuleSchema),
      ])
      .optional(),
    /**
     * Issue #207 — bundler-level hard-fail on direct `__generated__/`
     * imports. Default `true`. Set `false` to opt out of the
     * `mandu:block-generated-imports` Bun plugin.
     */
    blockGeneratedImport: z.boolean().default(true),
  })
  .strict();

/**
 * Build 설정 스키마 (strict)
 */
const BuildConfigSchema = z
  .object({
    outDir: z.string().default(".mandu"),
    minify: z.boolean().default(true),
    sourcemap: z.boolean().default(false),
    splitting: z.boolean().default(false),
    /**
     * Phase 18 — prerender static HTML for pages during `mandu build`.
     * Default: `true` (every static page + every dynamic page whose
     * module exports `generateStaticParams` is prerendered).
     */
    prerender: z.boolean().default(true),
    /**
     * Phase 18.η — opt into post-build bundle analyzer artefacts
     * (`.mandu/analyze/report.html` + `report.json`). Default `false`.
     * CLI `--analyze` overrides this at runtime; config is the "always on
     * for this project" switch.
     */
    analyze: z.boolean().default(false),
  })
  .strict();

/**
 * Dev 설정 스키마 (strict)
 */
const DevConfigSchema = z
  .object({
    hmr: z.boolean().default(true),
    watchDirs: z.array(z.string()).default([]),
    observability: z.boolean().default(true),
    /**
     * Issue #191 — `_devtools.js` (~1.15 MB React dev runtime + Kitchen
     * panel) injection override. `undefined` (omitted) = default
     * auto-detect based on `manifest.hasIslands`. Explicit `true` / `false`
     * force on / off. Only applies in dev mode.
     */
    devtools: z.boolean().optional(),
    /**
     * Issue #196 — auto-run `scripts/prebuild-*.ts` before `mandu dev`.
     * `undefined` = default (auto-enabled when content/ OR prebuild
     * scripts exist); explicit `true` / `false` forces on / off.
     */
    autoPrebuild: z.boolean().optional(),
    /**
     * Issue #196 — directory whose changes trigger a watch-mode
     * prebuild re-run. Non-empty to keep chokidar from trying to watch
     * an empty pattern. Default `"content"`.
     */
    contentDir: z.string().min(1).default("content"),
    /**
     * Issue #203 — per-script wall-clock timeout (ms) for
     * `scripts/prebuild-*.ts`. `undefined` = use default (120_000 ms) or
     * the `MANDU_PREBUILD_TIMEOUT_MS` env var if set. Explicit positive
     * integer overrides both. The boundary check mirrors
     * `server.rateLimit.windowMs` style — positive integers only.
     */
    prebuildTimeoutMs: z.number().int().positive().optional(),
  })
  .strict();

/**
 * FS Routes 설정 스키마 (strict)
 */
const FsRoutesConfigSchema = z
  .object({
    routesDir: z.string().default("app"),
    extensions: z.array(z.string()).default([".tsx", ".ts", ".jsx", ".js"]),
    exclude: z.array(z.string()).default([]),
    islandSuffix: z.string().default(".island"),
  })
  .strict();

/**
 * SEO 설정 스키마 (strict)
 */
const SeoConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    defaultTitle: z.string().optional(),
    titleTemplate: z.string().optional(),
  })
  .strict();

/**
 * Test 설정 스키마 (Phase 12.1 — strict)
 *
 * `.strict()` is applied at every nested object so stale / misspelt keys
 * are caught at config-load time, not when the CLI trips over them. Each
 * default mirrors the TypeScript documentation in `./mandu.ts`.
 */
const TestUnitConfigSchema = z
  .object({
    include: z.array(z.string().min(1)).default(["**/*.test.ts", "**/*.test.tsx"]),
    exclude: z
      .array(z.string().min(1))
      .default(["node_modules/**", ".mandu/**", "dist/**"]),
    timeout: z.number().int().positive().default(30_000),
  })
  .strict();

const TestIntegrationConfigSchema = z
  .object({
    include: z
      .array(z.string().min(1))
      .default(["tests/integration/**/*.test.ts", "tests/integration/**/*.test.tsx"]),
    exclude: z
      .array(z.string().min(1))
      .default(["node_modules/**", ".mandu/**", "dist/**"]),
    dbUrl: z.string().min(1).default("sqlite::memory:"),
    sessionStore: z.enum(["memory", "sqlite"]).default("memory"),
    timeout: z.number().int().positive().default(60_000),
  })
  .strict();

const TestE2EConfigSchema = z
  .object({
    reserved: z.literal(true).optional(),
  })
  .strict();

const TestCoverageConfigSchema = z
  .object({
    lines: z.number().min(0).max(100).optional(),
    branches: z.number().min(0).max(100).optional(),
  })
  .strict();

const TestConfigSchema = z
  .object({
    unit: TestUnitConfigSchema.default({}),
    integration: TestIntegrationConfigSchema.default({}),
    e2e: TestE2EConfigSchema.default({}),
    coverage: TestCoverageConfigSchema.default({}),
  })
  .strict();

/**
 * Phase 17 — observability endpoint config (strict).
 *
 * Shape mirrors `ServerOptions.observability`; both fields omit a
 * default so the runtime can distinguish "not set" (use mode default)
 * from "explicit false" (force off even in dev).
 */
/**
 * Phase 18.θ — tracing sub-block. All fields optional; omitting the
 * whole block keeps tracing disabled and incurs zero runtime overhead.
 * `endpoint` and `headers` are only meaningful when `exporter === "otlp"`
 * but we don't make that a cross-field refine — runtime falls back to
 * console with a warning when `"otlp"` is requested without an endpoint.
 */
const TracingConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    exporter: z.enum(["console", "otlp"]).optional(),
    endpoint: z.string().url().optional(),
    headers: z.record(z.string()).optional(),
    serviceName: z.string().min(1).optional(),
  })
  .strict();

const ObservabilityConfigSchema = z
  .object({
    heapEndpoint: z.boolean().optional(),
    metricsEndpoint: z.boolean().optional(),
    tracing: TracingConfigSchema.optional(),
  })
  .strict();

const AdapterConfigSchema = z.custom<ManduAdapter | undefined>(
  (value) =>
    value === undefined ||
    (typeof value === "object" &&
      value !== null &&
      typeof (value as { name?: unknown }).name === "string" &&
      typeof (value as { createServer?: unknown }).createServer === "function"),
  {
    message: "adapter must be a ManduAdapter with name and createServer()",
  }
);

/**
 * Mandu 설정 스키마 (DNA-003: strict mode)
 *
 * 알 수 없는 키가 있으면 오류 발생 → 오타 즉시 감지
 * MANDU_STRICT=0 으로 비활성화 가능
 */
/**
 * Plugin schema — array of objects with `name` (string) and optional `hooks`/`setup`.
 * Validated structurally; hook functions are opaque to Zod.
 */
const ManduPluginSchema = z.custom<ManduPlugin>(
  (v) =>
    typeof v === "object" &&
    v !== null &&
    typeof (v as { name?: unknown }).name === "string",
  { message: "Each plugin must be an object with a `name` string" }
);

const ManduHooksSchema = z.custom<Partial<ManduHooks>>(
  (v) => typeof v === "object" && v !== null,
  { message: "hooks must be an object" }
);

/**
 * Phase 18.ε — canonical request-level middleware. Each entry must be an
 * object with a non-empty `name` string and a `handler` function.
 * `match` is optional but must be a function when present. Zod cannot
 * introspect closures, so this is a structural check; `defineMiddleware`
 * enforces the same shape at definition time for the clearest DX error.
 */
const MiddlewareSchema = z.custom<Middleware>(
  (v) => {
    if (typeof v !== "object" || v === null) return false;
    const obj = v as { name?: unknown; handler?: unknown; match?: unknown };
    if (typeof obj.name !== "string" || obj.name.length === 0) return false;
    if (typeof obj.handler !== "function") return false;
    if (obj.match !== undefined && typeof obj.match !== "function") return false;
    return true;
  },
  {
    message:
      "Each middleware must be an object with a non-empty `name` string, a `handler` function, and (optionally) a `match` function. Use `defineMiddleware({...})` to construct.",
  }
);

/**
 * Phase 18.ζ — ISR / cache config (strict).
 *
 * All fields optional. Omitting the block leaves caching disabled unless
 * individual routes opt in via `filling.loader(fn, { revalidate })` or
 * loader-level `_cache` metadata. Setting `defaultMaxAge` makes every
 * non-dynamic route auto-cache with that fresh TTL.
 */
const CacheConfigSchema = z
  .object({
    defaultMaxAge: z.number().int().nonnegative().optional(),
    defaultSwr: z.number().int().nonnegative().optional(),
    maxEntries: z.number().int().positive().optional(),
    store: z.enum(["memory"]).optional(),
  })
  .strict();

/**
 * Phase 18.λ — declarative cron scheduler (strict).
 *
 * Each `jobs[i]` entry is structurally validated: `name` must be a non-empty
 * string, `schedule` a string (deeper cron validation runs at `defineCron`
 * time), and `handler` (or `run` alias) a function. Zod cannot introspect
 * closures, so the handler field is a structural check.
 *
 * `disabled` short-circuits registration in environments where cron
 * shouldn't fire (e.g., a read-only replica reading the same config file
 * its primary uses).
 */
const CronDefSchema = z.custom<CronDef>(
  (v) => {
    if (typeof v !== "object" || v === null) return false;
    const obj = v as Record<string, unknown>;
    if (typeof obj.name !== "string" || obj.name.length === 0) return false;
    if (typeof obj.schedule !== "string" || obj.schedule.length === 0) return false;
    if (typeof obj.handler !== "function" && typeof obj.run !== "function") return false;
    if (obj.timezone !== undefined && typeof obj.timezone !== "string") return false;
    if (obj.runOn !== undefined) {
      if (!Array.isArray(obj.runOn)) return false;
      for (const r of obj.runOn) {
        if (r !== "bun" && r !== "workers") return false;
      }
    }
    return true;
  },
  {
    message:
      "Each cron job must be an object with `name` (string), `schedule` (string), and `handler` (function). Optional: `timezone` (string), `runOn` (array of 'bun'|'workers'), `skipInDev` (boolean), `timeoutMs` (number).",
  }
);

const SchedulerConfigSchema = z
  .object({
    jobs: z.array(CronDefSchema).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

/**
 * Phase 18.μ — i18n config schema (strict).
 *
 * Strictly validates shape + cross-field invariants that `defineI18n()`
 * enforces at runtime (defaultLocale ∈ locales, fallback ∈ locales,
 * domain map required when strategy === "domain"). Doing this at
 * config load gives users a clean `mandu validate` error instead of
 * a runtime boot failure.
 */
const I18nConfigSchema = z
  .object({
    locales: z.array(z.string().min(1)).min(1),
    defaultLocale: z.string().min(1),
    fallback: z.string().min(1).optional(),
    strategy: z.enum(["path-prefix", "domain", "header", "cookie"]),
    cookieName: z.string().min(1).optional(),
    domains: z.record(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const locales = new Set(value.locales);
    if (locales.size !== value.locales.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locales"],
        message: "locales must not contain duplicates",
      });
    }
    if (!locales.has(value.defaultLocale)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultLocale"],
        message: `defaultLocale "${value.defaultLocale}" must be one of locales`,
      });
    }
    if (value.fallback !== undefined && !locales.has(value.fallback)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fallback"],
        message: `fallback "${value.fallback}" must be one of locales`,
      });
    }
    if (value.strategy === "domain") {
      if (!value.domains || Object.keys(value.domains).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["domains"],
          message: "strategy 'domain' requires a non-empty domains map",
        });
      } else {
        for (const [host, locale] of Object.entries(value.domains)) {
          if (!locales.has(locale)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["domains", host],
              message: `domains["${host}"] = "${locale}" is not in locales`,
            });
          }
        }
      }
    }
  });

export const ManduConfigSchema = z
  .object({
    adapter: AdapterConfigSchema.optional(),
    /**
     * Issue #192 — CSS View Transitions auto-inject. Default `true`.
     * Set `false` to suppress the `@view-transition` `<style>` block.
     */
    transitions: z.boolean().default(true),
    /**
     * Issue #192 — Hover prefetch helper. Default `true`.
     * Set `false` to suppress the ~500-byte prefetch IIFE.
     */
    prefetch: z.boolean().default(true),
    /**
     * Issue #193 — Opt-out SPA navigation. Default `true`.
     * When `true`, plain `<a href="/...">` clicks are intercepted by
     * the client-side router (per-link escape hatch: `data-no-spa`).
     * Set `false` to revert to the legacy opt-in behavior, where only
     * `<a data-mandu-link>` is intercepted.
     */
    spa: z.boolean().default(true),
    server: ServerConfigSchema.default({}),
    guard: GuardConfigSchema.default({}),
    build: BuildConfigSchema.default({}),
    dev: DevConfigSchema.default({}),
    fsRoutes: FsRoutesConfigSchema.default({}),
    seo: SeoConfigSchema.default({}),
    test: TestConfigSchema.default({}),
    observability: ObservabilityConfigSchema.default({}),
    /** Phase 18.ζ — ISR / tag-based cache invalidation. Optional. */
    cache: CacheConfigSchema.optional(),
    plugins: z.array(ManduPluginSchema).optional(),
    hooks: ManduHooksSchema.optional(),
    /**
     * Phase 18.ε — request-level middleware chain. Array validated
     * structurally (see {@link MiddlewareSchema}); no default, so
     * omitting the field leaves the chain empty (zero-overhead
     * passthrough at runtime).
     */
    middleware: z.array(MiddlewareSchema).optional(),
    /**
     * Phase 18.λ — declarative cron scheduler. See {@link SchedulerConfigSchema}.
     * Omit the block to disable scheduling entirely (zero-overhead
     * passthrough).
     */
    scheduler: SchedulerConfigSchema.optional(),
    /**
     * Phase 18.μ — first-class i18n config. See {@link I18nConfigSchema}.
     * Optional; omission leaves i18n disabled with zero runtime overhead.
     */
    i18n: I18nConfigSchema.optional(),
  })
  .strict();

export type ValidatedManduConfig = z.infer<typeof ManduConfigSchema>;

/** Validated `test` block (convenience re-export for fixtures/CLI). */
export type ValidatedTestConfig = z.infer<typeof TestConfigSchema>;

/**
 * Resolve the `test` block with defaults filled in.
 *
 * Use this from fixtures / CLI test runners that need a guaranteed-shaped
 * object without having to validate the whole config.
 */
export function resolveTestConfig(raw?: unknown): ValidatedTestConfig {
  return TestConfigSchema.parse(raw ?? {});
}

/**
 * 검증 결과
 */
export interface ValidationResult {
  valid: boolean;
  config?: ValidatedManduConfig;
  errors?: Array<{
    path: string;
    message: string;
  }>;
  source?: string;
}

/**
 * Assertion function: narrows unknown config to ValidatedManduConfig or throws.
 *
 * Useful in code paths that receive untrusted config objects and need
 * to guarantee the type after the call without a separate null-check.
 */
export function assertValidConfig(cfg: unknown): asserts cfg is ValidatedManduConfig {
  const result = ManduConfigSchema.safeParse(cfg);
  if (!result.success) {
    const messages = result.error.errors.map(
      (e) => `${e.path.join(".")}: ${e.message}`
    );
    throw new Error(`Invalid ManduConfig:\n  ${messages.join("\n  ")}`);
  }
}

/**
 * 설정 파일 검증
 */
export async function validateConfig(rootDir: string): Promise<ValidationResult> {
  for (const fileName of CONFIG_FILES) {
    const filePath = path.join(rootDir, fileName);
    if (!(await Bun.file(filePath).exists())) {
      continue;
    }

    try {
      let raw: unknown;
      if (fileName.endsWith(".json")) {
        raw = await readJsonFile(filePath);
      } else {
        const module = await import(pathToFileURL(filePath).href);
        raw = module?.default ?? module;
      }

      const config = ManduConfigSchema.parse(coerceConfig(raw ?? {}, fileName));
      return { valid: true, config, source: fileName };
    } catch (error) {
      if (error instanceof ZodError) {
        const errors = error.errors.map((e) => ({
          path: e.path.join("."),
          message: e.message,
        }));
        return {
          valid: false,
          errors: [
            { path: "", message: `Config validation failed in '${filePath}'. Fix the following field errors:` },
            ...errors,
          ],
          source: fileName,
        };
      }

      // Differentiate file-not-found from parse/import errors
      const errMsg = error instanceof Error ? error.message : String(error);
      const isModuleError = errMsg.includes("Cannot find module") || errMsg.includes("MODULE_NOT_FOUND");
      const isSyntaxError = error instanceof SyntaxError || errMsg.includes("SyntaxError");

      let detail: string;
      if (isModuleError) {
        detail = `Could not resolve config file '${filePath}'. Check that the file exists and all its imports are installed.`;
      } else if (isSyntaxError) {
        detail = `Syntax error while parsing '${filePath}': ${errMsg}. Verify the file contains valid TypeScript/JSON.`;
      } else {
        detail = `Failed to load config from '${filePath}': ${errMsg}`;
      }

      return {
        valid: false,
        errors: [{ path: "", message: detail }],
        source: fileName,
      };
    }
  }

  // 설정 파일 없음 - 기본값 사용
  return { valid: true, config: ManduConfigSchema.parse({}) };
}

/**
 * CLI용 검증 및 리포트
 */
export async function validateAndReport(rootDir: string): Promise<ValidatedManduConfig | null> {
  const result = await validateConfig(rootDir);

  if (!result.valid) {
    console.error(`\n❌ Invalid config${result.source ? ` (${result.source})` : ""}:\n`);
    for (const error of result.errors || []) {
      const location = error.path ? `  ${error.path}: ` : "  ";
      console.error(`${location}${error.message}`);
    }
    console.error("");
    return null;
  }

  return result.config!;
}
