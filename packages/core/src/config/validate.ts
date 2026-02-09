import { z, ZodError, ZodIssueCode } from "zod";
import path from "path";
import { pathToFileURL } from "url";
import { CONFIG_FILES, coerceConfig } from "./mandu";
import { readJsonFile } from "../utils/bun";

/**
 * DNA-003: Strict mode schema helper
 *
 * Creates a schema that warns about unknown keys instead of failing
 * This provides the benefits of .strict() while maintaining compatibility
 */
function strictWithWarnings<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  schemaName: string
): z.ZodObject<T> {
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
    hostname: z.string().default("localhost"),
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
  })
  .strict();

/**
 * Guard 설정 스키마 (strict)
 */
const GuardConfigSchema = z
  .object({
    preset: z.enum(["mandu", "fsd", "clean", "hexagonal", "atomic"]).default("mandu"),
    srcDir: z.string().default("src"),
    exclude: z.array(z.string()).default([]),
    realtime: z.boolean().default(true),
    rules: z.record(z.enum(["error", "warn", "warning", "off"])).optional(),
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
 * Mandu 설정 스키마 (DNA-003: strict mode)
 *
 * 알 수 없는 키가 있으면 오류 발생 → 오타 즉시 감지
 * MANDU_STRICT=0 으로 비활성화 가능
 */
export const ManduConfigSchema = z
  .object({
    server: ServerConfigSchema.default({}),
    guard: GuardConfigSchema.default({}),
    build: BuildConfigSchema.default({}),
    dev: DevConfigSchema.default({}),
    fsRoutes: FsRoutesConfigSchema.default({}),
    seo: SeoConfigSchema.default({}),
  })
  .strict();

export type ValidatedManduConfig = z.infer<typeof ManduConfigSchema>;

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
        return { valid: false, errors, source: fileName };
      }

      return {
        valid: false,
        errors: [
          {
            path: "",
            message: `Failed to load config: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
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
