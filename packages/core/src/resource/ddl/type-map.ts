/**
 * Phase 4c — Dialect-specific type mapping.
 *
 * Pure, stateless translation from Mandu's abstract `DdlFieldType` to the
 * concrete SQL column type declaration for each supported provider.
 *
 * This module is intentionally tiny and has no dependency on `emit.ts`; it
 * is imported by `emit.ts` and may be consumed independently by Agents
 * D (generator) and F (QA) for table introspection / parity checks.
 *
 * ## Type map (v1 definitive)
 *
 * | Mandu `type`              | Postgres          | MySQL         | SQLite  |
 * |---------------------------|-------------------|---------------|---------|
 * | `string` (no maxLength)   | `TEXT`            | `VARCHAR(255)`| `TEXT`  |
 * | `string` (maxLength = N)  | `VARCHAR(N)`      | `VARCHAR(N)`  | `TEXT`  |
 * | `number`                  | `DOUBLE PRECISION`| `DOUBLE`      | `REAL`  |
 * | `boolean`                 | `BOOLEAN`         | `TINYINT(1)`  | `INTEGER`|
 * | `date`                    | `TIMESTAMPTZ`     | `DATETIME(6)` | `TEXT`  |
 * | `uuid`                    | `UUID`            | `CHAR(36)`    | `TEXT`  |
 * | `email`                   | `VARCHAR(320)`    | `VARCHAR(320)`| `TEXT`  |
 * | `url`                     | `VARCHAR(2048)`   | `VARCHAR(2048)`| `TEXT` |
 * | `json` / `array` / `object`| `JSONB`          | `JSON`        | `TEXT`  |
 *
 * Rationale for fixed lengths:
 *   - `email` 320 chars — RFC 5321 cap (64 local + 1 @ + 255 domain).
 *   - `url`   2048 chars — de facto HTTP URL upper bound used by most
 *     browsers and CDNs; shorter than many drivers' TEXT truncation.
 *   - `string` default on MySQL is `VARCHAR(255)` because MySQL without a
 *     length on `VARCHAR` fails to parse; `TEXT` on MySQL disallows indexes
 *     without a prefix spec which breaks `indexed: true`.
 *
 * SQLite notes:
 *   - SQLite uses dynamic type affinity; our mapping chooses the canonical
 *     affinity names (`TEXT`, `REAL`, `INTEGER`) over the richer PG types so
 *     `SELECT typeof(col)` returns the expected affinity in tests.
 *   - Booleans are `INTEGER` — SQLite has no native boolean; the driver
 *     stores `1`/`0`.
 */
import type { DdlDefault, DdlFieldDef, DdlFieldType, SqlProvider } from "./types";

// =====================================================================
// Constants — exposed for testability and to document magic numbers.
// =====================================================================

/** Default VARCHAR length for MySQL when the `string` field omits `maxLength`. */
export const MYSQL_DEFAULT_STRING_LENGTH = 255;

/** RFC 5321 email upper bound. Enforced on MySQL/PG as a VARCHAR cap. */
export const EMAIL_MAX_LENGTH = 320;

/**
 * Pragmatic HTTP URL cap — shorter than most TEXT truncation points
 * (e.g. IE's historical 2083 limit) and long enough for OAuth redirects.
 */
export const URL_MAX_LENGTH = 2048;

/** Fixed CHAR length for UUIDs on MySQL (36 = canonical hex-with-dashes). */
export const UUID_CHAR_LENGTH = 36;

// =====================================================================
// Static per-provider map for non-parameterized types.
// `string` is resolved dynamically because it depends on `maxLength`.
// =====================================================================

type StaticType = Exclude<DdlFieldType, "string">;

const TYPE_MAP: Record<SqlProvider, Record<StaticType, string>> = {
  postgres: {
    number: "DOUBLE PRECISION",
    boolean: "BOOLEAN",
    date: "TIMESTAMPTZ",
    uuid: "UUID",
    email: `VARCHAR(${EMAIL_MAX_LENGTH})`,
    url: `VARCHAR(${URL_MAX_LENGTH})`,
    json: "JSONB",
    array: "JSONB",
    object: "JSONB",
  },
  mysql: {
    number: "DOUBLE",
    boolean: "TINYINT(1)",
    date: "DATETIME(6)",
    uuid: `CHAR(${UUID_CHAR_LENGTH})`,
    email: `VARCHAR(${EMAIL_MAX_LENGTH})`,
    url: `VARCHAR(${URL_MAX_LENGTH})`,
    json: "JSON",
    array: "JSON",
    object: "JSON",
  },
  sqlite: {
    number: "REAL",
    boolean: "INTEGER",
    date: "TEXT",
    uuid: "TEXT",
    email: "TEXT",
    url: "TEXT",
    json: "TEXT",
    array: "TEXT",
    object: "TEXT",
  },
};

