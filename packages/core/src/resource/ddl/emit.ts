/**
 * Phase 4c — DDL emission engine.
 *
 * Pure, deterministic translation from `DdlResource` / `Change` objects
 * into dialect-correct SQL strings for Postgres, MySQL, and SQLite.
 *
 * Design invariants (Agents B/C/D/E/G rely on these):
 *   1. NO I/O. Every function is synchronous and takes / returns strings
 *      or plain objects. No filesystem, no database connection.
 *   2. NO dependency on `Bun.SQL` or any driver. We only emit SQL text —
 *      Agent C's runner handles execution.
 *   3. Every identifier — table names, column names, index names — MUST
 *      flow through `quoteIdent`. Direct string interpolation of
 *      identifiers into SQL is a security audit failure (Agent G).
 *   4. Value literals in `DEFAULT` clauses flow through `resolveDefault`
 *      which handles quote escaping. `kind: "sql"` is the explicit
 *      escape hatch — caller's responsibility.
 *   5. Unsupported changes (v1 scope — `alter-column-type`) emit a
 *      `-- TODO:` comment block + a no-op `SELECT 1;` so the generated
 *      migration still parses and Agent C's runner can record an
 *      "applied but manual" row.
 *
 * Determinism:
 *   - `emitCreateTable` emits columns in `DdlFieldDef` array order — the
 *     snapshot layer (Agent B) is responsible for stabilizing that order
 *     (see §"Deterministic ordering" in docs/bun/phase-4c-team-plan.md).
 *   - `emitChanges` emits in the order received. Agent B guarantees
 *     deterministic change order; emit does not re-sort.
 *
 * References:
 *   - docs/bun/phase-4c-team-plan.md §2 (types) + §3 Agent A
 *   - docs/rfcs/0001-db-resource-layer.md Appendix D.1 (dialect divergence)
 *   - DNA/drizzle-orm/drizzle-kit/src/sqlgenerator.ts (reference emitter)
 */

import {
  nowExpr,
  resolveColumnType,
  resolveDefault,
} from "./type-map";
import type {
  Change,
  DdlFieldDef,
  DdlIndex,
  DdlResource,
  SqlProvider,
} from "./types";

// =====================================================================
// Identifier quoting — security-critical (audited by Agent G).
// =====================================================================

/**
 * Maximum length for an identifier before we refuse to emit.
 *
 * Postgres allows 63 bytes (NAMEDATALEN - 1), MySQL 64. We pick the
 * tighter bound so identity rules are uniform across dialects and
 * cross-dialect migration files don't surprise a user switching providers.
 */
const MAX_IDENT_LENGTH = 63;

/**
 * Dialect-correct identifier quoter.
 *
 * - Postgres / SQLite: wraps in ANSI double quotes. Rejects names
 *   containing `"` — there is no portable escape (`""` works on PG but
 *   complicates downstream tooling and is not idiomatic for generated
 *   code).
 * - MySQL: wraps in backticks. Rejects names containing `` ` ``.
 *
 * All providers additionally reject:
 *   - empty string
 *   - names longer than 63 chars (PG limit — stricter than MySQL's 64)
 *   - NUL bytes (`\0`) — a driver-level crash on several Bun.SQL backends
 *
 * @throws {Error} with a clear message when any rule is violated.
 */
