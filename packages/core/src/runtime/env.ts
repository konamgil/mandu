/**
 * Mandu Environment Configuration
 *
 * .env 파일 로딩 및 환경 변수 관리
 * Bun의 내장 .env 지원을 확장하여 환경별 설정 제공
 */

import path from "path";

// ========== Types ==========

export interface EnvConfig {
  /**
   * 프로젝트 루트 디렉토리
   * @default process.cwd()
   */
  rootDir?: string;

  /**
   * 환경 이름 (development, production, test 등)
   * @default process.env.NODE_ENV || 'development'
   */
  env?: string;

  /**
   * .env 파일 경로 목록 (우선순위 순서)
   * @default ['.env.local', '.env.{env}', '.env']
   */
  files?: string[];

  /**
   * 필수 환경 변수 목록
   * 없으면 에러 발생
   */
  required?: string[];

  /**
   * 기본값 설정
   */
  defaults?: Record<string, string>;
}

export interface EnvValidationResult {
  success: boolean;
  loaded: string[];
  missing: string[];
  errors: string[];
}

// ========== Internal Helpers ==========

/**
 * .env 파일 파싱
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    // 빈 줄이나 주석 건너뛰기
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    // KEY=VALUE 파싱
    const equalIndex = trimmed.indexOf("=");
    if (equalIndex === -1) {
      continue;
    }

    const key = trimmed.substring(0, equalIndex).trim();
    let value = trimmed.substring(equalIndex + 1).trim();

    // 따옴표 제거
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // 이스케이프 문자 처리
    value = value
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");

    result[key] = value;
  }

  return result;
}

/**
 * 파일이 존재하는지 확인
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    const file = Bun.file(filePath);
    return await file.exists();
  } catch {
    return false;
  }
}

/**
 * 파일 내용 읽기
 */
async function readFile(filePath: string): Promise<string | null> {
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      return await file.text();
    }
    return null;
  } catch {
    return null;
  }
}

// ========== Main Functions ==========

/**
 * .env 파일들 로드
 *
 * 로드 순서 (나중에 로드된 것이 우선):
 * 1. .env (기본 설정)
 * 2. .env.{environment} (환경별 설정)
 * 3. .env.local (로컬 오버라이드, git에 포함하지 않음)
 *
 * @example
 * ```typescript
 * await loadEnv(); // 기본 설정
 *
 * await loadEnv({
 *   env: 'production',
 *   required: ['DATABASE_URL', 'API_KEY'],
 * });
 * ```
 */
export async function loadEnv(config: EnvConfig = {}): Promise<EnvValidationResult> {
  const {
    rootDir = process.cwd(),
    env = process.env.NODE_ENV || "development",
    files,
    required = [],
    defaults = {},
  } = config;

  const result: EnvValidationResult = {
    success: true,
    loaded: [],
    missing: [],
    errors: [],
  };

  // 기본 파일 순서
  const envFiles = files || [
    ".env",
    `.env.${env}`,
    ".env.local",
  ];

  // 기본값 먼저 적용
  for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  // .env 파일들 로드
  for (const envFile of envFiles) {
    const filePath = path.join(rootDir, envFile);

    const content = await readFile(filePath);
    if (content !== null) {
      const parsed = parseEnvFile(content);

      for (const [key, value] of Object.entries(parsed)) {
        process.env[key] = value;
      }

      result.loaded.push(envFile);
    }
  }

  // 필수 환경 변수 검증
  for (const key of required) {
    if (!process.env[key]) {
      result.missing.push(key);
      result.errors.push(`Missing required environment variable: ${key}`);
    }
  }

  if (result.missing.length > 0) {
    result.success = false;
  }

  return result;
}

/**
 * 환경 변수 타입 안전하게 가져오기
 *
 * @example
 * ```typescript
 * const port = env('PORT', '3000'); // string
 * const debug = env.bool('DEBUG', false); // boolean
 * const timeout = env.number('TIMEOUT', 5000); // number
 * ```
 */
