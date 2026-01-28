/**
 * Mandu Contract Type Inference
 * Contract 스키마에서 TypeScript 타입 추론
 */

import type { z } from "zod";
import type {
  ContractSchema,
  ContractRequestSchema,
  ContractResponseSchema,
  MethodRequestSchema,
} from "./schema";

/**
 * Extract inferred type from Zod schema
 */
type InferZod<T> = T extends z.ZodTypeAny ? z.infer<T> : never;

/**
 * Infer request schema types for a single method
 */
type InferMethodRequest<T extends MethodRequestSchema | undefined> = T extends MethodRequestSchema
  ? {
      query: T["query"] extends z.ZodTypeAny ? z.infer<T["query"]> : undefined;
      body: T["body"] extends z.ZodTypeAny ? z.infer<T["body"]> : undefined;
      params: T["params"] extends z.ZodTypeAny ? z.infer<T["params"]> : undefined;
      headers: T["headers"] extends z.ZodTypeAny ? z.infer<T["headers"]> : undefined;
    }
  : undefined;

/**
 * Infer all request schemas
 */
type InferContractRequest<T extends ContractRequestSchema> = {
  [K in keyof T]: InferMethodRequest<T[K] extends MethodRequestSchema ? T[K] : undefined>;
};

/**
 * Infer all response schemas
 */
type InferContractResponse<T extends ContractResponseSchema> = {
  [K in keyof T]: T[K] extends z.ZodTypeAny ? z.infer<T[K]> : never;
};

/**
 * Infer full contract types
 *
 * @example
 * ```typescript
 * const contract = Mandu.contract({
 *   request: {
 *     GET: { query: z.object({ page: z.number() }) },
 *     POST: { body: z.object({ name: z.string() }) },
 *   },
 *   response: {
 *     200: z.object({ data: z.array(z.string()) }),
 *   },
 * });
 *
 * type Contract = InferContract<typeof contract>;
 * // {
 * //   request: {
 * //     GET: { query: { page: number }, body: undefined, params: undefined, headers: undefined },
 * //     POST: { query: undefined, body: { name: string }, params: undefined, headers: undefined },
 * //   },
 * //   response: {
 * //     200: { data: string[] },
 * //   },
 * // }
 * ```
 */
export type InferContract<T extends ContractSchema> = {
  request: InferContractRequest<T["request"]>;
  response: InferContractResponse<T["response"]>;
  description: T["description"];
  tags: T["tags"];
};

/**
 * Extract query type for a specific method
 */
export type InferQuery<
  T extends ContractSchema,
  M extends keyof T["request"]
> = T["request"][M] extends MethodRequestSchema
  ? T["request"][M]["query"] extends z.ZodTypeAny
    ? z.infer<T["request"][M]["query"]>
    : undefined
  : undefined;

/**
 * Extract body type for a specific method
 */
export type InferBody<
  T extends ContractSchema,
  M extends keyof T["request"]
> = T["request"][M] extends MethodRequestSchema
  ? T["request"][M]["body"] extends z.ZodTypeAny
    ? z.infer<T["request"][M]["body"]>
    : undefined
  : undefined;

/**
 * Extract params type for a specific method
 */
export type InferParams<
  T extends ContractSchema,
  M extends keyof T["request"]
> = T["request"][M] extends MethodRequestSchema
  ? T["request"][M]["params"] extends z.ZodTypeAny
    ? z.infer<T["request"][M]["params"]>
    : undefined
  : undefined;

/**
 * Extract response type for a specific status code
 */
export type InferResponse<
  T extends ContractSchema,
  S extends keyof T["response"]
> = T["response"][S] extends z.ZodTypeAny ? z.infer<T["response"][S]> : never;

/**
 * Helper type to get all defined methods in a contract
 */
export type ContractMethods<T extends ContractSchema> = Extract<
  keyof T["request"],
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
>;

/**
 * Helper type to get all defined status codes in a contract
 */
export type ContractStatusCodes<T extends ContractSchema> = keyof T["response"];

/**
 * Helper type to check if a method exists in contract
 */
export type HasMethod<
  T extends ContractSchema,
  M extends string
> = M extends keyof T["request"] ? true : false;

/**
 * Extract all required fields from a method schema
 */
export type RequiredFields<
  T extends ContractSchema,
  M extends keyof T["request"]
> = T["request"][M] extends MethodRequestSchema
  ? {
      query: T["request"][M]["query"] extends z.ZodTypeAny ? true : false;
      body: T["request"][M]["body"] extends z.ZodTypeAny ? true : false;
      params: T["request"][M]["params"] extends z.ZodTypeAny ? true : false;
      headers: T["request"][M]["headers"] extends z.ZodTypeAny ? true : false;
    }
  : never;

/**
 * Get the success response type (200 or 201)
 */
export type SuccessResponse<T extends ContractSchema> = T["response"][200] extends z.ZodTypeAny
  ? z.infer<T["response"][200]>
  : T["response"][201] extends z.ZodTypeAny
    ? z.infer<T["response"][201]>
    : never;

/**
 * Get the error response type (400, 404, 500, etc.)
 */
export type ErrorResponse<T extends ContractSchema> =
  | (T["response"][400] extends z.ZodTypeAny ? z.infer<T["response"][400]> : never)
  | (T["response"][401] extends z.ZodTypeAny ? z.infer<T["response"][401]> : never)
  | (T["response"][403] extends z.ZodTypeAny ? z.infer<T["response"][403]> : never)
  | (T["response"][404] extends z.ZodTypeAny ? z.infer<T["response"][404]> : never)
  | (T["response"][500] extends z.ZodTypeAny ? z.infer<T["response"][500]> : never);

/**
 * Utility type for strict contract enforcement
 * Contract에 정의된 메서드만 허용
 */
export type StrictContractMethods<T extends ContractSchema> = {
  [M in ContractMethods<T>]: true;
};

/**
 * Type-safe fetch options derived from contract
 * 클라이언트에서 Contract 기반 fetch 호출에 사용
 */
export type ContractFetchOptions<
  T extends ContractSchema,
  M extends keyof T["request"]
> = T["request"][M] extends MethodRequestSchema
  ? {
      query?: T["request"][M]["query"] extends z.ZodTypeAny
        ? z.input<T["request"][M]["query"]>
        : never;
      body?: T["request"][M]["body"] extends z.ZodTypeAny
        ? z.input<T["request"][M]["body"]>
        : never;
      params?: T["request"][M]["params"] extends z.ZodTypeAny
        ? z.input<T["request"][M]["params"]>
        : never;
      headers?: T["request"][M]["headers"] extends z.ZodTypeAny
        ? z.input<T["request"][M]["headers"]>
        : never;
    }
  : never;

/**
 * Response type union for a contract
 */
export type ContractResponseUnion<T extends ContractSchema> = {
  [K in keyof T["response"]]: T["response"][K] extends z.ZodTypeAny
    ? { status: K; data: z.infer<T["response"][K]> }
    : never;
}[keyof T["response"]];
