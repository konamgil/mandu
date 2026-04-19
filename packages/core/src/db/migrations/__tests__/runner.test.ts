/**
 * @mandujs/core/db/migrations — runner integration tests
 *
 * These tests hit the REAL `Bun.SQL` SQLite (in-memory + tmpdir-backed)
 * adapter so the full path — tagged-template parameter binding, WAL
 * semantics, transaction rollback, BEGIN IMMEDIATE locks — gets
 * exercised. No mocks.
 *
 * We use a gate to skip cleanly when run under a Bun build that lacks
 * `Bun.SQL` (matches the pattern in `tests/db/db-sqlite.test.ts`). On
 * the CI target (Bun 1.3.x) every test runs.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDb, type Db } from "../../index";
import {
  DEFAULT_HISTORY_TABLE,
  historyTableDdl,
  readAllHistory,
} from "../history-table";
import {
  MigrationTamperedError,
  MigrationTimeoutError,
  computeMigrationChecksum,
  createMigrationRunner,
  splitStatements,
} from "../runner";

// ─── Gate ───────────────────────────────────────────────────────────────────

const hasBunSql = (() => {
  const g = globalThis as unknown as { Bun?: { SQL?: unknown } };
  return typeof g.Bun?.SQL === "function";
})();

const describeIfBunSql = hasBunSql ? describe : describe.skip;

// ─── Fixture helpers ────────────────────────────────────────────────────────

interface Fixture {
  db: Db;
  dbPath: string;
  scratchDir: string;
  migrationsDir: string;
}

async function setupFixture(): Promise<Fixture> {
  const scratchDir = mkdtempSync(join(tmpdir(), "mandu-migrations-"));
  const migrationsDir = join(scratchDir, "migrations");
  // Create the dir up-front — matches what Agent E's CLI will do.
  await writeFile(join(scratchDir, ".gitkeep"), "");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(migrationsDir, { recursive: true });

  const dbPath = join(scratchDir, "app.db");
  const db = createDb({ url: `sqlite://${dbPath}` });
  // Kick the lazy init.
  await db`SELECT 1`;
  return { db, dbPath, scratchDir, migrationsDir };
}

async function teardownFixture(f: Fixture): Promise<void> {
  try {
    await f.db.close();
  } catch {
    /* already closed */
  }
  rmSync(f.scratchDir, { recursive: true, force: true });
}

function writeMigration(
  dir: string,
  filename: string,
  sql: string,
): string {
  const fullPath = join(dir, filename);
  writeFileSync(fullPath, sql, "utf8");
  return fullPath;
}

// ─── Checksum unit tests (no DB) ────────────────────────────────────────────

describe("computeMigrationChecksum", () => {
  it("normalises CRLF to LF before hashing — CRLF and LF produce the same digest", () => {
    const lf = computeMigrationChecksum("abc\n");
    const crlf = computeMigrationChecksum("abc\r\n");
    expect(lf).toBe(crlf);
  });

  it("is deterministic: identical input → identical digest", () => {
    const sql = "CREATE TABLE t (id INTEGER);\nINSERT INTO t VALUES (1);\n";
    expect(computeMigrationChecksum(sql)).toBe(computeMigrationChecksum(sql));
  });

  it("produces a 64-char lowercase hex SHA-256 digest", () => {
    const digest = computeMigrationChecksum("hello world");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for even-a-single-byte mutation (whitespace preserved)", () => {
    const a = computeMigrationChecksum("CREATE TABLE t (id INTEGER);");
    const b = computeMigrationChecksum("CREATE TABLE t (id INTEGER); ");
    expect(a).not.toBe(b);
  });
});

// ─── Statement splitter unit tests ──────────────────────────────────────────

