/**
 * Mandu Intent - 의도 기반 API 라우팅
 *
 * @example
 * ```ts
 * import { intent } from '@mandujs/core';
 *
 * export default intent({
 *   '사용자 목록 조회': {
 *     method: 'GET',
 *     handler: (ctx) => ctx.ok(users),
 *   },
 *   '사용자 생성': {
 *     method: 'POST',
 *     input: z.object({ name: z.string() }),
 *     handler: async (ctx) => {
 *       const data = await ctx.body();
 *       return ctx.created(createUser(data));
 *     },
 *   },
 * });
 * ```
 */

import { z, type ZodType } from 'zod';
import { ManduFillingFactory, type ManduFilling } from '../filling/filling';
import type { ManduContext } from '../filling/context';

// ============================================================================
// Types
// ============================================================================

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface IntentDefinition<TInput = unknown, TOutput = unknown> {
  /** HTTP 메서드 */
  method: HttpMethod;
  /** 추가 경로 (예: '/:id') */
  path?: string;
  /** 입력 스키마 (Zod) */
  input?: ZodType<TInput>;
  /** 출력 스키마 (Zod) - 문서화/검증용 */
  output?: ZodType<TOutput>;
  /** 가능한 에러 코드 목록 */
  errors?: readonly string[];
  /** 설명 (OpenAPI 문서용) */
  description?: string;
  /** 핸들러 함수 */
  handler: (ctx: ManduContext) => Response | Promise<Response>;
  /** Guard/Middleware */
  guard?: (ctx: ManduContext) => Response | void | Promise<Response | void>;
}

export type IntentMap = Record<string, IntentDefinition<any, any>>;

export interface IntentMeta {
  __intent: true;
  __intents: IntentMap;
  __docs: IntentDocumentation[];
}

export interface IntentDocumentation {
  name: string;
  method: HttpMethod;
  path: string;
  description?: string;
  input?: ZodType<unknown>;
  output?: ZodType<unknown>;
  errors?: readonly string[];
}

// ============================================================================
// intent() - 의도 기반 API 생성
// ============================================================================

/**
 * 의도 기반 API 라우트 생성
 *
 * 하나의 파일에서 여러 관련 API를 의도(intent)로 그룹화
 * - 의도 이름이 자동으로 OpenAPI description이 됨
 * - AI가 "사용자 삭제 API"를 쉽게 찾을 수 있음
 * - 타입 안전한 입출력
 */
