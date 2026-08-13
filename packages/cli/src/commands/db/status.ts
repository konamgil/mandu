/**
 * `mandu db status` — informational snapshot of the migration history.
 *
 * Prints a three-section view:
 *
 *   Applied   — rows in `__mandu_migrations` that still match disk.
 *   Pending   — files on disk that have no matching history row.
 *   Tampered  — applied rows whose on-disk checksum has drifted.
 *   Orphaned  — history rows whose file no longer exists on disk.
 *
 * ## Flags
 *
 *   --json    Structured output; the full `MigrationStatus` object
 *             shape from `@mandujs/core/resource/ddl/types`.
 *   --check   Exit 1 if `pending.length > 0`. Enables CI gating:
 *             `mandu db status --check || exit 1`. Default exit is
 *             0 regardless of pending count — status is informational.
 *
 * @module cli/commands/db/status
 */

import path from "node:path";

import { createMigrationRunner } from "@mandujs/core/compat/db/migrations/runner";
import type { MigrationStatus } from "@mandujs/core/compat/resource/ddl/types";

import { resolveDb, DbResolutionError } from "./resolve-db";
import { theme } from "../../terminal/theme";

export interface DbStatusOptions {
  /** Emit the full MigrationStatus shape as JSON. */
  json?: boolean;
  /** Exit 1 when pending.length > 0 — for CI gating. */
  check?: boolean;
  /** Override cwd — tests. */
  cwd?: string;
}

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;

/**
 * Entry point. Exits:
 *   0 on success (or when `--check` passes).
 *   1 on I/O / DB errors, or when `--check && pending > 0`.
 */
export async function dbStatus(options: DbStatusOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = path.join(cwd, "spec", "db", "migrations");

  let db;
  try {
    const resolved = await resolveDb({ cwd });
    db = resolved.db;
  } catch (err) {
    if (err instanceof DbResolutionError) {
      printError("Database not configured", err);
    } else {
      printError("Failed to resolve Db handle", err);
    }
    return EXIT_ERROR;
  }

  const runner = createMigrationRunner(db, { migrationsDir });
  let status: MigrationStatus;
  try {
    await runner.ensureHistoryTable();
    status = await runner.status();
  } catch (err) {
    printError("Failed to read migration status", err);
    await safeClose(db);
    return EXIT_ERROR;
  }

  await safeClose(db);

  if (options.json === true) {
    process.stdout.write(JSON.stringify(status, null, 2) + "\n");
  } else {
    renderTable(status, db.provider);
  }

  if (options.check === true && status.pending.length > 0) {
    if (options.json !== true) {
      process.stderr.write(
        `\n${theme.warn("--check failed:")} ${status.pending.length} pending migration(s).\n`,
      );
    }
    return EXIT_ERROR;
  }
  return EXIT_OK;
}

// =====================================================================
// Rendering
// =====================================================================

function renderTable(status: MigrationStatus, provider: string): void {
  process.stdout.write("\n");
  process.stdout.write(`  ${theme.heading("Migration status")} ${theme.dim(`(${provider})`)}\n\n`);

  process.stdout.write(`  ${theme.bold("Applied")}  (${status.applied.length})\n`);
  if (status.applied.length === 0) {
    process.stdout.write(`    ${theme.dim("· (none)")}\n`);
  } else {
    for (const row of status.applied) {
      const when = row.appliedAt instanceof Date ? row.appliedAt.toISOString() : String(row.appliedAt);
      process.stdout.write(
        `    ${theme.success("✓")} ${row.filename.padEnd(42)} ${theme.dim(when)}\n`,
      );
    }
  }
  process.stdout.write("\n");

  process.stdout.write(`  ${theme.bold("Pending")}  (${status.pending.length})\n`);
  if (status.pending.length === 0) {
    process.stdout.write(`    ${theme.dim("· (none)")}\n`);
  } else {
    for (const row of status.pending) {
      process.stdout.write(
        `    ${theme.warn("○")} ${row.filename.padEnd(42)} ${theme.dim(row.checksum.slice(0, 8))}\n`,
      );
    }
  }
  process.stdout.write("\n");

  if (status.tampered.length > 0) {
    process.stdout.write(`  ${theme.error("Tampered")} (${status.tampered.length})\n`);
    for (const row of status.tampered) {
      process.stdout.write(
        `    ${theme.error("!")} ${row.filename}\n` +
        `      ${theme.dim("stored:")}  ${row.storedChecksum.slice(0, 16)}...\n` +
        `      ${theme.dim("on-disk:")} ${row.currentChecksum.slice(0, 16)}...\n`,
      );
    }
    process.stdout.write("\n");
  }

  if (status.orphaned.length > 0) {
    process.stdout.write(`  ${theme.warn("Orphaned")} (${status.orphaned.length})\n`);
    for (const row of status.orphaned) {
      process.stdout.write(`    ${theme.warn("?")} ${row.filename} ${theme.dim("(no file on disk)")}\n`);
    }
    process.stdout.write("\n");
  }
}

function printError(label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${theme.error("error:")} ${label}: ${msg}\n`);
}

async function safeClose(db: { close: () => Promise<void> } | undefined): Promise<void> {
  if (!db) return;
  try {
    await db.close();
  } catch {
    /* swallow */
  }
}
