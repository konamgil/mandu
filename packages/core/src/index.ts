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
export * from "./router";
export * from "./config";
export * from "./lockfile";
export * from "./utils";
export * from "./seo";
export * from "./island";
export * from "./intent";
export * from "./devtools";

// Consolidated Mandu namespace
import { ManduFilling, ManduContext, ManduFillingFactory } from "./filling";
import { createContract, defineHandler, defineRoute, createClient, contractFetch, createClientContract } from "./contract";
import { defineContract, generateAllFromContract, generateOpenAPISpec } from "./contract/define";
import { island, isIsland, type IslandComponent, type HydrationStrategy } from "./island";
import { intent, isIntent, getIntentDocs, generateOpenAPIFromIntent } from "./intent";
import { initializeHook, reportError, ManduDevTools, getStateManager } from "./devtools";
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
   * Create a client-safe contract
   */
  clientContract: createClientContract,

  /**
   * Make a type-safe fetch call
   */
  fetch: contractFetch,

  // === AI-Native APIs ===
  /**
   * Define a Contract for code generation
   * @example
   * const api = Mandu.define({
   *   getUser: { method: 'GET', path: '/users/:id', output: userSchema },
   * });
   */
  define: defineContract,

  /**
   * Create an Island component (declarative hydration)
   * @example
   * export default Mandu.island('visible', ({ name }) => <div>{name}</div>);
   */
  island,

  /**
   * Check if a component is an Island
   */
  isIsland,

  /**
   * Create an Intent-based API handler
   * @example
   * export default Mandu.intent({
   *   '사용자 조회': { method: 'GET', handler: (ctx) => ctx.ok(user) },
   * });
   */
  intent,

  /**
   * Check if a handler is an Intent
   */
  isIntent,

  /**
   * Generate code from Contract
   */
  generate: generateAllFromContract,

  /**
   * Generate OpenAPI spec from Contract
   */
  openapi: generateOpenAPISpec,

  // === DevTools API ===
  /**
   * Initialize DevTools hook (call at app startup)
   * @example
   * Mandu.devtools.init();
   */
  devtools: {
    /**
     * Initialize DevTools
     */
    init: initializeHook,

    /**
     * Report an error to DevTools
     */
    reportError,

    /**
     * Get the state manager instance
     */
    getStateManager,

    /**
     * DevTools public API (also available as window.ManduDevTools)
     */
    api: ManduDevTools,
  },
} as const;
