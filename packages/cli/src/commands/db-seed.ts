/**
 * `mandu db seed` — Phase 13.2.
 *
 * Runs the project's seed files (`spec/seeds/*.seed.ts`) against a live
 * database, replaying deterministic fixture data for development /
 * staging environments.
 *
 * ## Why seeds are not migrations
 *
 * Migrations describe **schema**; seeds describe **data**. Conflating
 * the two leads to two classic failures — tests that can't re-run
 * because prior row data lingers (seeds in migration history), and
 * destructive schema changes that can't roll back because a "fixture"
 * table has real users in it. We keep the two surfaces isolated:
 *
 *   - `mandu db plan/apply` — Phase 4c migration runner. History table
 *     `__mandu_migrations`. Never touches row data outside what the
 *     operator explicitly wrote into their `.sql` files.
 *   - `mandu db seed`       — this module. Talks to `__mandu_seeds`
 *     (a different history table), calls user code, runs in a
 *     per-file transaction, and is safe to replay.
 *
 * ## Seed file contract
 *
 * A seed file is a regular TypeScript module that lives in
 * `spec/seeds/`. Two shapes are supported:
 *
 *   - **Declarative** (simple case):
 *
 *     ```ts
 *     export default {
 *       resource: "user",
 *       data: [
 *         { email: "alice@example.com", name: "Alice" },
 *         { email: "bob@example.com",   name: "Bob"   },
 *       ],
 *     };
 *     ```
 *
 *     The runner validates every row against the resource's Zod
 *     schema (Phase 4c) and then INSERTs via `Bun.SQL` parameterised
 *     template literals. `--reset` wipes the resource's table first;
 *     default behaviour is **upsert** keyed on the primary column.
 *
 *   - **Imperative** (function):
 *
 *     ```ts
 *     export default async function seed(ctx: SeedContext) {
 *       await ctx.upsert("user", [{ email: "x" }], { by: "email" });
 *     }
 *     ```
 *
 *     The `SeedContext` surface exposes `db` (raw Bun.SQL handle,
 *     parameter-safe), `upsert(resource, rows, { by })`, and `insert`.
 *
 * Both shapes can expose a top-level `env: readonly ("dev" | "staging"
 * | "prod")[]` to gate where they apply. The default is `["dev",
 * "staging"]` — production is opt-in to prevent surprises.
 *
 * ## Security
 *
 * - Every identifier — table names, column names — flows through
 *   `quoteIdent` from `@mandujs/core/resource/ddl/emit`. Any raw
 *   interpolation is a SQL-injection bug and fails CI.
 * - Every value is bound via `Bun.SQL`'s parameter substitution,
 *   never concatenated into the SQL text.
 * - Rows are validated against the resource's Zod schema BEFORE any
 *   DB call — invalid payloads are rejected at the TypeScript layer.
 *
 * ## Exit codes
 *
 *   0 — success (or nothing to seed under current env filter)
 *   1 — I/O, validation, or SQL error
 *   2 — usage error (unknown flag combo)
 *   3 — tampered history (one or more already-applied seeds changed on disk)
 *
 * @module cli/commands/db-seed
 */

