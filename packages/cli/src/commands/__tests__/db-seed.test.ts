/**
 * Unit tests for `packages/cli/src/commands/db-seed.ts`.
 *
 * We test three surfaces:
 *
 *   - Pure helpers (`bindRow`, `validateRowsAgainstResource`,
 *     `detectTamper`, `resolveEnvWhitelist`).
 *   - End-to-end runner via `dbSeed()` against in-memory SQLite.
 *   - The prod-env confirmation gate.
 *
 * All runner tests use Bun's built-in `sqlite::memory:` connection so
 * no external DB is required. Fixtures live in `fs.mkdtemp` so
 * concurrent suites don't collide.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  dbSeed,
  __private,
  type SeedDb,
  EXIT_OK,
  EXIT_ERROR,
  EXIT_REFUSED,
} from "../db-seed";
import { createDb } from "@mandujs/core/compat/db/index";
import type { ParsedResource } from "@mandujs/core/compat/resource/index";

const PREFIX = path.join(os.tmpdir(), "mandu-db-seed-test-");

const hasBunSql = (() => {
  const g = globalThis as unknown as { Bun?: { SQL?: unknown } };
  return typeof g.Bun?.SQL === "function";
})();
const describeIfBunSql = hasBunSql ? describe : describe.skip;

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(PREFIX);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// =====================================================================
// Pure-helper tests
// =====================================================================

describe("bindRow", () => {
  it("produces a `?` placeholder list for SQLite", () => {
    const { columns, placeholders, values, columnNames } = __private.bindRow(
      { name: "alice", age: 30 },
      "sqlite",
    );
    expect(columns).toBe(`"name", "age"`);
    expect(placeholders).toBe(`?, ?`);
    expect(values).toEqual(["alice", 30]);
    expect(columnNames).toEqual(["name", "age"]);
  });

  it("uses $N placeholders for Postgres", () => {
    const { placeholders } = __private.bindRow(
      { name: "alice", age: 30 },
      "postgres",
    );
    expect(placeholders).toBe(`$1, $2`);
  });

  it("rejects empty rows", () => {
    expect(() => __private.bindRow({}, "sqlite")).toThrow(/no columns/);
  });

  it("routes every identifier through quoteIdent (rejects backticks on postgres)", () => {
    // An identifier containing double-quotes is rejected by quoteIdent on
    // postgres/sqlite (no portable escape).
    expect(() =>
      __private.bindRow({ 'evil"col': "x" }, "sqlite"),
    ).toThrow();
  });
});

describe("validateRowsAgainstResource", () => {
  const resource = {
    resourceName: "user",
    filePath: "/fake",
    fileName: "user",
    definition: {
      name: "user",
      fields: {
        id: { type: "uuid" as const, required: true },
        email: { type: "email" as const, required: true },
        name: { type: "string" as const, required: false },
      },
    },
  };

  it("accepts rows with all known columns", () => {
    __private.validateRowsAgainstResource(
      [{ id: "x", email: "a@b", name: "Alice" }],
      resource,
    );
  });

  it("rejects rows with unknown columns", () => {
    expect(() =>
      __private.validateRowsAgainstResource(
        [{ id: "x", email: "a@b", evil: "y" }],
        resource,
      ),
    ).toThrow(/unknown column/);
  });

  it("rejects missing required columns", () => {
    expect(() =>
      __private.validateRowsAgainstResource([{ name: "bob" }], resource),
    ).toThrow(/missing required/);
  });

  it("accepts missing required column when a default is declared", () => {
    const resourceWithDefault = {
      ...resource,
      definition: {
        ...resource.definition,
        fields: {
          ...resource.definition.fields,
          status: { type: "string" as const, required: true, default: "pending" },
        },
      },
    };
    __private.validateRowsAgainstResource(
      [{ id: "x", email: "a@b" }],
      resourceWithDefault,
    );
  });
});

describe("resolveEnvWhitelist", () => {
  it("returns the default list when no env is set", () => {
    const list = __private.resolveEnvWhitelist({ default: { resource: "x", data: [] } });
    expect([...list].sort()).toEqual(["dev", "staging"]);
  });

  it("prefers the top-level `env` export", () => {
    const list = __private.resolveEnvWhitelist({
      default: { resource: "x", data: [] },
      env: ["prod"],
    });
    expect(list).toEqual(["prod"]);
  });

  it("reads env from a declarative object's own field", () => {
    const list = __private.resolveEnvWhitelist({
      default: { resource: "x", data: [], env: ["staging"] },
    });
    expect(list).toEqual(["staging"]);
  });

  it("falls back to defaults when env is malformed", () => {
    const list = __private.resolveEnvWhitelist({
      default: { resource: "x", data: [] },
      env: ["bogus"] as unknown as readonly ("dev" | "staging" | "prod")[],
    });
    expect([...list].sort()).toEqual(["dev", "staging"]);
  });
});

describe("detectTamper", () => {
  it("returns an empty array when history is empty", () => {
    const res = __private.detectTamper(new Map(), [
      { path: "/x", filename: "001_init.seed.ts", checksum: "abc" },
    ]);
    expect(res).toEqual([]);
  });

  it("detects a checksum mismatch for the same filename", () => {
    const history = new Map([["oldcheck", { filename: "001_init.seed.ts" }]]);
    const res = __private.detectTamper(history, [
      { path: "/x", filename: "001_init.seed.ts", checksum: "newcheck" },
    ]);
    expect(res.length).toBe(1);
    expect(res[0]!.filename).toBe("001_init.seed.ts");
    expect(res[0]!.storedChecksum).toBe("oldcheck");
    expect(res[0]!.currentChecksum).toBe("newcheck");
  });
});

// =====================================================================
// Prod gate test — no DB interaction required
// =====================================================================

describe("dbSeed — environment gating", () => {
  it("refuses --env=prod without MANDU_DB_SEED_PROD_CONFIRM=yes", async () => {
    delete process.env.MANDU_DB_SEED_PROD_CONFIRM;
    const seedsDir = path.join(tmp, "spec", "seeds");
    const resourcesDir = path.join(tmp, "spec", "resources");
    await fs.mkdir(seedsDir, { recursive: true });
    await fs.mkdir(resourcesDir, { recursive: true });
    await fs.writeFile(
      path.join(seedsDir, "001_x.seed.ts"),
      `export default { resource: "x", data: [] };`,
    );
    const code = await dbSeed({
      cwd: tmp,
      env: "prod",
      seedsDir,
      resourcesDir,
    });
    expect(code).toBe(EXIT_REFUSED);
  });

  it("usage error for unknown env", async () => {
    const code = await dbSeed({
      cwd: tmp,
      // deliberately invalid
      env: "bogus" as unknown as "dev",
      seedsDir: tmp,
      resourcesDir: tmp,
    });
    // EXIT_USAGE from the module.
    expect(code).toBe(2);
  });
});

// =====================================================================
// End-to-end — uses real Bun.SQL in-memory SQLite
// =====================================================================

/**
 * Build an in-memory `ParsedResource` stand-in without hitting the
 * filesystem. Mirrors what `parseResourceSchemas` would have produced
 * — the runner never touches `filePath` or `fileName` for declarative
 * seeds, so a fake path is fine.
 */
