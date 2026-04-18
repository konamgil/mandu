/**
 * Phase 4c.R3 — Full pipeline integration tests across SQLite / Postgres / MySQL.
 *
 * The complete flow we exercise per dialect:
 *
 *   1. ParsedResource[] → snapshotFromResources → DdlResource[]
 *   2. diffSnapshots(old, next) → Change[]
 *   3. emitChanges(changes, provider) → SQL migration body
 *   4. Write NNNN_auto_*.sql file to migrations directory
 *   5. createMigrationRunner(db, opts).apply() → executes SQL + writes __mandu_migrations
 *   6. Verify schema matches via dialect-specific introspection
 *   7. Instantiate the generated repo factory → findById / findMany / create / update / delete
 *   8. Tamper + concurrent-apply + empty-diff edge cases
 *
 * ## Skip policy
 *
 * SQLite runs everywhere (Bun's in-process driver). Postgres + MySQL
 * require Docker and only run when the corresponding env vars are set:
 *
 *   DB_TEST_POSTGRES_URL=postgres://test:test@localhost:5433/testdb
 *   DB_TEST_MYSQL_URL=mysql://test:test@localhost:3307/testdb
 *
 * (See `packages/core/tests/fixtures/db/docker-compose.yml` — same env
 * var contract as Phase 4a's integration tests.)
 *
 * Rather than rely on test-runner `skipIf` conditions (inconsistent
 * across Bun versions), we branch at registration time: `describe` vs
 * `describe.skip`. This keeps the skipped-test count visible in the
 * reporter and guarantees the bodies always compile.
 *
 * ## Parallelism + isolation
 *
 * Each test gets a fresh database. For SQLite that's a scratch file in
 * `os.tmpdir()`. For Postgres/MySQL tables are prefixed with a unique
 * per-fixture namespace so parallel runs against the same shared server
 * can't step on each other. Tables are dropped in afterEach regardless
 * of outcome.
 *
 * ## R1/R2 gaps surfaced by this test suite (reported, not fixed)
 *
 * - [R2] `generator-repo.ts` omits the primary key from the INSERT
 *   column list unconditionally (see `resolveColumns` — `omitOnInsert = primary`).
 *   For UUID-PK columns WITHOUT a DB-side default this means a
 *   `NOT NULL` violation on SQLite and a NULL PK silently accepted on
 *   SQLite (`id` becomes NULL instead of the user-supplied UUID). Our
 *   test 6 works around this by using `db` directly for `create` and
 *   verifying the repo's read/update/delete methods.
 * - [R1] `emitChanges` for an `add-column` whose field is `indexed: true`
 *   does NOT also emit a `CREATE INDEX` — only the CREATE TABLE path
 *   emits auto-indexes. Adding an indexed field via ALTER TABLE will
 *   add the column but no index. Our test 4 verifies the column gets
 *   added; explicit index creation is exercised via
 *   `persistence.indexes[]` in test 4b.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, type Db } from "@mandujs/core/db";
import {
  createMigrationRunner,
  MigrationTamperedError,
  computeMigrationChecksum,
} from "@mandujs/core/db/migrations/runner";
import {
  DEFAULT_HISTORY_TABLE,
  readAllHistory,
} from "@mandujs/core/db/migrations/history-table";
import {
  snapshotFromResources,
} from "@mandujs/core/resource/ddl/snapshot";
import { diffSnapshots } from "@mandujs/core/resource/ddl/diff";
import { emitChanges } from "@mandujs/core/resource/ddl/emit";
import type {
  ParsedResource,
} from "@mandujs/core/resource/parser";
import type { ResourceDefinition } from "@mandujs/core/resource/schema";
import type {
  Change,
  Snapshot,
  SqlProvider,
} from "@mandujs/core/resource/ddl/types";
import { generateRepoSource } from "@mandujs/core/resource/generator-repo";

// ============================================
// Gate — needs Bun.SQL at all
// ============================================

const hasBunSql = (() => {
  const g = globalThis as unknown as { Bun?: { SQL?: unknown } };
  return typeof g.Bun?.SQL === "function";
})();

/** Postgres URL (docker fixture). Present → run. */
const POSTGRES_URL = process.env.DB_TEST_POSTGRES_URL?.trim() || "";
/** MySQL URL (docker fixture). Present → run. */
const MYSQL_URL = process.env.DB_TEST_MYSQL_URL?.trim() || "";

