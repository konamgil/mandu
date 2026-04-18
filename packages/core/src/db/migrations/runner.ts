/**
 * @mandujs/core/db/migrations/runner
 *
 * Migration runtime for Mandu — the single source of truth for:
 *
 *   1. Reading migration files from disk (`NNNN_description.sql`).
 *   2. Keeping a history of what has been applied in the database's own
 *      `__mandu_migrations` table.
 *   3. Verifying that on-disk files haven't drifted from what we
 *      applied (checksum tamper detection).
 *   4. Atomically applying pending migrations with per-dialect
 *      serialisation (advisory lock / GET_LOCK / BEGIN IMMEDIATE).
 *
 * ## Flow
 *
 * ```
 * ensureHistoryTable()
 *   ↓
 * plan()           → reads disk, diffs against history, returns pending
 *   ↓
 * apply()          → acquires lock, runs each pending file in its own tx,
 *                     inserts history row on success, aborts on first
 *                     failure (previously applied rows persist)
 *   ↓
 * status()         → combined snapshot of applied / pending / tampered /
 *                     orphaned
 * ```
 *
 * ## Tamper detection
 *
 * When a migration file on disk has been modified after it was applied,
 * its SHA-256 checksum no longer matches the one stored in
 * `__mandu_migrations`. Such rows are surfaced by `status()` as
 * `tampered`. `apply()` refuses to advance past a tampered row and
 * throws {@link MigrationTamperedError} naming the file + both
 * checksums — the operator must either revert the file or use
 * `mandu db reset --allow-tamper --force` (Agent E's CLI) to forcibly
 * reset history.
 *
 * ## Transaction semantics
 *
 * Every migration file is applied inside its own `db.transaction()`
 * call. A crash or SQL error during a migration rolls back every
 * statement in that file AND omits the history row — the next
 * `apply()` retries from exactly that version. Migrations earlier in
 * the sequence are not touched.
 *
 * ## v1 limitations (documented for upstream consumers)
 *
 * - Statement splitter is a simple "semicolon at end of line" split. A
 *   single migration file that includes a `;` inside a string literal
 *   on its own line will mis-split. Works for 99% of hand-written
 *   migrations. See {@link splitStatements} for the exact rule.
 * - No rollback / DOWN migrations.
 * - No cross-process distributed lock beyond the dialect primitives
 *   Bun.SQL exposes.
 *
 * @module db/migrations/runner
 */

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import type {
  AppliedMigration,
  LockStrategy,
  MigrationStatus,
  PendingMigration,
  SqlProvider,
} from "../../resource/ddl/types";
import type { Db } from "../index";
import {
  DEFAULT_HISTORY_TABLE,
  SAFE_HISTORY_TABLE_RE,
  historyTableDdl,
  insertHistory,
  readAllHistory,
  type HistoryRow,
} from "./history-table";
import { acquireMigrationLock, type MigrationLock } from "./lock";

// ─── Public errors ──────────────────────────────────────────────────────────

/**
 * Thrown when a migration file on disk has a different checksum than
 * the one stored in `__mandu_migrations`. `apply()` refuses to proceed;
 * the operator must resolve the drift.
 */
export class MigrationTamperedError extends Error {
  readonly name = "MigrationTamperedError";
  readonly filename: string;
  readonly storedChecksum: string;
  readonly currentChecksum: string;

  constructor(filename: string, storedChecksum: string, currentChecksum: string) {
    super(
      `[@mandujs/core/db/migrations] Migration ${filename} has been modified ` +
        `since it was applied. Stored checksum: ${storedChecksum}, current: ${currentChecksum}. ` +
        `Revert the file or run 'mandu db reset --allow-tamper --force' to reset history.`,
    );
    this.filename = filename;
    this.storedChecksum = storedChecksum;
    this.currentChecksum = currentChecksum;
  }
}

/**
 * Thrown when a migration file times out. `applyTimeoutMs` is checked
 * after each statement — we don't attempt to kill the underlying
 * connection (Bun.SQL doesn't expose that), but we do refuse to insert
 * a history row for the timed-out migration.
 */
export class MigrationTimeoutError extends Error {
  readonly name = "MigrationTimeoutError";
  readonly filename: string;
  readonly elapsedMs: number;
  readonly timeoutMs: number;

