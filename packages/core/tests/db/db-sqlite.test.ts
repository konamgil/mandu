/**
 * @mandujs/core/db — SQLite integration tests
 *
 * These exercise the **real** `Bun.SQL` adapter against in-memory and
 * temporary file-backed SQLite databases. No docker, no external service,
 * no external config — every fixture lives in `:memory:` or a scratch
 * directory inside the OS tmp dir, so the suite runs in every CI and
 * local checkout.
 *
 * Postgres and MySQL integration tests live under `tests/db/` with docker
 * fixtures — those are handled by the validation engineer's PR.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Db } from "../../src/db";

/**
 * Gate: every `it` resolves cleanly (skipped) on a Bun build that doesn't
 * ship `Bun.SQL`. We keep the gate narrow to `Bun.SQL` so `Bun.sqlite` /
 * `bun:sqlite` presence is NOT what's being checked — this suite hits the
 * new unified `Bun.SQL` code path.
 */
const hasBunSql = (() => {
  const g = globalThis as unknown as { Bun?: { SQL?: unknown } };
  return typeof g.Bun?.SQL === "function";
})();

const describeIfBunSql = hasBunSql ? describe : describe.skip;

describeIfBunSql("@mandujs/core/compat/db — SQLite (in-memory) integration", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb({ url: "sqlite::memory:" });
    await db`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      )
    `;
  });

  afterEach(async () => {
    await db.close();
  });

  it("CREATE + INSERT + SELECT roundtrip returns the inserted row", async () => {
    await db`INSERT INTO users (name) VALUES (${"alice"})`;

    const rows = await db<{ id: number; name: string }>`
      SELECT id, name FROM users
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("alice");
    expect(typeof rows[0]!.id).toBe("number");
  });

  it("binds placeholder values as parameters for weird characters (apostrophes, emoji, Korean)", async () => {
    const awkwardNames = [
      "O'Brien",
      "robert'; DROP TABLE users; --",
      "Löwe",
      "李小龙",
      "이순신",
      "🦀 rust-lover",
    ];
    for (const n of awkwardNames) {
      await db`INSERT INTO users (name) VALUES (${n})`;
    }

    const rows = await db<{ name: string }>`SELECT name FROM users`;
    expect(rows.map((r) => r.name).sort()).toEqual([...awkwardNames].sort());

    // Sanity: the table still exists — the "DROP TABLE" attempt was bound,
    // not executed.
    const tblCheck = await db<{ name: string }>`
      SELECT name FROM sqlite_master WHERE type = ${"table"} AND name = ${"users"}
    `;
    expect(tblCheck).toHaveLength(1);
  });

  it("SELECT with placeholder filters by a single value", async () => {
    await db`INSERT INTO users (name) VALUES (${"alice"})`;
    await db`INSERT INTO users (name) VALUES (${"bob"})`;
    await db`INSERT INTO users (name) VALUES (${"carol"})`;

    const target = "bob";
    const rows = await db<{ name: string }>`
      SELECT name FROM users WHERE name = ${target}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("bob");
  });

  it(".one() returns the matching row when exactly one exists", async () => {
    await db`INSERT INTO users (name) VALUES (${"solo"})`;

    const row = await db.one<{ id: number; name: string }>`
      SELECT id, name FROM users WHERE name = ${"solo"}
    `;
    expect(row).not.toBeNull();
    expect(row!.name).toBe("solo");
  });

  it(".one() returns null when no row matches", async () => {
    const row = await db.one`
      SELECT name FROM users WHERE name = ${"ghost"}
    `;
    expect(row).toBeNull();
  });

  it(".one() throws when more than one row matches", async () => {
    await db`INSERT INTO users (name) VALUES (${"x"})`;
    await db`INSERT INTO users (name) VALUES (${"y"})`;

    await expect(
      // Intentionally select multiple rows.
      db.one`SELECT name FROM users`,
    ).rejects.toThrow(/expected 0 or 1 row, got 2/);
  });

  it("transaction() commits on resolve — rows persist after return", async () => {
    await db.transaction(async (tx) => {
      await tx`INSERT INTO users (name) VALUES (${"tx-1"})`;
      await tx`INSERT INTO users (name) VALUES (${"tx-2"})`;
    });

    const rows = await db<{ name: string }>`
      SELECT name FROM users ORDER BY name
    `;
    expect(rows.map((r) => r.name)).toEqual(["tx-1", "tx-2"]);
  });

  it("transaction() rolls back on throw — no rows persist", async () => {
    class Boom extends Error {}

    await expect(
      db.transaction(async (tx) => {
        await tx`INSERT INTO users (name) VALUES (${"rolled-back-1"})`;
        await tx`INSERT INTO users (name) VALUES (${"rolled-back-2"})`;
        throw new Boom("nope");
      }),
    ).rejects.toBeInstanceOf(Boom);

    const rows = await db<{ name: string }>`SELECT name FROM users`;
    expect(rows).toHaveLength(0);
  });

  it("close() then query → rejects with canonical pool-closed error", async () => {
    await db.close();
    await expect(db`SELECT 1`).rejects.toThrow(/pool closed/);
    // Idempotent: a second close() call must not throw.
    await expect(db.close()).resolves.toBeUndefined();

    // Re-assign `db` so the afterEach `close()` doesn't re-throw on the
    // already-closed handle. A fresh sqlite::memory: handle is cheap.
    db = createDb({ url: "sqlite::memory:" });
    await db`SELECT 1`;
  });

  it("surfaces SQL syntax errors with a clear, non-generic message", async () => {
    let caught: unknown = null;
    try {
      await db`SELECT FROM garbage`;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    const msg = (caught as Error).message;
    // Bun surfaces the underlying SQLite diagnostic verbatim ("near …: syntax error").
    expect(msg).toMatch(/syntax|FROM|garbage/i);
  });

  it("reports provider === 'sqlite' for sqlite: URLs", () => {
    expect(db.provider).toBe("sqlite");
  });
});

