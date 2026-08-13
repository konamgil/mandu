/**
 * `mandu db reset` — DANGEROUS history-destroying command.
 *
 * Drops the `__mandu_migrations` table (the "history") so the next
 * `mandu db apply` treats every file as pending again. With
 * `--drop-tables`, it also drops every table mentioned in the
 * current applied snapshot — a full local-dev reset.
 *
 * ## Safety gates (all must pass before anything is dropped)
 *
 *   1. `--force` flag is REQUIRED. Missing → exit 4.
 *   2. Interactive (TTY) path: user must type the project folder name.
 *   3. `--ci` path: `MANDU_DB_RESET_CONFIRM=true` must be set.
 *   4. If tampered history is detected, refuse unless `--allow-tamper`.
 *
 * Any gate failure → exit code 4 (distinct from generic I/O errors so
 * scripts can assert "reset refused" vs "reset crashed").
 *
 * ## Never use in production
 *
 * The gates above are the same in every environment — `--force` is
 * sufficient to wipe a production history. Don't. Restrict the command
 * to scoped CI jobs via `NODE_ENV` checks in the calling pipeline.
 *
 * @module cli/commands/db/reset
 */

import path from "node:path";
import { createInterface } from "node:readline/promises";

import { createMigrationRunner } from "@mandujs/core/compat/db/migrations/runner";
import { quoteIdent } from "@mandujs/core/compat/resource/ddl/emit";
import { parseSnapshot } from "@mandujs/core/compat/resource/ddl/snapshot";
import type { Snapshot } from "@mandujs/core/compat/resource/ddl/types";
import { existsSync, promises as fs } from "node:fs";

import { resolveDb, DbResolutionError } from "./resolve-db";
import { theme } from "../../terminal/theme";

export interface DbResetOptions {
  /** Required for any destructive action to proceed. */
  force?: boolean;
  /** In CI (non-TTY), require MANDU_DB_RESET_CONFIRM=true instead of typing. */
  ci?: boolean;
  /** Proceed even if tampered history is detected. */
  allowTamper?: boolean;
  /** Also drop every table declared in the applied snapshot. */
  dropTables?: boolean;
  /** Override cwd — tests. */
  cwd?: string;
  /** Override input stream — tests. */
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Override env lookup — tests. */
  envConfirm?: string | undefined;
}

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_REFUSED = 4;

function reverseCopy<T>(items: readonly T[]): T[] {
  const reversed: T[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    reversed.push(items[index] as T);
  }
  return reversed;
}

export async function dbReset(options: DbResetOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = path.join(cwd, "spec", "db", "migrations");
  const schemaDir = path.join(cwd, ".mandu", "schema");
  const appliedPath = path.join(schemaDir, "applied.json");

  // Gate 1 — must have --force.
  if (options.force !== true) {
    process.stderr.write(
      `${theme.error("refused:")} --force is required. ${theme.dim("mandu db reset --force")}\n`,
    );
    return EXIT_REFUSED;
  }

  // Gate 2/3 — confirmation.
  const ok = await confirm(cwd, options);
  if (!ok) {
    process.stderr.write(`${theme.error("refused:")} confirmation failed or cancelled.\n`);
    return EXIT_REFUSED;
  }

  // Resolve DB.
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

  // Gate 4 — tamper check.
  try {
    const runner = createMigrationRunner(db, { migrationsDir });
    await runner.ensureHistoryTable();
    const status = await runner.status();
    if (status.tampered.length > 0 && options.allowTamper !== true) {
      process.stderr.write(
        `${theme.error("refused:")} ${status.tampered.length} tampered migration(s) detected.\n` +
        `  Re-run with ${theme.command("--allow-tamper")} to proceed.\n`,
      );
      await safeClose(db);
      return EXIT_REFUSED;
    }

    // Load the applied snapshot so --drop-tables knows what to drop.
    let snapshot: Snapshot | null = null;
    if (options.dropTables === true && existsSync(appliedPath)) {
      try {
        const raw = await fs.readFile(appliedPath, "utf8");
        snapshot = parseSnapshot(raw);
      } catch (err) {
        printError(`Cannot load ${appliedPath}`, err);
        await safeClose(db);
        return EXIT_ERROR;
      }
    }

    // 1) Drop tables (if requested).
    if (options.dropTables === true && snapshot) {
      for (const resource of reverseCopy(snapshot.resources)) {
        // Reverse order — not strict FK safety (v1 has no FK) but
        // matches the natural "last-in-first-out" pattern.
        const stmt = `DROP TABLE IF EXISTS ${quoteIdent(resource.name, snapshot.provider)}`;
        await execRaw(db, stmt);
        process.stdout.write(`  ${theme.success("✓")} dropped ${resource.name}\n`);
      }
    }

    // 2) Drop history.
    await execRaw(db, `DROP TABLE IF EXISTS ${quoteIdent("__mandu_migrations", db.provider)}`);
    process.stdout.write(`  ${theme.success("✓")} dropped __mandu_migrations\n`);

    // 3) Remove applied snapshot (filesystem).
    if (existsSync(appliedPath)) {
      await fs.unlink(appliedPath);
      process.stdout.write(`  ${theme.success("✓")} removed ${appliedPath}\n`);
    }

    process.stdout.write(`\n  ${theme.success("Reset complete.")} Run ${theme.command("mandu db apply")} to rebuild.\n\n`);
    await safeClose(db);
    return EXIT_OK;
  } catch (err) {
    printError("Reset failed", err);
    await safeClose(db);
    return EXIT_ERROR;
  }
}

// =====================================================================
// Confirmation gate
// =====================================================================

async function confirm(cwd: string, options: DbResetOptions): Promise<boolean> {
  // CI path — no TTY, require env var.
  if (options.ci === true) {
    const env =
      options.envConfirm !== undefined
        ? options.envConfirm
        : process.env.MANDU_DB_RESET_CONFIRM;
    if (env !== "true") {
      process.stderr.write(
        `${theme.warn("CI confirm required:")} set MANDU_DB_RESET_CONFIRM=true to proceed.\n`,
      );
      return false;
    }
    return true;
  }

  // Interactive path — user must type the project folder name.
  const projectName = path.basename(cwd);
  const output = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;

  output.write(
    `${theme.warn("DANGER:")} this drops __mandu_migrations and can destroy data.\n` +
    `  Type ${theme.command(projectName)} to confirm: `,
  );

  const rl = createInterface({ input, output });
  let answer = "";
  try {
    answer = (await rl.question("")).trim();
  } finally {
    rl.close();
  }

  if (answer !== projectName) {
    output.write(
      `${theme.dim("  expected:")} ${projectName}\n` +
      `${theme.dim("  got:     ")} ${answer || "(empty)"}\n`,
    );
    return false;
  }
  return true;
}

// =====================================================================
// Helpers
// =====================================================================

/** Raw DDL exec — mirrors the pattern in Agent C's runner. */
async function execRaw(db: { (s: TemplateStringsArray, ...v: unknown[]): Promise<unknown> }, sql: string): Promise<void> {
  const strings = Object.assign([sql], { raw: [sql] }) as unknown as TemplateStringsArray;
  await db(strings);
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
