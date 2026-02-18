/**
 * Branded Types - Nominal typing for string identifiers
 *
 * Prevents accidental mixing of different ID types at compile time.
 * All branded types are structurally compatible with plain strings at runtime.
 *
 * @example
 * ```typescript
 * const col = collectionId("blog");
 * const entry = entryId("hello-world");
 * // col and entry are both strings at runtime,
 * // but TypeScript treats them as distinct types.
 * ```
 */

declare const __brand: unique symbol;

/**
 * Brand utility type - creates nominal types from structural types.
 * The brand exists only at the type level and has zero runtime cost.
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Branded string identifying a content collection */
export type CollectionId = Brand<string, "CollectionId">;

/** Branded string identifying a content entry within a collection */
export type EntryId = Brand<string, "EntryId">;

/** Branded string containing sanitized HTML (XSS-safe) */
export type SafeHTML = Brand<string, "SafeHTML">;

/** Branded string identifying a route in the manifest */
export type RouteId = Brand<string, "RouteId">;

// -- Constructor functions --

/** Create a branded CollectionId from a plain string */
export function collectionId(id: string): CollectionId {
  return id as CollectionId;
}

/** Create a branded EntryId from a plain string */
export function entryId(id: string): EntryId {
  return id as EntryId;
}

/** Create a branded SafeHTML from a sanitized string */
export function safeHTML(html: string): SafeHTML {
  return html as SafeHTML;
}

/** Create a branded RouteId from a plain string */
export function routeId(id: string): RouteId {
  return id as RouteId;
}
