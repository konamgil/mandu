/**
 * Mandu Contract Handler
 * Contract 기반 타입 안전 핸들러 정의
 *
 * Elysia 패턴 채택: Contract → Handler 타입 자동 추론
 */

import type { z } from "zod";
import type {
  ContractSchema,
  ContractMethod,
  MethodRequestSchema,
} from "./schema";
import type { InferResponseSchema } from "./types";

/**
 * Typed request context for a handler
 * Contract에서 추론된 타입으로 요청 컨텍스트 제공
 */
export interface TypedContext<
  TQuery = unknown,
  TBody = unknown,
  TParams = unknown,
  THeaders = unknown,
> {
  /** Parsed and validated query parameters */
  query: TQuery;
  /** Parsed and validated request body */
  body: TBody;
  /** Parsed and validated path parameters */
  params: TParams;
  /** Parsed and validated headers */
  headers: THeaders;
  /** Original Request object */
  request: Request;
  /** Route path (e.g., "/users/:id") */
  path: string;
  /** HTTP method */
  method: ContractMethod;
}

/**
 * Infer context type from method schema
 */
type InferContextFromMethod<T extends MethodRequestSchema | undefined> =
  T extends MethodRequestSchema
    ? TypedContext<
        T["query"] extends z.ZodTypeAny ? z.infer<T["query"]> : undefined,
        T["body"] extends z.ZodTypeAny ? z.infer<T["body"]> : undefined,
        T["params"] extends z.ZodTypeAny ? z.infer<T["params"]> : undefined,
        T["headers"] extends z.ZodTypeAny ? z.infer<T["headers"]> : undefined
      >
    : TypedContext<undefined, undefined, undefined, undefined>;

/**
 * Handler function type for a specific method
 */
export type HandlerFn<TContext, TResponse> = (
  ctx: TContext
) => TResponse | Promise<TResponse>;

/**
 * Infer response type union from contract response schema
 */
type InferResponseUnion<TResponse extends ContractSchema["response"]> = {
  [K in keyof TResponse]: InferResponseSchema<TResponse[K]>;
}[keyof TResponse];

/**
 * Handler definition for all methods in a contract
 *
 * @example
 * ```typescript
 * const contract = Mandu.contract({
 *   request: {
 *     GET: { query: z.object({ page: z.number() }) },
 *     POST: { body: z.object({ name: z.string() }) },
 *   },
 *   response: {
 *     200: z.object({ users: z.array(z.string()) }),
 *     201: z.object({ user: z.string() }),
 *   },
 * });
 *
 * // handlers is typed: { GET: (ctx) => ..., POST: (ctx) => ... }
 * const handlers = Mandu.handler(contract, {
 *   GET: (ctx) => {
 *     // ctx.query is { page: number }
 *     return { users: [] };
 *   },
 *   POST: (ctx) => {
 *     // ctx.body is { name: string }
 *     return { user: ctx.body.name };
 *   },
 * });
 * ```
 */
export type ContractHandlers<T extends ContractSchema> = {
  [M in Extract<keyof T["request"], ContractMethod>]?: HandlerFn<
    InferContextFromMethod<
      T["request"][M] extends MethodRequestSchema ? T["request"][M] : undefined
    >,
    InferResponseUnion<T["response"]>
  >;
};

/**
 * Define type-safe handlers for a contract
 *
 * @param contract - The contract schema
 * @param handlers - Handler implementations for each method
 * @returns Typed handler object
 *
 * @example
 * ```typescript
 * const handlers = defineHandler(userContract, {
 *   GET: async (ctx) => {
 *     const { page, limit } = ctx.query; // Typed!
 *     const users = await db.users.findMany({ skip: page * limit, take: limit });
 *     return { data: users };
 *   },
 *   POST: async (ctx) => {
 *     const user = await db.users.create({ data: ctx.body }); // Typed!
 *     return { data: user };
 *   },
 * });
 * ```
 */
export function defineHandler<T extends ContractSchema>(
  _contract: T,
  handlers: ContractHandlers<T>
): ContractHandlers<T> {
  return handlers;
}

/**
 * Handler result with status code
 * 응답에 상태 코드를 명시적으로 지정
 */
export interface HandlerResult<T = unknown> {
  status: number;
  data: T;
  headers?: Record<string, string>;
}

/**
 * Create a typed response with status code
 *
 * @example
 * ```typescript
 * const handler = defineHandler(contract, {
 *   POST: async (ctx) => {
 *     const user = await createUser(ctx.body);
 *     return response(201, { data: user });
 *   },
 * });
 * ```
 */
export function response<T>(
  status: number,
  data: T,
  headers?: Record<string, string>
): HandlerResult<T> {
  return { status, data, headers };
}

/**
 * Type guard for HandlerResult
 */
export function isHandlerResult(value: unknown): value is HandlerResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "data" in value
  );
}

/**
 * Extract method-specific handler type from contract
 *
 * @example
 * ```typescript
 * type GetHandler = ExtractHandler<typeof userContract, "GET">;
 * // (ctx: { query: { page: number }, ... }) => Promise<{ data: User[] }>
 * ```
 */
export type ExtractHandler<
  T extends ContractSchema,
  M extends ContractMethod,
> = M extends keyof T["request"]
  ? HandlerFn<
      InferContextFromMethod<
        T["request"][M] extends MethodRequestSchema
          ? T["request"][M]
          : undefined
      >,
      InferResponseUnion<T["response"]>
    >
  : never;

/**
 * Utility to create a handler context from raw request
 * 런타임에서 Request → TypedContext 변환
 */
export async function createContext<
  TQuery = unknown,
  TBody = unknown,
  TParams = unknown,
  THeaders = unknown,
>(
  request: Request,
  path: string,
  method: ContractMethod,
  parsedData: {
    query?: TQuery;
    body?: TBody;
    params?: TParams;
    headers?: THeaders;
  } = {}
): Promise<TypedContext<TQuery, TBody, TParams, THeaders>> {
  return {
    query: parsedData.query as TQuery,
    body: parsedData.body as TBody,
    params: parsedData.params as TParams,
    headers: parsedData.headers as THeaders,
    request,
    path,
    method,
  };
}

/**
 * Combined contract + handler definition
 * Contract와 Handler를 한 번에 정의
 *
 * @example
 * ```typescript
 * export default Mandu.route({
 *   contract: {
 *     request: {
 *       GET: { query: z.object({ id: z.string() }) },
 *     },
 *     response: {
 *       200: z.object({ user: UserSchema }),
 *     },
 *   },
 *   handler: {
 *     GET: async (ctx) => {
 *       const user = await db.users.findUnique({ where: { id: ctx.query.id } });
 *       return { user };
 *     },
 *   },
 * });
 * ```
 */
export interface RouteDefinition<T extends ContractSchema> {
  contract: T;
  handler: ContractHandlers<T>;
}

/**
 * Define a complete route with contract and handler
 */
export function defineRoute<T extends ContractSchema>(
  definition: RouteDefinition<T>
): RouteDefinition<T> {
  return definition;
}
