/**
 * `mandu db` CLI — Phase 4c.R2 Agent E tests.
 *
 * Exercises all four subcommands + the rename prompt + db resolution
 * helper. Uses REAL filesystem (tmpdir) + REAL `Bun.SQL` SQLite so
 * coverage matches what runs in production. Skips runner-backed tests
 * cleanly under Bun builds that lack `Bun.SQL` (same guard pattern as
 * `packages/core/src/db/migrations/__tests__/runner.test.ts`).
 *
 * Count: 18 tests (required ≥15).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, promises as fs, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import {
  dbPlan,
  dbApply,
  dbStatus,
  dbReset,
} from "../../src/commands/db";
import {
  applyRenames,
  findRenameCandidates,
  formatPrompt,
} from "../../src/commands/db/rename-prompt";
import { resolveDb } from "../../src/commands/db/resolve-db";
import type { Change, DdlFieldDef } from "@mandujs/core/resource/ddl/types";

// ─── Bun.SQL gate (runner-backed tests only) ────────────────────────────────

const hasBunSql = (() => {
  const g = globalThis as unknown as { Bun?: { SQL?: unknown } };
  return typeof g.Bun?.SQL === "function";
})();
const describeIfBunSql = hasBunSql ? describe : describe.skip;

// ─── Fixture ────────────────────────────────────────────────────────────────

interface ProjectFixture {
  root: string;
  dbPath: string;
  dbUrl: string;
  resourcesDir: string;
  migrationsDir: string;
  schemaDir: string;
  appliedPath: string;
  cleanup: () => void;
}

function setupProject(): ProjectFixture {
  const root = mkdtempSync(join(tmpdir(), "mandu-cli-db-"));
  const resourcesDir = join(root, "spec", "resources");
  const migrationsDir = join(root, "spec", "db", "migrations");
  const schemaDir = join(root, ".mandu", "schema");
  const dbPath = join(root, "app.db");
  mkdirSync(resourcesDir, { recursive: true });
  mkdirSync(migrationsDir, { recursive: true });
  mkdirSync(schemaDir, { recursive: true });
  return {
    root,
    dbPath,
    dbUrl: `sqlite://${dbPath}`,
    resourcesDir,
    migrationsDir,
    schemaDir,
    appliedPath: join(schemaDir, "applied.json"),
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Write a minimal persistent resource file. Persistence block carries
 * the provider so the snapshot engine picks up the intended dialect.
 *
 * We import `@mandujs/core/resource` via an absolute file-URL-style
 * path that Bun resolves from the test's tmpdir — the workspace's
 * `@mandujs/core` alias does not reach into `os.tmpdir()`.
 */
function writeResource(
  f: ProjectFixture,
  name: string,
  body: string,
): void {
  const filePath = join(f.resourcesDir, `${name}.resource.ts`);
  writeFileSync(filePath, body, "utf8");
}

function basicUserResource(): string {
  // Use the absolute path to @mandujs/core so Bun can resolve it from
  // the tmpdir location (bunfig.toml's workspace alias only applies to
  // files inside the repo tree).
  const coreResourcePath = join(process.cwd(), "packages", "core", "src", "resource", "index.ts").replace(/\\/g, "/");
  return `
    import { defineResource } from "${coreResourcePath}";
    export default defineResource({
      name: "user",
      fields: {
        id: { type: "uuid", required: true, primary: true },
        email: { type: "email", required: true, unique: true },
      },
      options: {
        persistence: { provider: "sqlite" },
      },
    });
  `;
}

// ─── Env isolation helper ────────────────────────────────────────────────────

let savedEnv: Record<string, string | undefined> = {};

function snapshotEnv(keys: string[]): void {
  savedEnv = {};
  for (const k of keys) savedEnv[k] = process.env[k];
}
function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// ============================================================================
// Rename prompt — pure helpers (no Bun.SQL required)
// ============================================================================