describeIfBunSql("@mandujs/core/compat/db — SQLite file + concurrent handles", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "mandu-db-sqlite-"));
  });

  afterEach(() => {
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("two independent Db handles (one :memory:, one file) do not interfere", async () => {
    const memDb = createDb({ url: "sqlite::memory:" });
    // Use `sqlite://<absolute-path>` — the triple-slash form that Bun.SQL
    // documents for file-backed databases.
    const fileDb = createDb({ url: `sqlite://${join(scratchDir, "a.db")}` });

    try {
      await memDb`CREATE TABLE t (v TEXT)`;
      await fileDb`CREATE TABLE t (v TEXT)`;

      await memDb`INSERT INTO t (v) VALUES (${"from-memory"})`;
      await fileDb`INSERT INTO t (v) VALUES (${"from-file"})`;

      const memRows = await memDb<{ v: string }>`SELECT v FROM t`;
      const fileRows = await fileDb<{ v: string }>`SELECT v FROM t`;

      expect(memRows).toEqual([{ v: "from-memory" }]);
      expect(fileRows).toEqual([{ v: "from-file" }]);
    } finally {
      await memDb.close();
      await fileDb.close();
    }
  });

  it("re-uses prepared statements for repeated identical query text (observable via roundtrip correctness)", async () => {
    // Bun.SQL caches prepared statements internally; we don't have a public
    // counter to assert against, so this test asserts the CORRECTNESS of
    // repeated parameterised queries returning the right rows — which would
    // fail if the cache ever handed back a stale statement for a different
    // parameter set. That's the user-visible contract.
    const db = createDb({ url: `sqlite://${join(scratchDir, "b.db")}` });
    try {
      await db`CREATE TABLE k (id INTEGER PRIMARY KEY, v TEXT)`;
      for (let i = 1; i <= 10; i++) {
        await db`INSERT INTO k (id, v) VALUES (${i}, ${`row-${i}`})`;
      }
      // Run the same SELECT text 10 times with different parameters.
      for (let i = 1; i <= 10; i++) {
        const row = await db.one<{ v: string }>`SELECT v FROM k WHERE id = ${i}`;
        expect(row).not.toBeNull();
        expect(row!.v).toBe(`row-${i}`);
      }
    } finally {
      await db.close();
    }
  });

  it("file-backed database persists across a close/reopen cycle", async () => {
    const path = join(scratchDir, "persist.db");

    const firstDb = createDb({ url: `sqlite://${path}` });
    await firstDb`CREATE TABLE entries (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT)`;
    await firstDb`INSERT INTO entries (label) VALUES (${"persist-me"})`;
    await firstDb.close();

    const secondDb = createDb({ url: `sqlite://${path}` });
    try {
      const rows = await secondDb<{ label: string }>`
        SELECT label FROM entries
      `;
      expect(rows).toEqual([{ label: "persist-me" }]);
    } finally {
      await secondDb.close();
    }
  });
});