import path from "node:path";
import { existsSync, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { Glob } from "bun";

import { quoteIdent } from "@mandujs/core/compat/resource/ddl/emit";
import {
  parseResourceSchemas,
  validateResourceUniqueness,
  type ParsedResource,
} from "@mandujs/core/compat/resource/index";
import { snapshotFromResources } from "@mandujs/core/compat/resource/ddl/snapshot";
import type {
  DdlResource,
  Snapshot,
} from "@mandujs/core/compat/resource/ddl/types";

import { resolveDb, DbResolutionError } from "./db/resolve-db";
import { theme } from "../terminal/theme";

// =====================================================================
// Types
// =====================================================================

/** Environment label the current seed run is targeting. */
export type SeedEnv = "dev" | "staging" | "prod";

export const SEED_ENVS: readonly SeedEnv[] = ["dev", "staging", "prod"] as const;

/** Minimum subset of the DB handle the runner needs. */
export interface SeedDb {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T[]>;
  readonly provider: "postgres" | "mysql" | "sqlite";
  transaction<R>(fn: (tx: SeedDb) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

/** Public surface passed to imperative (function) seed modules. */
export interface SeedContext {
  /** Raw DB handle — prefer `upsert` / `insert` below when possible. */
  db: SeedDb;
  /** Current environment label. */
  env: SeedEnv;
  /** Insert rows into a resource's table; fails on PK collision. */
  insert(resource: string, rows: Record<string, unknown>[]): Promise<void>;
  /** Upsert rows. `by` is the unique column name used in the ON CONFLICT clause. */
  upsert(
    resource: string,
    rows: Record<string, unknown>[],
    opts: { by: string },
  ): Promise<void>;
}

/** Declarative seed payload. */
export interface DeclarativeSeed {
  resource: string;
  data: Record<string, unknown>[];
  /** Column used for upsert conflict resolution. Default: `"id"`. */
  key?: string;
  /** Environments where this seed runs. Default: `["dev", "staging"]`. */
  env?: readonly SeedEnv[];
}

/** Imperative seed payload. */
export type SeedFunction = (ctx: SeedContext) => Promise<void>;

/** Module-level shape returned from `import(seedFile)`. */
export interface SeedModule {
  default: DeclarativeSeed | SeedFunction;
  /** Optional override of `env` when the default export is a function. */
  env?: readonly SeedEnv[];
}

// =====================================================================
// CLI options
// =====================================================================

export interface DbSeedOptions {
  /** Filter — only run seeds whose file prefix matches. */
  file?: string;
  /** Force an environment label. Default: `"dev"`. */
  env?: SeedEnv;
  /** Skip any execution; print what would run + emit SQL preview. */
  dryRun?: boolean;
  /** Truncate target tables before inserting (DANGEROUS). */
  reset?: boolean;
  /** Non-interactive mode — disables confirmations, fails fast. */
  ci?: boolean;
  /** JSON output. */
  json?: boolean;
  /** Override for tests. */
  cwd?: string;
  /** Override DB handle for tests. */
  db?: SeedDb;
  /** Override seed-dir discovery for tests. */
  seedsDir?: string;
  /** Override resources-dir discovery for tests. */
  resourcesDir?: string;
  /**
   * Inject pre-parsed resources to bypass the filesystem discovery
   * path entirely — used by tests that want to skip the
   * `defineResource` import round-trip.
   */
  resources?: ParsedResource[];
}

// Stable exit codes — distinct from `db apply` so shell callers can
// branch on intent.
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
export const EXIT_TAMPER = 3;
export const EXIT_REFUSED = 4;

/** Default seeds run in dev + staging only — prod is explicit opt-in. */
const DEFAULT_ENV_WHITELIST: readonly SeedEnv[] = ["dev", "staging"] as const;

/** Seeds history table — distinct from migrations history. */
const HISTORY_TABLE = "__mandu_seeds";

/** Seed filename pattern. `NNN_description.seed.ts` — same shape as migrations. */
const SEED_FILE_RE = /^(\d{3,})_[^/\\]+\.seed\.ts$/i;

/**
 * Main entry — returns a numeric exit code. The registry wraps this
 * and calls `process.exit(code)` so the return path mirrors `db apply`.
 */
export async function dbSeed(options: DbSeedOptions = {}): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const seedsDir = options.seedsDir ?? path.join(cwd, "spec", "seeds");
  const resourcesDir = options.resourcesDir ?? path.join(cwd, "spec", "resources");
  const env: SeedEnv = options.env ?? "dev";

  if (!SEED_ENVS.includes(env)) {
    process.stderr.write(
      `${theme.error("usage:")} --env must be one of ${SEED_ENVS.join("|")}, got ${JSON.stringify(env)}\n`,
    );
    return EXIT_USAGE;
  }

  // Prod gate — require explicit confirmation. Matches `db reset` pattern.
  if (env === "prod" && options.dryRun !== true) {
    const confirm = process.env.MANDU_DB_SEED_PROD_CONFIRM;
    if (confirm !== "yes") {
      process.stderr.write(
        `${theme.error("refused:")} seeding production requires ${theme.command("MANDU_DB_SEED_PROD_CONFIRM=yes")}.\n` +
          `  ${theme.dim("this command can modify real user data — double-check your DATABASE_URL")}\n`,
      );
      return EXIT_REFUSED;
    }
  }

  if (!existsSync(seedsDir)) {
    if (options.json === true) {
      emitJson({ status: "ok", env, applied: [], skipped: [] });
    } else {
      process.stdout.write(
        `  ${theme.dim("no seeds directory:")} ${seedsDir}\n` +
          `  ${theme.dim("create one with:")} ${theme.command("mkdir -p spec/seeds")}\n`,
      );
    }
    return EXIT_OK;
  }

  // Load resources first — we need schemas to validate declarative seeds.
  let resources: ParsedResource[] = [];
  try {
    resources = options.resources ?? (await loadResources(resourcesDir));
  } catch (err) {
    printError("Failed to parse resources", err);
    return EXIT_ERROR;
  }
  const resourceByName = new Map(resources.map((r) => [r.resourceName, r]));
  // Build a name-resolver for persistent resources. Non-persistent
  // resources fall through to identity (resourceName == tableName,
  // fieldKey == columnName) so the declarative-seed surface works
  // with or without `persistence` declared.
  const nameResolver = buildNameResolver(resources);

  // Discover seed files.
  const allFiles = await discoverSeedFiles(seedsDir);
  const filtered = options.file
    ? allFiles.filter((f) => f.filename.startsWith(options.file!))
    : allFiles;
  if (filtered.length === 0) {
    if (options.json === true) {
      emitJson({ status: "ok", env, applied: [], skipped: allFiles.map((f) => f.filename) });
    } else {
      process.stdout.write(
        `  ${theme.dim("no matching seeds")} (dir: ${seedsDir}, filter: ${options.file ?? "*"})\n`,
      );
    }
    return EXIT_OK;
  }

  // Resolve DB — but skip when dry-run AND no resolver-hook-needed work.
  let db: SeedDb;
  try {
    if (options.db) {
      db = options.db;
    } else {
      const resolved = await resolveDb({ cwd });
      db = resolved.db as unknown as SeedDb;
    }
  } catch (err) {
    if (err instanceof DbResolutionError) {
      printError("Database not configured", err);
    } else {
      printError("Failed to resolve Db handle", err);
    }
    return EXIT_ERROR;
  }

  const closeWhenDone = !options.db;
  const closeDb = async (): Promise<void> => {
    if (closeWhenDone) await safeClose(db);
  };

  try {
    await db`SELECT 1`;
  } catch (err) {
    printError("Database connection failed", err);
    await closeDb();
    return EXIT_ERROR;
  }

  // Ensure history table.
  if (options.reset === true) {
    await execRaw(db, `DROP TABLE IF EXISTS ${quoteIdent(HISTORY_TABLE, db.provider)}`);
  }
  await ensureSeedsHistoryTable(db);

  // Tamper check — refuse to replay if a previously-applied seed's
  // on-disk bytes differ from what we recorded.
  const history = await readSeedsHistory(db);
  const tamper = detectTamper(history, filtered);
  if (tamper.length > 0) {
    if (options.json === true) {
      emitJson({ status: "tampered", tampered: tamper });
    } else {
      process.stderr.write(`\n${theme.error("TAMPER DETECTED")}\n\n`);
      for (const t of tamper) {
        process.stderr.write(`  file:    ${t.filename}\n`);
        process.stderr.write(`  stored:  ${t.storedChecksum}\n`);
        process.stderr.write(`  on-disk: ${t.currentChecksum}\n\n`);
      }
      process.stderr.write(
        `  Revert the file or use ${theme.command("mandu db seed --reset")} to rebuild history.\n\n`,
      );
    }
    await closeDb();
    return EXIT_TAMPER;
  }

  const applied: string[] = [];
  const skipped: { filename: string; reason: string }[] = [];

  try {
    for (const file of filtered) {
      // Skip files that have been applied and are idempotent-by-history.
      if (!options.reset && history.has(file.checksum)) {
        skipped.push({ filename: file.filename, reason: "already-applied" });
        continue;
      }

      // Load the seed module.
      let mod: SeedModule;
      try {
        mod = (await import(file.path)) as SeedModule;
      } catch (err) {
        printError(`Failed to import ${file.filename}`, err);
        await closeDb();
        return EXIT_ERROR;
      }

      const envFilter = resolveEnvWhitelist(mod);
      if (!envFilter.includes(env)) {
        skipped.push({ filename: file.filename, reason: `env-mismatch (${envFilter.join(",")})` });
        continue;
      }

      if (options.dryRun === true) {
        if (options.json !== true) {
          process.stdout.write(
            `  ${theme.dim("dry-run:")} ${file.filename} ${theme.dim(`(${file.checksum.slice(0, 8)})`)}\n`,
          );
          try {
            const preview = await previewSeed(
              mod,
              resourceByName,
              nameResolver,
              db.provider,
            );
            for (const line of preview) process.stdout.write(`    ${line}\n`);
          } catch (err) {
            process.stdout.write(
              `    ${theme.warn("preview failed:")} ${err instanceof Error ? err.message : String(err)}\n`,
            );
          }
        }
        continue;
      }

      // Execute the seed inside a transaction. Any failure aborts and
      // leaves the DB + history unchanged for this file.
      try {
        await db.transaction(async (tx) => {
          await executeSeedModule(mod, {
            db: tx,
            env,
            resourceByName,
            nameResolver,
            reset: options.reset === true,
          });
          await recordSeedHistory(tx, file, env);
        });
      } catch (err) {
        printError(`Failed to apply ${file.filename}`, err);
        await closeDb();
        return EXIT_ERROR;
      }

      applied.push(file.filename);
      if (options.json !== true) {
        process.stdout.write(
          `  ${theme.success("✓")} ${file.filename} ${theme.dim(`(${file.checksum.slice(0, 8)})`)}\n`,
        );
      }
    }
  } finally {
    // Nothing else to clean up — per-file transactions are scoped above.
  }

  if (options.json === true) {
    emitJson({ status: "ok", env, applied, skipped, dryRun: options.dryRun === true });
  } else if (applied.length === 0) {
    if (options.dryRun !== true) {
      process.stdout.write(
        `\n  ${theme.success("Up to date")} — no new seeds to apply.\n\n`,
      );
    }
  } else {
    process.stdout.write(
      `\n  ${theme.success("Seeded")} ${applied.length} file(s) (env=${env}).\n\n`,
    );
  }

  await closeDb();
  return EXIT_OK;
}

// =====================================================================
// Seed-file discovery
// =====================================================================

interface DiscoveredSeed {
  path: string;
  filename: string;
  checksum: string;
}

async function discoverSeedFiles(dir: string): Promise<DiscoveredSeed[]> {
  const out: DiscoveredSeed[] = [];
  const glob = new Glob("*.seed.ts");
  for await (const entry of glob.scan({ cwd: dir, onlyFiles: true })) {
    if (!SEED_FILE_RE.test(entry)) {
      process.stderr.write(
        `  ${theme.warn("skip:")} ${entry} does not match NNN_description.seed.ts pattern\n`,
      );
      continue;
    }
    const abs = path.join(dir, entry);
    const body = await fs.readFile(abs, "utf8");
    const checksum = createHash("sha256")
      .update(body.replace(/\r\n/g, "\n"), "utf8")
      .digest("hex");
    out.push({ path: abs, filename: entry, checksum });
  }
  out.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
  return out;
}

async function loadResources(resourcesDir: string): Promise<ParsedResource[]> {
  if (!existsSync(resourcesDir)) return [];
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
  if (files.length === 0) return [];
  const parsed = await parseResourceSchemas(files);
  validateResourceUniqueness(parsed);
  return parsed;
}

// =====================================================================
// Environment resolution
// =====================================================================

function resolveEnvWhitelist(mod: SeedModule): readonly SeedEnv[] {
  // Top-level `env` export takes precedence.
  if (Array.isArray(mod.env) && mod.env.every(isSeedEnv)) {
    return mod.env as readonly SeedEnv[];
  }
  const def = mod.default;
  if (def && typeof def === "object" && "env" in def) {
    const e = (def as { env?: readonly unknown[] }).env;
    if (Array.isArray(e) && e.every(isSeedEnv)) {
      return e as readonly SeedEnv[];
    }
  }
  return DEFAULT_ENV_WHITELIST;
}

function isSeedEnv(v: unknown): v is SeedEnv {
  return v === "dev" || v === "staging" || v === "prod";
}

// =====================================================================
// Name resolution — resource → DB table, field key → column name
// =====================================================================

/**
 * Produces a mapper from `(resourceName, fieldKey) → (tableName, columnName)`
 * consistent with the snapshot layer the migration runner uses.
 *
 * Resources without `options.persistence` are treated as identity
 * mappings — useful for tests that declare minimal resources.
 */
export interface NameResolver {
  resolveTable(resourceName: string): string;
  resolveColumn(resourceName: string, fieldKey: string): string;
  hasResource(resourceName: string): boolean;
}

function buildNameResolver(resources: readonly ParsedResource[]): NameResolver {
  const persistent: ParsedResource[] = [];
  for (const r of resources) {
    const rawPersistence = (r.definition.options as { persistence?: unknown } | undefined)
      ?.persistence;
    if (rawPersistence) persistent.push(r);
  }
  let snapshot: Snapshot | null = null;
  if (persistent.length > 0) {
    try {
      snapshot = snapshotFromResources(persistent);
    } catch {
      // Resource set is invalid for the snapshot layer — fall back to
      // identity. The runner will still execute (Bun.SQL will surface
      // a clearer error than a schema load failure would).
      snapshot = null;
    }
  }
  const ddlByResource = new Map<string, DdlResource>();
  if (snapshot) {
    // DdlResource#name is the TABLE name — we need a different key
    // (resource name). Re-iterate the source resources to build that.
    for (const r of persistent) {
      const rawPersistence = (r.definition.options as { persistence?: unknown } | undefined)
        ?.persistence;
      if (!rawPersistence) continue;
      // Build a single-resource snapshot to get the corresponding DDL
      // resource. Cheaper than walking the full snapshot looking for
      // a matching entry.
      try {
        const mini = snapshotFromResources([r]);
        const first = mini.resources[0];
        if (first) ddlByResource.set(r.resourceName, first);
      } catch {
        /* skip */
      }
    }
  }

  const parsedByName = new Map(resources.map((r) => [r.resourceName, r]));

  return {
    resolveTable(resourceName: string): string {
      const ddl = ddlByResource.get(resourceName);
      if (ddl) return ddl.name;
      return resourceName;
    },
    resolveColumn(resourceName: string, fieldKey: string): string {
      const ddl = ddlByResource.get(resourceName);
      if (!ddl) return fieldKey;
      // Map the field key to the DDL column name. The DDL resource
      // preserves field order from the source; we match on position
      // via the original resource definition.
      const parsed = parsedByName.get(resourceName);
      if (!parsed) return fieldKey;
      const keys = Object.keys(parsed.definition.fields);
      const idx = keys.indexOf(fieldKey);
      if (idx < 0 || idx >= ddl.fields.length) return fieldKey;
      return ddl.fields[idx]!.name;
    },
    hasResource(resourceName: string): boolean {
      return parsedByName.has(resourceName);
    },
  };
}

// =====================================================================
// Execution — declarative vs imperative
// =====================================================================

interface ExecContext {
  db: SeedDb;
  env: SeedEnv;
  resourceByName: Map<string, ParsedResource>;
  nameResolver: NameResolver;
  reset: boolean;
}

async function executeSeedModule(mod: SeedModule, ctx: ExecContext): Promise<void> {
  const def = mod.default;
  if (!def) {
    throw new Error("seed module must export a default value");
  }
  if (typeof def === "function") {
    const fn = def as SeedFunction;
    const seedCtx: SeedContext = {
      db: ctx.db,
      env: ctx.env,
      insert: async (resource, rows) =>
        runInsert(ctx.db, resource, rows, ctx.resourceByName, ctx.nameResolver),
      upsert: async (resource, rows, opts) =>
        runUpsert(
          ctx.db,
          resource,
          rows,
          opts.by,
          ctx.resourceByName,
          ctx.nameResolver,
        ),
    };
    await fn(seedCtx);
    return;
  }
  if (typeof def !== "object" || def === null) {
    throw new Error(
      "seed default export must be either a function or a { resource, data } object",
    );
  }
  const declarative = def as DeclarativeSeed;
  if (typeof declarative.resource !== "string" || declarative.resource.length === 0) {
    throw new Error("declarative seed requires a non-empty `resource` field");
  }
  if (!Array.isArray(declarative.data)) {
    throw new Error(`declarative seed "${declarative.resource}" requires a \`data\` array`);
  }
  const resource = ctx.resourceByName.get(declarative.resource);
  if (!resource) {
    throw new Error(
      `unknown resource "${declarative.resource}" — add spec/resources/${declarative.resource}.resource.ts first`,
    );
  }
  if (ctx.reset) {
    // Truncate/delete the target table. On SQLite there is no TRUNCATE;
    // DELETE FROM is equivalent and respects the enclosing transaction.
    const tableName = ctx.nameResolver.resolveTable(declarative.resource);
    const tableIdent = quoteIdent(tableName, ctx.db.provider);
    await execRaw(ctx.db, `DELETE FROM ${tableIdent}`);
  }
  const key = declarative.key ?? "id";
  await runUpsert(
    ctx.db,
    declarative.resource,
    declarative.data,
    key,
    ctx.resourceByName,
    ctx.nameResolver,
  );
}

// =====================================================================
// Insert / upsert primitives
// =====================================================================

async function runInsert(
  db: SeedDb,
  resource: string,
  rows: Record<string, unknown>[],
  resourceByName: Map<string, ParsedResource>,
  nameResolver: NameResolver,
): Promise<void> {
  if (rows.length === 0) return;
  const meta = resourceByName.get(resource);
  if (!meta) {
    throw new Error(`unknown resource "${resource}" — cannot insert`);
  }
  validateRowsAgainstResource(rows, meta);
  const tableName = nameResolver.resolveTable(resource);
  const tableIdent = quoteIdent(tableName, db.provider);
  for (const row of rows) {
    const mapped = mapRowColumns(row, resource, nameResolver);
    const { columns, placeholders, values } = bindRow(mapped, db.provider);
    await execValuesStmt(
      db,
      `INSERT INTO ${tableIdent} (${columns}) VALUES (${placeholders})`,
      values,
    );
  }
}

async function runUpsert(
  db: SeedDb,
  resource: string,
  rows: Record<string, unknown>[],
  byColumn: string,
  resourceByName: Map<string, ParsedResource>,
  nameResolver: NameResolver,
): Promise<void> {
  if (rows.length === 0) return;
  const meta = resourceByName.get(resource);
  if (!meta) {
    throw new Error(`unknown resource "${resource}" — cannot upsert`);
  }
  validateRowsAgainstResource(rows, meta);
  // Validate `byColumn` is a real field on the resource before we route
  // it through quoteIdent — better UX, earlier error.
  if (!(byColumn in meta.definition.fields) && byColumn !== "id") {
    throw new Error(
      `upsert conflict column "${byColumn}" is not a field of resource "${resource}"`,
    );
  }
  const tableName = nameResolver.resolveTable(resource);
  const tableIdent = quoteIdent(tableName, db.provider);
  const resolvedByColumn = nameResolver.resolveColumn(resource, byColumn);
  const byIdent = quoteIdent(resolvedByColumn, db.provider);
  for (const row of rows) {
    const mapped = mapRowColumns(row, resource, nameResolver);
    const { columns, placeholders, values, columnNames } = bindRow(mapped, db.provider);
    const updateSet = columnNames
      .filter((c) => c !== resolvedByColumn)
      .map((c) => `${quoteIdent(c, db.provider)} = EXCLUDED.${quoteIdent(c, db.provider)}`)
      .join(", ");

    let sql: string;
    if (db.provider === "sqlite" || db.provider === "postgres") {
      // Both accept `ON CONFLICT (col) DO UPDATE SET ...` with the
      // EXCLUDED pseudo-table. If there is only one column (the key),
      // we DO NOTHING to avoid an empty SET list.
      const onConflict = updateSet.length > 0 ? `DO UPDATE SET ${updateSet}` : "DO NOTHING";
      sql = `INSERT INTO ${tableIdent} (${columns}) VALUES (${placeholders}) ON CONFLICT (${byIdent}) ${onConflict}`;
    } else {
      // MySQL — ON DUPLICATE KEY UPDATE. Requires a UNIQUE index on
      // `byColumn` (defense-in-depth: caller is responsible).
      const mysqlSet = columnNames
        .filter((c) => c !== resolvedByColumn)
        .map(
          (c) =>
            `${quoteIdent(c, db.provider)} = VALUES(${quoteIdent(c, db.provider)})`,
        )
        .join(", ");
      sql = `INSERT INTO ${tableIdent} (${columns}) VALUES (${placeholders}) ${
        mysqlSet.length > 0 ? `ON DUPLICATE KEY UPDATE ${mysqlSet}` : ""
      }`;
    }
    await execValuesStmt(db, sql, values);
  }
}

/**
 * Remap row object keys (field names as authored) to the DB column
 * names the snapshot layer computes. Keeps values untouched.
 */
function mapRowColumns(
  row: Record<string, unknown>,
  resource: string,
  nameResolver: NameResolver,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const mapped = nameResolver.resolveColumn(resource, key);
    out[mapped] = row[key];
  }
  return out;
}

/**
 * Bind a row to a (columns, placeholders, values) triple.
 *
 * - Column names flow through `quoteIdent` — identifier injection blocked.
 * - Values are placeholder references — SQL injection blocked.
 *
 * Column order is `Object.keys(row)` — deterministic in Node/Bun since
 * numeric keys sort first, then insertion order.
 */
function bindRow(
  row: Record<string, unknown>,
  provider: SeedDb["provider"],
): {
  columns: string;
  placeholders: string;
  values: unknown[];
  columnNames: string[];
} {
  const columnNames = Object.keys(row);
  if (columnNames.length === 0) {
    throw new Error("cannot insert a row with no columns");
  }
  const values = columnNames.map((c) => row[c]);
  // quoteIdent validates each column name.
  const columns = columnNames.map((c) => quoteIdent(c, provider)).join(", ");
  const placeholders = columnNames
    .map((_, i) => (provider === "postgres" ? `$${i + 1}` : "?"))
    .join(", ");
  return { columns, placeholders, values, columnNames };
}

function validateRowsAgainstResource(
  rows: Record<string, unknown>[],
  resource: ParsedResource,
): void {
  const knownFields = new Set(Object.keys(resource.definition.fields));
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`row #${i} in resource "${resource.resourceName}" is not an object`);
    }
    for (const col of Object.keys(row)) {
      if (!knownFields.has(col)) {
        throw new Error(
          `unknown column "${col}" in resource "${resource.resourceName}" (row #${i})`,
        );
      }
    }
    // Required-field validation — ensures we fail fast with a helpful
    // error rather than letting the DB emit a cryptic NOT NULL constraint
    // violation.
    for (const [col, field] of Object.entries(resource.definition.fields)) {
      if (field.required && !(col in row) && field.default === undefined) {
        throw new Error(
          `missing required column "${col}" in resource "${resource.resourceName}" (row #${i})`,
        );
      }
    }
  }
}

