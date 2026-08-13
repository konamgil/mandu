/**
 * `mandu db plan` — compute and persist the next migration file.
 *
 * Flow:
 *
 *   1. Scan `spec/resources/*.resource.ts`, parse them, and build a
 *      next-state `Snapshot` via Agent B's `snapshotFromResources`.
 *   2. Read the currently-applied snapshot from `.mandu/schema/applied.json`
 *      (null if this is the first run).
 *   3. Diff the two snapshots → ordered `Change[]` via Agent B.
 *   4. Ask the user (if TTY and not `--ci`) whether any (drop-column,
 *      add-column) pair is actually a rename; rewrite the change list
 *      accordingly (`rename-prompt.ts`).
 *   5. Emit the SQL via Agent A's `emitChanges`.
 *   6. Write the SQL to `spec/db/migrations/NNNN_auto_<ts>.sql`, where
 *      `NNNN` is the next zero-padded version after any existing files.
 *   7. Print a summary to stdout — human-readable by default, JSON
 *      when `--json` is set.
 *
 * ### Why not write `.mandu/schema/applied.json` here?
 *
 * `plan` only *produces* the migration file — `applied.json` must only
 * be updated after a successful `mandu db apply`. Otherwise a plan that
 * the user then tosses (via `rm`) leaves the recorded state out of sync
 * with the database.
 *
 * ### Agent D relation
 *
 * Agent D's `@mandujs/core/resource/generator-schema` exposes
 * `computeSchemaGeneration` + `writeSchemaArtifacts` which also run
 * diff + emit, but as a side-effect they also persist per-resource
 * schema snippets into `.mandu/generated/server/schema/{table}.sql`.
 * `mandu db plan` keeps the primitive path (direct `snapshotFromResources`
 * + `diffSnapshots` + `emitChanges`) so it ONLY writes the single
 * migration file — `mandu generate` (Agent D's surface) is the command
 * that also emits the derived schema snippets. This separation keeps
 * the tools' side-effects orthogonal and predictable.
 *
 * @module cli/commands/db/plan
 */

import path from "node:path";
import { promises as fs, existsSync } from "node:fs";
import { Glob } from "bun";

import {
  parseResourceSchemas,
  validateResourceUniqueness,
  type ParsedResource,
} from "@mandujs/core/compat/resource/index";
import {
  snapshotFromResources,
  serializeSnapshot,
  parseSnapshot,
} from "@mandujs/core/compat/resource/ddl/snapshot";
import { diffSnapshots } from "@mandujs/core/compat/resource/ddl/diff";
import { emitChanges } from "@mandujs/core/compat/resource/ddl/emit";
import type {
  Change,
  Snapshot,
  SqlProvider,
} from "@mandujs/core/compat/resource/ddl/types";

import { applyRenames } from "./rename-prompt";
import { theme } from "../../terminal/theme";

/**
 * Detect SQL provider from a DATABASE_URL-style scheme.
 * Returns undefined when no DATABASE_URL is set so callers can fall back
 * to per-resource `persistence.provider`. Issue #270.
 */
function detectProviderFromDatabaseUrl(): SqlProvider | undefined {
  const url = process.env.DATABASE_URL;
  if (!url) return undefined;
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgres";
  if (url.startsWith("mysql://") || url.startsWith("mysql2://")) return "mysql";
  if (url.startsWith("sqlite://") || url.startsWith("sqlite:")) return "sqlite";
  return undefined;
}

export interface DbPlanOptions {
  /** CI mode: skip rename prompt, always emit drop+add. */
  ci?: boolean;
  /** Emit a single JSON object to stdout instead of the human table. */
  json?: boolean;
  /** Override cwd — tests. */
  cwd?: string;
}

export interface DbPlanResult {
  /** Number of changes in the generated migration. */
  changes: Change[];
  /** Absolute path of the migration file, or `null` when there were no changes. */
  migrationPath: string | null;
  /** Full snapshot that WILL be committed after `mandu db apply` succeeds. */
  snapshot: Snapshot;
  /** Provider the plan targets (derived from resources). */
  provider: SqlProvider;
}

export const EXIT_OK = 0;
export const EXIT_IO = 1;
export const EXIT_USAGE = 2;