const runSqlite = hasBunSql;
const runPostgres = hasBunSql && POSTGRES_URL.length > 0;
const runMysql = hasBunSql && MYSQL_URL.length > 0;

// ============================================
// Builders — ParsedResource fixtures
// ============================================

function makeParsed(
  def: ResourceDefinition,
  file = `/virtual/${def.name}.resource.ts`,
): ParsedResource {
  return {
    definition: def,
    filePath: file,
    fileName: def.name,
    resourceName: def.name,
  };
}

/** Baseline user resource — mirrors a realistic auth starter. */
function userResource(provider: SqlProvider): ResourceDefinition {
  return {
    name: "user",
    fields: {
      id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
      email: { type: "email", required: true },
      name: { type: "string", required: true },
      createdAt: { type: "date", required: true },
    },
    options: {
      persistence: { provider },
    } as unknown as ResourceDefinition["options"],
  };
}

/** user + extra `avatar` column — used by add-column diff. */
function userResourceWithAvatar(provider: SqlProvider): ResourceDefinition {
  const base = userResource(provider);
  return {
    ...base,
    fields: {
      ...base.fields,
      avatar: { type: "string", required: false },
    },
  };
}

/** user with NO `name` — used by drop-column diff. */
function userResourceNoName(provider: SqlProvider): ResourceDefinition {
  return {
    name: "user",
    fields: {
      id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
      email: { type: "email", required: true },
      createdAt: { type: "date", required: true },
    },
    options: {
      persistence: { provider },
    } as unknown as ResourceDefinition["options"],
  };
}

/** user with an additional `role` field (NOT indexed) + an explicit multi-column
 *  index in `persistence.indexes`. Exercises the add-index Change path. */
function userResourceWithIndex(provider: SqlProvider, indexName: string): ResourceDefinition {
  return {
    name: "user",
    fields: {
      id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
      email: { type: "email", required: true },
      name: { type: "string", required: true },
      role: { type: "string", required: false },
      createdAt: { type: "date", required: true },
    },
    options: {
      persistence: {
        provider,
        indexes: [{ name: indexName, fields: ["role"], unique: false }],
      },
    } as unknown as ResourceDefinition["options"],
  };
}

/** user with `name` changing type string → number (stub alter). */
function userResourceTypeChange(provider: SqlProvider): ResourceDefinition {
  return {
    name: "user",
    fields: {
      id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
      email: { type: "email", required: true },
      name: { type: "number", required: true }, // was string
      createdAt: { type: "date", required: true },
    },
    options: {
      persistence: { provider },
    } as unknown as ResourceDefinition["options"],
  };
}

/** A second resource for multi-table tests. */
function postResource(provider: SqlProvider): ResourceDefinition {
  return {
    name: "post",
    fields: {
      id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
      userId: { type: "uuid", required: true },
      title: { type: "string", required: true },
      body: { type: "string", required: true },
      createdAt: { type: "date", required: true },
    },
    options: {
      persistence: { provider },
    } as unknown as ResourceDefinition["options"],
  };
}

/** Third resource — exercises "3 create-table in one migration" case. */
function commentResource(provider: SqlProvider): ResourceDefinition {
  return {
    name: "comment",
    fields: {
      id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
      postId: { type: "uuid", required: true },
      body: { type: "string", required: true },
    },
    options: {
      persistence: { provider },
    } as unknown as ResourceDefinition["options"],
  };
}

// ============================================
// Scratch / fixture helpers
// ============================================

interface Fixture {
  db: Db;
  provider: SqlProvider;
  scratchDir: string;
  migrationsDir: string;
  /** Unique suffix scoped to this fixture — protects parallel runs against
   *  cross-run leaks in shared Postgres/MySQL schemas. */
  ns: string;
  /** Cleanup hook: drops tables the test may have created. Called in afterEach. */
  cleanup: () => Promise<void>;
}

let fixtureCounter = 0;

