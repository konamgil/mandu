/**
 * Phase 4c — Schema + migration file orchestration.
 *
 * The piece of the generator that runs ONCE per project (not once per
 * resource): computes the desired `Snapshot` from all persistent
 * resources, diffs it against `applied.json`, and composes:
 *
 *   - Per-resource CREATE TABLE snapshots at
 *     `.mandu/generated/server/schema/{table}.sql` (derived — docs for humans).
 *   - An auto-generated migration file at
 *     `spec/db/migrations/NNNN_auto_<timestamp>.sql` when changes exist.
 *
 * # Snapshot state model (pending vs applied)
 *
 * There is exactly ONE on-disk snapshot file: `.mandu/schema/applied.json`.
 * Ownership:
 *
 *   - Agent C's migration runner WRITES it after a successful `mandu db apply`.
 *   - This module (Agent D) only READS it.
 *
 * We deliberately do NOT maintain a separate `pending.json`. Rationale:
 *   1. The "pending" state is ephemeral — it's whatever
 *      `snapshotFromResources(resources)` returns right now. Persisting
 *      it would create a third source of truth that could drift from
 *      both the resource files and the migration file.
 *   2. The migration file itself is the durable artifact. Its checksum
 *      (computed by Agent C's runner) is what detects drift between
 *      "what we planned" and "what was applied".
 *   3. If the user runs `mandu db plan` twice without applying, we want
 *      the second run to pick up the FIRST auto-migration that's still
 *      pending and diff against THAT cumulatively, not re-emit the same
 *      migration. This module implements that by considering only files
 *      in the migrations dir that are not yet applied — see
 *      `readPendingMigrationsCount`.
 *
 * # Filename sequencing
 *
 * `writeSchemaArtifacts` scans `spec/db/migrations` for the highest
 * existing NNNN prefix, assigns NNNN+1, and never overwrites any file
 * already present (respects `MIGRATION_FILE_RE` from the runner). User-
 * edited migrations are sacred: the generator will only ever ADD new
 * files at higher sequence numbers.
 *
 * # Path traversal defense (Phase 4c.R4 security audit — H-01)
 *
 * `tableName` originates from:
 *   - `persistence.tableName` — validated by `asPersistence` (only
 *     `[A-Za-z_][A-Za-z0-9_]*` accepted).
 *   - `options.pluralName` — pre-4c field, NOT format-validated at
 *     resource-load time.
 *   - auto-pluralized `resource.name` — resource.name is validated by
 *     `validateResourceDefinition` (same alphabet).
 *
 * To close the remaining gap (pluralName), `writeSchemaArtifacts`
 * verifies every resolved table name against a conservative identifier
 * regex AND asserts the `path.join` result stays under
 * `resourceSchemaOutDir` before touching the filesystem. Same for the
 * auto-migration file (whose name is NNNN + ISO timestamp, both under
 * our control, but routed through the same guard for uniformity).
 *
 * # References
 *
 *   - docs/rfcs/0001-db-resource-layer.md §D3 (resource → DDL auto-derived)
 *   - docs/rfcs/0001-db-resource-layer.md §D4 (self-rolled migration runner)
 *   - docs/rfcs/0001-db-resource-layer.md Appendix D (post-4a normative)
 *   - docs/security/phase-4c-audit.md §H-01 (path traversal remediation)
 *   - packages/core/src/db/migrations/runner.ts (Agent C — applied.json owner)
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import type { ParsedResource } from "./parser";
import type { Change, Snapshot, SqlProvider } from "./ddl/types";
import { diffSnapshots } from "./ddl/diff";
import { emitChanges, emitCreateTable, emitSchema } from "./ddl/emit";
import { parseSnapshot, snapshotFromResources } from "./ddl/snapshot";
import { resolveGeneratedPaths } from "../paths";

// ============================================
// Public API — types
// ============================================

/** The combined output of `computeSchemaGeneration`. */
export interface SchemaGenerationResult {
  /** The next snapshot that WOULD be applied (for logging / debugging). */
  nextSnapshot: Snapshot;
  /** Full desired schema SQL (all CREATE TABLE blocks concatenated). */
  desiredSchema: string;
  /** Per-resource CREATE TABLE slices keyed by table name. */
  desiredSchemaByTable: Record<string, string>;
  /** Changes vs `applied.json`; empty array if schema unchanged. */
  changes: Change[];
  /** Migration SQL body (without BEGIN/COMMIT); empty string if no changes. */
  migrationSql: string;
  /**
   * Suggested migration filename (relative, `NNNN_auto_<ts>.sql`) — `null`
   * when `changes` is empty. Final NNNN is assigned at write time by
   * `writeSchemaArtifacts` which scans the migrations directory; this
   * value is a preview and may differ if another process adds a file
   * between `computeSchemaGeneration` and `writeSchemaArtifacts`.
   */
  migrationFilename: string | null;
  /** Which provider the nextSnapshot targets. Mirror of `nextSnapshot.provider`. */
  provider: SqlProvider;
}

