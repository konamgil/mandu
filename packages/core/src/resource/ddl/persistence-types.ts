/**
 * Phase 4c — Extended persistence options for `ResourceDefinition`.
 *
 * # Why a separate file (not module augmentation)?
 *
 * Module-augmenting `ResourceOptions.persistence` would pollute the shape
 * of `ResourceDefinition` for every consumer of `@mandujs/core` — including
 * apps that never opt into persistence. The augmentation would also load
 * DDL-specific symbols into the global type graph, which is exactly what
 * the `ddl/` subdirectory isolation is trying to prevent.
 *
 * Instead we keep persistence options as an INDEPENDENT type and narrow at
 * the use site (`snapshotFromResources`). `ResourceDefinition.options.persistence`
 * is typed as `unknown` by the public schema; this module's `asPersistence()`
 * is the single type-check gate. This preserves backward compatibility —
 * existing resource files without `persistence` keep working — while
 * giving the DDL layer a fully-typed view.
 *
 * References:
 *   - docs/rfcs/0001-db-resource-layer.md §4 D1 (opt-in persistence field)
 *   - docs/rfcs/0001-db-resource-layer.md Appendix D.1 (dialect divergence)
 *   - packages/core/src/resource/ddl/types.ts (canonical DDL contract)
 */

import type { SqlProvider, DdlDefault, DdlIndex } from "./types";

// ============================================
// Extended persistence options — opt-in
// ============================================

/**
 * Per-field override block. Merged on top of values derived from
 * `ResourceField` by `snapshotFromResources`. All fields are optional.
 *
 * `columnName` beats the default `camelCase → snake_case` transform.
 * `nullable` beats `!field.required`.
 * `default` beats `field.default` (and bypasses its string-magic parsing).
 * `maxLength` is used when the Mandu field type is `string`.
 */
export interface FieldOverride {
  /** Explicit column name override. Must match `/^[a-z_][a-z0-9_]*$/i`. */
  columnName?: string;
  /** Explicit NULL allowance. */
  nullable?: boolean;
  /** Explicit DEFAULT clause (bypasses `field.default` string magic). */
  default?: DdlDefault;
  /** VARCHAR length for `string` fields. Ignored for other types. */
  maxLength?: number;
  /** Mark as indexed (single-column, non-unique). */
  indexed?: boolean;
  /** Mark as UNIQUE. */
  unique?: boolean;
}

/**
 * Persistence block on a resource definition — opt-in to DDL/migration.
 * Resources without this field are ignored by the diff engine.
 */
export interface ExtendedResourcePersistence {
  /** Which SQL provider this resource targets. Must be consistent across the project. */
  provider: SqlProvider;
  /** Explicit table name. Overrides auto-pluralization of `resource.name`. */
  tableName?: string;
  /**
   * Primary key field key. Can be a single string (v1) or a 1-element array
   * (future-compatible). Multi-element arrays are rejected — composite keys
   * are v2+.
   */
  primaryKey?: string | [string];
  /** Multi-column indexes. Single-column indexes live on the field itself. */
  indexes?: DdlIndex[];
  /** Per-field overrides keyed by the Mandu field name. */
  fieldOverrides?: Record<string, FieldOverride>;
}

// ============================================
// Safe narrowing
// ============================================

/**
 * Narrow `unknown` (the public schema type for `options.persistence`) to
 * `ExtendedResourcePersistence`. Returns `undefined` when the value is
 * missing or empty. Throws `TypeError` on structurally-broken objects.
 *
 * This is the ONLY place the DDL layer trusts the shape of the persistence
 * block; downstream code never sees `unknown`.
 */
export function asPersistence(raw: unknown): ExtendedResourcePersistence | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") {
    throw new TypeError(`options.persistence must be an object, got ${typeof raw}`);
  }
  const obj = raw as Record<string, unknown>;
  const provider = obj.provider;
  if (provider !== "postgres" && provider !== "mysql" && provider !== "sqlite") {
    throw new TypeError(
      `options.persistence.provider must be one of "postgres" | "mysql" | "sqlite", got ${JSON.stringify(provider)}`
    );
  }
  if (obj.tableName !== undefined && typeof obj.tableName !== "string") {
    throw new TypeError(`options.persistence.tableName must be a string`);
  }
  if (obj.primaryKey !== undefined) {
    const pk = obj.primaryKey;
    if (
      typeof pk !== "string" &&
      !(Array.isArray(pk) && pk.length === 1 && typeof pk[0] === "string")
    ) {
      throw new TypeError(
        `options.persistence.primaryKey must be a string or single-element string array (composite keys are v2)`
      );
    }
  }
  if (obj.indexes !== undefined && !Array.isArray(obj.indexes)) {
    throw new TypeError(`options.persistence.indexes must be an array`);
  }
  if (
    obj.fieldOverrides !== undefined &&
    (typeof obj.fieldOverrides !== "object" || obj.fieldOverrides === null || Array.isArray(obj.fieldOverrides))
  ) {
    throw new TypeError(`options.persistence.fieldOverrides must be an object`);
  }
  return obj as unknown as ExtendedResourcePersistence;
}