// =====================================================================
// History table
// =====================================================================

async function ensureSeedsHistoryTable(db: SeedDb): Promise<void> {
  const tableIdent = quoteIdent(HISTORY_TABLE, db.provider);
  // Use simple types that work on all three providers.
  const createdAt =
    db.provider === "postgres"
      ? "TIMESTAMPTZ NOT NULL DEFAULT now()"
      : db.provider === "mysql"
      ? "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"
      : "TEXT NOT NULL DEFAULT (datetime('now'))";
  const sql = [
    `CREATE TABLE IF NOT EXISTS ${tableIdent} (`,
    `  filename TEXT NOT NULL PRIMARY KEY,`,
    `  checksum TEXT NOT NULL,`,
    `  env      TEXT NOT NULL,`,
    `  created_at ${createdAt}`,
    `)`,
  ].join("\n");
  await execRaw(db, sql);
}

async function readSeedsHistory(db: SeedDb): Promise<Map<string, { filename: string }>> {
  const tableIdent = quoteIdent(HISTORY_TABLE, db.provider);
  const rows = await execRaw<{ filename: string; checksum: string }>(
    db,
    `SELECT filename, checksum FROM ${tableIdent}`,
  );
  const byChecksum = new Map<string, { filename: string }>();
  for (const row of rows) {
    byChecksum.set(row.checksum, { filename: row.filename });
  }
  return byChecksum;
}