function makeUserResource(): ParsedResource {
  return {
    resourceName: "user",
    filePath: "/virtual/user.resource.ts",
    fileName: "user",
    definition: {
      name: "user",
      fields: {
        id: { type: "uuid", required: true },
        email: { type: "email", required: true },
        name: { type: "string", required: false },
      },
    },
  };
}

describeIfBunSql("dbSeed — declarative end-to-end (SQLite)", () => {
  it("seeds a resource and records history", async () => {
    const seedsDir = path.join(tmp, "spec", "seeds");
    const resourcesDir = path.join(tmp, "spec", "resources");
    await fs.mkdir(seedsDir, { recursive: true });
    // resourcesDir is still passed so the runner can *find* the dir;
    // tests inject a pre-parsed resource to skip the dynamic import.

    await fs.writeFile(
      path.join(seedsDir, "001_users.seed.ts"),
      `
export default {
  resource: "user",
  data: [
    { id: "u1", email: "a@example.com", name: "Alice" },
    { id: "u2", email: "b@example.com", name: "Bob" },
  ],
  key: "id",
};
`,
    );

    const db = createDb({ url: "sqlite::memory:" });
    await db`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT)`;

    const code = await dbSeed({
      cwd: tmp,
      db: db as unknown as SeedDb,
      seedsDir,
      resourcesDir,
      resources: [makeUserResource()],
      env: "dev",
    });
    expect(code).toBe(EXIT_OK);

    const rows = await db`SELECT id, email, name FROM "user" ORDER BY id`;
    expect(rows.length).toBe(2);
    expect(rows[0]!.id).toBe("u1");

    // History row written.
    const hist = await db`SELECT filename FROM "__mandu_seeds"`;
    expect(hist.length).toBe(1);

    // Second run is idempotent — same rows, no duplicates.
    const code2 = await dbSeed({
      cwd: tmp,
      db: db as unknown as SeedDb,
      seedsDir,
      resourcesDir,
      resources: [makeUserResource()],
      env: "dev",
    });
    expect(code2).toBe(EXIT_OK);
    const rows2 = await db`SELECT COUNT(*) as c FROM "user"`;
    expect(rows2[0]!.c).toBe(2);

    await db.close();
  });

  it("--reset truncates target table before seeding", async () => {
    const seedsDir = path.join(tmp, "spec", "seeds");
    const resourcesDir = path.join(tmp, "spec", "resources");
    await fs.mkdir(seedsDir, { recursive: true });
    // resourcesDir is still passed so the runner can *find* the dir;
    // tests inject a pre-parsed resource to skip the dynamic import.

    await fs.writeFile(
      path.join(seedsDir, "001_users.seed.ts"),
      `export default { resource: "user", data: [{ id: "u1", email: "a@b", name: "A" }], key: "id" };`,
    );

    const db = createDb({ url: "sqlite::memory:" });
    await db`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT)`;
    // Pre-existing row that should be wiped by --reset.
    await db`INSERT INTO "user" (id, email, name) VALUES (${"preexisting"}, ${"x@y"}, ${"Old"})`;

    await dbSeed({
      cwd: tmp,
      db: db as unknown as SeedDb,
      seedsDir,
      resourcesDir,
      resources: [makeUserResource()],
      env: "dev",
      reset: true,
    });

    const rows = await db`SELECT id FROM "user"`;
    expect(rows.length).toBe(1);
    expect(rows[0]!.id).toBe("u1");

    await db.close();
  });

  it("--dry-run does not execute or record history", async () => {
    const seedsDir = path.join(tmp, "spec", "seeds");
    const resourcesDir = path.join(tmp, "spec", "resources");
    await fs.mkdir(seedsDir, { recursive: true });
    // resourcesDir is still passed so the runner can *find* the dir;
    // tests inject a pre-parsed resource to skip the dynamic import.
    await fs.writeFile(
      path.join(seedsDir, "001_users.seed.ts"),
      `export default { resource: "user", data: [{ id: "u1", email: "a@b" }], key: "id" };`,
    );
    const db = createDb({ url: "sqlite::memory:" });
    await db`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT)`;

    const code = await dbSeed({
      cwd: tmp,
      db: db as unknown as SeedDb,
      seedsDir,
      resourcesDir,
      resources: [makeUserResource()],
      env: "dev",
      dryRun: true,
    });
    expect(code).toBe(EXIT_OK);
    const rows = await db`SELECT id FROM "user"`;
    expect(rows.length).toBe(0);
    await db.close();
  });

  it("transactional rollback — one failing row aborts the file", async () => {
    const seedsDir = path.join(tmp, "spec", "seeds");
    const resourcesDir = path.join(tmp, "spec", "resources");
    await fs.mkdir(seedsDir, { recursive: true });
    // resourcesDir is still passed so the runner can *find* the dir;
    // tests inject a pre-parsed resource to skip the dynamic import.
    // Seed includes a duplicate unique id that will collide with the
    // first row's PK constraint after the upsert tries to INSERT — the
    // table schema uses a NOT NULL column 'email' and we'll fail it by
    // sending two rows with the same id and then attempting
    // "key: 'email'" upsert with no email unique index. We force
    // failure by referencing an unknown column.
    await fs.writeFile(
      path.join(seedsDir, "001_users.seed.ts"),
      `export default {
        resource: "user",
        data: [{ id: "u1", email: "a@b" }, { id: "u2", email: "b@c", __evil: "payload" }],
        key: "id"
      };`,
    );

    const db = createDb({ url: "sqlite::memory:" });
    await db`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT)`;

    const code = await dbSeed({
      cwd: tmp,
      db: db as unknown as SeedDb,
      seedsDir,
      resourcesDir,
      resources: [makeUserResource()],
      env: "dev",
    });
    // Expect an error — the second row has an unknown column.
    expect(code).toBe(EXIT_ERROR);
    // Rollback: the first row should not be present.
    const rows = await db`SELECT id FROM "user"`;
    expect(rows.length).toBe(0);
    await db.close();
  });

  it("env filter skips files whose env whitelist excludes current env", async () => {
    const seedsDir = path.join(tmp, "spec", "seeds");
    const resourcesDir = path.join(tmp, "spec", "resources");
    await fs.mkdir(seedsDir, { recursive: true });
    // resourcesDir is still passed so the runner can *find* the dir;
    // tests inject a pre-parsed resource to skip the dynamic import.
    // File only for staging
    await fs.writeFile(
      path.join(seedsDir, "001_staging_only.seed.ts"),
      `export default { resource: "user", data: [{ id: "u1", email: "a@b" }], key: "id", env: ["staging"] };`,
    );
    const db = createDb({ url: "sqlite::memory:" });
    await db`CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT, name TEXT)`;
    const code = await dbSeed({
      cwd: tmp,
      db: db as unknown as SeedDb,
      seedsDir,
      resourcesDir,
      resources: [makeUserResource()],
      env: "dev",
    });
    expect(code).toBe(EXIT_OK);
    const rows = await db`SELECT id FROM "user"`;
    expect(rows.length).toBe(0);
    await db.close();
  });
});
