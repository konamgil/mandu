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
 * # Identifier validation
 *
 * All identifier-shaped fields (`tableName`, `fieldOverrides[key].columnName`,
 * `indexes[].name`) are validated against {@link SAFE_PERSISTENCE_IDENTIFIER_RE}
 * at narrowing time. This is defense-in-depth in addition to `quoteIdent`:
 *   - `quoteIdent` catches SQL-injection characters (double quotes, backticks,
 *     NUL bytes) — but only when the value reaches DDL emission.
 *   - The same values ALSO feed `path.join` calls in `writeSchemaArtifacts`
 *     (`.mandu/generated/server/schema/{tableName}.sql`) and could otherwise
 *     allow path traversal via `..`, `/`, or `\` in the declared name.
 *   - Restricting to `[A-Za-z_][A-Za-z0-9_]*` closes both surfaces uniformly
 *     and matches the constraint already enforced on `definition.name` by
 *     `validateResourceDefinition` in schema.ts.
 *
 * References:
 *   - docs/rfcs/0001-db-resource-layer.md §4 D1 (opt-in persistence field)
 *   - docs/rfcs/0001-db-resource-layer.md Appendix D.1 (dialect divergence)
 *   - docs/security/phase-4c-audit.md §H-01 (path traversal remediation)
 *   - packages/core/src/resource/ddl/types.ts (canonical DDL contract)
 */

import type { SqlProvider, DdlDefault, DdlIndex } from "./types";

// ============================================
// Identifier validation
// ============================================

/**
 * The set of names allowed for DDL identifiers that originate from
 * user-authored resource options (`tableName`, `columnName`, index
 * `name`). Starts with a letter or underscore, followed by letters,
 * digits, or underscores — i.e. the portable SQL identifier subset
 * that is also safe to interpolate into a filesystem path segment.
 *
 * Rejects:
 *   - path separators (`/`, `\`) — prevents path traversal via
 *     `writeSchemaArtifacts` which writes `{tableName}.sql`.
 *   - `..`, `.` — parent/current directory markers.
 *   - whitespace and control characters — break both filesystems and
 *     terminal rendering in CLI output.
 *   - quote characters — redundant with `quoteIdent` but cheaper to
 *     reject early than per-dialect at emit time.
 *
 * Tightness rationale: we prefer a whitelist over a blacklist because
 * OS + dialect quoting behavior varies; a whitelist aligns the two and
 * stays simple to reason about.
 */
export const SAFE_PERSISTENCE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Upper bound — mirrors `emit.ts:MAX_IDENT_LENGTH` so DDL identifiers
 * never grow past the tighter of PG (63) / MySQL (64) limits. Enforcing
 * it here gives a clearer error than the downstream emit-time throw.
 */
const MAX_PERSISTENCE_IDENTIFIER_LENGTH = 63;

function assertSafeIdentifier(kind: string, value: string): void {
  if (value.length === 0) {
    throw new TypeError(`options.persistence.${kind} must not be empty`);
  }
  if (value.length > MAX_PERSISTENCE_IDENTIFIER_LENGTH) {
    throw new TypeError(
      `options.persistence.${kind} too long (${value.length} > ${MAX_PERSISTENCE_IDENTIFIER_LENGTH}): ${value.slice(0, 32)}...`
    );
  }
  if (!SAFE_PERSISTENCE_IDENTIFIER_RE.test(value)) {
    throw new TypeError(
      `options.persistence.${kind} ${JSON.stringify(value)} contains characters outside [A-Za-z0-9_] or does not start with a letter/underscore. ` +
        `This restriction blocks SQL injection and path traversal uniformly; use ${SAFE_PERSISTENCE_IDENTIFIER_RE} to construct the name.`
    );
  }
}

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
 * missing or empty. Throws `TypeError` on structurally-broken objects OR
 * on identifier-shaped fields that contain SQL-injection / path-traversal
 * characters (see {@link SAFE_PERSISTENCE_IDENTIFIER_RE}).
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
  if (obj.tableName !== undefined) {
    if (typeof obj.tableName !== "string") {
      throw new TypeError(`options.persistence.tableName must be a string`);
    }
    assertSafeIdentifier("tableName", obj.tableName);
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
  if (obj.indexes !== undefined) {
    if (!Array.isArray(obj.indexes)) {
      throw new TypeError(`options.persistence.indexes must be an array`);
    }
    for (let i = 0; i < obj.indexes.length; i++) {
      const idx = obj.indexes[i] as { name?: unknown } | undefined;
      if (idx && typeof idx === "object" && typeof idx.name === "string") {
        assertSafeIdentifier(`indexes[${i}].name`, idx.name);
      }
    }
  }
  if (obj.fieldOverrides !== undefined) {
    if (typeof obj.fieldOverrides !== "object" || obj.fieldOverrides === null || Array.isArray(obj.fieldOverrides)) {
      throw new TypeError(`options.persistence.fieldOverrides must be an object`);
    }
    for (const [key, value] of Object.entries(obj.fieldOverrides as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(
          `options.persistence.fieldOverrides.${key} must be an object`
        );
      }
      const col = (value as { columnName?: unknown }).columnName;
      if (col !== undefined) {
        if (typeof col !== "string") {
          throw new TypeError(
            `options.persistence.fieldOverrides.${key}.columnName must be a string`
          );
        }
        assertSafeIdentifier(`fieldOverrides.${key}.columnName`, col);
      }
    }
  }
  return obj as unknown as ExtendedResourcePersistence;
}
