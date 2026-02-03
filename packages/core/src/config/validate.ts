import { z, ZodError } from "zod";
import path from "path";
import { pathToFileURL } from "url";
import { CONFIG_FILES, coerceConfig } from "./mandu";
import { readJsonFile } from "../utils/bun";

/**
 * Mandu 설정 스키마
 */
export const ManduConfigSchema = z
  .object({
    server: z
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
            }),
          ])
          .default(false),
        streaming: z.boolean().default(false),
      })
      .default({}),

    guard: z
      .object({
        preset: z.enum(["mandu", "fsd", "clean", "hexagonal", "atomic"]).default("mandu"),
        srcDir: z.string().default("src"),
        exclude: z.array(z.string()).default([]),
        realtime: z.boolean().default(true),
        rules: z.record(z.enum(["error", "warn", "warning", "off"])).optional(),
      })
      .default({}),

    build: z
      .object({
        outDir: z.string().default(".mandu"),
        minify: z.boolean().default(true),
        sourcemap: z.boolean().default(false),
        splitting: z.boolean().default(false),
      })
      .default({}),

    dev: z
      .object({
        hmr: z.boolean().default(true),
        watchDirs: z.array(z.string()).default([]),
      })
      .default({}),

    fsRoutes: z
      .object({
        routesDir: z.string().default("app"),
        extensions: z.array(z.string()).default([".tsx", ".ts", ".jsx", ".js"]),
        exclude: z.array(z.string()).default([]),
        islandSuffix: z.string().default(".island"),
        legacyManifestPath: z.string().optional(),
        mergeWithLegacy: z.boolean().default(true),
      })
      .default({}),

    seo: z
      .object({
        enabled: z.boolean().default(true),
        defaultTitle: z.string().optional(),
        titleTemplate: z.string().optional(),
      })
      .default({}),
  })
  .passthrough();

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