describe("splitStatements", () => {
  it("returns a single statement when no trailing semicolons exist", () => {
    expect(splitStatements("CREATE TABLE t (id INTEGER)")).toEqual([
      "CREATE TABLE t (id INTEGER)",
    ]);
  });

  it("splits two SQL statements separated by end-of-line semicolons", () => {
    const sql = "CREATE TABLE a (x INTEGER);\nCREATE INDEX idx ON a(x);";
    expect(splitStatements(sql)).toEqual([
      "CREATE TABLE a (x INTEGER)",
      "CREATE INDEX idx ON a(x)",
    ]);
  });

  it("drops empty statements between semicolons", () => {
    const sql = "CREATE TABLE a (x INTEGER);\n\n;\n";
    expect(splitStatements(sql)).toEqual(["CREATE TABLE a (x INTEGER)"]);
  });

  it("preserves inline comments within a statement", () => {
    const sql = "-- header\nCREATE TABLE a (x INTEGER); -- trailing\n";
    const out = splitStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("header");
    expect(out[0]).toContain("CREATE TABLE");
  });
});

// ─── historyTableDdl per-dialect verification ───────────────────────────────

describe("historyTableDdl", () => {
  it("emits TIMESTAMPTZ + double-quoted identifiers for Postgres", () => {
    const ddl = historyTableDdl(DEFAULT_HISTORY_TABLE, "postgres");
    expect(ddl).toContain('"__mandu_migrations"');
    expect(ddl).toContain("TIMESTAMPTZ");
    expect(ddl).toMatch(/"version"\s+TEXT\s+PRIMARY KEY/);
  });

  it("emits DATETIME(6) + backtick-quoted identifiers for MySQL", () => {
    const ddl = historyTableDdl(DEFAULT_HISTORY_TABLE, "mysql");
    expect(ddl).toContain("`__mandu_migrations`");
    expect(ddl).toContain("DATETIME(6)");
    expect(ddl).toContain("VARCHAR(50) NOT NULL");
    expect(ddl).toContain("PRIMARY KEY (`version`)");
  });

  it("emits TEXT timestamps + double-quoted identifiers for SQLite", () => {
    const ddl = historyTableDdl(DEFAULT_HISTORY_TABLE, "sqlite");
    expect(ddl).toContain('"__mandu_migrations"');
    expect(ddl).toMatch(/"applied_at"\s+TEXT\s+NOT NULL/);
  });

  it("rejects unsafe identifiers (SQL-injection guard)", () => {
    expect(() => historyTableDdl("bad; DROP TABLE users", "sqlite")).toThrow(
      /Invalid identifier/,
    );
  });
});

// ─── Full runner integration ────────────────────────────────────────────────