// =====================================================================
// Public API
// =====================================================================

/**
 * Dialect-specific NOW() expression. Used by `DdlDefault.kind === "now"`
 * and by emit.ts when a field's default should map to "current timestamp".
 *
 * - Postgres & MySQL — `NOW()` (ANSI-ish, identical semantics).
 * - SQLite          — `CURRENT_TIMESTAMP` (SQLite has no `NOW()`).
 */
export function nowExpr(provider: SqlProvider): string {
  switch (provider) {
    case "postgres":
    case "mysql":
      return "NOW()";
    case "sqlite":
      return "CURRENT_TIMESTAMP";
  }
}

/**
 * Resolve a Mandu field to its dialect-specific SQL column type declaration.
 *
 * `maxLength` applies ONLY to `string` — other types have fixed widths
 * documented in the module header.
 *
 * @example
 *   resolveColumnType({ type: "string", maxLength: 100, ... }, "postgres")
 *     → "VARCHAR(100)"
 *   resolveColumnType({ type: "string", ... }, "postgres")
 *     → "TEXT"
 *   resolveColumnType({ type: "string", ... }, "mysql")
 *     → "VARCHAR(255)"
 */
export function resolveColumnType(field: DdlFieldDef, provider: SqlProvider): string {
  if (field.type === "string") {
    return resolveStringType(field.maxLength, provider);
  }
  // Narrowed above — the remaining types are StaticType.
  return TYPE_MAP[provider][field.type];
}

/**
 * Resolve a `DdlDefault` to the SQL literal that goes after `DEFAULT`.
 *
 * Returns JUST the expression — the caller prepends `DEFAULT ` when
 * composing the column definition.
 *
 * Escaping rules:
 *   - `literal: string`  — ANSI single-quote escape (`'` → `''`).
 *   - `literal: number`  — emitted verbatim (already numeric).
 *   - `literal: boolean` — Postgres/MySQL `TRUE`/`FALSE`; SQLite `1`/`0`
 *     (no native boolean).
 *   - `sql: expr`        — passed through unchanged. Caller is responsible
 *     for cross-dialect portability; this is the escape hatch for things
 *     like sequence defaults or Postgres-specific `gen_random_uuid()`.
 */
export function resolveDefault(def: NonNullable<DdlFieldDef["default"]>, provider: SqlProvider): string {
  switch (def.kind) {
    case "now":
      return nowExpr(provider);
    case "null":
      return "NULL";
    case "sql":
      return def.expr;
    case "literal":
      return formatLiteral(def.value, provider);
  }
  // Exhaustiveness check — if DdlDefault gains a variant, TS will force this
  // function to be updated before the project type-checks.
  const _exhaustive: never = def;
  return _exhaustive;
}

// =====================================================================
// Internals
// =====================================================================

function resolveStringType(maxLength: number | undefined, provider: SqlProvider): string {
  if (provider === "sqlite") return "TEXT"; // SQLite ignores length spec.
  if (typeof maxLength === "number" && maxLength > 0) return `VARCHAR(${maxLength})`;
  if (provider === "postgres") return "TEXT";
  // MySQL default: we MUST pick a length because `VARCHAR` with no length is
  // a parse error. 255 is the convention most ORMs settle on.
  return `VARCHAR(${MYSQL_DEFAULT_STRING_LENGTH})`;
}

function formatLiteral(value: string | number | boolean, provider: SqlProvider): string {
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`DDL default literal must be a finite number, got ${String(value)}`);
    }
    return String(value);
  }
  // boolean
  if (provider === "sqlite") return value ? "1" : "0";
  return value ? "TRUE" : "FALSE";
}

// Runtime sanity — exported for test use only.
export function _internal_allStaticTypes(): StaticType[] {
  return [
    "number",
    "boolean",
    "date",
    "uuid",
    "email",
    "url",
    "json",
    "array",
    "object",
  ];
}

/** Re-export DdlDefault for ergonomic consumer imports. */
export type { DdlDefault };