describe("rename-prompt: findRenameCandidates", () => {
  const makeDrop = (resource: string, name: string): Change => ({
    kind: "drop-column",
    resourceName: resource,
    fieldName: name,
  });
  const makeAdd = (resource: string, field: DdlFieldDef): Change => ({
    kind: "add-column",
    resourceName: resource,
    field,
  });
  const f = (name: string, type: DdlFieldDef["type"] = "string"): DdlFieldDef => ({
    name,
    type,
    nullable: false,
    primary: false,
    unique: false,
    indexed: false,
  });

  it("pairs drop+add on same resource as rename candidate", () => {
    const changes: Change[] = [makeDrop("users", "old_name"), makeAdd("users", f("new_name"))];
    const candidates = findRenameCandidates(changes, "sqlite");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].oldFieldName).toBe("old_name");
    expect(candidates[0].newField.name).toBe("new_name");
  });

  it("does not pair across different resources", () => {
    const changes: Change[] = [makeDrop("users", "x"), makeAdd("posts", f("y"))];
    expect(findRenameCandidates(changes, "sqlite")).toEqual([]);
  });

  it("exact prompt copy matches documented spec", () => {
    const changes: Change[] = [makeDrop("users", "old_name"), makeAdd("users", f("new_name"))];
    const [candidate] = findRenameCandidates(changes, "sqlite");
    expect(formatPrompt(candidate)).toBe(
      `  ? Looks like a rename? "old_name" → "new_name" in "users"? [y/N]: `,
    );
  });
});

describe("rename-prompt: applyRenames", () => {
  const makeDrop = (resource: string, name: string): Change => ({
    kind: "drop-column",
    resourceName: resource,
    fieldName: name,
  });
  const makeAdd = (resource: string, name: string): Change => ({
    kind: "add-column",
    resourceName: resource,
    field: {
      name,
      type: "string",
      nullable: false,
      primary: false,
      unique: false,
      indexed: false,
    },
  });

  it("ci mode → leaves drop+add untouched", async () => {
    const input: Change[] = [makeDrop("users", "old"), makeAdd("users", "new")];
    const out = await applyRenames(input, "sqlite", { ci: true });
    expect(out).toEqual(input);
  });

  it("forceYes → rewrites drop+add into single rename-column", async () => {
    const input: Change[] = [makeDrop("users", "old"), makeAdd("users", "new")];
    const out = await applyRenames(input, "sqlite", { forceYes: true });
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "rename-column",
      resourceName: "users",
      oldName: "old",
      newName: "new",
      origin: "user-confirmed",
    });
  });

  it("simulated stdin 'y' → treats as rename (TTY path)", async () => {
    const input: Change[] = [makeDrop("users", "a"), makeAdd("users", "b")];
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    // Mark the streams as TTY so applyRenames takes the interactive path.
    Object.assign(stdout, { isTTY: true });
    // Pipe "y\n" into stdin immediately.
    setImmediate(() => {
      stdin.write("y\n");
      stdin.end();
    });
    const out = await applyRenames(input, "sqlite", {
      input: stdin,
      output: stdout,
    });
    expect(out.some((c) => c.kind === "rename-column")).toBe(true);
  });
});

// ============================================================================
// resolve-db — env vs config precedence
// ============================================================================

describe("resolveDb", () => {
  beforeEach(() => snapshotEnv(["DATABASE_URL"]));
  afterEach(() => restoreEnv());

  it("reads DATABASE_URL from env first", async () => {
    process.env.DATABASE_URL = "sqlite::memory:";
    const { db, source, config } = await resolveDb({ cwd: process.cwd() });
    expect(source).toBe("env");
    expect(config.url).toBe("sqlite::memory:");
    expect(db.provider).toBe("sqlite");
  });

  it("falls back to mandu.config.json `db` block when no env", async () => {
    delete process.env.DATABASE_URL;
    const f = setupProject();
    try {
      await fs.writeFile(
        join(f.root, "mandu.config.json"),
        JSON.stringify({ db: { url: "sqlite::memory:" } }),
        "utf8",
      );
      const { source, config } = await resolveDb({ cwd: f.root, envUrl: undefined });
      expect(source).toBe("config");
      expect(config.url).toBe("sqlite::memory:");
    } finally {
      f.cleanup();
    }
  });

  it("throws DbResolutionError when neither source is set", async () => {
    delete process.env.DATABASE_URL;
    const f = setupProject();
    try {
      await expect(
        resolveDb({ cwd: f.root, envUrl: undefined }),
      ).rejects.toThrow(/No database URL configured/);
    } finally {
      f.cleanup();
    }
  });
});