export function env(key: string, defaultValue?: string): string {
  return process.env[key] ?? defaultValue ?? "";
}

/**
 * 환경 변수 헬퍼 함수들
 */
export const envHelpers = {
  /**
   * 문자열 환경 변수
   */
  string(key: string, defaultValue: string = ""): string {
    return process.env[key] ?? defaultValue;
  },

  /**
   * 숫자 환경 변수
   */
  number(key: string, defaultValue: number = 0): number {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    const parsed = Number(value);
    return isNaN(parsed) ? defaultValue : parsed;
  },

  /**
   * 불리언 환경 변수
   */
  bool(key: string, defaultValue: boolean = false): boolean {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value === "true" || value === "1" || value === "yes";
  },

  /**
   * 배열 환경 변수 (쉼표로 구분)
   */
  array(key: string, defaultValue: string[] = []): string[] {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  },

  /**
   * JSON 환경 변수
   */
  json<T>(key: string, defaultValue: T): T {
    const value = process.env[key];
    if (value === undefined) return defaultValue;
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  },

  /**
   * 필수 환경 변수 (없으면 에러)
   */
  required(key: string): string {
    const value = process.env[key];
    if (value === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  },

  /**
   * 현재 환경 이름
   */
  get NODE_ENV(): string {
    return process.env.NODE_ENV || "development";
  },

  /**
   * 개발 환경 여부
   */
  get isDevelopment(): boolean {
    return this.NODE_ENV === "development";
  },

  /**
   * 프로덕션 환경 여부
   */
  get isProduction(): boolean {
    return this.NODE_ENV === "production";
  },

  /**
   * 테스트 환경 여부
   */
  get isTest(): boolean {
    return this.NODE_ENV === "test";
  },
};

/**
 * 환경 변수 스키마 정의 및 검증
 *
 * @example
 * ```typescript
 * const config = defineEnvSchema({
 *   DATABASE_URL: { type: 'string', required: true },
 *   PORT: { type: 'number', default: 3000 },
 *   DEBUG: { type: 'boolean', default: false },
 * });
 *
 * // 자동으로 타입 추론됨
 * config.DATABASE_URL // string
 * config.PORT // number
 * config.DEBUG // boolean
 * ```
 */
export interface EnvSchemaField {
  type: "string" | "number" | "boolean" | "array" | "json";
  required?: boolean;
  default?: unknown;
  description?: string;
}

export type EnvSchema = Record<string, EnvSchemaField>;

export type InferEnvSchema<T extends EnvSchema> = {
  [K in keyof T]: T[K]["type"] extends "string"
    ? string
    : T[K]["type"] extends "number"
      ? number
      : T[K]["type"] extends "boolean"
        ? boolean
        : T[K]["type"] extends "array"
          ? string[]
          : unknown;
};

export function defineEnvSchema<T extends EnvSchema>(
  schema: T
): InferEnvSchema<T> {
  const result: Record<string, unknown> = {};

  for (const [key, field] of Object.entries(schema)) {
    const { type, required = false, default: defaultValue } = field;

    let value: unknown;

    switch (type) {
      case "string":
        value = envHelpers.string(key, defaultValue as string);
        break;
      case "number":
        value = envHelpers.number(key, defaultValue as number);
        break;
      case "boolean":
        value = envHelpers.bool(key, defaultValue as boolean);
        break;
      case "array":
        value = envHelpers.array(key, defaultValue as string[]);
        break;
      case "json":
        value = envHelpers.json(key, defaultValue);
        break;
    }

    if (required && (value === undefined || value === "")) {
      throw new Error(
        `Missing required environment variable: ${key}${field.description ? ` (${field.description})` : ""}`
      );
    }

    result[key] = value;
  }

  return result as InferEnvSchema<T>;
}

// Re-export for convenience
export { env as getEnv };