/**
 * Entry point — registered from `registry.ts` via `db.ts` dispatch.
 *
 * Returns the CLI exit code (0 on success, 1 on I/O, 2 on usage).
 */
export async function dbPlan(options: DbPlanOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const resourcesDir = path.join(cwd, "spec", "resources");
  const migrationsDir = path.join(cwd, "spec", "db", "migrations");
  const schemaDir = path.join(cwd, ".mandu", "schema");
  const appliedPath = path.join(schemaDir, "applied.json");

  // Issue #270 — derive provider from DATABASE_URL so SQLite/MySQL projects
  // are reported correctly (was hardcoded "postgres" everywhere below).
  const urlProvider = detectProviderFromDatabaseUrl();
  const defaultProvider: SqlProvider = urlProvider ?? "postgres";

  let parsed: ParsedResource[];
  try {
    const files = await discoverResourceFiles(resourcesDir);
    if (files.length === 0) {
      emit(options, {
        changes: [],
        migrationPath: null,
        snapshot: emptySnapshot(defaultProvider),
        provider: defaultProvider,
      }, "no resources found — nothing to plan");
      return EXIT_OK;
    }
    parsed = await parseResourceSchemas(files);
    validateResourceUniqueness(parsed);
  } catch (err) {
    printError("Resource parse failed", err);
    return EXIT_IO;
  }

  // Compute the next snapshot.
  let nextSnapshot: Snapshot;
  try {
    nextSnapshot = snapshotFromResources(parsed);
  } catch (err) {
    printError("Snapshot build failed", err);
    return EXIT_IO;
  }

  // Issue #266 — diagnose silent drops: snapshotFromResources skips any
  // resource missing `options.persistence`. Previously this surfaced only
  // as "no schema changes" with no hint as to why. Now we count parsed
  // resources vs. snapshot resources and explain what's missing.
  if (parsed.length > 0 && nextSnapshot.resources.length === 0) {
    const dropped = parsed.map((r) => r.resourceName).join(", ");
    process.stderr.write(
      `${theme.warn("warning:")} ${parsed.length} resource(s) parsed but none reached the snapshot — ` +
        `each one is missing \`options.persistence\` and was silently dropped: ${dropped}\n` +
        `  Fix: add \`persistence: { provider: "${defaultProvider}", primaryKey: "id" }\` ` +
        `to each resource's \`options\`. See docs/guides/db-resources.md.\n`,
    );
  }

  // Issue #270 — when DATABASE_URL declares one provider but resources
  // declare another, the snapshot is meaningless against the live DB.
  if (urlProvider && nextSnapshot.resources.length > 0 && nextSnapshot.provider !== urlProvider) {
    printError(
      `Provider mismatch: DATABASE_URL is "${urlProvider}" but resources declare ` +
        `"${nextSnapshot.provider}". Align \`options.persistence.provider\` with the live DB.`,
      null,
    );
    return EXIT_USAGE;
  }

  // Load the applied snapshot (if any).
  let appliedSnapshot: Snapshot | null = null;
  if (existsSync(appliedPath)) {
    try {
      const raw = await fs.readFile(appliedPath, "utf8");
      appliedSnapshot = parseSnapshot(raw);
    } catch (err) {
      printError(`Failed to read ${appliedPath}`, err);
      return EXIT_IO;
    }
  }

  // Guard cross-provider diff early.
  if (appliedSnapshot && appliedSnapshot.provider !== nextSnapshot.provider) {
    printError(
      `Cross-provider diff refused: applied snapshot is "${appliedSnapshot.provider}", ` +
        `next is "${nextSnapshot.provider}". Reset with 'mandu db reset --force' and rebuild.`,
      null,
    );
    return EXIT_USAGE;
  }

  // Diff.
  let rawChanges: Change[];
  try {
    rawChanges = diffSnapshots(appliedSnapshot, nextSnapshot);
  } catch (err) {
    printError("Diff failed", err);
    return EXIT_IO;
  }

  // Prompt user for rename candidates (no-op in --ci).
  const changes = await applyRenames(rawChanges, nextSnapshot.provider, {
    ci: options.ci === true,
  });

  // Nothing to do — exit cleanly.
  if (changes.length === 0) {
    emit(options, {
      changes,
      migrationPath: null,
      snapshot: nextSnapshot,
      provider: nextSnapshot.provider,
    }, "no schema changes");
    return EXIT_OK;
  }

  // Emit SQL + write.
  let sql: string;
  try {
    sql = emitChanges(changes, nextSnapshot.provider);
  } catch (err) {
    printError("Migration SQL emit failed", err);
    return EXIT_USAGE;
  }
  let migrationPath: string;
  try {
    await fs.mkdir(migrationsDir, { recursive: true });
    migrationPath = await writeNextMigration(migrationsDir, sql);
  } catch (err) {
    printError(`Failed to write migration to ${migrationsDir}`, err);
    return EXIT_IO;
  }

  emit(options, {
    changes,
    migrationPath,
    snapshot: nextSnapshot,
    provider: nextSnapshot.provider,
  }, null);
  return EXIT_OK;
}