// ============================================================================
// dbPlan
// ============================================================================

describeIfBunSql("dbPlan", () => {
  let f: ProjectFixture;
  beforeEach(() => {
    f = setupProject();
  });
  afterEach(() => f.cleanup());

  it("TC-1: no resources → exit 0 with 'no resources found' message", async () => {
    const code = await dbPlan({ cwd: f.root, ci: true });
    expect(code).toBe(0);
    const dirFiles = await fs.readdir(f.migrationsDir);
    expect(dirFiles).toEqual([]);
  });

  it("TC-2: new resource → creates NNNN_auto_*.sql migration file", async () => {
    writeResource(f, "user", basicUserResource());
    const code = await dbPlan({ cwd: f.root, ci: true });
    expect(code).toBe(0);
    const dirFiles = await fs.readdir(f.migrationsDir);
    expect(dirFiles.length).toBe(1);
    expect(dirFiles[0]).toMatch(/^0001_auto_.*\.sql$/);
    const sql = await fs.readFile(join(f.migrationsDir, dirFiles[0]), "utf8");
    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain('"users"');
  });

  it("TC-3: --json emits parseable JSON with changes array + migrationPath", async () => {
    writeResource(f, "user", basicUserResource());
    // Capture stdout.
    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string) => {
      chunks.push(s);
      return true;
    };
    try {
      await dbPlan({ cwd: f.root, ci: true, json: true });
    } finally {
      (process.stdout.write as unknown) = originalWrite;
    }
    const text = chunks.join("");
    const parsed = JSON.parse(text);
    expect(typeof parsed.changeCount).toBe("number");
    expect(Array.isArray(parsed.changes)).toBe(true);
    expect(typeof parsed.migrationPath).toBe("string");
  });

  it("TC-4: empty diff → exit 0, no file written", async () => {
    // applied snapshot === next snapshot.
    writeResource(f, "user", basicUserResource());
    // First plan creates 0001; second plan with identical applied.json
    // must emit zero changes.
    await dbPlan({ cwd: f.root, ci: true });
    // Snapshot applied.json so next diff is a no-op.
    const { snapshotFromResources, serializeSnapshot } = await import("@mandujs/core/resource/ddl/snapshot");
    const { parseResourceSchemas } = await import("@mandujs/core/resource");
    const files = [join(f.resourcesDir, "user.resource.ts")];
    const parsed = await parseResourceSchemas(files);
    const snap = snapshotFromResources(parsed);
    await fs.writeFile(f.appliedPath, serializeSnapshot(snap), "utf8");

    const code = await dbPlan({ cwd: f.root, ci: true });
    expect(code).toBe(0);
    // Only the initial migration file should exist — no 0002.
    const files2 = (await fs.readdir(f.migrationsDir)).filter((n) => n.endsWith(".sql"));
    expect(files2.length).toBe(1);
  });
});

// ============================================================================
// dbApply
// ============================================================================

