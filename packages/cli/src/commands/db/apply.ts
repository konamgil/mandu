/**
 * `mandu db apply` — run pending migrations against the live database.
 *
 * Flow:
 *
 *   1. Resolve a live `Db` handle (env wins over `mandu.config`).
 *   2. Construct a `MigrationRunner` (Agent C) pointing at
 *      `spec/db/migrations/`.
 *   3. `runner.ensureHistoryTable()` — idempotent `__mandu_migrations`
 *      creation.
 *   4. `runner.plan()` — report what WILL run.
 *   5. `runner.apply({ dryRun })` — execute or simulate.
 *   6. Stream per-migration progress (`Applying 0003_foo.sql... done (12ms)`).
 *   7. On success exit 0. On tamper → 3. On SQL error → 1.
 *
 * ## Flags
 *
 *   --dry-run   Simulate; print SQL, no execution, no history write.
 *   --ci        Non-interactive; short-circuit if anything would prompt.
 *   --json      Structured stdout (result object at end of run).
 *
 * ## Exit codes (verified in tests)
 *
 *   0  — success (or nothing to apply)
 *   1  — generic I/O / SQL error
 *   2  — usage error (not applicable here; guarded in db.ts dispatch)
 *   3  — tampered migration history (`MigrationTamperedError`)
 *
 * @module cli/commands/db/apply
 */

import path from "node:path";
import { existsSync, promises as fs } from "node:fs";
import { Glob } from "bun";

import {
  MigrationTamperedError,
  MigrationTimeoutError,
  createMigrationRunner,
  type MigrationRunner,
} from "@mandujs/core/db/migrations/runner";
import {
  parseResourceSchemas,
  validateResourceUniqueness,
} from "@mandujs/core/resource";
import {
  snapshotFromResources,
  serializeSnapshot,
} from "@mandujs/core/resource/ddl/snapshot";
import type {
  AppliedMigration,
  PendingMigration,
} from "@mandujs/core/resource/ddl/types";

import { resolveDb, DbResolutionError } from "./resolve-db";
import { theme } from "../../terminal/theme";

export interface DbApplyOptions {
  dryRun?: boolean;
  ci?: boolean;
  json?: boolean;
  cwd?: string;
}

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_TAMPER = 3;

export interface DbApplyResult {
  applied: AppliedMigration[];
  pending: PendingMigration[];
  dryRun: boolean;
}

export async function dbApply(options: DbApplyOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = path.join(cwd, "spec", "db", "migrations");

  // Ensure the migrations dir exists so ensureHistoryTable + plan can
  // distinguish "no files" from a misconfigured tree.
  if (!existsSync(migrationsDir)) {
    await fs.mkdir(migrationsDir, { recursive: true });
  }

  // 1) Resolve the DB handle.
  let db;
  let dbSource: "env" | "config";
  try {
    const resolved = await resolveDb({ cwd });
    db = resolved.db;
    dbSource = resolved.source;
  } catch (err) {
    if (err instanceof DbResolutionError) {
      printError("Database not configured", err);
    } else {
      printError("Failed to resolve Db handle", err);
    }
    return EXIT_ERROR;
  }

  // Probe to surface connection errors early and predictably.
  try {
    await db`SELECT 1`;
  } catch (err) {
    printError("Database connection failed", err);
    await safeClose(db);
    return EXIT_ERROR;
  }

  if (options.json !== true) {
    process.stdout.write(
      `  ${theme.dim("connected")} ${db.provider} ${theme.dim(`(source: ${dbSource})`)}\n`,
    );
  }

  // 2) Construct the runner.
  const runner = createMigrationRunner(db, { migrationsDir });
  try {
    // 3) Ensure history.
    await runner.ensureHistoryTable();

    // 4) Plan.
    const pending = await runner.plan();

    if (pending.length === 0) {
      finish(options, { applied: [], pending: [], dryRun: options.dryRun === true });
      await safeClose(db);
      return EXIT_OK;
    }

    if (options.json !== true) {
      process.stdout.write(`\n  ${theme.heading("Pending:")} ${pending.length}\n`);
      for (const p of pending) {
        process.stdout.write(`    ${theme.dim("·")} ${p.filename} ${theme.dim(`(${p.checksum.slice(0, 8)})`)}\n`);
      }
      process.stdout.write("\n");
    }

    // Dry-run path.
    if (options.dryRun === true) {
      if (options.json !== true) {
        for (const p of pending) {
          process.stdout.write(`  ${theme.dim("---")} ${p.filename} ${theme.dim("---")}\n`);
          process.stdout.write(p.sql.trimEnd() + "\n\n");
        }
        process.stdout.write(`  ${theme.warn("dry-run:")} no SQL executed, no history written\n\n`);
      } else {
        finish(options, {
          applied: pending.map((p) => ({
            version: p.version,
            filename: p.filename,
            checksum: p.checksum,
            appliedAt: new Date(),
            executionMs: 0,
            success: false,
          })),
          pending,
          dryRun: true,
        });
      }
      await safeClose(db);
      return EXIT_OK;
    }

    // 5) Apply — stream per-migration progress.
    const applied = await applyWithStreaming(runner, pending, options);

    // 6) Write applied.json so the next `mandu db plan` sees the current
    //    DB state. This is Agent C's "ownership" of the snapshot file:
    //    plan only READS it, reset WIPES it, apply WRITES it. See
    //    docs/bun/phase-4c-team-plan.md §2 and plan.ts header for the
    //    contract.
    await writeAppliedSnapshot(cwd, options);

    finish(options, { applied, pending: [], dryRun: false });
    await safeClose(db);
    return EXIT_OK;
  } catch (err) {
    if (err instanceof MigrationTamperedError) {
      if (options.json === true) {
        emitJson({
          status: "tampered",
          filename: err.filename,
          storedChecksum: err.storedChecksum,
          currentChecksum: err.currentChecksum,
        });
      } else {
        process.stderr.write(`\n${theme.error("TAMPER DETECTED")}\n\n`);
        process.stderr.write(`  file:      ${err.filename}\n`);
        process.stderr.write(`  stored:    ${err.storedChecksum}\n`);
        process.stderr.write(`  on-disk:   ${err.currentChecksum}\n\n`);
        process.stderr.write(
          `  The migration file has been modified since it was applied.\n` +
          `  Revert the file, or run ${theme.command("mandu db reset --allow-tamper --force")} to rebuild.\n\n`,
        );
      }
      await safeClose(db);
      return EXIT_TAMPER;
    }
    if (err instanceof MigrationTimeoutError) {
      printError(`Migration timed out: ${err.filename}`, err);
      await safeClose(db);
      return EXIT_ERROR;
    }
    printError("Apply failed", err);
    process.stderr.write(
      `  ${theme.dim("note:")} previously-applied migrations remain applied; re-run when fixed.\n\n`,
    );
    await safeClose(db);
    return EXIT_ERROR;
  }
}

