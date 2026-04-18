/**
 * @mandujs/core/db/migrations/history-table
 *
 * History table DDL + row-level query helpers for the migration runtime.
 *
 * The `__mandu_migrations` table is Mandu's internal Flyway-style schema
 * history record. It exists in the user's database alongside their own
 * tables and is the single source of truth for "which migrations have
 * already been applied". Every row represents exactly one applied
 * migration file.
 *
 * ## Column contract (stable across dialects)
 *
 * | Column         | Type (dialect-mapped)            | Notes                                                  |
 * |----------------|----------------------------------|--------------------------------------------------------|
 * | `version`      | `TEXT PRIMARY KEY`               | Zero-padded 4-digit sequence (e.g. `"0001"`).          |
 * | `filename`     | `TEXT NOT NULL`                  | Migration filename relative to the migrations dir.     |
 * | `checksum`     | `TEXT NOT NULL`                  | SHA-256 hex lowercase of the file's normalized SQL.    |
 * | `applied_at`   | `TIMESTAMPTZ` / `DATETIME(6)` / `TEXT` | Dialect's high-precision timestamp.              |
 * | `execution_ms` | `INTEGER NOT NULL`               | Pure SQL execution time (excludes fetch / checksum).   |
 * | `success`      | `INTEGER NOT NULL`               | `0` or `1` — stored as int for dialect parity.         |
 * | `installed_by` | `TEXT`                           | DB user or `MANDU_MIGRATION_USER` env; nullable.       |
 *
 * ## Per-dialect DDL
 *
 * ### Postgres
 * ```sql
 * CREATE TABLE IF NOT EXISTS "__mandu_migrations" (
 *   "version"      TEXT PRIMARY KEY,
 *   "filename"     TEXT NOT NULL,
 *   "checksum"     TEXT NOT NULL,
 *   "applied_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 *   "execution_ms" INTEGER NOT NULL,
 *   "success"      INTEGER NOT NULL,
 *   "installed_by" TEXT
 * );
 * ```
 *
 * ### MySQL
 * ```sql
 * CREATE TABLE IF NOT EXISTS `__mandu_migrations` (
 *   `version`      VARCHAR(50) NOT NULL,
 *   `filename`     VARCHAR(255) NOT NULL,
 *   `checksum`     VARCHAR(64) NOT NULL,
 *   `applied_at`   DATETIME(6) NOT NULL,
 *   `execution_ms` INTEGER NOT NULL,
 *   `success`      INTEGER NOT NULL,
 *   `installed_by` VARCHAR(255),
 *   PRIMARY KEY (`version`)
 * );
 * ```
 * (MySQL requires lengths on VARCHAR in primary keys — we pick conservative
 *  sizes that match Bun.SQL's `TEXT` parse in practice.)
 *
 * ### SQLite
 * ```sql
 * CREATE TABLE IF NOT EXISTS "__mandu_migrations" (
 *   "version"      TEXT PRIMARY KEY,
 *   "filename"     TEXT NOT NULL,
 *   "checksum"     TEXT NOT NULL,
 *   "applied_at"   TEXT NOT NULL,
 *   "execution_ms" INTEGER NOT NULL,
 *   "success"      INTEGER NOT NULL,
 *   "installed_by" TEXT
 * );
 * ```
 *
 * @module db/migrations/history-table
 */

import type { SqlProvider } from "../../resource/ddl/types";
import type { Db } from "../index";

// ─── Constants ──────────────────────────────────────────────────────────────

/** Default history-table name. Override via `MigrationRunnerOptions.historyTable`. */
export const DEFAULT_HISTORY_TABLE = "__mandu_migrations";

/**
 * Identifier pattern for user-supplied history-table names. Because
 * Bun.SQL cannot bind identifiers, the table name is interpolated into
 * DDL/DML directly — we constrain it to `[A-Za-z_][A-Za-z0-9_]*` to
 * eliminate any SQL-injection surface. Same pattern used by
 * `filling/session-sqlite.ts:SAFE_IDENT_RE`.
 */
export const SAFE_HISTORY_TABLE_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ─── Row shape ──────────────────────────────────────────────────────────────

/**
 * Row shape for the history table. `success` is stored as an integer
 * (`0` / `1`) across all three dialects so consumers see a uniform type —
 * SQLite has no native boolean, and reusing the int form on PG/MySQL
 * keeps `readAllHistory` producing identically-typed rows.
 */
export interface HistoryRow {
  version: string;
  filename: string;
  checksum: string;
  applied_at: Date;
  execution_ms: number;
  success: number; // 0 or 1 — SQLite has no boolean
  installed_by?: string | null;
  // Index signature so the row satisfies `Record<string, unknown>` that
  // Bun.SQL's generic expects. Property types above still win for known keys.
  [key: string]: unknown;
}