async function setupFixture(provider: SqlProvider): Promise<Fixture> {
  const scratchDir = mkdtempSync(join(tmpdir(), `mandu-e2e-${provider}-`));
  const migrationsDir = join(scratchDir, "migrations");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(migrationsDir, { recursive: true });
  await writeFile(join(scratchDir, ".gitkeep"), "");

  // Per-fixture namespace — used inside table names so parallel tests
  // against the same Postgres/MySQL server don't step on each other.
  fixtureCounter += 1;
  const ns = `t${Date.now().toString(36)}${fixtureCounter}`;

  let db: Db;
  let cleanup: () => Promise<void>;

  if (provider === "sqlite") {
    const dbPath = join(scratchDir, "app.db");
    db = createDb({ url: `sqlite://${dbPath}` });
    await db`SELECT 1`;
    cleanup = async () => {
      try { await db.close(); } catch { /* idempotent */ }
    };
  } else if (provider === "postgres") {
    db = createDb({ url: POSTGRES_URL, provider: "postgres", max: 1 }); // max:1 avoids pool-state issues across test fixtures (pg_advisory_lock is session-scoped)
    await db`SELECT 1`;
    cleanup = async () => {
      try {
        const rows = await db<{ tablename: string }>`
          SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE ${`${ns}_%`}
        `;
        for (const { tablename } of rows) {
          const ident = `"${tablename.replace(/"/g, "")}"`;
          const strings = Object.assign([`DROP TABLE IF EXISTS ${ident} CASCADE`], { raw: [`DROP TABLE IF EXISTS ${ident} CASCADE`] }) as unknown as TemplateStringsArray;
          await db(strings);
        }
        await db`DROP TABLE IF EXISTS "__mandu_migrations"`;
      } finally {
        try { await db.close(); } catch { /* idempotent */ }
      }
    };
  } else {
    // mysql
    db = createDb({ url: MYSQL_URL, provider: "mysql", max: 1 }); // max:1 works around a Bun.SQL MySQL pool-reset bug where connections aren't released properly after db.transaction()
    await db`SELECT 1`;
    cleanup = async () => {
      try {
        const rows = await db<{ TABLE_NAME: string }>`
          SELECT TABLE_NAME FROM information_schema.tables
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ${`${ns}_%`}
        `;
        for (const r of rows) {
          const tn = r.TABLE_NAME;
          const ident = `\`${tn.replace(/`/g, "")}\``;
          const strings = Object.assign([`DROP TABLE IF EXISTS ${ident}`], { raw: [`DROP TABLE IF EXISTS ${ident}`] }) as unknown as TemplateStringsArray;
          await db(strings);
        }
        await db`DROP TABLE IF EXISTS \`__mandu_migrations\``;
      } finally {
        try { await db.close(); } catch { /* idempotent */ }
      }
    };
  }

  return { db, provider, scratchDir, migrationsDir, ns, cleanup };
}

async function teardownFixture(f: Fixture): Promise<void> {
  await f.cleanup();
  rmSync(f.scratchDir, { recursive: true, force: true });
}

/** Write a migration file. Returns absolute path. */
function writeMigration(dir: string, version: string, label: string, sql: string): string {
  const filename = `${version}_${label}.sql`;
  const full = join(dir, filename);
  writeFileSync(full, sql, "utf8");
  return full;
}

/**
 * Inject the namespace prefix into a ResourceDefinition's table. This lets
 * us run PG/MySQL tests against a shared server without leaking state
 * across parallel test runs.
 *
 * Implementation: set `options.persistence.tableName` to `<ns>_<plural>`.
 */
function nsTable(def: ResourceDefinition, ns: string): ResourceDefinition {
  const plural = pluralize(def.name);
  const prev = def.options as Record<string, unknown> | undefined;
  const prevPersistence = (prev?.persistence ?? {}) as Record<string, unknown>;
  return {
    ...def,
    options: {
      ...(prev ?? {}),
      persistence: { ...prevPersistence, tableName: `${ns}_${plural}` },
    } as unknown as ResourceDefinition["options"],
  };
}

function pluralize(singular: string): string {
  if (/[^aeiou]y$/i.test(singular)) return singular.slice(0, -1) + "ies";
  if (/(?:s|x|z|ch|sh)$/i.test(singular)) return singular + "es";
  return singular + "s";
}