async function recordSeedHistory(db: SeedDb, file: DiscoveredSeed, env: SeedEnv): Promise<void> {
  const tableIdent = quoteIdent(HISTORY_TABLE, db.provider);
  // We use INSERT OR REPLACE (sqlite) / ON CONFLICT (postgres) / ON DUPLICATE KEY (mysql)
  // so re-running with `--reset` doesn't duplicate rows.
  let sql: string;
  if (db.provider === "postgres") {
    sql = `INSERT INTO ${tableIdent} (filename, checksum, env) VALUES ($1, $2, $3) ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, env = EXCLUDED.env`;
  } else if (db.provider === "mysql") {
    sql = `INSERT INTO ${tableIdent} (filename, checksum, env) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE checksum = VALUES(checksum), env = VALUES(env)`;
  } else {
    sql = `INSERT OR REPLACE INTO ${tableIdent} (filename, checksum, env) VALUES (?, ?, ?)`;
  }
  await execValuesStmt(db, sql, [file.filename, file.checksum, env]);
}

interface TamperRow {
  filename: string;
  storedChecksum: string;
  currentChecksum: string;
}

function detectTamper(
  history: Map<string, { filename: string }>,
  filesOnDisk: DiscoveredSeed[],
): TamperRow[] {
  const out: TamperRow[] = [];
  // History key is checksum → filename. If a file on disk shares a
  // filename with a history row but a different checksum, it's tampered.
  const filenameToHistory = new Map<string, { checksum: string }>();
  for (const [checksum, { filename }] of history) {
    filenameToHistory.set(filename, { checksum });
  }
  for (const file of filesOnDisk) {
    const prior = filenameToHistory.get(file.filename);
    if (!prior) continue;
    if (prior.checksum !== file.checksum) {
      out.push({
        filename: file.filename,
        storedChecksum: prior.checksum,
        currentChecksum: file.checksum,
      });
    }
  }
  return out;
}