// ─── Identifier quoting ─────────────────────────────────────────────────────

/**
 * Quote a validated identifier for the target provider. Postgres/SQLite
 * use double-quotes; MySQL uses backticks. Callers MUST validate the
 * identifier against `SAFE_HISTORY_TABLE_RE` before quoting — this
 * function assumes the input is already safe and does NOT re-escape.
 */
function quoteIdent(name: string, provider: SqlProvider): string {
  if (!SAFE_HISTORY_TABLE_RE.test(name)) {
    throw new Error(
      `[@mandujs/core/db/migrations] Invalid identifier ${JSON.stringify(
        name,
      )}. Must match ${SAFE_HISTORY_TABLE_RE}.`,
    );
  }
  if (provider === "mysql") return `\`${name}\``;
  return `"${name}"`;
}

// ─── DDL ────────────────────────────────────────────────────────────────────

/**
 * Produce the `CREATE TABLE IF NOT EXISTS` DDL for the history table on
 * the target provider. Idempotent — callers should execute on every boot;
 * the `IF NOT EXISTS` clause prevents re-creation once the row exists.
 *
 * Column order is fixed across dialects. We choose per-column SQL types
 * that match the `HistoryRow` contract as closely as each dialect
 * permits. See the module JSDoc for the full per-dialect rendering.
 *
 * @throws when `tableName` fails the safe-identifier check.
 */
export function historyTableDdl(tableName: string, provider: SqlProvider): string {
  const qTable = quoteIdent(tableName, provider);

  switch (provider) {
    case "postgres": {
      return [
        `CREATE TABLE IF NOT EXISTS ${qTable} (`,
        `  "version"      TEXT PRIMARY KEY,`,
        `  "filename"     TEXT NOT NULL,`,
        `  "checksum"     TEXT NOT NULL,`,
        `  "applied_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),`,
        `  "execution_ms" INTEGER NOT NULL,`,
        `  "success"      INTEGER NOT NULL,`,
        `  "installed_by" TEXT`,
        `)`,
      ].join("\n");
    }
    case "mysql": {
      // MySQL demands a length on VARCHAR in a PRIMARY KEY. 50 chars is
      // ample for `NNNN` today and leaves room for longer version schemes.
      return [
        `CREATE TABLE IF NOT EXISTS ${qTable} (`,
        `  \`version\`      VARCHAR(50) NOT NULL,`,
        `  \`filename\`     VARCHAR(255) NOT NULL,`,
        `  \`checksum\`     VARCHAR(64) NOT NULL,`,
        `  \`applied_at\`   DATETIME(6) NOT NULL,`,
        `  \`execution_ms\` INTEGER NOT NULL,`,
        `  \`success\`      INTEGER NOT NULL,`,
        `  \`installed_by\` VARCHAR(255),`,
        `  PRIMARY KEY (\`version\`)`,
        `)`,
      ].join("\n");
    }
    case "sqlite": {
      // SQLite accepts TEXT for timestamps — we insert ISO-8601 strings.
      return [
        `CREATE TABLE IF NOT EXISTS ${qTable} (`,
        `  "version"      TEXT PRIMARY KEY,`,
        `  "filename"     TEXT NOT NULL,`,
        `  "checksum"     TEXT NOT NULL,`,
        `  "applied_at"   TEXT NOT NULL,`,
        `  "execution_ms" INTEGER NOT NULL,`,
        `  "success"      INTEGER NOT NULL,`,
        `  "installed_by" TEXT`,
        `)`,
      ].join("\n");
    }
  }
}

// ─── Query helpers ──────────────────────────────────────────────────────────
//
// `@mandujs/core/db` exposes a tagged-template API. The SQL we emit here
// is dynamic in exactly one way (the table name) — SQLite/Postgres/MySQL
// do not bind identifiers, so we interpolate the (validated) table name
// into the SQL text and bind only real values through Bun.SQL placeholders.
//
// We reuse the same `splitPlaceholders` trick as
// `filling/session-sqlite.ts` so the query goes through the wrapper's
// parameter binding path (no string concat of values, ever).

/**
 * Read every row in the history table, ordered by version. The row
 * shape is the same across dialects — `applied_at` is coerced to `Date`
 * when the dialect returns it as a string (SQLite).
 */
export async function readAllHistory(
  db: Db,
  tableName: string,
): Promise<HistoryRow[]> {
  if (!SAFE_HISTORY_TABLE_RE.test(tableName)) {
    throw new Error(
      `[@mandujs/core/db/migrations] Invalid history table name ${JSON.stringify(
        tableName,
      )}.`,
    );
  }
  const qTable = quoteIdent(tableName, db.provider);
  const sql = `SELECT version, filename, checksum, applied_at, execution_ms, success, installed_by FROM ${qTable} ORDER BY version ASC`;
  const rows = await execQuery<Record<string, unknown>>(db, sql, []);
  return rows.map(coerceHistoryRow);
}