/** The result of the write step. All fields absolute paths or booleans. */
export interface WriteSchemaArtifactsResult {
  /** Number of per-resource schema files written. */
  schemaFilesWritten: number;
  /** Absolute paths of every schema file written (may include overwrites). */
  schemaFilePaths: string[];
  /** Absolute path of the migration file written, or `null` if no changes. */
  migrationFilePath: string | null;
  /** The assigned NNNN for the migration (preserves the numeric sequence). */
  migrationVersion: string | null;
}

// ============================================
// Public API — compute
// ============================================

/**
 * Compute the diff between the current resource files and the applied
 * snapshot. Does NOT write anything to disk.
 *
 * Steps:
 *   1. Filter to persistent resources via `snapshotFromResources`
 *      (non-persistent resources are silently dropped).
 *   2. Read `.mandu/schema/applied.json`. Missing → `null` → first-run.
 *   3. Diff via `diffSnapshots`.
 *   4. Compose SQL outputs.
 *
 * Throws if resources declare mixed providers (delegated to
 * `snapshotFromResources`), or if applied.json exists but is malformed.
 */
export async function computeSchemaGeneration(
  resources: readonly ParsedResource[],
  rootDir: string,
  /**
   * Provider override — useful for CLI flags where the operator wants to
   * generate DDL for a different target than what's declared in the
   * resources (e.g. initial setup). When omitted, the provider is
   * derived from the resources' persistence blocks. When resources
   * conflict with the override, we THROW so the caller realizes they
   * need to align the two.
   */
  provider?: SqlProvider,
): Promise<SchemaGenerationResult> {
  const nextSnapshot = snapshotFromResources(resources);
  const paths = resolveGeneratedPaths(rootDir);

  if (provider !== undefined && nextSnapshot.resources.length > 0 && nextSnapshot.provider !== provider) {
    throw new TypeError(
      `computeSchemaGeneration: provider override "${provider}" conflicts with ` +
        `resource-declared provider "${nextSnapshot.provider}". Align persistence.provider on ` +
        `your resources or drop the override.`,
    );
  }
  if (provider !== undefined && nextSnapshot.resources.length === 0) {
    // Empty resource set — override the fallback so the caller's intent is honored.
    (nextSnapshot as { provider: SqlProvider }).provider = provider;
  }

  const applied = await readAppliedSnapshot(paths.schemaStateDir);

  const changes = diffSnapshots(applied, nextSnapshot);

  // Per-resource schema snippets (for the human-readable
  // `.mandu/generated/server/schema/{table}.sql` files).
  const desiredSchemaByTable: Record<string, string> = {};
  for (const resource of nextSnapshot.resources) {
    desiredSchemaByTable[resource.name] =
      emitCreateTable(resource, nextSnapshot.provider);
  }

  const desiredSchema = emitSchema(nextSnapshot.resources, nextSnapshot.provider);
  const migrationSql = changes.length > 0 ? composeMigrationSql(changes, nextSnapshot.provider) : "";

  return {
    nextSnapshot,
    desiredSchema,
    desiredSchemaByTable,
    changes,
    migrationSql,
    migrationFilename:
      changes.length > 0 ? previewMigrationFilename() : null,
    provider: nextSnapshot.provider,
  };
}

// ============================================
// Public API — write
// ============================================

/**
 * User-derived segment whitelist. Matches `SAFE_PERSISTENCE_IDENTIFIER_RE`
 * from `ddl/persistence-types.ts`. Starts with a letter or `_`, then
 * letters / digits / underscores only. No `.`, `/`, `\`, spaces, shell
 * metachars, control chars — path traversal impossible.
 *
 * Applied to: per-resource `tableName` keys in `desiredSchemaByTable`,
 * which can originate from `options.pluralName` or `persistence.tableName`.
 * (Both ultimately flow through `snapshot.ts:resolveTableName`.)
 */
const SAFE_TABLE_FILE_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Generator-derived segment whitelist. The auto-migration filename is
 * `${NNNN}_auto_${ISO_TIMESTAMP_WITH_DASHES}` where the ISO timestamp
 * has had `:` + `.` replaced with `-`. The character set reduces to
 * digits, `_`, `-`, `T`, `Z`. This segment is NEVER user-derived but
 * the path guard is applied for uniformity.
 */