describeIfBunSql("createMigrationRunner — integration", () => {
  let f: Fixture;

  beforeEach(async () => {
    f = await setupFixture();
  });

  afterEach(async () => {
    await teardownFixture(f);
  });

  it("ensureHistoryTable() is idempotent — calling twice is a no-op", async () => {
    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    await runner.ensureHistoryTable();
    await runner.ensureHistoryTable();
    // Sanity — table exists and is queryable.
    const rows = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
    expect(rows).toEqual([]);
  });

  it("plan() on empty dir + empty history returns []", async () => {
    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const pending = await runner.plan();
    expect(pending).toEqual([]);
  });

  it("plan() returns pending migrations sorted by version, ignoring already-applied", async () => {
    writeMigration(f.migrationsDir, "0001_one.sql", "CREATE TABLE a (id INTEGER);");
    writeMigration(f.migrationsDir, "0002_two.sql", "CREATE TABLE b (id INTEGER);");
    writeMigration(f.migrationsDir, "0003_three.sql", "CREATE TABLE c (id INTEGER);");

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    // Pre-seed history as if 0001 was already applied.
    await runner.ensureHistoryTable();
    await f.db`INSERT INTO "__mandu_migrations"
      (version, filename, checksum, applied_at, execution_ms, success, installed_by)
      VALUES (${"0001"}, ${"0001_one.sql"},
              ${computeMigrationChecksum("CREATE TABLE a (id INTEGER);")},
              ${new Date().toISOString()}, ${0}, ${1}, ${"test"})`;

    const pending = await runner.plan();
    expect(pending.map((p) => p.version)).toEqual(["0002", "0003"]);
  });

  it("plan() ignores non-.sql files silently", async () => {
    writeMigration(f.migrationsDir, "0001_valid.sql", "CREATE TABLE t (id INTEGER);");
    writeMigration(f.migrationsDir, "README.md", "# notes");
    writeMigration(f.migrationsDir, "0002_also_valid.sql", "CREATE TABLE u (id INTEGER);");

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const pending = await runner.plan();
    expect(pending.map((p) => p.version)).toEqual(["0001", "0002"]);
  });

  it("plan() warns and skips .sql files that do not match NNNN_description.sql", async () => {
    writeMigration(f.migrationsDir, "0001_ok.sql", "CREATE TABLE a (id INTEGER);");
    writeMigration(f.migrationsDir, "not_a_migration.sql", "SELECT 1;");
    writeMigration(f.migrationsDir, "also-bad.sql", "SELECT 1;");

    // Capture the warn so the test output stays clean.
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };
    try {
      const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
      const pending = await runner.plan();
      expect(pending.map((p) => p.version)).toEqual(["0001"]);
      expect(warns.some((m) => m.includes("not_a_migration.sql"))).toBe(true);
      expect(warns.some((m) => m.includes("also-bad.sql"))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it("plan() throws when two files share the same version prefix", async () => {
    writeMigration(f.migrationsDir, "0001_first.sql", "SELECT 1;");
    writeMigration(f.migrationsDir, "0001_conflict.sql", "SELECT 2;");

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    await expect(runner.plan()).rejects.toThrow(/Duplicate migration version/);
  });

  it("apply() happy path: applies all pending, writes history, plan() becomes empty", async () => {
    writeMigration(
      f.migrationsDir,
      "0001_create_users.sql",
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);",
    );
    writeMigration(
      f.migrationsDir,
      "0002_create_posts.sql",
      "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER);",
    );

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const applied = await runner.apply();
    expect(applied.map((a) => a.version)).toEqual(["0001", "0002"]);
    expect(applied.every((a) => a.success === true)).toBe(true);

    const afterPlan = await runner.plan();
    expect(afterPlan).toEqual([]);

    const history = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
    expect(history).toHaveLength(2);
    expect(history[0]!.version).toBe("0001");
    expect(history[1]!.version).toBe("0002");

    // Sanity — the migrations actually took effect.
    const tables = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `;
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(["posts", "users"]),
    );
  });

  it("apply({ dryRun: true }) does NOT execute SQL and does NOT insert history", async () => {
    writeMigration(
      f.migrationsDir,
      "0001_side_effect.sql",
      "CREATE TABLE should_not_exist (id INTEGER);",
    );

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const preview = await runner.apply({ dryRun: true });
    expect(preview).toHaveLength(1);
    expect(preview[0]!.version).toBe("0001");
    expect(preview[0]!.success).toBe(false); // dry-run marker

    // Table must not exist and history must be empty.
    const tables = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'should_not_exist'
    `;
    expect(tables).toEqual([]);

    const history = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
    expect(history).toEqual([]);
  });

  it("apply() on a file with a syntax error: rolls back, no history row, throws with filename", async () => {
    writeMigration(
      f.migrationsDir,
      "0001_good.sql",
      "CREATE TABLE good (id INTEGER);",
    );
    writeMigration(
      f.migrationsDir,
      "0002_bad.sql",
      "CREATE TABLE bad (id INTEGER); INSERT INTO this_table_does_not_exist VALUES (1);",
    );

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    let caught: unknown = null;
    try {
      await runner.apply();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/0002_bad\.sql/);

    // 0001 succeeded, 0002 left no trace.
    const history = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
    expect(history.map((h) => h.version)).toEqual(["0001"]);

    // The `bad` table from 0002 must NOT exist — tx rolled back.
    const badTable = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'bad'
    `;
    expect(badTable).toEqual([]);

    // The `good` table from 0001 IS there.
    const goodTable = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'good'
    `;
    expect(goodTable).toHaveLength(1);
  });

  it("plan() does NOT include a file that has a history row, even if checksum mismatches", async () => {
    const originalSql = "CREATE TABLE x (id INTEGER);";
    writeMigration(f.migrationsDir, "0001_x.sql", originalSql);

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    await runner.ensureHistoryTable();

    // Apply then rewrite the file to break the checksum.
    await runner.apply();
    writeMigration(f.migrationsDir, "0001_x.sql", "CREATE TABLE x (id INTEGER, new_col TEXT);");

    const pending = await runner.plan();
    expect(pending).toEqual([]); // history wins; file is not "pending"

    // But status() surfaces the tamper.
    const status = await runner.status();
    expect(status.tampered).toHaveLength(1);
    expect(status.tampered[0]!.filename).toBe("0001_x.sql");
  });

  it("status() reports tampered after file modification", async () => {
    writeMigration(f.migrationsDir, "0001_init.sql", "CREATE TABLE t1 (id INTEGER);");

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    await runner.apply();

    // Tamper: rewrite the migration content.
    writeMigration(f.migrationsDir, "0001_init.sql", "CREATE TABLE t1 (id INTEGER, extra TEXT);");
    // Force mtime bump so some filesystems update the stat promptly.
    const newTime = new Date();
    utimesSync(join(f.migrationsDir, "0001_init.sql"), newTime, newTime);

    const status = await runner.status();
    expect(status.tampered).toHaveLength(1);
    expect(status.tampered[0]!.version).toBe("0001");
    expect(status.tampered[0]!.storedChecksum).not.toBe(
      status.tampered[0]!.currentChecksum,
    );
  });

  it("apply() throws MigrationTamperedError when a prior row's file has been mutated", async () => {
    writeMigration(f.migrationsDir, "0001_a.sql", "CREATE TABLE a (id INTEGER);");
    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    await runner.apply();

    // Mutate + add a new pending migration.
    writeMigration(f.migrationsDir, "0001_a.sql", "CREATE TABLE a (id INTEGER, x TEXT);");
    writeMigration(f.migrationsDir, "0002_b.sql", "CREATE TABLE b (id INTEGER);");

    await expect(runner.apply()).rejects.toBeInstanceOf(MigrationTamperedError);
  });

  it("status() surfaces applied + pending + tampered + orphaned simultaneously", async () => {
    writeMigration(f.migrationsDir, "0001_applied.sql", "CREATE TABLE a (id INTEGER);");
    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    await runner.apply();

    // Now introduce: (1) a pending file, (2) tamper on applied, (3) an
    // orphaned history row pointing at a now-deleted version.
    writeMigration(f.migrationsDir, "0002_pending.sql", "CREATE TABLE b (id INTEGER);");
    writeMigration(f.migrationsDir, "0001_applied.sql", "CREATE TABLE a (id INTEGER, mod TEXT);");

    // Insert an orphan history row directly.
    await f.db`INSERT INTO "__mandu_migrations"
      (version, filename, checksum, applied_at, execution_ms, success, installed_by)
      VALUES (${"9999"}, ${"9999_deleted.sql"},
              ${"deadbeef".repeat(8)}, ${new Date().toISOString()}, ${0}, ${1}, ${"test"})`;

    const status = await runner.status();
    expect(status.applied.map((a) => a.version).sort()).toEqual(["0001", "9999"]);
    expect(status.pending.map((p) => p.version)).toEqual(["0002"]);
    expect(status.tampered.map((t) => t.version)).toEqual(["0001"]);
    expect(status.orphaned.map((o) => o.filename)).toEqual(["9999_deleted.sql"]);
  });

  it("apply() on multi-statement file (CREATE TABLE + CREATE INDEX) executes all statements", async () => {
    writeMigration(
      f.migrationsDir,
      "0001_multi.sql",
      `CREATE TABLE items (id INTEGER PRIMARY KEY, slug TEXT);
CREATE INDEX items_slug_idx ON items (slug);`,
    );

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const applied = await runner.apply();
    expect(applied).toHaveLength(1);

    const indexes = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'items_slug_idx'
    `;
    expect(indexes).toHaveLength(1);
  });

  it("concurrent apply() calls: second runner waits / fails rather than clobbering", async () => {
    writeMigration(
      f.migrationsDir,
      "0001_slow.sql",
      "CREATE TABLE slow (id INTEGER);",
    );

    // Two runners, same DB handle. SQLite BEGIN IMMEDIATE on the same
    // connection errors immediately for the second acquirer ("cannot
    // start a transaction within a transaction"), which is exactly
    // the serialisation behaviour we want — the second call fails fast
    // rather than silently interleaving.
    const runnerA = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const runnerB = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });

    const results = await Promise.allSettled([runnerA.apply(), runnerB.apply()]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    // Final state: exactly one history row for 0001 (the other call
    // either waited and found it applied, or errored mid-lock).
    const history = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
    expect(history.filter((h) => h.version === "0001")).toHaveLength(1);
  });

  it("dispose() releases held lock and is idempotent (no-op on second call)", async () => {
    writeMigration(f.migrationsDir, "0001_init.sql", "CREATE TABLE d (id INTEGER);");

    const runner = createMigrationRunner(f.db, {
      migrationsDir: f.migrationsDir,
      // "none" so we can safely call dispose() without depending on
      // transaction state from BEGIN IMMEDIATE.
      lockStrategy: "none",
    });
    await runner.apply();
    await runner.dispose();
    await runner.dispose(); // must not throw
    expect(true).toBe(true);
  });

  it("first operation auto-runs ensureHistoryTable when user forgot", async () => {
    writeMigration(f.migrationsDir, "0001_auto.sql", "CREATE TABLE auto (id INTEGER);");

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    // Skip ensureHistoryTable() — plan() should auto-initialise.
    const pending = await runner.plan();
    expect(pending.map((p) => p.version)).toEqual(["0001"]);

    // History table now exists.
    const rows = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("custom historyTable override flows through ensureHistoryTable/plan/apply/status", async () => {
    writeMigration(f.migrationsDir, "0001_custom.sql", "CREATE TABLE c1 (id INTEGER);");

    const runner = createMigrationRunner(f.db, {
      migrationsDir: f.migrationsDir,
      historyTable: "project_migrations",
    });
    await runner.apply();

    // The default table is NOT created.
    const defaultTbl = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__mandu_migrations'
    `;
    expect(defaultTbl).toEqual([]);

    // The custom one IS.
    const customTbl = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_migrations'
    `;
    expect(customTbl).toHaveLength(1);

    // And reads use the override.
    const rows = await readAllHistory(f.db, "project_migrations");
    expect(rows.map((r) => r.version)).toEqual(["0001"]);
  });

  it("installed_by defaults to MANDU_MIGRATION_USER env var when set", async () => {
    writeMigration(f.migrationsDir, "0001_who.sql", "CREATE TABLE who (id INTEGER);");

    const prev = process.env.MANDU_MIGRATION_USER;
    process.env.MANDU_MIGRATION_USER = "ci-bot";
    try {
      const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
      await runner.apply();
      const rows = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
      expect(rows[0]!.installed_by).toBe("ci-bot");
    } finally {
      if (prev === undefined) delete process.env.MANDU_MIGRATION_USER;
      else process.env.MANDU_MIGRATION_USER = prev;
    }
  });

  it("installed_by falls back to 'mandu' when the env var is unset", async () => {
    writeMigration(f.migrationsDir, "0001_fallback.sql", "CREATE TABLE f (id INTEGER);");

    const prev = process.env.MANDU_MIGRATION_USER;
    delete process.env.MANDU_MIGRATION_USER;
    try {
      const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
      await runner.apply();
      const rows = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
      expect(rows[0]!.installed_by).toBe("mandu");
    } finally {
      if (prev !== undefined) process.env.MANDU_MIGRATION_USER = prev;
    }
  });

  it("plan() returns freshly-computed checksums (does NOT cache across calls)", async () => {
    writeMigration(f.migrationsDir, "0001_v.sql", "CREATE TABLE v (id INTEGER);");

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const plan1 = await runner.plan();
    const checksum1 = plan1[0]!.checksum;

    writeMigration(f.migrationsDir, "0001_v.sql", "CREATE TABLE v (id INTEGER, more TEXT);");
    const plan2 = await runner.plan();
    const checksum2 = plan2[0]!.checksum;

    expect(checksum1).not.toBe(checksum2);
  });

  it("apply() on an empty migrations directory returns [] without errors", async () => {
    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const applied = await runner.apply();
    expect(applied).toEqual([]);
  });

  it("apply() is a no-op when everything is already applied", async () => {
    writeMigration(f.migrationsDir, "0001_noop.sql", "CREATE TABLE n (id INTEGER);");

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const first = await runner.apply();
    expect(first).toHaveLength(1);
    const second = await runner.apply();
    expect(second).toEqual([]);
  });

  it("applyTimeoutMs of 1ms aborts a file whose cumulative SQL runs longer", async () => {
    // Force a timeout by using `applyTimeoutMs = 1` and a migration with
    // enough statements that cumulative execution reliably crosses 1 ms
    // on any hardware. The previous 3-statement version (total ~0.3-1.5
    // ms on fast in-memory SQLite) could finish within the 1 ms budget
    // and leave the expected `MigrationTimeoutError` unthrown on ~40 %
    // of isolated runs. 120 small `CREATE TABLE` statements clear 1 ms
    // by a wide margin on every target — observed ~2-8 ms on the
    // current test boxes.
    const statementCount = 120;
    const sqlBlock = Array.from(
      { length: statementCount },
      (_, i) => `CREATE TABLE slow${i} (id INTEGER);`,
    ).join("\n");
    writeMigration(f.migrationsDir, "0001_timeout.sql", sqlBlock);

    const runner = createMigrationRunner(f.db, {
      migrationsDir: f.migrationsDir,
      applyTimeoutMs: 1,
    });

    let err: unknown = null;
    try {
      await runner.apply();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MigrationTimeoutError);
    expect((err as MigrationTimeoutError).filename).toBe("0001_timeout.sql");

    // No history row for the timed-out migration.
    const rows = await readAllHistory(f.db, DEFAULT_HISTORY_TABLE);
    expect(rows).toEqual([]);

    // Tables rolled back.
    const tables = await f.db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'slow%'
    `;
    expect(tables).toEqual([]);
  });

  it("MigrationTamperedError exposes filename + both checksums", async () => {
    writeMigration(f.migrationsDir, "0001_t.sql", "CREATE TABLE t (id INTEGER);");
    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    await runner.apply();

    writeMigration(f.migrationsDir, "0001_t.sql", "CREATE TABLE t (id INTEGER, ex TEXT);");

    let err: unknown = null;
    try {
      await runner.apply();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MigrationTamperedError);
    const mte = err as MigrationTamperedError;
    expect(mte.filename).toBe("0001_t.sql");
    expect(mte.storedChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(mte.currentChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(mte.storedChecksum).not.toBe(mte.currentChecksum);
  });

  it("applied migrations carry strict checksum + execution_ms + appliedAt values", async () => {
    writeMigration(f.migrationsDir, "0001_x.sql", "CREATE TABLE x (id INTEGER);");

    const runner = createMigrationRunner(f.db, { migrationsDir: f.migrationsDir });
    const applied = await runner.apply();
    expect(applied).toHaveLength(1);
    const a = applied[0]!;
    expect(a.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof a.executionMs).toBe("number");
    expect(a.executionMs).toBeGreaterThanOrEqual(0);
    expect(a.appliedAt).toBeInstanceOf(Date);
    expect(a.success).toBe(true);
  });
});
