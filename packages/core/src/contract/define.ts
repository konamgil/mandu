/**
 * Mandu Contract Definition - Contract-First 개발
 *
 * @example
 * ```ts
 * import { defineContract } from '@mandujs/core';
 *
 * export const userContract = defineContract({
 *   getUser: {
 *     method: 'GET',
 *     path: '/api/users/:id',
 *     input: z.object({ id: z.string() }),
 *     output: z.object({ name: z.string(), email: z.string() }),
 *   },
 *   createUser: {
 *     method: 'POST',
 *     path: '/api/users',
 *     input: z.object({ name: z.string(), email: z.string() }),
 *     output: z.object({ id: z.string() }),
 *   },
 * });
 *
 * // 자동 생성됨:
 * // - API 핸들러 타입
 * // - 클라이언트 훅
 * // - OpenAPI 스펙
 * ```
 */

import { z, type ZodType, type ZodObject, type ZodRawShape } from 'zod';

// ============================================================================
// Types
// ============================================================================

export type ContractMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface EndpointDefinition<
  TInput extends ZodType = ZodType,
  TOutput extends ZodType = ZodType,
  TParams extends ZodType = ZodType,
> {
  /** HTTP 메서드 */
  method: ContractMethod;
  /** API 경로 */
  path: string;
  /** URL 파라미터 스키마 */
  params?: TParams;
  /** 요청 바디/쿼리 스키마 */
  input?: TInput;
  /** 응답 스키마 */
  output: TOutput;
  /** 가능한 에러 코드 */
  errors?: readonly string[];
  /** 설명 */
  description?: string;
  /** 태그 (OpenAPI grouping) */
  tags?: string[];
}

export type ContractDefinition = Record<string, EndpointDefinition<any, any, any>>;

// ============================================================================
// Contract Metadata
// ============================================================================

export interface ContractMeta<T extends ContractDefinition> {
  __contract: true;
  __name: string;
  __endpoints: T;
  __version: string;
}

export type Contract<T extends ContractDefinition> = T & ContractMeta<T>;

// ============================================================================
// defineContract() - Contract 정의
// ============================================================================

let contractCounter = 0;

/**
 * Contract 정의
 *
 * Contract는 API의 명세(specification)입니다.
 * - 타입 안전한 API 호출
 * - 자동 코드 생성의 기반
 * - OpenAPI 문서 자동 생성
 */
export function defineContract<T extends ContractDefinition>(
  endpoints: T,
  options?: {
    name?: string;
    version?: string;
  }
): Contract<T> {
  const name = options?.name || `contract_${++contractCounter}`;
  const version = options?.version || '1.0.0';

  const contract = endpoints as Contract<T>;
  contract.__contract = true;
  contract.__name = name;
  contract.__endpoints = endpoints;
  contract.__version = version;

  return contract;
}

// ============================================================================
// isContract() - Contract 체크
// ============================================================================

export function isContract<T extends ContractDefinition>(
  value: unknown
): value is Contract<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ContractMeta<any>).__contract === true
  );
}

// ============================================================================
// Type Inference Utilities
// ============================================================================

/** Contract에서 Input 타입 추출 */
export type ContractInput<
  C extends Contract<any>,
  K extends keyof C['__endpoints']
> = C['__endpoints'][K]['input'] extends ZodType<infer T> ? T : never;

/** Contract에서 Output 타입 추출 */
export type ContractOutput<
  C extends Contract<any>,
  K extends keyof C['__endpoints']
> = C['__endpoints'][K]['output'] extends ZodType<infer T> ? T : never;

/** Contract에서 Params 타입 추출 */
export type ContractParams<
  C extends Contract<any>,
  K extends keyof C['__endpoints']
> = C['__endpoints'][K]['params'] extends ZodType<infer T> ? T : never;

// ============================================================================
// Code Generation Templates
// ============================================================================

/**
 * Contract에서 API 핸들러 코드 생성
 */
export function generateApiHandler<T extends ContractDefinition>(
  contract: Contract<T>,
  endpointName: keyof T
): string {
  const endpoint = contract.__endpoints[endpointName as string];
  if (!endpoint) {
    throw new Error(`Endpoint "${String(endpointName)}" not found in contract`);
  }

  const { method, path, input, output, description } = endpoint;

  return `
import { Mandu } from '@mandujs/core';
import { z } from 'zod';

/**
 * ${description || endpointName as string}
 * ${method} ${path}
 */
export default Mandu.filling()
  ${input ? `.onParse(async (ctx) => {
    // Input validation is automatic via ctx.body()
  })` : ''}
  .${method.toLowerCase()}(async (ctx) => {
    ${input ? `const body = await ctx.body(/* your input schema */);
    if (!body.success) {
      return ctx.error('Validation failed', body.error);
    }
    const data = body.data;` : ''}

    // TODO: Implement your logic here

    return ctx.ok({
      // TODO: Return your response
    });
  });
`.trim();
}

/**
 * Contract에서 React Query 훅 생성
 */