// ─── Composable fragments against real Bun.SQL (#315) ────────────────────────

describeIfBunSql("@mandujs/core/compat/db — SQLite fragment composition", () => {
  let db: Db;

  beforeEach(async () => {
    db = createDb({ url: "sqlite::memory:" });
    await db`
      CREATE TABLE pledges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        party TEXT NOT NULL,
        region TEXT NOT NULL
      )
    `;
    const seed: Array<[string, string, string]> = [
      ["climate action", "green", "seoul"],
      ["housing reform", "green", "busan"],
      ["tax cut", "blue", "seoul"],
      ["transit plan", "blue", "busan"],
    ];
    for (const [title, party, region] of seed) {
      await db`INSERT INTO pledges (title, party, region) VALUES (${title}, ${party}, ${region})`;
    }
  });

  afterEach(async () => {
    await db.close();
  });

  // Builds the same dynamic list query the dogfooding app needed: N optional
  // filters joined with AND, all values bound. Proves the synthetic
  // TemplateStringsArray works against the REAL Bun.SQL adapter.
  async function listPledges(filters: {
    party?: string;
    region?: string;
    search?: string;
  }): Promise<Array<{ title: string }>> {
    const conds = [];
    if (filters.party) conds.push(db.sql`party = ${filters.party}`);
    if (filters.region) conds.push(db.sql`region = ${filters.region}`);
    if (filters.search) conds.push(db.sql`title LIKE ${"%" + filters.search + "%"}`);
    const where = conds.length
      ? db.sql`WHERE ${db.join(conds, " AND ")}`
      : db.sql``;
    return await db<{ title: string }>`
      SELECT title FROM pledges ${where} ORDER BY id
    `;
  }

  it("no filters → returns every row", async () => {
    const rows = await listPledges({});
    expect(rows).toHaveLength(4);
  });

  it("single filter → binds the value and filters correctly", async () => {
    const rows = await listPledges({ party: "green" });
    expect(rows.map((r) => r.title).sort()).toEqual(["climate action", "housing reform"]);
  });

  it("multiple filters → AND-composed with every value bound", async () => {
    const rows = await listPledges({ party: "green", region: "seoul" });
    expect(rows.map((r) => r.title)).toEqual(["climate action"]);
  });

  it("LIKE filter with metacharacters stays a bound parameter", async () => {
    const rows = await listPledges({ search: "reform" });
    expect(rows.map((r) => r.title)).toEqual(["housing reform"]);

    // An injection attempt routed through a fragment must not execute.
    const evil = await listPledges({ search: "%'; DROP TABLE pledges; --" });
    expect(evil).toHaveLength(0);
    const stillThere = await db<{ n: number }>`SELECT COUNT(*) AS n FROM pledges`;
    expect(Number(stillThere[0]!.n)).toBe(4);
  });

  it("nested fragment composes within a WHERE group", async () => {
    const partyOrRegion = db.sql`(party = ${"blue"} OR region = ${"seoul"})`;
    const rows = await db<{ title: string }>`
      SELECT title FROM pledges WHERE ${partyOrRegion} ORDER BY id
    `;
    expect(rows.map((r) => r.title)).toEqual([
      "climate action",
      "tax cut",
      "transit plan",
    ]);
  });
});
