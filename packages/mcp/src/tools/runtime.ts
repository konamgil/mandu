/**
 * Mandu MCP Runtime Tools
 * Runtime 설정 조회 및 관리 도구
 *
 * - Logger 설정 조회/변경
 * - Normalize 설정 조회
 * - Contract 옵션 확인
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getProjectPaths, readJsonFile } from "../utils/project.js";
import { loadManifest } from "@mandujs/core";
import path from "path";
import fs from "fs/promises";

export const runtimeToolDefinitions: Tool[] = [
  {
    name: "mandu_get_runtime_config",
    description:
      "Get current runtime configuration including logger and normalize settings. " +
      "Shows default values and any overrides from contracts.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_get_contract_options",
    description:
      "Get normalize and coerce options for a specific contract. " +
      "These options control how request data is sanitized and type-converted.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to get contract options for",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_set_contract_normalize",
    description:
      "Set normalize mode for a contract. " +
      "Modes: 'strip' (remove undefined fields, default), 'strict' (error on undefined), 'passthrough' (allow all).",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to update",
        },
        normalize: {
          type: "string",
          enum: ["strip", "strict", "passthrough"],
          description:
            "Normalize mode: strip (Mass Assignment 방지), strict (에러 발생), passthrough (모두 허용)",
        },
        coerceQueryParams: {
          type: "boolean",
          description: "Whether to auto-convert query string types (default: true)",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_list_logger_options",
    description:
      "List available logger configuration options and their descriptions. " +
      "Useful for understanding how to configure logging in Mandu.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_generate_logger_config",
    description:
      "Generate logger configuration code based on requirements. " +
      "Returns TypeScript code that can be added to the project.",
    inputSchema: {
      type: "object",
      properties: {
        environment: {
          type: "string",
          enum: ["development", "production", "testing"],
          description: "Target environment (default: development)",
        },
        includeHeaders: {
          type: "boolean",
          description: "Whether to log request headers (default: false for security)",
        },
        includeBody: {
          type: "boolean",
          description: "Whether to log request body (default: false for security)",
        },
        format: {
          type: "string",
          enum: ["pretty", "json"],
          description: "Log output format (pretty for dev, json for prod)",
        },
        customRedact: {
          type: "array",
          items: { type: "string" },
          description: "Additional fields to redact from logs",
        },
      },
      required: [],
    },
  },
];

async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return null;
  }
}

export function runtimeTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_get_runtime_config: async () => {
      return {
        defaults: {
          logger: {
            format: "pretty",
            level: "info",
            includeHeaders: false,
            includeBody: false,
            maxBodyBytes: 1024,
            sampleRate: 1,
            slowThresholdMs: 1000,
            redact: [
              "authorization",
              "cookie",
              "set-cookie",
              "x-api-key",
              "password",
              "token",
              "secret",
              "bearer",
              "credential",
            ],
          },
          normalize: {
            mode: "strip",
            coerceQueryParams: true,
            deep: true,
          },
        },
        description: {
          logger: {
            format: "Log output format: 'pretty' (colored, dev) or 'json' (structured, prod)",
            level: "Minimum log level: 'debug' | 'info' | 'warn' | 'error'",
            includeHeaders: "⚠️ Security risk if true - logs request headers",
            includeBody: "⚠️ Security risk if true - logs request body",
            maxBodyBytes: "Maximum body size to log (truncates larger bodies)",
            sampleRate: "Sampling rate 0-1 (1 = 100% logging)",
            slowThresholdMs: "Requests slower than this get detailed logging",
            redact: "Header/field names to mask in logs",
          },
          normalize: {
            mode: "strip: remove undefined fields (Mass Assignment 방지), strict: error on undefined, passthrough: allow all",
            coerceQueryParams: "Auto-convert query string '123' → number 123",
            deep: "Apply normalization to nested objects",
          },
        },
        usage: {
          logger: `import { logger, devLogger, prodLogger } from "@mandujs/core";

// Development
app.use(devLogger());

// Production
app.use(prodLogger({ sampleRate: 0.1 }));`,
          normalize: `// In contract definition
export default Mandu.contract({
  normalize: "strip",  // or "strict" | "passthrough"
  coerceQueryParams: true,
  request: { ... },
  response: { ... },
});`,
        },
      };
    },

    mandu_get_contract_options: async (args: Record<string, unknown>) => {
      const { routeId } = args as { routeId: string };

      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const route = result.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      if (!route.contractModule) {
        return {
          routeId,
          hasContract: false,
          defaults: {
            normalize: "strip",
            coerceQueryParams: true,
          },
          suggestion: `Create a contract with: mandu_create_contract({ routeId: "${routeId}" })`,
        };
      }

      // Read contract file and extract options
      const contractPath = path.join(projectRoot, route.contractModule);
      const contractContent = await readFileContent(contractPath);

      if (!contractContent) {
        return {
          routeId,
          contractModule: route.contractModule,
          error: "Contract file not found",
        };
      }

      // Parse normalize and coerceQueryParams from content
      const normalizeMatch = contractContent.match(/normalize\s*:\s*["'](\w+)["']/);
      const coerceMatch = contractContent.match(/coerceQueryParams\s*:\s*(true|false)/);

      return {
        routeId,
        contractModule: route.contractModule,
        options: {
          normalize: normalizeMatch?.[1] || "strip (default)",
          coerceQueryParams: coerceMatch ? coerceMatch[1] === "true" : "true (default)",
        },
        explanation: {
          normalize: {
            strip: "정의되지 않은 필드 제거 (Mass Assignment 공격 방지)",
            strict: "정의되지 않은 필드 있으면 400 에러",
            passthrough: "모든 필드 허용 (검증만, 필터링 안 함)",
          },
          coerceQueryParams: "URL query string은 항상 문자열이므로, 스키마 타입으로 자동 변환",
        },
      };
    },

    mandu_set_contract_normalize: async (args: Record<string, unknown>) => {
      const { routeId, normalize, coerceQueryParams } = args as {
        routeId: string;
        normalize?: "strip" | "strict" | "passthrough";
        coerceQueryParams?: boolean;
      };

      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const route = result.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      if (!route.contractModule) {
        return {
          error: "Route has no contract module",
          suggestion: `Create a contract first: mandu_create_contract({ routeId: "${routeId}" })`,
        };
      }

      const contractPath = path.join(projectRoot, route.contractModule);
      let content = await readFileContent(contractPath);

      if (!content) {
        return { error: `Contract file not found: ${route.contractModule}` };
      }

      const changes: string[] = [];

      // Update normalize option
      if (normalize) {
        if (content.includes("normalize:")) {
          content = content.replace(
            /normalize\s*:\s*["']\w+["']/,
            `normalize: "${normalize}"`
          );
          changes.push(`normalize: "${normalize}"`);
        } else {
          // Add normalize option after description or tags
          const insertPoint =
            content.indexOf("request:") ||
            content.indexOf("response:");
          if (insertPoint > 0) {
            const before = content.slice(0, insertPoint);
            const after = content.slice(insertPoint);
            content = before + `normalize: "${normalize}",\n  ` + after;
            changes.push(`normalize: "${normalize}" (added)`);
          }
        }
      }

      // Update coerceQueryParams option
      if (coerceQueryParams !== undefined) {
        if (content.includes("coerceQueryParams:")) {
          content = content.replace(
            /coerceQueryParams\s*:\s*(true|false)/,
            `coerceQueryParams: ${coerceQueryParams}`
          );
          changes.push(`coerceQueryParams: ${coerceQueryParams}`);
        } else if (insertAfter(content, "normalize:")) {
          content = content.replace(
            /(normalize\s*:\s*["']\w+["']),?/,
            `$1,\n  coerceQueryParams: ${coerceQueryParams},`
          );
          changes.push(`coerceQueryParams: ${coerceQueryParams} (added)`);
        }
      }

      if (changes.length === 0) {
        return {
          success: false,
          message: "No changes to apply",
          currentContent: content.slice(0, 500) + "...",
        };
      }

      // Write updated content
      await Bun.write(contractPath, content);

      return {
        success: true,
        contractModule: route.contractModule,
        changes,
        message: `Updated ${route.contractModule}`,
        securityNote:
          normalize === "passthrough"
            ? "⚠️ passthrough 모드는 Mass Assignment 공격에 취약할 수 있습니다. 신뢰할 수 있는 입력에만 사용하세요."
            : normalize === "strict"
            ? "strict 모드는 클라이언트가 추가 필드를 보내면 400 에러를 반환합니다."
            : "strip 모드 (권장): 정의되지 않은 필드는 자동 제거됩니다.",
      };
    },

    mandu_list_logger_options: async () => {
      return {
        options: [
          {
            name: "format",
            type: '"pretty" | "json"',
            default: "pretty",
            description: "로그 출력 형식. pretty는 개발용 컬러 출력, json은 운영용 구조화 로그",
          },
          {
            name: "level",
            type: '"debug" | "info" | "warn" | "error"',
            default: "info",
            description: "최소 로그 레벨. debug는 모든 요청 상세, error는 에러만",
          },
          {
            name: "includeHeaders",
            type: "boolean",
            default: false,
            description: "⚠️ 요청 헤더 로깅. 민감 정보 노출 위험",
          },
          {
            name: "includeBody",
            type: "boolean",
            default: false,
            description: "⚠️ 요청 바디 로깅. 민감 정보 노출 + 스트림 문제",
          },
          {
            name: "maxBodyBytes",
            type: "number",
            default: 1024,
            description: "바디 로깅 시 최대 크기 (초과분 truncate)",
          },
          {
            name: "redact",
            type: "string[]",
            default: '["authorization", "cookie", "password", ...]',
            description: "로그에서 마스킹할 헤더/필드명",
          },
          {
            name: "requestId",
            type: '"auto" | ((ctx) => string)',
            default: "auto",
            description: "요청 ID 생성 방식. auto는 UUID 또는 타임스탬프 기반",
          },
          {
            name: "sampleRate",
            type: "number (0-1)",
            default: 1,
            description: "샘플링 비율. 운영에서 로그 양 조절 (0.1 = 10%)",
          },
          {
            name: "slowThresholdMs",
            type: "number",
            default: 1000,
            description: "느린 요청 임계값. 초과 시 warn 레벨로 상세 출력",
          },
          {
            name: "includeTraceOnSlow",
            type: "boolean",
            default: true,
            description: "느린 요청에 Trace 리포트 포함",
          },
          {
            name: "sink",
            type: "(entry: LogEntry) => void",
            default: "console",
            description: "커스텀 로그 출력 (Pino, CloudWatch 등 연동)",
          },
          {
            name: "skip",
            type: "(string | RegExp)[]",
            default: "[]",
            description: '로깅 제외 경로 패턴. 예: ["/health", /^\\/static\\//]',
          },
        ],
        presets: {
          devLogger: "개발용: debug 레벨, pretty 포맷, 헤더 포함",
          prodLogger: "운영용: info 레벨, json 포맷, 헤더/바디 미포함",
        },
      };
    },

    mandu_generate_logger_config: async (args: Record<string, unknown>) => {
      const {
        environment = "development",
        includeHeaders = false,
        includeBody = false,
        format,
        customRedact = [],
      } = args as {
        environment?: "development" | "production" | "testing";
        includeHeaders?: boolean;
        includeBody?: boolean;
        format?: "pretty" | "json";
        customRedact?: string[];
      };

      const isDev = environment === "development";
      const isProd = environment === "production";

      const config = {
        format: format || (isDev ? "pretty" : "json"),
        level: isDev ? "debug" : "info",
        includeHeaders: isDev ? includeHeaders : false,
        includeBody: isDev ? includeBody : false,
        maxBodyBytes: 1024,
        sampleRate: isProd ? 0.1 : 1,
        slowThresholdMs: isDev ? 500 : 1000,
        ...(customRedact.length > 0 && { redact: customRedact }),
      };

      const code = `import { logger } from "@mandujs/core";

// ${environment} environment logger configuration
export const appLogger = logger(${JSON.stringify(config, null, 2)});

// Usage in your app:
// app.use(appLogger);
`;

      const warnings: string[] = [];
      if (includeHeaders && isProd) {
        warnings.push("⚠️ includeHeaders: true는 프로덕션에서 민감 정보 노출 위험이 있습니다.");
      }
      if (includeBody && isProd) {
        warnings.push("⚠️ includeBody: true는 프로덕션에서 민감 정보 노출 위험이 있습니다.");
      }

      return {
        environment,
        config,
        code,
        warnings: warnings.length > 0 ? warnings : undefined,
        tips: [
          "devLogger() 또는 prodLogger() 프리셋을 사용할 수도 있습니다.",
          "sink 옵션으로 Pino, CloudWatch 등 외부 시스템 연동 가능",
          "skip 옵션으로 /health, /metrics 등 제외 가능",
        ],
      };
    },
  };
}

function insertAfter(content: string, search: string): boolean {
  return content.includes(search);
}
