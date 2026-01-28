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