/**
 * Insert a single history row. The `applied_at` column is serialized to
 * ISO-8601 on SQLite (TEXT column) and passed through as-is on PG/MySQL
 * (native timestamp types).
 *
 * Expected to be called inside a transaction by the runner so that a
 * crash between SQL execution + history write leaves no partial state.
 */
export async function insertHistory(
  db: Db,
  tableName: string,
  row: Omit<HistoryRow, "applied_at"> & { applied_at: Date },
): Promise<void> {
  if (!SAFE_HISTORY_TABLE_RE.test(tableName)) {
    throw new Error(
      `[@mandujs/core/db/migrations] Invalid history table name ${JSON.stringify(
        tableName,
      )}.`,
    );
  }
  const qTable = quoteIdent(tableName, db.provider);

  // SQLite stores timestamps as TEXT in our schema; PG/MySQL accept Date.
  const appliedAtParam =
    db.provider === "sqlite" ? row.applied_at.toISOString() : row.applied_at;

  const sql = `INSERT INTO ${qTable} (version, filename, checksum, applied_at, execution_ms, success, installed_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
  await execQuery<Record<string, unknown>>(db, sql, [
    row.version,
    row.filename,
    row.checksum,
    appliedAtParam,
    row.execution_ms,
    row.success,
    row.installed_by ?? null,
  ]);
}

// ─── Internals ──────────────────────────────────────────────────────────────

/**
 * Normalize a raw row read from the DB into the `HistoryRow` contract.
 * Bun.SQL returns SQLite TEXT timestamps as strings; PG/MySQL drivers
 * return `Date` already. We unify on `Date`.
 */
function coerceHistoryRow(raw: Record<string, unknown>): HistoryRow {
  const appliedAtValue = raw.applied_at;
  let appliedAt: Date;
  if (appliedAtValue instanceof Date) {
    appliedAt = appliedAtValue;
  } else if (typeof appliedAtValue === "string") {
    appliedAt = new Date(appliedAtValue);
  } else if (typeof appliedAtValue === "number") {
    appliedAt = new Date(appliedAtValue);
  } else {
    // Row with NULL applied_at shouldn't happen (NOT NULL in DDL), but
    // handle defensively so consumers never crash on a garbage row.
    appliedAt = new Date(0);
  }

  return {
    version: String(raw.version ?? ""),
    filename: String(raw.filename ?? ""),
    checksum: String(raw.checksum ?? ""),
    applied_at: appliedAt,
    execution_ms: Number(raw.execution_ms ?? 0),
    success: Number(raw.success ?? 0),
    installed_by:
      typeof raw.installed_by === "string" ? raw.installed_by : null,
  };
}

/**
 * Run a SQL string (with `$1, $2, …` placeholders) against the
 * tagged-template `Db`. We construct a synthetic `TemplateStringsArray`
 * by splitting on the placeholder markers — the same pattern used by
 * `filling/session-sqlite.ts:splitPlaceholders`.
 *
 * This keeps the value-binding path identical to user-authored tagged
 * template literals (`db\`SELECT ...\``) — the values are forwarded to
 * Bun.SQL as bound parameters, never concatenated into the SQL string.
 */
async function execQuery<T extends Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const parts = splitPlaceholders(sql, params.length);
  const strings = Object.assign(parts.slice(), {
    raw: parts.slice(),
  }) as unknown as TemplateStringsArray;
  return (await db<T>(strings, ...params)) as T[];
}

/**
 * Split a SQL string with `$1`, `$2`, … markers into the string segments
 * that bracket each placeholder. The resulting array has
 * `placeholderCount + 1` entries — matches a real
 * `TemplateStringsArray`'s shape.
 *
 * Throws if the detected placeholder count disagrees with the provided
 * `params.length` — catches mismatched SQL/param pairs at call time
 * rather than surfacing them as a confusing Bun.SQL error.
 */
function splitPlaceholders(sql: string, expected: number): string[] {
  const parts: string[] = [];
  let rest = sql;
  for (let i = 1; i <= expected; i++) {
    const marker = `$${i}`;
    const idx = rest.indexOf(marker);
    if (idx === -1) {
      throw new Error(
        `[@mandujs/core/db/migrations] placeholder ${marker} missing in SQL: ${sql}`,
      );
    }
    parts.push(rest.slice(0, idx));
    rest = rest.slice(idx + marker.length);
  }
  parts.push(rest);
  return parts;
}