  constructor(filename: string, elapsedMs: number, timeoutMs: number) {
    super(
      `[@mandujs/core/db/migrations] Migration ${filename} exceeded ${timeoutMs}ms ` +
        `(elapsed: ${elapsedMs}ms). History not recorded; retry via 'mandu db apply'.`,
    );
    this.filename = filename;
    this.elapsedMs = elapsedMs;
    this.timeoutMs = timeoutMs;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Options for {@link createMigrationRunner}. */
export interface MigrationRunnerOptions {
  /** Absolute path to the migrations directory. Must exist at call time. */
  migrationsDir: string;
  /**
   * Lock strategy. Defaults derived from `db.provider`:
   *   - `postgres` → `pg_advisory_lock`
   *   - `mysql`    → `mysql_get_lock`
   *   - `sqlite`   → `sqlite_immediate`
   *
   * Pass `"none"` in test suites that don't need serialisation.
   */
  lockStrategy?: LockStrategy;
  /** History table name. Default: `"__mandu_migrations"`. */
  historyTable?: string;
  /**
   * Per-migration-file timeout in milliseconds. When the total
   * elapsed time for a single migration file exceeds this value, the
   * runner aborts the file and throws {@link MigrationTimeoutError}
   * WITHOUT recording a history row. Default: `60_000` (60 s).
   */
  applyTimeoutMs?: number;
}

/** The runner returned by {@link createMigrationRunner}. */
export interface MigrationRunner {
  /** Idempotent creation of the history table. */
  ensureHistoryTable(): Promise<void>;
  /**
   * Return every migration file on disk that has no successful history
   * row, sorted by version. Checksums are computed fresh from file
   * bytes — never cached.
   */
  plan(): Promise<PendingMigration[]>;
  /**
   * Apply all pending migrations. Each file runs in its own
   * transaction; a failure in file N leaves files 0..N-1 applied and
   * N..∞ pending. The runner holds the migration lock for the duration
   * of `apply()` — multiple concurrent callers serialise.
   *
   * `dryRun: true` reports what WOULD be applied without executing SQL
   * and without inserting history rows.
   */
  apply(options?: { dryRun?: boolean }): Promise<AppliedMigration[]>;
  /** Combined snapshot: applied + pending + tampered + orphaned. */
  status(): Promise<MigrationStatus>;
  /** Idempotent release of any held lock. Does NOT close the Db. */
  dispose(): Promise<void>;
}

/**
 * Factory — wraps a `Db` handle with migration-runtime affordances.
 * Construction is cheap (no IO); the first operation lazily creates
 * the history table if it doesn't exist yet.
 */
export function createMigrationRunner(
  db: Db,
  options: MigrationRunnerOptions,
): MigrationRunner {
  if (!options || typeof options.migrationsDir !== "string" || options.migrationsDir.length === 0) {
    throw new TypeError(
      "[@mandujs/core/db/migrations] createMigrationRunner: 'migrationsDir' is required.",
    );
  }

  const historyTable = options.historyTable ?? DEFAULT_HISTORY_TABLE;
  if (!SAFE_HISTORY_TABLE_RE.test(historyTable)) {
    throw new Error(
      `[@mandujs/core/db/migrations] Invalid history table name ${JSON.stringify(historyTable)}. ` +
        `Must match ${SAFE_HISTORY_TABLE_RE}.`,
    );
  }

  const lockStrategy: LockStrategy =
    options.lockStrategy ?? defaultLockStrategy(db.provider);

  const applyTimeoutMs =
    typeof options.applyTimeoutMs === "number" && options.applyTimeoutMs > 0
      ? options.applyTimeoutMs
      : 60_000;

  let historyReady = false;
  let heldLock: MigrationLock | null = null;
  const migrationsDir = options.migrationsDir;

  async function ensureHistoryTable(): Promise<void> {
    if (historyReady) return;
    const ddl = historyTableDdl(historyTable, db.provider);
    await execRaw(db, ddl);
    historyReady = true;
  }

  async function ensureReady(): Promise<void> {
    // Keep the "call ensureHistoryTable() first" explicit in the spec
    // but do the right thing implicitly: auto-initialise on first op.
    // This matches the ergonomic of Phase 4b's session storage.
    if (!historyReady) {
      await ensureHistoryTable();
    }
  }

  async function plan(): Promise<PendingMigration[]> {
    await ensureReady();
    const [diskFiles, history] = await Promise.all([
      readMigrationsFromDisk(migrationsDir),
      readAllHistory(db, historyTable),
    ]);
    const appliedVersions = new Set(
      history.filter((h) => h.success === 1).map((h) => h.version),
    );
    return diskFiles.filter((f) => !appliedVersions.has(f.version));
  }

  async function apply(
    opts: { dryRun?: boolean } = {},
  ): Promise<AppliedMigration[]> {
    await ensureReady();

    // Tamper check BEFORE acquiring the lock so the fast-fail path
    // doesn't hold the advisory lock longer than necessary.
    const history = await readAllHistory(db, historyTable);
    const diskFiles = await readMigrationsFromDisk(migrationsDir);
    const diskByVersion = new Map(diskFiles.map((f) => [f.version, f]));
    for (const row of history) {
      if (row.success !== 1) continue;
      const disk = diskByVersion.get(row.version);
      if (!disk) continue; // orphan on the history side — surfaced via status(), not apply()
      if (disk.checksum !== row.checksum) {
        throw new MigrationTamperedError(
          disk.filename,
          row.checksum,
          disk.checksum,
        );
      }
    }

    const appliedVersions = new Set(
      history.filter((h) => h.success === 1).map((h) => h.version),
    );
    const pending = diskFiles.filter((f) => !appliedVersions.has(f.version));
    if (pending.length === 0) return [];

    // Dry-run: report what we WOULD apply, no IO, no history.
    if (opts.dryRun === true) {
      return pending.map<AppliedMigration>((p) => ({
        version: p.version,
        filename: p.filename,
        checksum: p.checksum,
        appliedAt: new Date(),
        executionMs: 0,
        success: false, // dry-run is not real — mark as not-yet-applied
      }));
    }

    const installedBy =
      (typeof process !== "undefined" && process.env?.MANDU_MIGRATION_USER) ||
      "mandu";

    const applied: AppliedMigration[] = [];

    heldLock = await acquireMigrationLock(db, lockStrategy);
    try {
      for (const migration of pending) {
        const start = Date.now();

        const statements = splitStatements(migration.sql);
        if (statements.length === 0) {
          // Empty migration — still record a history row so we don't
          // re-run it. execution_ms = 0 reflects reality.
          await insertHistory(db, historyTable, {
            version: migration.version,
            filename: migration.filename,
            checksum: migration.checksum,
            applied_at: new Date(),
            execution_ms: 0,
            success: 1,
            installed_by: installedBy,
          });
          applied.push({
            version: migration.version,
            filename: migration.filename,
            checksum: migration.checksum,
            appliedAt: new Date(),
            executionMs: 0,
            success: true,
          });
          continue;
        }

        try {
          await db.transaction(async (tx) => {
            for (const stmt of statements) {
              await execRaw(tx, stmt);
              const elapsed = Date.now() - start;
              if (elapsed > applyTimeoutMs) {
                throw new MigrationTimeoutError(
                  migration.filename,
                  elapsed,
                  applyTimeoutMs,
                );
              }
            }
          });
        } catch (err) {
          if (err instanceof MigrationTimeoutError) throw err;
          // Wrap with migration context so downstream callers know
          // which file blew up. Preserve the original stack where
          // possible via `cause`.
          const msg = err instanceof Error ? err.message : String(err);
          const wrapped = new Error(
            `[@mandujs/core/db/migrations] Failed to apply ${migration.filename}: ${msg}`,
          );
          // Preserve the original as a `cause` chain for diagnostics.
          (wrapped as { cause?: unknown }).cause = err;
          throw wrapped;
        }

        const executionMs = Date.now() - start;
        const appliedAt = new Date();

        // History row is written AFTER the SQL transaction commits.
        // If this INSERT itself fails, the migration has run but we
        // have no record — the user will see it as pending again.
        // Mitigation: the insert is a single tiny statement; in
        // practice it either succeeds or the whole connection is
        // dead (in which case subsequent apply() calls will also fail
        // and the user will debug from the DB side).
        await insertHistory(db, historyTable, {
          version: migration.version,
          filename: migration.filename,
          checksum: migration.checksum,
          applied_at: appliedAt,
          execution_ms: executionMs,
          success: 1,
          installed_by: installedBy,
        });

        applied.push({
          version: migration.version,
          filename: migration.filename,
          checksum: migration.checksum,
          appliedAt,
          executionMs,
          success: true,
        });
      }
    } finally {
      if (heldLock) {
        await heldLock.release();
        heldLock = null;
      }
    }

    return applied;
  }

  async function status(): Promise<MigrationStatus> {
    await ensureReady();

    const [diskFiles, history] = await Promise.all([
      readMigrationsFromDisk(migrationsDir),
      readAllHistory(db, historyTable),
    ]);

    const diskByVersion = new Map(diskFiles.map((f) => [f.version, f]));

    const applied: AppliedMigration[] = [];
    const tampered: MigrationStatus["tampered"] = [];
    for (const row of history) {
      if (row.success !== 1) continue;
      const disk = diskByVersion.get(row.version);
      if (disk && disk.checksum !== row.checksum) {
        tampered.push({
          version: row.version,
          filename: disk.filename,
          storedChecksum: row.checksum,
          currentChecksum: disk.checksum,
        });
      }
      applied.push({
        version: row.version,
        filename: row.filename,
        checksum: row.checksum,
        appliedAt: row.applied_at,
        executionMs: row.execution_ms,
        success: true,
      });
    }

    const appliedVersions = new Set(
      history.filter((h) => h.success === 1).map((h) => h.version),
    );
    const pending = diskFiles.filter((f) => !appliedVersions.has(f.version));

    // "orphaned" = files that exist on disk, have NO matching history
    // row, AND are already in `pending` — by definition they'd show up
    // in `pending`. The spec uses `orphaned` for the inverse (rare):
    // history rows with no file on disk. We capture the latter so
    // operators can spot a deleted file that was already applied.
    const diskVersions = new Set(diskFiles.map((f) => f.version));
    const orphaned: MigrationStatus["orphaned"] = [];
    for (const row of history) {
      if (!diskVersions.has(row.version)) {
        orphaned.push({ filename: row.filename });
      }
    }

    return { applied, pending, tampered, orphaned };
  }

  async function dispose(): Promise<void> {
    if (heldLock) {
      await heldLock.release();
      heldLock = null;
    }
    // Explicitly do NOT close the Db — ownership belongs to the caller
    // (per the module JSDoc).
  }

  return {
    ensureHistoryTable,
    plan,
    apply,
    status,
    dispose,
  };
}

// ─── Checksum ───────────────────────────────────────────────────────────────

/**
 * Compute the migration checksum — SHA-256 hex, lowercase, with `\r\n`
 * normalised to `\n`. This is the ONLY normalisation we apply; all other
 * whitespace, comments, BOMs, trailing newlines are preserved as-is so
 * hand-edits (even cosmetic ones) are detected.
 *
 * Rationale: Flyway uses CRC-32 for the same purpose; we upgraded to
 * SHA-256 because CRC collides more readily when SQL is minified or
 * large. Full 256-bit cryptographic hash is overkill for this use-case,
 * but adds zero practical cost (<0.1 ms on any migration < 1 MB).
 */
export function computeMigrationChecksum(sql: string): string {
  const normalized = sql.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

// ─── Filesystem discovery ───────────────────────────────────────────────────

/**
 * Matches `NNNN_description.sql`. Version is captured as group 1.
 *
 * We require at least 4 digits (zero-padded) followed by an underscore
 * and at least one character of description, then `.sql`. Loose enough
 * to accept `0001_init.sql` and `20260401_foo.sql` equally; strict
 * enough to reject `migration.sql` or `init.sql` (no version prefix).
 */
const MIGRATION_FILE_RE = /^(\d{4,})_[^/\\]+\.sql$/i;

/**
 * Read every `NNNN_*.sql` file in `dir`, hash it, and return the result
 * sorted by version. Non-matching files produce a single `console.warn`
 * each (callers can silence via their logger wrapper).
 *
 * @throws when two files share the same version prefix.
 */
async function readMigrationsFromDisk(dir: string): Promise<PendingMigration[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      // Missing migrations dir is not fatal — plan() returns []. Agent
      // E's CLI creates the directory on `mandu db plan`.
      return [];
    }
    throw err;
  }

  const seen = new Map<string, string>(); // version → filename (for duplicate detection)
  const results: PendingMigration[] = [];

  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".sql")) continue;
    const match = MIGRATION_FILE_RE.exec(entry);
    if (!match) {
      console.warn(
        `[@mandujs/core/db/migrations] Ignoring ${entry}: filename does not match NNNN_description.sql pattern.`,
      );
      continue;
    }
    // Zero-pad the version to 4+ digits for stable lex ordering. The
    // regex already requires 4+; use the captured string verbatim.
    const version = match[1]!;
    if (seen.has(version)) {
      throw new Error(
        `[@mandujs/core/db/migrations] Duplicate migration version ${JSON.stringify(version)}: ` +
          `${seen.get(version)} and ${entry}.`,
      );
    }
    seen.set(version, entry);

    const fullPath = path.join(dir, entry);
    const [raw, stat] = await Promise.all([
      fs.readFile(fullPath, "utf8"),
      fs.stat(fullPath),
    ]);
    results.push({
      version,
      filename: entry,
      sql: raw,
      checksum: computeMigrationChecksum(raw),
      createdAt: stat.mtime,
    });
  }

  results.sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
  return results;
}