// =====================================================================
// Filesystem helpers
// =====================================================================

async function discoverResourceFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const glob = new Glob("*.resource.ts");
  const files: string[] = [];
  for await (const entry of glob.scan({ cwd: dir, absolute: true, onlyFiles: true })) {
    files.push(entry);
  }
  files.sort();
  return files;
}

/**
 * Compute the next `NNNN_auto_<ts>.sql` filename and write the SQL.
 *
 * Version picks the next zero-padded integer > any existing 4-digit
 * prefix in the directory. Timestamp is ISO (`-` separated, no colons)
 * so the filename is safe across filesystems.
 */
async function writeNextMigration(dir: string, sql: string): Promise<string> {
  const existing = await fs.readdir(dir).catch(() => [] as string[]);
  let max = 0;
  for (const name of existing) {
    const m = /^(\d{4,})_/.exec(name);
    if (!m) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = String(max + 1).padStart(4, "0");
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
  const filename = `${next}_auto_${ts}.sql`;
  const fullPath = path.join(dir, filename);

  const header =
    "-- Generated by `mandu db plan` — edit with care\n" +
    `-- Version: ${next}\n` +
    `-- Generated: ${new Date().toISOString()}\n\n`;

  await fs.writeFile(fullPath, header + sql + "\n", "utf8");
  return fullPath;
}

// =====================================================================
// Rendering
// =====================================================================

function emit(
  options: DbPlanOptions,
  result: DbPlanResult,
  emptyMessage: string | null,
): void {
  if (options.json === true) {
    const out = {
      changeCount: result.changes.length,
      changes: result.changes,
      migrationPath: result.migrationPath,
      provider: result.provider,
    };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    return;
  }

  if (emptyMessage !== null) {
    process.stdout.write(`\n  ${theme.dim("db plan:")} ${emptyMessage}\n\n`);
    return;
  }

  process.stdout.write("\n");
  process.stdout.write(`  ${theme.heading("Planned migration")} ${theme.dim(`(${result.provider})`)}\n`);
  process.stdout.write(`  ${theme.dim("→")} ${theme.path(result.migrationPath ?? "")}\n\n`);
  process.stdout.write(`  ${theme.bold("Changes:")}  ${result.changes.length}\n`);
  const counts = countByKind(result.changes);
  for (const [kind, n] of Object.entries(counts)) {
    process.stdout.write(`    ${theme.dim("·")} ${kind.padEnd(24)} ${n}\n`);
  }
  process.stdout.write("\n");
  process.stdout.write(
    `  ${theme.dim("Next:")} review the file, then run ${theme.command("mandu db apply")}\n\n`,
  );
}

function countByKind(changes: readonly Change[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of changes) {
    out[c.kind] = (out[c.kind] ?? 0) + 1;
  }
  return out;
}

function printError(label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : err === null ? "" : String(err);
  process.stderr.write(
    `${theme.error("error:")} ${label}${msg ? `: ${msg}` : ""}\n`,
  );
}

function emptySnapshot(provider: SqlProvider): Snapshot {
  return {
    version: 1,
    provider,
    resources: [],
    generatedAt: new Date().toISOString(),
  };
}

// Re-export for tests.
export const _internal = { discoverResourceFiles, writeNextMigration, countByKind, serializeSnapshot };
