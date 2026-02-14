/**
 * Mandu Contract Module
 * Contract-first API 정의 시스템
 *
 * Elysia DNA 패턴 채택:
 * - Contract → Handler 타입 자동 추론
 * - TypedContext로 요청 데이터 접근
 * - z.object({...}) 스키마 기반 검증
 */

export * from "./schema";
export * from "./types";
export * from "./validator";
export * from "./handler";
export * from "./client";
export * from "./normalize";
export * from "./registry";
export * from "./client-safe";
export * from "./protection";
export * from "./route-helpers";

import type { ContractDefinition, ContractInstance, ContractSchema } from "./schema";
import type { ContractHandlers, RouteDefinition } from "./handler";
import { defineHandler, defineRoute } from "./handler";
import { createClient, contractFetch, type ClientOptions } from "./client";
import { createClientContract } from "./client-safe";

/**
 * Create a Mandu API Contract
 *
 * Contract-first 방식으로 API 스키마를 정의합니다.
 * 정의된 스키마는 다음에 활용됩니다:
 * - TypeScript 타입 추론 (Slot에서 자동 완성)
 * - 런타임 요청/응답 검증
 * - OpenAPI 문서 자동 생성
 * - Guard의 Contract-Slot 일관성 검사
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { Mandu } from "@mandujs/core";
 *
 * const UserSchema = z.object({
 *   id: z.string().uuid(),
 *   email: z.string().email(),
 *   name: z.string().min(2),
 * });
 *
 * export default Mandu.contract({
 *   description: "사용자 관리 API",
 *   tags: ["users"],
 *
 *   request: {
 *     GET: {
 *       query: z.object({
 *         page: z.coerce.number().default(1),
 *         limit: z.coerce.number().default(10),
 *       }),
 *     },
 *     POST: {
 *       body: UserSchema.omit({ id: true }),
 *     },
 *   },
 *
 *   response: {
 *     200: z.object({ data: z.array(UserSchema) }),
 *     201: z.object({ data: UserSchema }),
 *     400: z.object({ error: z.string() }),
 *     404: z.object({ error: z.string() }),
 *   },
 * });
 * ```
 */
export function createContract<T extends ContractDefinition>(definition: T): T & ContractInstance {
  return {
    ...definition,
    _validated: false,
  };
}

/**
 * Mandu Namespace
 *
 * Contract-first API 개발을 위한 메인 인터페이스
 *
 * @example
 * ```typescript
 * import { Mandu } from "@mandujs/core";
 * import { z } from "zod";
 *
 * // 1. Contract 정의
 * const userContract = Mandu.contract({
 *   request: {
 *     GET: { query: z.object({ id: z.string() }) },
 *     POST: { body: z.object({ name: z.string(), email: z.string().email() }) },
 *   },
 *   response: {
 *     200: z.object({ user: z.object({ id: z.string(), name: z.string() }) }),
 *     201: z.object({ user: z.object({ id: z.string(), name: z.string() }) }),
 *   },
 * });
 *
 * // 2. Handler 정의 (타입 자동 추론)
 * const handlers = Mandu.handler(userContract, {
 *   GET: async (ctx) => {
 *     // ctx.query.id는 string 타입으로 자동 추론
 *     const user = await db.users.findUnique({ where: { id: ctx.query.id } });
 *     return { user };
 *   },
 *   POST: async (ctx) => {
 *     // ctx.body.name, ctx.body.email 자동 추론
 *     const user = await db.users.create({ data: ctx.body });
 *     return { user };
 *   },
 * });
 *
 * // 3. 또는 Route로 한 번에 정의
 * export default Mandu.route({
 *   contract: userContract,
 *   handler: handlers,
 * });
 * ```
 */
/**
 * Contract-specific Mandu functions
 * Note: Use `ManduContract` to avoid conflict with other Mandu exports
 */
export const ManduContract = {
  /**
   * Create a typed Contract
   * Contract 스키마 정의 및 타입 추론
   */
  contract: createContract,

  /**
   * Create typed handlers for a contract
   * Contract 기반 타입 안전 핸들러 정의
   *
   * @example
   * ```typescript
   * const handlers = Mandu.handler(contract, {
   *   GET: (ctx) => {
   *     // ctx.query, ctx.body, ctx.params 모두 타입 추론
   *     return { data: ctx.query.id };
   *   },
   * });
   * ```
   */
  handler: defineHandler,

  /**
   * Define a complete route with contract and handler
   * Contract와 Handler를 한 번에 정의
   *
   * @example
   * ```typescript
   * export default Mandu.route({
   *   contract: {
   *     request: { GET: { query: z.object({ id: z.string() }) } },
   *     response: { 200: z.object({ data: z.string() }) },
   *   },
   *   handler: {
   *     GET: (ctx) => ({ data: ctx.query.id }),
   *   },
   * });
   * ```
   */
  route: defineRoute,

  /**
   * Create a type-safe API client from contract
   * Contract 기반 타입 안전 클라이언트 생성
   *
   * @example
   * ```typescript
   * const client = Mandu.client(userContract, {
   *   baseUrl: "http://localhost:3000/api/users",
   * });
   *
   * // Type-safe API calls
   * const users = await client.GET({ query: { page: 1 } });
   * const newUser = await client.POST({ body: { name: "Alice" } });
   * ```
   */
  client: createClient,

  /**
   * Create a client-safe contract
   * Client에서 노출할 스키마만 선택
   */
  clientContract: createClientContract,

  /**
   * Single type-safe fetch call
   * 단일 타입 안전 fetch 호출
   *
   * @example
   * ```typescript
   * const result = await Mandu.fetch(contract, "GET", "/api/users", {
   *   query: { page: 1 },
   * });
   * ```
   */
  fetch: contractFetch,
} as const;

/**
 * Alias for backward compatibility within contract module
 * 외부에서는 메인 index.ts의 Mandu를 사용하세요
 */
export const Mandu = ManduContract;