// =====================================================================
// Dry-run SQL preview
// =====================================================================

async function previewSeed(
  mod: SeedModule,
  resourceByName: Map<string, ParsedResource>,
  nameResolver: NameResolver,
  provider: SeedDb["provider"],
): Promise<string[]> {
  const def = mod.default;
  if (typeof def === "function") {
    return ["function seed — run without --dry-run to execute"];
  }
  if (!def || typeof def !== "object") {
    return ["unknown seed shape"];
  }
  const declarative = def as DeclarativeSeed;
  const meta = resourceByName.get(declarative.resource);
  if (!meta) {
    return [`unknown resource "${declarative.resource}"`];
  }
  validateRowsAgainstResource(declarative.data, meta);
  const tableName = nameResolver.resolveTable(declarative.resource);
  const tableIdent = quoteIdent(tableName, provider);
  const lines: string[] = [];
  for (let i = 0; i < Math.min(declarative.data.length, 3); i++) {
    const row = declarative.data[i]!;
    const mapped = mapRowColumns(row, declarative.resource, nameResolver);
    const { columns, placeholders } = bindRow(mapped, provider);
    lines.push(`INSERT INTO ${tableIdent} (${columns}) VALUES (${placeholders})`);
  }
  if (declarative.data.length > 3) {
    lines.push(`-- ... + ${declarative.data.length - 3} more row(s)`);
  }
  return lines;
}