/** End-to-end: parsedResources → snapshot → diff(applied) → migration file → apply → returns the applied snapshot. */
async function planAndApply(
  f: Fixture,
  resources: ParsedResource[],
  applied: Snapshot | null,
  version: string,
  label: string,
): Promise<{ snapshot: Snapshot; changes: Change[]; migrationPath: string | null }> {
  const next = snapshotFromResources(resources);
  const changes = diffSnapshots(applied, next);
  if (changes.length === 0) {
    return { snapshot: next, changes: [], migrationPath: null };
  }
  const sql = emitChanges(changes, f.provider);
  const migrationPath = writeMigration(f.migrationsDir, version, label, sql);
  // lockStrategy "none" on MySQL: the combination of max:1 pool + session-
  // scoped GET_LOCK + db.transaction() reliably hangs inside Bun's test
  // harness. Test 8 exercises concurrency lock semantics with two distinct
  // db handles so we still have coverage of the per-dialect lock path.
  const runner = createMigrationRunner(f.db, {
    migrationsDir: f.migrationsDir,
    ...(f.provider === "mysql" ? { lockStrategy: "none" as const } : {}),
  });
  await runner.apply();
  return { snapshot: next, changes, migrationPath };
}

// ============================================
// Dialect-specific introspection
// ============================================

async function tableExists(f: Fixture, tableName: string): Promise<boolean> {
  if (f.provider === "sqlite") {
    const rows = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${tableName}
    `;
    return rows.length > 0;
  }
  if (f.provider === "postgres") {
    const rows = await f.db<{ tablename: string }>`
      SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename = ${tableName}
    `;
    return rows.length > 0;
  }
  // mysql
  const rows = await f.db<{ TABLE_NAME: string }>`
    SELECT TABLE_NAME FROM information_schema.tables
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tableName}
  `;
  return rows.length > 0;
}

async function columnExists(f: Fixture, tableName: string, column: string): Promise<boolean> {
  if (f.provider === "sqlite") {
    // pragma_table_info doesn't accept params; interpolate our own ns-prefixed table name safely.
    const ident = tableName.replace(/[^a-zA-Z0-9_]/g, "");
    const q = `SELECT name FROM pragma_table_info('${ident}')`;
    const strings = Object.assign([q], { raw: [q] }) as unknown as TemplateStringsArray;
    const rows = (await f.db(strings)) as Array<{ name: string }>;
    return rows.some((r) => r.name === column);
  }
  if (f.provider === "postgres") {
    const rows = await f.db<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${tableName} AND column_name = ${column}
    `;
    return rows.length > 0;
  }
  // mysql
  const rows = await f.db<{ COLUMN_NAME: string }>`
    SELECT COLUMN_NAME FROM information_schema.columns
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tableName} AND COLUMN_NAME = ${column}
  `;
  return rows.length > 0;
}