const SAFE_MIGRATION_FILE_SEGMENT_RE = /^[A-Za-z0-9_\-]+$/;

/**
 * Join `dir` + `segment + suffix` and ensure the resolved path stays
 * strictly under `dir`. Validates `segment` against `allowRe` first
 * (blocks `..`, `/`, `\`, control chars), then resolves and asserts
 * containment as defense-in-depth.
 *
 * Defense-in-depth rationale (H-01 from Phase 4c audit):
 *   - `asPersistence` catches malicious `tableName` / `columnName` /
 *     `indexes[].name` at narrowing time.
 *   - This check catches anything that slipped through — e.g.
 *     `options.pluralName` (pre-4c, no runtime format check) — AND
 *     asserts the resolved path never escapes `dir` even if a future
 *     refactor loosens the regex.
 */
function safeJoinSegment(
  dir: string,
  segment: string,
  suffix: string,
  allowRe: RegExp,
): string {
  if (typeof segment !== "string" || segment.length === 0) {
    throw new TypeError(`safeJoinSegment: segment must be a non-empty string`);
  }
  if (!allowRe.test(segment)) {
    throw new Error(
      `[@mandujs/core/resource] refused to write file whose name segment ${JSON.stringify(segment)} ` +
        `does not match ${allowRe}. This blocks path-traversal via resource-derived names.`,
    );
  }
  const joined = path.join(dir, `${segment}${suffix}`);
  const resolvedDir = path.resolve(dir);
  const resolvedJoin = path.resolve(joined);
  // Must live strictly inside `resolvedDir` — i.e. share the exact
  // prefix + path separator. The equality check on `path.join` guards
  // against cross-platform resolution surprises (mixed separators,
  // UNC paths on Windows).
  if (
    resolvedJoin !== path.join(resolvedDir, `${segment}${suffix}`) ||
    !resolvedJoin.startsWith(resolvedDir + path.sep)
  ) {
    throw new Error(
      `[@mandujs/core/resource] refused to write outside ${resolvedDir}: resolved path ${resolvedJoin}`,
    );
  }
  return joined;
}

/**
 * Write per-resource schema snippets and (if changes exist) a new
 * migration file to disk.
 *
 * Guarantees:
 *   - Never overwrites an existing `NNNN_*.sql` file in the migrations
 *     directory. The next sequence number is assigned at write time
 *     based on a fresh scan.
 *   - `.mandu/schema/applied.json` is NEVER written from this module.
 *     Agent C's migration runner owns that file and writes it only
 *     after a successful `mandu db apply`. This keeps drift detection
 *     meaningful: `applied.json` always reflects what the DB actually
 *     has, not what we intended to apply.
 *   - Creates parent directories as needed (`mkdir -p` semantics).
 *   - Rejects any `tableName` / migration version that would resolve
 *     outside the target directory (see `safeJoinSegment`).
 *
 * Returns the paths of written files so the caller can log / report to
 * the user.
 */
export async function writeSchemaArtifacts(
  result: SchemaGenerationResult,
  rootDir: string,
): Promise<WriteSchemaArtifactsResult> {
  const paths = resolveGeneratedPaths(rootDir);

  const schemaFilePaths: string[] = [];

  if (Object.keys(result.desiredSchemaByTable).length > 0) {
    await ensureDir(paths.resourceSchemaOutDir);
    for (const [tableName, sql] of Object.entries(result.desiredSchemaByTable)) {
      const filePath = safeJoinSegment(
        paths.resourceSchemaOutDir,
        tableName,
        ".sql",
        SAFE_TABLE_FILE_SEGMENT_RE,
      );
      // Schema files are DERIVED — always regenerate. Format the file
      // with a header so human readers don't confuse it with a migration.
      const body = `-- @generated by Mandu — do not edit.
-- Source: spec/resources (resource definition)
-- Regenerate with \`mandu generate\` or \`mandu db plan\`.
--
-- NOTE: This file is a SNAPSHOT of the current desired schema. It is
-- NOT applied by the migration runner. For changes to reach your
-- database, use the NNNN_*.sql files in spec/db/migrations instead.

${sql}
`;
      await fs.writeFile(filePath, body, "utf8");
      schemaFilePaths.push(filePath);
    }
  }

  let migrationFilePath: string | null = null;
  let migrationVersion: string | null = null;

  if (result.migrationSql.length > 0 && result.changes.length > 0) {
    await ensureDir(paths.migrationsDir);
    const nextVersion = await findNextMigrationVersion(paths.migrationsDir);
    // Timestamp chars are a fixed [0-9:T.-Z] subset from
    // `new Date().toISOString()`; after the `[:.]` → `-` replacement
    // only `[0-9T-Z]` remain — safe for a file segment. Auto-migration
    // names are never user-derived but we route through `safeJoinSegment`
    // for uniformity.
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filenameSegment = `${nextVersion}_auto_${timestamp}`;
    migrationFilePath = safeJoinSegment(
      paths.migrationsDir,
      filenameSegment,
      ".sql",
      SAFE_MIGRATION_FILE_SEGMENT_RE,
    );
    migrationVersion = nextVersion;

    const body = `-- @generated by Mandu — human-editable.
-- Auto-generated on: ${new Date().toISOString()}
-- Changes detected: ${result.changes.length}
-- Target provider:  ${result.provider}
--
-- This file was composed by \`mandu db plan\`. Review it, edit if
-- necessary, and apply with \`mandu db apply\`. You own this file after
-- it's created — the generator will NEVER overwrite it.

${result.migrationSql}`;
    await fs.writeFile(migrationFilePath, body, "utf8");
  }

  return {
    schemaFilesWritten: schemaFilePaths.length,
    schemaFilePaths,
    migrationFilePath,
    migrationVersion,
  };
}