// ─── Statement splitter ─────────────────────────────────────────────────────

/**
 * Split a migration SQL string into individual statements.
 *
 * v1 rule: split on `;` at the END of a line (or at the very end of the
 * file). Empty statements (whitespace only) are dropped. SQL line
 * comments (`--`) and multi-line (`/* … *\/`) are preserved inside each
 * statement so drivers see the original text.
 *
 * **Limitation** (documented for users): a `;` inside a SQL string
 * literal that happens to be followed by a newline WILL be mis-split.
 * In practice this is extremely rare in hand-authored DDL — column
 * definitions and constraint expressions don't contain raw semicolons.
 * If you hit this, collapse the offending statement onto a single line
 * or escape with `--` line-comment markers. A proper tokenising splitter
 * lands in v2 (tracked with the migration runtime's other limitations).
 */
export function splitStatements(sql: string): string[] {
  // Normalise line endings for splitting; `computeMigrationChecksum`
  // does the same so the output is consistent across OSes.
  const normalised = sql.replace(/\r\n/g, "\n");

  const statements: string[] = [];
  let buffer: string[] = [];

  for (const line of normalised.split("\n")) {
    buffer.push(line);
    const trimmed = line.trimEnd();
    if (trimmed.endsWith(";")) {
      // Emit the statement up to (and including) this line, then drop
      // the trailing `;` so Bun.SQL doesn't double-terminate it.
      const joined = buffer.join("\n").trimEnd();
      const withoutTrailing = joined.slice(0, -1); // strip ;
      const statement = withoutTrailing.trim();
      if (statement.length > 0) {
        statements.push(statement);
      }
      buffer = [];
    }
  }

  // Handle a tail statement without a trailing `;`. Bun.SQL / most
  // drivers accept statements without a terminator; we do the same.
  const tail = buffer.join("\n").trim();
  if (tail.length > 0) {
    statements.push(tail);
  }

  return statements;
}

// ─── Defaults ───────────────────────────────────────────────────────────────

/** Derive the default `LockStrategy` from the detected provider. */
function defaultLockStrategy(provider: SqlProvider): LockStrategy {
  switch (provider) {
    case "postgres":
      return "pg_advisory_lock";
    case "mysql":
      return "mysql_get_lock";
    case "sqlite":
      return "sqlite_immediate";
  }
}

// ─── Raw SQL exec (parameter-less) ──────────────────────────────────────────
//
// We reuse the tagged-template surface of `@mandujs/core/db` for raw DDL
// by constructing a zero-placeholder synthetic template array. The DDL
// comes from trusted sources (operator-authored migration files or
// Mandu-emitted history table DDL), so there's no injection surface.

async function execRaw(db: Db, sql: string): Promise<void> {
  const strings = Object.assign([sql], { raw: [sql] }) as unknown as TemplateStringsArray;
  await db(strings);
}

// Re-export HistoryRow so consumers doing `import { MigrationRunner } from "./runner"`
// also reach row-level types without a second import site.
export type { HistoryRow };