export function quoteIdent(name: string, provider: SqlProvider): string {
  if (typeof name !== "string") {
    throw new Error(`identifier must be a string, got ${typeof name}`);
  }
  if (name.length === 0) {
    throw new Error("identifier must not be empty");
  }
  if (name.length > MAX_IDENT_LENGTH) {
    throw new Error(
      `identifier too long (${name.length} > ${MAX_IDENT_LENGTH}): ${name.slice(0, 32)}...`,
    );
  }
  if (name.includes("\0")) {
    throw new Error("identifier contains NUL byte");
  }

  if (provider === "mysql") {
    if (name.includes("`")) {
      throw new Error(`identifier contains unquotable character: ${JSON.stringify(name)}`);
    }
    return `\`${name}\``;
  }
  // Postgres, SQLite
  if (name.includes('"')) {
    throw new Error(`identifier contains unquotable character: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

// =====================================================================
// Column + index emission helpers.
// =====================================================================

/**
 * Emit a single column definition line (no leading whitespace, no trailing
 * comma). Used inside `CREATE TABLE` parens and by `emitChange("add-column")`.
 *
 * Column order of modifiers (chosen to match Drizzle / Atlas output for
 * familiarity):
 *   <name> <type> [PRIMARY KEY] [NOT NULL] [UNIQUE] [DEFAULT <expr>]
 *
 * Rationale:
 *   - `PRIMARY KEY` before `NOT NULL` mirrors Postgres/MySQL docs.
 *   - `DEFAULT` last because some drivers (SQLite) parse `NOT NULL DEFAULT`
 *     more reliably than the reverse.
 */
function emitColumnDef(field: DdlFieldDef, provider: SqlProvider): string {
  const ident = quoteIdent(field.name, provider);
  const type = resolveColumnType(field, provider);
  const parts: string[] = [ident, type];

  if (field.primary) parts.push("PRIMARY KEY");
  // PRIMARY KEY implies NOT NULL everywhere; skip the explicit marker.
  if (!field.nullable && !field.primary) parts.push("NOT NULL");
  if (field.unique && !field.primary) parts.push("UNIQUE");

  if (field.default) {
    parts.push(`DEFAULT ${resolveDefault(field.default, provider)}`);
  }

  return parts.join(" ");
}

/**
 * Stable single-column index name. Used when a field is flagged
 * `indexed: true` but no explicit DdlIndex entry exists for it.
 *
 * Format: `idx_<table>_<column>` — shortened to fit within
 * MAX_IDENT_LENGTH when either name is long.
 */
function autoIndexName(table: string, column: string): string {
  const raw = `idx_${table}_${column}`;
  if (raw.length <= MAX_IDENT_LENGTH) return raw;
  // Truncate by taking prefix of table + suffix of column — preserves some
  // readability while guaranteeing length compliance. Deterministic.
  const budget = MAX_IDENT_LENGTH - "idx_".length - 1;
  const halfBudget = Math.floor(budget / 2);
  return `idx_${table.slice(0, halfBudget)}_${column.slice(-halfBudget)}`;
}

/**
 * Emit a `CREATE INDEX` statement for either:
 *   - an automatic single-column index on an `indexed: true` field, or
 *   - an explicit multi-column `DdlIndex`.
 */
function emitCreateIndex(
  table: string,
  name: string,
  columns: readonly string[],
  unique: boolean,
  provider: SqlProvider,
): string {
  const uniqueKw = unique ? "UNIQUE " : "";
  const tbl = quoteIdent(table, provider);
  const idx = quoteIdent(name, provider);
  const cols = columns.map((c) => quoteIdent(c, provider)).join(", ");
  return `CREATE ${uniqueKw}INDEX ${idx} ON ${tbl} (${cols});`;
}

// =====================================================================
// Public API — resource-level emitters.
// =====================================================================

/**
 * Emit the full initial-migration SQL for a single resource:
 * one `CREATE TABLE` followed by zero or more `CREATE INDEX` statements.
 *
 * Output format:
 *   - No leading / trailing blank lines (caller composes).
 *   - `CREATE TABLE` spans multiple lines, one column per line, two-space
 *     indent — matches Drizzle-kit's output for diff readability.
 *   - Each statement ends with `;`. Statements separated by `\n`.
 *
 * Determinism: column order matches `resource.fields` array order, index
 * order matches: all `indexed: true` fields (in field array order) first,
 * then explicit `resource.indexes` (in array order).
 */
export function emitCreateTable(resource: DdlResource, provider: SqlProvider): string {
  if (!Array.isArray(resource.fields) || resource.fields.length === 0) {
    throw new Error(`resource "${resource.name}" has no fields — cannot emit CREATE TABLE`);
  }

  const tableIdent = quoteIdent(resource.name, provider); // also validates

  const columnLines = resource.fields.map((f) => `  ${emitColumnDef(f, provider)}`);
  const createTable = [
    `CREATE TABLE ${tableIdent} (`,
    columnLines.join(",\n"),
    `);`,
  ].join("\n");

  const indexStatements: string[] = [];

  // Auto-index from `field.indexed` (single column, non-unique).
  for (const field of resource.fields) {
    if (!field.indexed) continue;
    // Skip if field is already unique (UNIQUE column constraint creates
    // an implicit index on PG/MySQL; on SQLite a UNIQUE column also has
    // an implicit index).
    if (field.unique || field.primary) continue;
    indexStatements.push(
      emitCreateIndex(
        resource.name,
        autoIndexName(resource.name, field.name),
        [field.name],
        false,
        provider,
      ),
    );
  }

  // Explicit multi-column indexes.
  for (const index of resource.indexes ?? []) {
    validateIndex(resource, index);
    indexStatements.push(
      emitCreateIndex(resource.name, index.name, index.fields, index.unique, provider),
    );
  }

  return indexStatements.length > 0
    ? `${createTable}\n${indexStatements.join("\n")}`
    : createTable;
}

/**
 * Emit a `DROP TABLE IF EXISTS` statement. `IF EXISTS` is present on all
 * three dialects and makes migrations idempotent on re-run.
 */
export function emitDropTable(resourceName: string, provider: SqlProvider): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(resourceName, provider)};`;
}

/**
 * Emit the full initial schema for many resources. Each resource becomes a
 * `CREATE TABLE` (+ its indexes); blocks are separated by one blank line
 * for readability.
 *
 * Deterministic in resource array order — the snapshot layer is
 * responsible for stable ordering.
 */
export function emitSchema(resources: DdlResource[], provider: SqlProvider): string {
  if (resources.length === 0) return "";
  return resources.map((r) => emitCreateTable(r, provider)).join("\n\n");
}

/**
 * Emit a sequence of `Change` objects as a single migration SQL string.
 * Each change becomes one or more statements, separated by newlines.
 *
 * Empty input returns empty string (not whitespace) — makes it safe to
 * concatenate with a header or leave out when unused.
 */
export function emitChanges(changes: readonly Change[], provider: SqlProvider): string {
  if (changes.length === 0) return "";
  return changes.map((c) => emitChange(c, provider)).join("\n");
}

// =====================================================================
// Change dispatch — one branch per `Change.kind`.
// =====================================================================

/**
 * Dispatch a single `Change` to the corresponding SQL statement(s).
 *
 * Unknown `kind` throws (defensive against future `Change` variants added
 * to `types.ts` without a matching emitter update).
 */
export function emitChange(change: Change, provider: SqlProvider): string {
  switch (change.kind) {
    case "create-table":
      return emitCreateTable(change.resource, provider);
    case "drop-table":
      return emitDropTable(change.resourceName, provider);
    case "add-column":
      return emitAddColumn(change.resourceName, change.field, provider);
    case "drop-column":
      return emitDropColumn(change.resourceName, change.fieldName, provider);
    case "alter-column-type":
      return emitAlterColumnTypeStub(
        change.resourceName,
        change.fieldName,
        change.fromType,
        change.toType,
      );
    case "alter-column-nullable":
      return emitAlterColumnNullable(
        change.resourceName,
        change.fieldName,
        change.nullable,
        provider,
      );
    case "alter-column-default":
      return emitAlterColumnDefault(
        change.resourceName,
        change.fieldName,
        change.default,
        provider,
      );
    case "add-index":
      return emitAddIndex(change.resourceName, change.index, provider);
    case "drop-index":
      return emitDropIndex(change.resourceName, change.indexName, provider);
    case "rename-table":
      return emitRenameTable(change.oldName, change.newName, provider);
    case "rename-column":
      return emitRenameColumn(
        change.resourceName,
        change.oldName,
        change.newName,
        provider,
      );
    default: {
      // `never` check — keeps this function exhaustive with types.ts.
      const _exhaustive: never = change;
      throw new Error(`unknown Change.kind: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// =====================================================================
// Change emitters (internal — called only via emitChange dispatch).
// =====================================================================

function emitAddColumn(
  resourceName: string,
  field: DdlFieldDef,
  provider: SqlProvider,
): string {
  const table = quoteIdent(resourceName, provider);
  const columnDef = emitColumnDef(field, provider);
  return `ALTER TABLE ${table} ADD COLUMN ${columnDef};`;
}

/**
 * DROP COLUMN.
 *
 * Note on SQLite: DROP COLUMN landed in SQLite 3.35 (March 2021). Bun's
 * bundled SQLite is modern (3.46+ as of Bun 1.3), so we emit the standard
 * `ALTER TABLE ... DROP COLUMN ...` and assume the target engine is >=3.35.
 * Downstream environments pinning an older SQLite will need to manually
 * use the `recreate table` dance — Agent F's matrix tests cover 3.46.
 */
function emitDropColumn(
  resourceName: string,
  fieldName: string,
  provider: SqlProvider,
): string {
  const table = quoteIdent(resourceName, provider);
  const col = quoteIdent(fieldName, provider);
  return `ALTER TABLE ${table} DROP COLUMN ${col};`;
}

/**
 * Emit a stub `-- TODO:` block for v1-unsupported `alter-column-type`.
 *
 * Output: a multi-line SQL comment block naming the resource + field +
 * fromType → toType, followed by the literal TODO message and a no-op
 * `SELECT 1;` so the migration runner (Agent C) parses and advances past
 * this statement.
 */
function emitAlterColumnTypeStub(
  resourceName: string,
  fieldName: string,
  fromType: string,
  toType: string,
): string {
  return [
    `-- ================================================================`,
    `-- Column type change detected: ${resourceName}.${fieldName}`,
    `--   from: ${fromType}`,
    `--   to:   ${toType}`,
    `-- TODO: Mandu does not auto-generate ALTER COLUMN TYPE in v1.`,
    `-- Please write the migration manually, then re-run \`mandu db apply\`.`,
    `-- ================================================================`,
    `SELECT 1;`,
  ].join("\n");
}

function emitAlterColumnNullable(
  resourceName: string,
  fieldName: string,
  nullable: boolean,
  provider: SqlProvider,
): string {
  const table = quoteIdent(resourceName, provider);
  const col = quoteIdent(fieldName, provider);
  if (provider === "postgres") {
    // PG supports direct SET/DROP NOT NULL on existing columns.
    return nullable
      ? `ALTER TABLE ${table} ALTER COLUMN ${col} DROP NOT NULL;`
      : `ALTER TABLE ${table} ALTER COLUMN ${col} SET NOT NULL;`;
  }
  if (provider === "sqlite") {
    // SQLite cannot toggle NOT NULL on an existing column without a full
    // table recreate. Emit a stub so the user handles it manually.
    return [
      `-- ================================================================`,
      `-- Nullability change: ${resourceName}.${fieldName} → ${nullable ? "NULL" : "NOT NULL"}`,
      `-- TODO: SQLite cannot toggle NOT NULL in place. Recreate the table`,
      `-- manually (CREATE new, INSERT SELECT, DROP old, RENAME) and re-run.`,
      `-- ================================================================`,
      `SELECT 1;`,
    ].join("\n");
  }
  // MySQL requires the full column spec; we cannot reconstruct it here.
  // Emit a stub — Agent B's diff emits `alter-column-nullable` only when
  // everything else matches, so this is narrow-scope.
  return [
    `-- ================================================================`,
    `-- Nullability change: ${resourceName}.${fieldName} → ${nullable ? "NULL" : "NOT NULL"}`,
    `-- TODO: MySQL MODIFY COLUMN requires the full column type; Mandu v1`,
    `-- cannot emit this automatically. Please edit this migration to use`,
    `-- \`ALTER TABLE ${resourceName} MODIFY COLUMN ${fieldName} <TYPE> ${nullable ? "NULL" : "NOT NULL"}\``,
    `-- ================================================================`,
    `SELECT 1;`,
  ].join("\n");
}

function emitAlterColumnDefault(
  resourceName: string,
  fieldName: string,
  def: DdlFieldDef["default"] | undefined,
  provider: SqlProvider,
): string {
  const table = quoteIdent(resourceName, provider);
  const col = quoteIdent(fieldName, provider);
  if (provider === "postgres") {
    return def
      ? `ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT ${resolveDefault(def, provider)};`
      : `ALTER TABLE ${table} ALTER COLUMN ${col} DROP DEFAULT;`;
  }
  if (provider === "sqlite") {
    // Same constraint as nullability — SQLite needs a table recreate.
    return [
      `-- ================================================================`,
      `-- Default change: ${resourceName}.${fieldName}`,
      `-- TODO: SQLite cannot ALTER DEFAULT in place. Recreate the table.`,
      `-- ================================================================`,
      `SELECT 1;`,
    ].join("\n");
  }
  // MySQL — ALTER COLUMN ... SET DEFAULT / DROP DEFAULT is actually supported.
  return def
    ? `ALTER TABLE ${table} ALTER COLUMN ${col} SET DEFAULT ${resolveDefault(def, provider)};`
    : `ALTER TABLE ${table} ALTER COLUMN ${col} DROP DEFAULT;`;
}

function emitAddIndex(
  resourceName: string,
  index: DdlIndex,
  provider: SqlProvider,
): string {
  if (!index.fields || index.fields.length === 0) {
    throw new Error(`DdlIndex "${index.name}" has no fields`);
  }
  return emitCreateIndex(resourceName, index.name, index.fields, index.unique, provider);
}

function emitDropIndex(
  resourceName: string,
  indexName: string,
  provider: SqlProvider,
): string {
  const idx = quoteIdent(indexName, provider);
  if (provider === "mysql") {
    // MySQL requires the table name — DROP INDEX ... ON table.
    const table = quoteIdent(resourceName, provider);
    return `DROP INDEX ${idx} ON ${table};`;
  }
  // Postgres + SQLite use standalone DROP INDEX (index names are unique
  // per-schema in PG, per-database in SQLite).
  return `DROP INDEX ${idx};`;
}

function emitRenameTable(
  oldName: string,
  newName: string,
  provider: SqlProvider,
): string {
  const from = quoteIdent(oldName, provider);
  const to = quoteIdent(newName, provider);
  return `ALTER TABLE ${from} RENAME TO ${to};`;
}

function emitRenameColumn(
  resourceName: string,
  oldName: string,
  newName: string,
  provider: SqlProvider,
): string {
  const table = quoteIdent(resourceName, provider);
  const from = quoteIdent(oldName, provider);
  const to = quoteIdent(newName, provider);
  // All three dialects use `ALTER TABLE ... RENAME COLUMN ... TO ...` in
  // their modern versions (PG >=9.2, MySQL >=8.0.3, SQLite >=3.25).
  return `ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to};`;
}

// =====================================================================
// Validation helpers.
// =====================================================================

function validateIndex(resource: DdlResource, index: DdlIndex): void {
  if (!index.name) {
    throw new Error(`resource "${resource.name}" has an unnamed index`);
  }
  if (!index.fields || index.fields.length === 0) {
    throw new Error(`index "${index.name}" on "${resource.name}" has no fields`);
  }
  const fieldNames = new Set(resource.fields.map((f) => f.name));
  for (const f of index.fields) {
    if (!fieldNames.has(f)) {
      throw new Error(
        `index "${index.name}" on "${resource.name}" references unknown field "${f}"`,
      );
    }
  }
}

// Internal exports for white-box tests ONLY. Not part of the public API
// (consumers should never rely on these names being stable).
export const _internal = {
  emitColumnDef,
  autoIndexName,
  validateIndex,
  MAX_IDENT_LENGTH,
};

// Re-export the type-map functions so consumers can import from a single
// entry point. No logic added — just pass-through.
export { nowExpr, resolveColumnType, resolveDefault } from "./type-map";