// ============================================
// Internals — migration SQL composition
// ============================================

/**
 * Wrap the sequence of `Change` → SQL emission with a transaction
 * header/footer. SQLite uses `BEGIN` / `COMMIT` (plain) because its
 * migration runner invokes each file via `db.transaction()` anyway —
 * but the explicit BEGIN/COMMIT is harmless inside an already-open tx
 * and makes the file runnable standalone via `sqlite3 foo.db < file.sql`.
 */
function composeMigrationSql(changes: readonly Change[], provider: SqlProvider): string {
  const body = emitChanges(changes, provider);
  if (body.length === 0) return "";
  return `BEGIN;

${body}

COMMIT;`;
}

// ============================================
// Internals — filesystem I/O
// ============================================

async function readAppliedSnapshot(schemaStateDir: string): Promise<Snapshot | null> {
  const appliedPath = path.join(schemaStateDir, "applied.json");
  let raw: string;
  try {
    raw = await fs.readFile(appliedPath, "utf8");
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") {
      // First run — no applied snapshot yet. Diff engine accepts null
      // and emits a `create-table` change per resource.
      return null;
    }
    throw err;
  }
  try {
    return parseSnapshot(raw);
  } catch (err) {
    // Malformed applied.json is operator-visible; rethrow with a hint.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[computeSchemaGeneration] Failed to parse ${appliedPath}: ${msg}. ` +
        `Either revert the file to its prior state or delete it to force a full re-create.`,
    );
  }
}

/**
 * Scan `spec/db/migrations/` and return the next zero-padded 4-digit
 * sequence. First run → "0001". If existing files use wider padding
 * (e.g. "12345_foo.sql"), the next returned version matches that width.
 *
 * Missing directory → "0001". Non-migration files in the directory are
 * ignored — the regex matches the runner's.
 */
async function findNextMigrationVersion(migrationsDir: string): Promise<string> {
  const re = /^(\d{4,})_[^/\\]+\.sql$/i;
  let entries: string[];
  try {
    entries = await fs.readdir(migrationsDir);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "ENOENT") return "0001";
    throw err;
  }

  let max = 0;
  let width = 4;
  for (const entry of entries) {
    const match = re.exec(entry);
    if (!match) continue;
    const version = match[1]!;
    const n = Number.parseInt(version, 10);
    if (Number.isFinite(n) && n > max) max = n;
    if (version.length > width) width = version.length;
  }

  const next = (max + 1).toString();
  // Zero-pad to width; if the new number exceeds the old width (overflow
  // from e.g. 9999 → 10000), grow the width so padding remains consistent.
  if (next.length > width) width = next.length;
  return next.padStart(width, "0");
}

function previewMigrationFilename(): string {
  // Preview is deliberately fuzzy: the real NNNN is assigned at write
  // time in `writeSchemaArtifacts`. Consumers should treat this as
  // informational only.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return `NNNN_auto_${ts}.sql`;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

// ============================================
// Internals — test hooks
// ============================================

/**
 * Exposed for unit tests ONLY. Consumers must NOT reach in here — these
 * helpers are private API.
 */
export const _internalForTests = {
  findNextMigrationVersion,
  composeMigrationSql,
  readAppliedSnapshot,
  safeJoinSegment,
  SAFE_TABLE_FILE_SEGMENT_RE,
  SAFE_MIGRATION_FILE_SEGMENT_RE,
};