// =====================================================================
// Streaming apply — shows per-file progress
// =====================================================================

async function applyWithStreaming(
  runner: MigrationRunner,
  pending: PendingMigration[],
  options: DbApplyOptions,
): Promise<AppliedMigration[]> {
  // Agent C's runner executes the full batch internally inside a single
  // lock. Showing progress mid-batch would require hooking into the
  // runner — for v1 we print the full plan up front, then the result
  // table. The applied array carries per-file execution time so the
  // post-run view is still granular.
  const applied = await runner.apply({ dryRun: options.dryRun === true });

  if (options.json !== true) {
    for (const row of applied) {
      process.stdout.write(
        `  ${theme.success("✓")} ${row.filename.padEnd(42)} ${theme.dim(`${row.executionMs}ms`)}\n`,
      );
    }
    process.stdout.write("\n");
  }
  return applied;
}

// =====================================================================
// Rendering + helpers
// =====================================================================

function finish(options: DbApplyOptions, result: DbApplyResult): void {
  if (options.json === true) {
    emitJson({
      status: "ok",
      appliedCount: result.applied.length,
      applied: result.applied,
      pending: result.pending,
      dryRun: result.dryRun,
    });
    return;
  }
  if (result.applied.length === 0 && result.pending.length === 0) {
    process.stdout.write(`\n  ${theme.success("Up to date")} — no pending migrations.\n\n`);
    return;
  }
  process.stdout.write(`  ${theme.success("Applied")} ${result.applied.length} migration(s).\n\n`);
}

function emitJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
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
    /* swallow — already closed or caller will exit */
  }
}

// =====================================================================
// applied.json writer — Agent C's snapshot ownership surface
// =====================================================================

/**
 * After a successful apply, persist the current resource snapshot to
 * `.mandu/schema/applied.json` so the next `mandu db plan` diffs
 * against the live DB state rather than re-emitting the same changes.
 *
 * Soft-fails on any error: the migration already succeeded, and the
 * snapshot is only used by `plan` (not by the runtime). A mismatch
 * surfaces the next time the user runs plan, which is noisy but
 * recoverable; losing DB data because we refused to exit 0 after a
 * successful apply is not.
 *
 * Dry-runs skip writing entirely — nothing was applied.
 */
async function writeAppliedSnapshot(
  cwd: string,
  options: DbApplyOptions,
): Promise<void> {
  if (options.dryRun === true) return;

  const resourcesDir = path.join(cwd, "spec", "resources");
  const schemaDir = path.join(cwd, ".mandu", "schema");
  const appliedPath = path.join(schemaDir, "applied.json");

  try {
    if (!existsSync(resourcesDir)) {
      // No resources → nothing to snapshot. Leave any existing file
      // alone (reset is the only path that wipes applied.json).
      return;
    }

    const files: string[] = [];
    const glob = new Glob("*.resource.ts");
    for await (const entry of glob.scan({
      cwd: resourcesDir,
      absolute: true,
      onlyFiles: true,
    })) {
      files.push(entry);
    }
    files.sort();
    if (files.length === 0) return;

    const parsed = await parseResourceSchemas(files);
    validateResourceUniqueness(parsed);
    const snapshot = snapshotFromResources(parsed);

    await fs.mkdir(schemaDir, { recursive: true });
    await fs.writeFile(appliedPath, serializeSnapshot(snapshot), "utf8");
  } catch (err) {
    // Never fail the apply on snapshot-write errors — the migration is
    // already committed. Warn the operator so they know plan may be
    // stale until the next successful apply.
    if (options.json !== true) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `  ${theme.warn("warn:")} applied.json not updated: ${msg}\n` +
          `  ${theme.dim("next:")} rerun ${theme.command("mandu db plan")} — if it re-emits, remove the stale snapshot.\n\n`,
      );
    }
  }
}
