export * from "./spec";
export * from "./runtime";
export * from "./generator";
export * from "./guard";
export * from "./report";
export * from "./filling";
export * from "./change";
export * from "./error";
export * from "./slot";
export * from "./bundler";
export * from "./contract";
export * from "./openapi";
export * from "./brain";
export * from "./watcher";

// Consolidated Mandu namespace
import { ManduFilling, ManduContext, ManduFillingFactory } from "./filling";
import { createContract, defineHandler, defineRoute, createClient, contractFetch } from "./contract";
import type { ContractDefinition, ContractInstance, ContractSchema } from "./contract";
import type { ContractHandlers, ClientOptions } from "./contract";

/**
 * Mandu - Unified Namespace
 *
 * 통합된 Mandu API 인터페이스
 *
 * @example
 * ```typescript
 * import { Mandu } from "@mandujs/core";
 * import { z } from "zod";
 *
 * // Filling (Handler) API
 * export default Mandu.filling()
 *   .get(async (ctx) => ctx.json({ message: "Hello" }));
 *
 * // Contract API
 * const contract = Mandu.contract({
 *   request: { GET: { query: z.object({ id: z.string() }) } },
 *   response: { 200: z.object({ data: z.string() }) },
 * });
 *
 * // Handler API (with type inference)
 * const handlers = Mandu.handler(contract, {
 *   GET: (ctx) => ({ data: ctx.query.id }),
 * });
 *
 * // Client API (type-safe fetch)
 * const client = Mandu.client(contract, { baseUrl: "/api" });
 * const result = await client.GET({ query: { id: "123" } });
 * ```
 */
export const Mandu = {
  // === Filling (Handler) API ===
  /**
   * Create a new filling (handler chain)
   */
  filling: ManduFillingFactory.filling,

  /**
   * Create a ManduContext from a Request
   */
  context: ManduFillingFactory.context,

  // === Contract API ===
  /**
   * Define a typed API contract
   */
  contract: createContract,

  /**
   * Create typed handlers for a contract
   */
  handler: defineHandler,

  /**
   * Define a complete route (contract + handler)
   */
  route: defineRoute,

  /**
   * Create a type-safe API client
   */
  client: createClient,

  /**
   * Make a type-safe fetch call
   */
  fetch: contractFetch,
} as const;