export function intent(intents: IntentMap): ManduFilling & IntentMeta {
  const filling = ManduFillingFactory.filling();
  const docs: IntentDocumentation[] = [];

  // 메서드별로 핸들러 그룹화
  const methodHandlers: Record<HttpMethod, IntentDefinition<any, any>[]> = {
    GET: [],
    POST: [],
    PUT: [],
    PATCH: [],
    DELETE: [],
    HEAD: [],
    OPTIONS: [],
  };

  // Intent 분류 및 문서화
  for (const [intentName, definition] of Object.entries(intents)) {
    methodHandlers[definition.method].push({
      ...definition,
      description: definition.description || intentName,
    });

    docs.push({
      name: intentName,
      method: definition.method,
      path: definition.path || '/',
      description: definition.description || intentName,
      input: definition.input,
      output: definition.output,
      errors: definition.errors,
    });
  }

  // 각 메서드에 대해 핸들러 등록
  const registerMethod = (method: HttpMethod, handlers: IntentDefinition<any, any>[]) => {
    if (handlers.length === 0) return;

    const methodLower = method.toLowerCase() as Lowercase<HttpMethod>;

    (filling as any)[methodLower](async (ctx: ManduContext) => {
      // 경로 매칭 (path가 있는 경우)
      for (const def of handlers) {
        if (def.path && !matchPath(ctx.url, def.path)) {
          continue;
        }

        // Guard 실행
        if (def.guard) {
          const guardResult = await def.guard(ctx);
          if (guardResult instanceof Response) {
            return guardResult;
          }
        }

        // Input 검증
        if (def.input && ['POST', 'PUT', 'PATCH'].includes(method)) {
          const bodyResult = await ctx.body(def.input);
          if (!bodyResult.success) {
            return ctx.error('Validation failed', bodyResult.error);
          }
        }

        // 핸들러 실행
        return def.handler(ctx);
      }

      // 매칭되는 핸들러 없음
      return ctx.notFound(`No handler for ${method} ${ctx.url}`);
    });
  };

  // 모든 메서드 등록
  for (const [method, handlers] of Object.entries(methodHandlers)) {
    registerMethod(method as HttpMethod, handlers);
  }

  // 메타데이터 부착
  const result = filling as ManduFilling & IntentMeta;
  result.__intent = true;
  result.__intents = intents;
  result.__docs = docs;

  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 간단한 경로 매칭 (/:id 같은 패턴)
 */
function matchPath(url: string, pattern: string): boolean {
  if (pattern === '/') return true;

  const urlPath = new URL(url, 'http://localhost').pathname;
  const patternParts = pattern.split('/').filter(Boolean);
  const urlParts = urlPath.split('/').filter(Boolean);

  if (patternParts.length !== urlParts.length) return false;

  return patternParts.every((part, i) => {
    if (part.startsWith(':')) return true; // 동적 파라미터
    return part === urlParts[i];
  });
}

/**
 * Intent에서 OpenAPI 스펙 생성
 */
export function generateOpenAPIFromIntent(
  basePath: string,
  intentFilling: IntentMeta
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const doc of intentFilling.__docs) {
    const fullPath = basePath + (doc.path === '/' ? '' : doc.path);
    const method = doc.method.toLowerCase();

    if (!paths[fullPath]) {
      paths[fullPath] = {};
    }

    paths[fullPath][method] = {
      summary: doc.name,
      description: doc.description,
      requestBody: doc.input
        ? {
            content: {
              'application/json': {
                schema: zodToJsonSchema(doc.input),
              },
            },
          }
        : undefined,
      responses: {
        '200': {
          description: 'Success',
          content: doc.output
            ? {
                'application/json': {
                  schema: zodToJsonSchema(doc.output),
                },
              }
            : undefined,
        },
        ...(doc.errors?.reduce(
          (acc, error) => ({
            ...acc,
            [getErrorStatusCode(error)]: { description: error },
          }),
          {}
        ) || {}),
      },
    };
  }

  return { paths };
}

/**
 * 간단한 Zod → JSON Schema 변환
 */
function zodToJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  // 실제 구현은 zod-to-json-schema 라이브러리 사용 권장
  const def = (schema as any)._def;

  if (def.typeName === 'ZodString') {
    return { type: 'string' };
  }
  if (def.typeName === 'ZodNumber') {
    return { type: 'number' };
  }
  if (def.typeName === 'ZodBoolean') {
    return { type: 'boolean' };
  }
  if (def.typeName === 'ZodObject') {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(def.shape())) {
      properties[key] = zodToJsonSchema(value as ZodType<unknown>);
    }
    return { type: 'object', properties };
  }
  if (def.typeName === 'ZodArray') {
    return { type: 'array', items: zodToJsonSchema(def.type) };
  }

  return { type: 'unknown' };
}

/**
 * 에러 코드 → HTTP 상태 코드
 */
function getErrorStatusCode(error: string): number {
  const errorMap: Record<string, number> = {
    NOT_FOUND: 404,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    RATE_LIMITED: 429,
    INVALID_INPUT: 400,
    VALIDATION_ERROR: 400,
    INTERNAL_ERROR: 500,
  };

  return errorMap[error] || 400;
}

// ============================================================================
// isIntent() - Intent 체크
// ============================================================================

export function isIntent(value: unknown): value is ManduFilling & IntentMeta {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as IntentMeta).__intent === true
  );
}

// ============================================================================
// getIntentDocs() - Intent 문서 추출
// ============================================================================

export function getIntentDocs(intentFilling: IntentMeta): IntentDocumentation[] {
  return intentFilling.__docs;
}