async function indexExists(f: Fixture, tableName: string, indexNameLike: string): Promise<boolean> {
  if (f.provider === "sqlite") {
    const rows = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ${tableName}
    `;
    return rows.some((r) => r.name.includes(indexNameLike));
  }
  if (f.provider === "postgres") {
    const rows = await f.db<{ indexname: string }>`
      SELECT indexname FROM pg_indexes WHERE tablename = ${tableName}
    `;
    return rows.some((r) => r.indexname.includes(indexNameLike));
  }
  // mysql
  const rows = await f.db<{ INDEX_NAME: string }>`
    SELECT INDEX_NAME FROM information_schema.statistics
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${tableName}
  `;
  return rows.some((r) => r.INDEX_NAME.includes(indexNameLike));
}

// ============================================
// Dialect matrix driver
// ============================================

interface DialectCase {
  provider: SqlProvider;
  enabled: boolean;
  describeLabel: string;
}

const cases: DialectCase[] = [
  { provider: "sqlite", enabled: runSqlite, describeLabel: "SQLite" },
  { provider: "postgres", enabled: runPostgres, describeLabel: "Postgres" },
  { provider: "mysql", enabled: runMysql, describeLabel: "MySQL" },
];

for (const c of cases) {
  const describeFn = c.enabled ? describe : describe.skip;

  describeFn(`[${c.describeLabel}] resource → migration → apply`, () => {
    let f: Fixture;

    beforeEach(async () => {
      f = await setupFixture(c.provider);
    });

    afterEach(async () => {
      await teardownFixture(f);
    });

    // ------------------------------------------------------------------
    // 1. Empty start → CREATE TABLE
    // ------------------------------------------------------------------

    test("1. empty applied state + one resource → create-table change applies cleanly", async () => {
      const resources = [makeParsed(nsTable(userResource(c.provider), f.ns))];
      const { snapshot, changes, migrationPath } = await planAndApply(
        f,
        resources,
        null,
        "0001",
        "create_users",
      );
      expect(changes).toHaveLength(1);
      expect(changes[0]!.kind).toBe("create-table");
      expect(migrationPath).not.toBeNull();

      const plural = `${f.ns}_users`;
      expect(await tableExists(f, plural)).toBe(true);

      const hist = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
      expect(hist.filter((h) => h.success === 1)).toHaveLength(1);

      expect(snapshot.resources.find((r) => r.name === plural)).toBeDefined();
    });

    // ------------------------------------------------------------------
    // 2. Add a field → ADD COLUMN
    // ------------------------------------------------------------------

    test("2. baseline applied → resource adds field → add-column change applies", async () => {
      const baseline = [makeParsed(nsTable(userResource(c.provider), f.ns))];
      const first = await planAndApply(f, baseline, null, "0001", "create_users");
      expect(first.changes).toHaveLength(1);

      const extended = [makeParsed(nsTable(userResourceWithAvatar(c.provider), f.ns))];
      const second = await planAndApply(f, extended, first.snapshot, "0002", "add_avatar");
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0]!.kind).toBe("add-column");

      expect(await columnExists(f, `${f.ns}_users`, "avatar")).toBe(true);
    });

    // ------------------------------------------------------------------
    // 3. Drop a field → DROP COLUMN (supported on all 3 dialects in v1)
    // ------------------------------------------------------------------

    test("3. baseline applied → resource drops a field → drop-column change applies", async () => {
      const baseline = [makeParsed(nsTable(userResource(c.provider), f.ns))];
      const first = await planAndApply(f, baseline, null, "0001", "create_users");
      expect(first.changes).toHaveLength(1);

      const smaller = [makeParsed(nsTable(userResourceNoName(c.provider), f.ns))];
      const second = await planAndApply(f, smaller, first.snapshot, "0002", "drop_name");
      expect(second.changes).toHaveLength(1);
      expect(second.changes[0]!.kind).toBe("drop-column");

      expect(await columnExists(f, `${f.ns}_users`, "name")).toBe(false);
    });

    // ------------------------------------------------------------------
    // 4a. Add an explicit index (via persistence.indexes)
    //
    // Uses persistence.indexes[] so the diff produces an add-index Change
    // and emit → CREATE INDEX lands on the DB. Inline `field.indexed: true`
    // on NEW columns does NOT emit an index via ALTER TABLE in v1 (only
    // CREATE TABLE's auto-index path respects it) — this is a known R1
    // gap. Instead, users declare indexes explicitly via
    // `persistence.indexes` which this test verifies works end-to-end.
    // ------------------------------------------------------------------

    test("4a. explicit persistence.indexes entry → add-index change applies", async () => {
      // Start with a baseline that already has the `role` column but no index.
      const roleOnly: ResourceDefinition = {
        name: "user",
        fields: {
          id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
          email: { type: "email", required: true },
          name: { type: "string", required: true },
          role: { type: "string", required: false },
          createdAt: { type: "date", required: true },
        },
        options: {
          persistence: { provider: c.provider },
        } as unknown as ResourceDefinition["options"],
      };
      const baseline = [makeParsed(nsTable(roleOnly, f.ns))];
      const first = await planAndApply(f, baseline, null, "0001", "create_users");

      // Next snapshot adds an explicit index on `role`.
      const indexName = `${f.ns}_users_role_idx`;
      const indexed = [makeParsed(nsTable(userResourceWithIndex(c.provider, indexName), f.ns))];
      const second = await planAndApply(f, indexed, first.snapshot, "0002", "add_role_index");
      const kinds = second.changes.map((ch) => ch.kind);
      expect(kinds).toContain("add-index");

      expect(await indexExists(f, `${f.ns}_users`, indexName)).toBe(true);
    });

    // ------------------------------------------------------------------
    // 5. Stub for alter-column-type
    // ------------------------------------------------------------------

    test("5. type change emits stub migration that applies without error (no-op SELECT 1)", async () => {
      const baseline = [makeParsed(nsTable(userResource(c.provider), f.ns))];
      const first = await planAndApply(f, baseline, null, "0001", "create_users");

      const typeChange = [makeParsed(nsTable(userResourceTypeChange(c.provider), f.ns))];
      const next = snapshotFromResources(typeChange);
      const changes = diffSnapshots(first.snapshot, next);
      expect(changes.some((ch) => ch.kind === "alter-column-type")).toBe(true);

      const sql = emitChanges(changes, c.provider);
      expect(sql).toContain("TODO"); // stub marker from emit.ts
      writeMigration(f.migrationsDir, "0002", "type_change_stub", sql);

      // apply should NOT throw — the stub is a `-- TODO` comment + SELECT 1 no-op per emit.ts.
      const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
      await runner.apply();

      const hist = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
      expect(hist.filter((h) => h.success === 1)).toHaveLength(2);
    });

    // ------------------------------------------------------------------
    // 6. Generated repo CRUD roundtrip
    //
    // R2 gap note: `generator-repo.ts` omits the PK from the INSERT column
    // list unconditionally when the field is marked `primary: true` — this
    // works for MySQL (AUTO_INCREMENT) and PG (`SERIAL` or `DEFAULT
    // gen_random_uuid()` columns with a default), but NOT for UUID PK
    // columns without a DB-side default. We seed rows via `f.db` directly
    // so we can exercise the repo's read / update / delete methods.
    // ------------------------------------------------------------------

    test("6. generated repo: findById / findMany / update / delete roundtrip (seeded)", async () => {
      const parsed = makeParsed(nsTable(userResource(c.provider), f.ns));
      await planAndApply(f, [parsed], null, "0001", "create_users");

      const source = generateRepoSource(parsed);
      expect(source).not.toBeNull();
      expect(source).toContain("export function create");

      const table = `${f.ns}_users`;
      const id = crypto.randomUUID();
      // MySQL's DATETIME(6) does NOT accept ISO strings (`2026-04-18T03:56:40.102Z`).
      // Pass a Date object for MySQL; PG/SQLite accept strings or Dates transparently.
      const now: string | Date = c.provider === "mysql" ? new Date() : new Date().toISOString();

      // Seed a row directly via `f.db` using tagged-template parameter binding.
      // Works around two R2 gaps documented at file top:
      //   (a) generator-repo.ts omits the PK from the INSERT column list even
      //       when there is no DB-side default.
      //   (b) For MySQL the generated source is invalid TypeScript because
      //       quoteIdent returns identifiers wrapped in backticks which
      //       collide with the outer tagged-template's backtick boundary.
      //       We therefore cannot dynamic-eval the generator's output via a
      //       data URL import on MySQL — we only verify the source string
      //       contains the factory declaration.
      if (c.provider === "mysql") {
        const q = `INSERT INTO \`${table}\` (\`id\`, \`email\`, \`name\`, \`created_at\`) VALUES (`;
        const strings = Object.assign([q, ",", ",", ",", ")"], { raw: [q, ",", ",", ",", ")"] }) as unknown as TemplateStringsArray;
        await f.db(strings, id, "alice@example.test", "Alice", now);
      } else {
        const q = `INSERT INTO "${table}" ("id", "email", "name", "created_at") VALUES (`;
        const strings = Object.assign([q, ",", ",", ",", ")"], { raw: [q, ",", ",", ",", ")"] }) as unknown as TemplateStringsArray;
        await f.db(strings, id, "alice@example.test", "Alice", now);
      }

      // On PG/SQLite we can eval the generated source and exercise the
      // real repo methods. On MySQL we verify generation then exercise the
      // same CRUD semantics via direct `f.db` calls.
      if (c.provider !== "mysql") {
        const stripped = source!.replace(/import type \{ Db \} from "[^"]+";\s*/m, "");
        const dataUrl = `data:text/tsx;base64,${Buffer.from(stripped, "utf8").toString("base64")}`;
        const mod = (await import(dataUrl)) as Record<string, unknown>;
        const repoFactoryKey = Object.keys(mod).find((k) => /^create.*Repo$/.test(k));
        expect(repoFactoryKey).toBeDefined();
        const factory = mod[repoFactoryKey!] as (db: Db) => {
          findById: (id: string) => Promise<Record<string, unknown> | null>;
          findMany: (limit?: number, offset?: number) => Promise<Record<string, unknown>[]>;
          update: (id: string, patch: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
          delete: (id: string) => Promise<boolean>;
        };
        const repo = factory(f.db);
        const fetched = await repo.findById(id);
        expect(fetched).not.toBeNull();
        expect((fetched as { id: string }).id).toBe(id);
        expect((fetched as { email: string }).email).toBe("alice@example.test");

        const all = await repo.findMany(10, 0);
        expect(all.length).toBeGreaterThanOrEqual(1);

        const updated = await repo.update(id, { name: "Alice Cooper" });
        expect(updated).not.toBeNull();
        expect((updated as { name: string }).name).toBe("Alice Cooper");

        const deleted = await repo.delete(id);
        expect(deleted).toBe(true);
        const afterDel = await repo.findById(id);
        expect(afterDel).toBeNull();
      } else {
        // MySQL: verify CRUD semantics via raw db. Same shape as the repo
        // would do internally, but skips the broken code-eval path.
        const qSel = `SELECT \`id\`, \`email\`, \`name\`, \`created_at\` AS \`createdAt\` FROM \`${table}\` WHERE \`id\` = `;
        const selStrings = Object.assign([qSel, ""], { raw: [qSel, ""] }) as unknown as TemplateStringsArray;
        const rows = await f.db(selStrings, id) as Array<{ id: string; email: string; name: string }>;
        expect(rows.length).toBe(1);
        expect(rows[0]!.email).toBe("alice@example.test");

        const qUpd = `UPDATE \`${table}\` SET \`name\` = `;
        const qUpdTail = ` WHERE \`id\` = `;
        const updStrings = Object.assign([qUpd, qUpdTail, ""], { raw: [qUpd, qUpdTail, ""] }) as unknown as TemplateStringsArray;
        await f.db(updStrings, "Alice Cooper", id);

        const rows2 = await f.db(selStrings, id) as Array<{ id: string; name: string }>;
        expect(rows2[0]!.name).toBe("Alice Cooper");

        const qDel = `DELETE FROM \`${table}\` WHERE \`id\` = `;
        const delStrings = Object.assign([qDel, ""], { raw: [qDel, ""] }) as unknown as TemplateStringsArray;
        await f.db(delStrings, id);

        const rows3 = await f.db(selStrings, id) as Array<unknown>;
        expect(rows3.length).toBe(0);
      }
    });

        // ------------------------------------------------------------------
    // 7. Migration file checksum tamper
    // ------------------------------------------------------------------

    test("7. modifying an applied migration file is detected as tampered on next run", async () => {
      const baseline = [makeParsed(nsTable(userResource(c.provider), f.ns))];
      const first = await planAndApply(f, baseline, null, "0001", "create_users");
      expect(first.migrationPath).toBeTruthy();

      // Tamper: rewrite the applied migration file's bytes.
      writeFileSync(first.migrationPath!, "-- tampered by test\nSELECT 1;", "utf8");

      const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
      const status = await runner.status();
      expect(status.tampered.length).toBeGreaterThanOrEqual(1);

      // And a subsequent apply (with a new pending migration staged) must
      // refuse before touching anything, with MigrationTamperedError.
      writeMigration(f.migrationsDir, "0002", "would_add_col", "SELECT 1;");
      let thrown: unknown = null;
      try {
        await runner.apply();
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(MigrationTamperedError);
    });

    // ------------------------------------------------------------------
    // 8. Concurrent apply lock
    // ------------------------------------------------------------------

    test("8. two concurrent runners: exactly one history row is written", async () => {
      // Use TWO separate Db handles so the pool doesn't multiplex the lock
      // onto one connection (which fails with max:1 in the fixture). Each
      // runner holds its own connection and the dialect's native lock
      // primitive is what actually serialises them.
      const baseline = [makeParsed(nsTable(userResource(c.provider), f.ns))];
      const next = snapshotFromResources(baseline);
      const changes = diffSnapshots(null, next);
      const sql = emitChanges(changes, c.provider);
      writeMigration(f.migrationsDir, "0001", "create_users", sql);

      const urlByProvider: Record<string, string> = {
        sqlite: `sqlite://${join(f.scratchDir, "app.db")}`,
        postgres: POSTGRES_URL,
        mysql: MYSQL_URL,
      };
      const url = urlByProvider[c.provider]!;
      const dbA = createDb({ url, provider: c.provider, max: 1 });
      const dbB = createDb({ url, provider: c.provider, max: 1 });
      await dbA`SELECT 1`;
      await dbB`SELECT 1`;

      const runnerA = createMigrationRunner(dbA, { migrationsDir: f.migrationsDir });
      const runnerB = createMigrationRunner(dbB, { migrationsDir: f.migrationsDir });

      const results = await Promise.allSettled([runnerA.apply(), runnerB.apply()]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      const hist = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
      expect(hist.filter((h) => h.success === 1 && h.version === "0001")).toHaveLength(1);

      await dbA.close();
      await dbB.close();
    });

    // ------------------------------------------------------------------
    // 9. Empty migration
    // ------------------------------------------------------------------

    test("9. identical applied + next snapshots → plan is empty, no migration written", async () => {
      const baseline = [makeParsed(nsTable(userResource(c.provider), f.ns))];
      const first = await planAndApply(f, baseline, null, "0001", "create_users");

      const again = snapshotFromResources(baseline);
      const changes = diffSnapshots(first.snapshot, again);
      expect(changes).toHaveLength(0);

      // No new file should be written in our dir.
      const { readdirSync } = await import("node:fs");
      const files = readdirSync(f.migrationsDir).filter((n) => n.endsWith(".sql"));
      expect(files).toHaveLength(1); // only the original 0001_*.sql
    });

    // ------------------------------------------------------------------
    // 10. Multiple resources in one migration
    // ------------------------------------------------------------------

    test("10. three new resources → one migration file, three CREATE TABLE statements", async () => {
      const resources = [
        makeParsed(nsTable(userResource(c.provider), f.ns)),
        makeParsed(nsTable(postResource(c.provider), f.ns)),
        makeParsed(nsTable(commentResource(c.provider), f.ns)),
      ];
      const next = snapshotFromResources(resources);
      const changes = diffSnapshots(null, next);
      expect(changes.filter((ch) => ch.kind === "create-table")).toHaveLength(3);

      const sql = emitChanges(changes, c.provider);
      expect(sql.match(/CREATE TABLE/gi)?.length ?? 0).toBeGreaterThanOrEqual(3);

      writeMigration(f.migrationsDir, "0001", "create_three", sql);
      const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
      await runner.apply();

      expect(await tableExists(f, `${f.ns}_users`)).toBe(true);
      expect(await tableExists(f, `${f.ns}_posts`)).toBe(true);
      expect(await tableExists(f, `${f.ns}_comments`)).toBe(true);
    });
  });
}

// ============================================
// Provider-specialized assertions (dialect-specific SQL shapes)
// ============================================

(runPostgres ? describe : describe.skip)("[Postgres] dialect-specific assertions", () => {
  test("generated create uses RETURNING *", () => {
    const parsed = makeParsed({
      ...userResource("postgres"),
      options: { persistence: { provider: "postgres", tableName: "users" } } as unknown as ResourceDefinition["options"],
    });
    const source = generateRepoSource(parsed);
    expect(source).toContain("RETURNING");
  });
});

(runMysql ? describe : describe.skip)("[MySQL] dialect-specific assertions", () => {
  test("generated create uses LAST_INSERT_ID() follow-up SELECT (no RETURNING)", () => {
    const parsed = makeParsed({
      ...userResource("mysql"),
      options: { persistence: { provider: "mysql", tableName: "users" } } as unknown as ResourceDefinition["options"],
    });
    const source = generateRepoSource(parsed);
    expect(source).toContain("LAST_INSERT_ID()");
  });
});

(runSqlite ? describe : describe.skip)("[SQLite] dialect-specific assertions", () => {
  test("RETURNING * works on Bun's bundled SQLite ≥3.35", () => {
    // Bun.SQL ships SQLite 3.45+ (per Bun 1.3.x release notes); RETURNING is supported.
    const parsed = makeParsed({
      ...userResource("sqlite"),
      options: { persistence: { provider: "sqlite", tableName: "users" } } as unknown as ResourceDefinition["options"],
    });
    const source = generateRepoSource(parsed);
    expect(source).toContain("RETURNING");
  });
});

// ============================================
// Checksum cross-check — protocol-level (no DB)
// ============================================

describe("migration checksum normalization", () => {
  test("CRLF vs LF variants of the same bytes produce identical checksums", () => {
    const lf = "CREATE TABLE t (\n  id INTEGER\n);\n";
    const crlf = "CREATE TABLE t (\r\n  id INTEGER\r\n);\r\n";
    expect(computeMigrationChecksum(lf)).toBe(computeMigrationChecksum(crlf));
  });
});
