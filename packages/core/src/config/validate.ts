import { z, ZodError, ZodIssueCode } from "zod";
import path from "path";
import { pathToFileURL } from "url";
import { CONFIG_FILES, coerceConfig } from "./mandu";
import { readJsonFile } from "../utils/bun";
import type { ManduAdapter } from "../runtime/adapter";
import type { ManduPlugin, ManduHooks } from "../plugins/hooks";

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
 * Guard 설정 스키마 (strict)
 */
const GuardConfigSchema = z
  .object({
    preset: z.enum(["mandu", "fsd", "clean", "hexagonal", "atomic", "cqrs"]).default("mandu"),
    srcDir: z.string().default("src"),
    exclude: z.array(z.string()).default([]),
    realtime: z.boolean().default(true),
    rules: z.record(z.enum(["error", "warn", "warning", "off"])).optional(),
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
const ObservabilityConfigSchema = z
  .object({
    heapEndpoint: z.boolean().optional(),
    metricsEndpoint: z.boolean().optional(),
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
    plugins: z.array(ManduPluginSchema).optional(),
    hooks: ManduHooksSchema.optional(),
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