describeIfBunSql("dbApply", () => {
  let f: ProjectFixture;
  beforeEach(() => {
    f = setupProject();
    snapshotEnv(["DATABASE_URL"]);
    process.env.DATABASE_URL = `sqlite://${f.dbPath}`;
  });
  afterEach(() => {
    restoreEnv();
    f.cleanup();
  });

  it("TC-5: 1 pending migration → runs it, exit 0", async () => {
    writeFileSync(
      join(f.migrationsDir, "0001_init.sql"),
      `CREATE TABLE "users" ("id" TEXT PRIMARY KEY, "email" TEXT NOT NULL UNIQUE);`,
      "utf8",
    );
    const code = await dbApply({ cwd: f.root });
    expect(code).toBe(0);
  });

  it("TC-6: --dry-run does NOT execute (table absent afterwards)", async () => {
    writeFileSync(
      join(f.migrationsDir, "0001_init.sql"),
      `CREATE TABLE "users" ("id" TEXT PRIMARY KEY);`,
      "utf8",
    );
    const code = await dbApply({ cwd: f.root, dryRun: true });
    expect(code).toBe(0);

    // Table should NOT exist post-dry-run.
    const { createDb } = await import("@mandujs/core/db");
    const db = createDb({ url: `sqlite://${f.dbPath}` });
    const rows = await db<{ name: string }>`SELECT name FROM sqlite_master WHERE type='table' AND name='users'`;
    await db.close();
    expect(rows.length).toBe(0);
  });

  it("TC-7: tampered history → exit 3", async () => {
    // Write + apply one migration, then mutate it.
    const filePath = join(f.migrationsDir, "0001_init.sql");
    writeFileSync(filePath, `CREATE TABLE "t1" ("id" INTEGER PRIMARY KEY);`, "utf8");
    const first = await dbApply({ cwd: f.root });
    expect(first).toBe(0);

    // Tamper — change the file content AFTER it was applied.
    writeFileSync(filePath, `CREATE TABLE "t1" ("id" INTEGER PRIMARY KEY, "x" INTEGER);`, "utf8");

    // Add a new pending file to force apply() to traverse past the
    // tampered row.
    writeFileSync(
      join(f.migrationsDir, "0002_next.sql"),
      `CREATE TABLE "t2" ("id" INTEGER PRIMARY KEY);`,
      "utf8",
    );

    const code = await dbApply({ cwd: f.root });
    expect(code).toBe(3);
  });

  it("TC-8a: apply writes .mandu/schema/applied.json so next plan sees current DB state", async () => {
    // Seed a resource so apply has something to snapshot.
    writeResource(f, "user", basicUserResource());

    // Run plan → produces 0001_auto_*.sql.
    await dbPlan({ cwd: f.root, ci: true });

    // Apply the generated migration.
    const code = await dbApply({ cwd: f.root });
    expect(code).toBe(0);

    // applied.json MUST now exist and be a valid snapshot with our user resource.
    expect(existsSync(f.appliedPath)).toBe(true);
    const raw = await fs.readFile(f.appliedPath, "utf8");
    const { parseSnapshot } = await import("@mandujs/core/resource/ddl/snapshot");
    const snap = parseSnapshot(raw);
    expect(snap.provider).toBe("sqlite");
    expect(snap.resources.map((r) => r.name)).toContain("users");

    // And a second plan with no resource changes must emit zero — this is
    // the contract that G1 regressed without applied.json being written.
    const second = await dbPlan({ cwd: f.root, ci: true });
    expect(second).toBe(0);
    const migrations = (await fs.readdir(f.migrationsDir)).filter((n) => n.endsWith(".sql"));
    expect(migrations.length).toBe(1);
  });

  it("TC-8b: --dry-run does NOT write applied.json", async () => {
    writeResource(f, "user", basicUserResource());
    await dbPlan({ cwd: f.root, ci: true });

    const code = await dbApply({ cwd: f.root, dryRun: true });
    expect(code).toBe(0);
    expect(existsSync(f.appliedPath)).toBe(false);
  });

  it("TC-8: SQL error mid-migration → exit 1, previous migrations remain", async () => {
    // First migration succeeds; second fails.
    writeFileSync(
      join(f.migrationsDir, "0001_ok.sql"),
      `CREATE TABLE "good" ("id" INTEGER PRIMARY KEY);`,
      "utf8",
    );
    writeFileSync(
      join(f.migrationsDir, "0002_bad.sql"),
      `NOT A VALID SQL STATEMENT;`,
      "utf8",
    );
    const code = await dbApply({ cwd: f.root });
    expect(code).toBe(1);

    // First table should still exist.
    const { createDb } = await import("@mandujs/core/db");
    const db = createDb({ url: `sqlite://${f.dbPath}` });
    const rows = await db<{ name: string }>`SELECT name FROM sqlite_master WHERE type='table' AND name='good'`;
    await db.close();
    expect(rows.length).toBe(1);
  });
});

// ============================================================================
// dbStatus
// ============================================================================