// =====================================================================
// Helpers
// =====================================================================

/** Execute a raw SQL string with no placeholders. */
async function execRaw<T = Record<string, unknown>>(
  db: SeedDb,
  sql: string,
): Promise<T[]> {
  // Reuse the migration runner's trick: synthetic TemplateStringsArray.
  const strings = Object.assign([sql], { raw: [sql] }) as unknown as TemplateStringsArray;
  return (await db<T>(strings)) as T[];
}

/**
 * Execute a prepared statement with a values array. We rebuild a fake
 * TemplateStringsArray that splits the SQL at each `?` / `$N` boundary
 * so Bun.SQL's parameter-binding path runs — `values` are NEVER
 * concatenated into the SQL text.
 */
async function execValuesStmt(db: SeedDb, sql: string, values: unknown[]): Promise<void> {
  if (values.length === 0) {
    await execRaw(db, sql);
    return;
  }
  // Split on `?` (sqlite/mysql) or `$1..$N` (postgres).
  const parts: string[] = [];
  let rest = sql;
  const re = /\?|\$\d+/;
  while (true) {
    const m = re.exec(rest);
    if (!m) {
      parts.push(rest);
      break;
    }
    parts.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
  }
  if (parts.length !== values.length + 1) {
    throw new Error(
      `placeholder count mismatch: expected ${values.length + 1} splits, got ${parts.length}`,
    );
  }
  const strings = Object.assign(parts, { raw: parts }) as unknown as TemplateStringsArray;
  await db(strings, ...values);
}

function emitJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function printError(label: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${theme.error("error:")} ${label}: ${msg}\n`);
}

async function safeClose(db: SeedDb | undefined): Promise<void> {
  if (!db) return;
  try {
    await db.close();
  } catch {
    /* already closed */
  }
}

// =====================================================================
// Re-exports — for tests
// =====================================================================

export const __private = {
  bindRow,
  validateRowsAgainstResource,
  detectTamper,
  resolveEnvWhitelist,
  previewSeed,
  buildNameResolver,
  mapRowColumns,
  SEED_FILE_RE,
  HISTORY_TABLE,
  DEFAULT_ENV_WHITELIST,
};