export function generateClientHook<T extends ContractDefinition>(
  contract: Contract<T>,
  endpointName: keyof T
): string {
  const endpoint = contract.__endpoints[endpointName as string];
  if (!endpoint) {
    throw new Error(`Endpoint "${String(endpointName)}" not found in contract`);
  }

  const { method, path, description } = endpoint;
  const hookName = `use${String(endpointName).charAt(0).toUpperCase() + String(endpointName).slice(1)}`;
  const isQuery = method === 'GET';

  if (isQuery) {
    return `
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { ContractInput, ContractOutput } from '@mandujs/core';
import { contract } from '../contracts';

type Input = ContractInput<typeof contract, '${String(endpointName)}'>;
type Output = ContractOutput<typeof contract, '${String(endpointName)}'>;

/**
 * ${description || endpointName as string}
 */
export function ${hookName}(
  params: Input,
  options?: Omit<UseQueryOptions<Output>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: ['${String(endpointName)}', params],
    queryFn: async () => {
      const res = await fetch(\`${path.replace(/:(\w+)/g, '${params.$1}')}\`);
      if (!res.ok) throw new Error('API Error');
      return res.json() as Promise<Output>;
    },
    ...options,
  });
}
`.trim();
  } else {
    return `
import { useMutation, type UseMutationOptions } from '@tanstack/react-query';
import type { ContractInput, ContractOutput } from '@mandujs/core';
import { contract } from '../contracts';

type Input = ContractInput<typeof contract, '${String(endpointName)}'>;
type Output = ContractOutput<typeof contract, '${String(endpointName)}'>;

/**
 * ${description || endpointName as string}
 */
export function ${hookName}(
  options?: Omit<UseMutationOptions<Output, Error, Input>, 'mutationFn'>
) {
  return useMutation({
    mutationFn: async (input: Input) => {
      const res = await fetch('${path}', {
        method: '${method}',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error('API Error');
      return res.json() as Promise<Output>;
    },
    ...options,
  });
}
`.trim();
  }
}

/**
 * Contract에서 전체 코드 생성
 */
export function generateAllFromContract<T extends ContractDefinition>(
  contract: Contract<T>
): {
  handlers: Record<string, string>;
  hooks: Record<string, string>;
  types: string;
} {
  const handlers: Record<string, string> = {};
  const hooks: Record<string, string> = {};

  for (const name of Object.keys(contract.__endpoints)) {
    handlers[name] = generateApiHandler(contract, name);
    hooks[name] = generateClientHook(contract, name);
  }

  const types = generateTypeDefinitions(contract);

  return { handlers, hooks, types };
}

/**
 * Contract에서 타입 정의 생성
 */
export function generateTypeDefinitions<T extends ContractDefinition>(
  contract: Contract<T>
): string {
  const lines: string[] = [
    `// Auto-generated types for ${contract.__name}`,
    `// Version: ${contract.__version}`,
    '',
    'import { z } from "zod";',
    '',
  ];

  for (const [name, endpoint] of Object.entries(contract.__endpoints)) {
    const typeName = name.charAt(0).toUpperCase() + name.slice(1);

    if (endpoint.input) {
      lines.push(`export type ${typeName}Input = z.infer<typeof ${name}InputSchema>;`);
    }
    if (endpoint.output) {
      lines.push(`export type ${typeName}Output = z.infer<typeof ${name}OutputSchema>;`);
    }
    if (endpoint.params) {
      lines.push(`export type ${typeName}Params = z.infer<typeof ${name}ParamsSchema>;`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================================
// OpenAPI Generation
// ============================================================================

/**
 * Contract에서 OpenAPI 스펙 생성
 */
export function generateOpenAPISpec<T extends ContractDefinition>(
  contract: Contract<T>,
  options?: {
    title?: string;
    version?: string;
    servers?: Array<{ url: string; description?: string }>;
  }
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const [name, endpoint] of Object.entries(contract.__endpoints)) {
    const { method, path, input, output, description, tags, errors } = endpoint;

    if (!paths[path]) {
      paths[path] = {};
    }

    paths[path][method.toLowerCase()] = {
      operationId: name,
      summary: description || name,
      tags: tags || [],
      ...(input && ['POST', 'PUT', 'PATCH'].includes(method)
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${name}Input` },
                },
              },
            },
          }
        : {}),
      responses: {
        '200': {
          description: 'Success',
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${name}Output` },
            },
          },
        },
        ...(errors?.reduce(
          (acc, error) => ({
            ...acc,
            [getStatusCode(error)]: {
              description: error,
            },
          }),
          {}
        ) || {}),
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: options?.title || contract.__name,
      version: options?.version || contract.__version,
    },
    servers: options?.servers || [{ url: '/' }],
    paths,
    components: {
      schemas: generateSchemas(contract),
    },
  };
}

function generateSchemas<T extends ContractDefinition>(
  contract: Contract<T>
): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};

  for (const [name, endpoint] of Object.entries(contract.__endpoints)) {
    if (endpoint.input) {
      schemas[`${name}Input`] = zodToOpenAPI(endpoint.input);
    }
    if (endpoint.output) {
      schemas[`${name}Output`] = zodToOpenAPI(endpoint.output);
    }
  }

  return schemas;
}

function zodToOpenAPI(schema: ZodType): Record<string, unknown> {
  const def = (schema as any)._def;
  const typeName = def.typeName;

  switch (typeName) {
    case 'ZodString':
      return { type: 'string' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return { type: 'array', items: zodToOpenAPI(def.type) };
    case 'ZodObject': {
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(def.shape())) {
        properties[key] = zodToOpenAPI(value as ZodType);
        if (!(value as any).isOptional?.()) {
          required.push(key);
        }
      }
      return { type: 'object', properties, required };
    }
    case 'ZodOptional':
      return zodToOpenAPI(def.innerType);
    case 'ZodNullable':
      return { ...zodToOpenAPI(def.innerType), nullable: true };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    default:
      return { type: 'object' };
  }
}

function getStatusCode(error: string): string {
  const map: Record<string, string> = {
    NOT_FOUND: '404',
    UNAUTHORIZED: '401',
    FORBIDDEN: '403',
    RATE_LIMITED: '429',
    BAD_REQUEST: '400',
    INTERNAL_ERROR: '500',
  };
  return map[error] || '400';
}