describeIfBunSql("dbStatus", () => {
  let f: ProjectFixture;
  beforeEach(() => {
    f = setupProject();
    snapshotEnv(["DATABASE_URL"]);
    process.env.DATABASE_URL = `sqlite://${f.dbPath}`;
  });
  afterEach(() => {
    restoreEnv();
    f.cleanup();
  });

  it("TC-9: mix of applied + pending prints all tables, exit 0", async () => {
    writeFileSync(
      join(f.migrationsDir, "0001_init.sql"),
      `CREATE TABLE "a" ("id" INTEGER PRIMARY KEY);`,
      "utf8",
    );
    await dbApply({ cwd: f.root });
    writeFileSync(
      join(f.migrationsDir, "0002_pending.sql"),
      `CREATE TABLE "b" ("id" INTEGER PRIMARY KEY);`,
      "utf8",
    );
    const code = await dbStatus({ cwd: f.root });
    expect(code).toBe(0);
  });

  it("TC-10: --check with pending → exit 1", async () => {
    writeFileSync(
      join(f.migrationsDir, "0001_pending.sql"),
      `CREATE TABLE "a" ("id" INTEGER PRIMARY KEY);`,
      "utf8",
    );
    const code = await dbStatus({ cwd: f.root, check: true });
    expect(code).toBe(1);
  });

  it("TC-11: --check with no pending → exit 0", async () => {
    writeFileSync(
      join(f.migrationsDir, "0001_init.sql"),
      `CREATE TABLE "a" ("id" INTEGER PRIMARY KEY);`,
      "utf8",
    );
    await dbApply({ cwd: f.root });
    const code = await dbStatus({ cwd: f.root, check: true });
    expect(code).toBe(0);
  });

  it("TC-12: --json emits parseable MigrationStatus object", async () => {
    writeFileSync(
      join(f.migrationsDir, "0001_pending.sql"),
      `CREATE TABLE "a" ("id" INTEGER PRIMARY KEY);`,
      "utf8",
    );
    const chunks: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout.write as unknown) = (s: string) => {
      chunks.push(s);
      return true;
    };
    try {
      await dbStatus({ cwd: f.root, json: true });
    } finally {
      (process.stdout.write as unknown) = original;
    }
    const parsed = JSON.parse(chunks.join(""));
    expect(Array.isArray(parsed.applied)).toBe(true);
    expect(Array.isArray(parsed.pending)).toBe(true);
    expect(Array.isArray(parsed.tampered)).toBe(true);
    expect(Array.isArray(parsed.orphaned)).toBe(true);
  });
});

// ============================================================================
// dbReset
// ============================================================================

describeIfBunSql("dbReset", () => {
  let f: ProjectFixture;
  beforeEach(() => {
    f = setupProject();
    snapshotEnv(["DATABASE_URL", "MANDU_DB_RESET_CONFIRM"]);
    process.env.DATABASE_URL = `sqlite://${f.dbPath}`;
  });
  afterEach(() => {
    restoreEnv();
    f.cleanup();
  });

  it("TC-13: no --force → exit 4", async () => {
    const code = await dbReset({ cwd: f.root });
    expect(code).toBe(4);
  });

  it("TC-14: --force --ci without MANDU_DB_RESET_CONFIRM → exit 4", async () => {
    delete process.env.MANDU_DB_RESET_CONFIRM;
    const code = await dbReset({
      cwd: f.root,
      force: true,
      ci: true,
      envConfirm: undefined,
    });
    expect(code).toBe(4);
  });

  it("TC-15: --force --ci + MANDU_DB_RESET_CONFIRM=true → drops history", async () => {
    // Apply one migration first so the history table exists.
    writeFileSync(
      join(f.migrationsDir, "0001_init.sql"),
      `CREATE TABLE "users" ("id" INTEGER PRIMARY KEY);`,
      "utf8",
    );
    await dbApply({ cwd: f.root });

    const code = await dbReset({
      cwd: f.root,
      force: true,
      ci: true,
      envConfirm: "true",
    });
    expect(code).toBe(0);

    // History gone.
    const { createDb } = await import("@mandujs/core/db");
    const db = createDb({ url: `sqlite://${f.dbPath}` });
    const rows = await db<{ name: string }>`SELECT name FROM sqlite_master WHERE type='table' AND name='__mandu_migrations'`;
    await db.close();
    expect(rows.length).toBe(0);
  });
});
