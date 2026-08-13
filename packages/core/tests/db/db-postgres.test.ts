/**
 * @mandujs/core/db — Postgres integration tests
 *
 * These tests run against a real Postgres 16 server provisioned by
 * `packages/core/tests/fixtures/db/docker-compose.yml`. They exercise the
 * createDb contract end-to-end — no fakes, no in-memory swap — across the
 * 10 symmetry cases the db-mysql suite also covers, plus Postgres-specific
 * features (RETURNING, JSONB).
 *
 * ### Gate
 *
 * The suite is gated on the `DB_TEST_POSTGRES_URL` env var so CI (and
 * contributors who haven't brought up docker) no-op the suite cleanly.
 * With `DB_TEST_POSTGRES_URL` unset, every `it` is `describe.skip`-ed and
 * the runner reports the tests as skipped (not failed).
 *
 * ### Identifier handling
 *
 * `@mandujs/core/db` deliberately binds every `${…}` in a tagged template
 * as a SQL **parameter**, not as SQL text. That's the right default (zero
 * injection surface) but it means DDL like `CREATE TABLE ${name}` can't
 * work through the tagged template. The suite therefore uses **fixed
 * identifier literals** hard-coded into the SQL strings, with `DROP TABLE
 * IF EXISTS` in `beforeAll` to guarantee a clean slate. Parallel test
 * runs against the same fixture would collide on these names — but CI
 * tears the compose stack down with `-v` between jobs, and locally the
 * suite owns its fixture.
 *
 * ### How to run locally
 *
 * ```bash
 * docker compose -f packages/core/tests/fixtures/db/docker-compose.yml up -d
 * export DB_TEST_POSTGRES_URL=postgres://test:test@localhost:5433/testdb
 * bun test packages/core/tests/db/db-postgres.test.ts
 * ```
 *
 * ### CI
 *
 * See `.github/workflows/ci.yml` job `db-integration`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
// NOTE: The Bun expert is landing `packages/core/src/db/index.ts` in parallel.
// If this import fails, we fail cleanly at load time — that's the intended
// behavior, re-run once their PR merges.
import { createDb } from "../../src/db";

const PG_URL = process.env.DB_TEST_POSTGRES_URL;

const describeIfPg = PG_URL ? describe : describe.skip;

// Fixed identifiers — see "Identifier handling" in the file-level comment.
// Namespaced under `mandu_test_` so they're easy to strip from a dev DB.
const TABLE = "mandu_test_users";
const TABLE_POSTS = "mandu_test_posts";
const TABLE_JSON = "mandu_test_events";

describeIfPg("@mandujs/core/compat/db — Postgres integration", () => {
  // Top-level connection used for schema setup/teardown. Each test that
  // needs isolation spins up its own createDb handle.
  let admin: ReturnType<typeof createDb>;

  beforeAll(async () => {
    admin = createDb({ url: PG_URL!, provider: "postgres" });

    // Clean slate — the container volume may have survived a previous run
    // that crashed before teardown. Child tables first (FK ordering).
    await admin`DROP TABLE IF EXISTS mandu_test_posts`.catch(() => {});
    await admin`DROP TABLE IF EXISTS mandu_test_events`.catch(() => {});
    await admin`DROP TABLE IF EXISTS mandu_test_users`.catch(() => {});

    // Minimal schemas. The suite owns creating these; the fixture only
    // provisions the empty `testdb` database.
    await admin`
      CREATE TABLE mandu_test_users (
        id    SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name  TEXT NOT NULL
      )
    `;
    await admin`
      CREATE TABLE mandu_test_posts (
        id        SERIAL PRIMARY KEY,
        author_id INTEGER NOT NULL REFERENCES mandu_test_users(id),
        title     TEXT NOT NULL
      )
    `;
    await admin`
      CREATE TABLE mandu_test_events (
        id   SERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        meta JSONB NOT NULL
      )
    `;
  });

  afterAll(async () => {
    // Best-effort — the fixture's `down -v` is authoritative.
    await admin`DROP TABLE IF EXISTS mandu_test_posts`.catch(() => {});
    await admin`DROP TABLE IF EXISTS mandu_test_events`.catch(() => {});
    await admin`DROP TABLE IF EXISTS mandu_test_users`.catch(() => {});
    await admin.close();
  });

  afterEach(async () => {
    // Truncate between tests so row-id assertions (and UNIQUE-violation
    // tests) don't accrete state. `TRUNCATE ... RESTART IDENTITY` resets
    // the SERIAL counters too.
    await admin`TRUNCATE mandu_test_posts, mandu_test_events, mandu_test_users RESTART IDENTITY CASCADE`;
  });

  // --- 1. createDb + simple SELECT ------------------------------------------

  it("createDb + simple SELECT returns rows", async () => {
    const db = createDb({ url: PG_URL!, provider: "postgres" });
    try {
      const rows = await db<{ one: number }>`SELECT 1 AS one`;
      expect(rows).toEqual([{ one: 1 }]);
      expect(db.provider).toBe("postgres");
    } finally {
      await db.close();
    }
  });

  // --- 2. INSERT + SELECT roundtrip with parameter binding ------------------

  it("INSERT + SELECT roundtrip with parameter binding", async () => {
    const email = "alice@example.com";
    const name = "Alice";

    await admin`INSERT INTO mandu_test_users (email, name) VALUES (${email}, ${name})`;

    const rows = await admin<{ email: string; name: string }>`
      SELECT email, name FROM mandu_test_users WHERE email = ${email}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]).toEqual({ email, name });
  });

  // --- 3. .one() — 0/1/2+ row cases -----------------------------------------

  it(".one() returns null on zero rows", async () => {
    const row = await admin.one<{ id: number }>`
      SELECT id FROM mandu_test_users WHERE email = ${"nobody@example.com"}
    `;
    expect(row).toBeNull();
  });

  it(".one() returns the single row on one-row result", async () => {
    await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"bob@example.com"}, ${"Bob"})`;

    const row = await admin.one<{ email: string; name: string }>`
      SELECT email, name FROM mandu_test_users WHERE email = ${"bob@example.com"}
    `;
    expect(row).toEqual({ email: "bob@example.com", name: "Bob" });
  });

  it(".one() on a multi-row result surfaces a descriptive error", async () => {
    await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"c1@example.com"}, ${"C1"})`;
    await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"c2@example.com"}, ${"C2"})`;

    // Contract: multi-row under .one() must throw, not silently truncate.
    // We don't pin the exact message — just that it's recognizable as a
    // "more than one row" condition.
    let threw: unknown = null;
    try {
      await admin.one`SELECT email FROM mandu_test_users`;
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(Error);
    expect(String(threw)).toMatch(/one|single|multiple|row/i);
  });

  // --- 4. Transaction commit path ------------------------------------------

  it("transaction commits on success", async () => {
    await admin.transaction(async (tx) => {
      await tx`INSERT INTO mandu_test_users (email, name) VALUES (${"tx-ok@example.com"}, ${"TxOK"})`;
    });

    const row = await admin.one<{ email: string }>`
      SELECT email FROM mandu_test_users WHERE email = ${"tx-ok@example.com"}
    `;
    expect(row).toEqual({ email: "tx-ok@example.com" });
  });

  // --- 5. Transaction rollback path ----------------------------------------

  it("transaction rolls back on thrown error", async () => {
    const sentinel = new Error("rollback me");
    let caught: unknown = null;

    try {
      await admin.transaction(async (tx) => {
        await tx`
          INSERT INTO mandu_test_users (email, name)
          VALUES (${"tx-rollback@example.com"}, ${"TxRollback"})
        `;
        throw sentinel;
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(sentinel);

    // The insert must NOT have landed.
    const row = await admin.one`
      SELECT email FROM mandu_test_users WHERE email = ${"tx-rollback@example.com"}
    `;
    expect(row).toBeNull();
  });

  // --- 6. Concurrent connections -------------------------------------------

  it("two independent handles can write concurrently without interference", async () => {
    const a = createDb({ url: PG_URL!, provider: "postgres" });
    const b = createDb({ url: PG_URL!, provider: "postgres" });
    try {
      await Promise.all([
        a`INSERT INTO mandu_test_users (email, name) VALUES (${"conc-a@example.com"}, ${"A"})`,
        b`INSERT INTO mandu_test_users (email, name) VALUES (${"conc-b@example.com"}, ${"B"})`,
      ]);

      const rows = await admin<{ email: string }>`
        SELECT email FROM mandu_test_users
        WHERE email IN (${"conc-a@example.com"}, ${"conc-b@example.com"})
        ORDER BY email
      `;
      expect(rows.map((r) => r.email)).toEqual([
        "conc-a@example.com",
        "conc-b@example.com",
      ]);
    } finally {
      await a.close();
      await b.close();
    }
  });

  // --- 7. SQL injection resistance -----------------------------------------

  it("tagged-template params are bound, not concatenated (injection safe)", async () => {
    await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"inject@example.com"}, ${"Real"})`;

    // Classic injection — if params were concatenated this would truncate the
    // WHERE clause or drop the table. Bound correctly, it's just a literal
    // string that doesn't match any row.
    const malicious = `inject@example.com' OR '1'='1`;
    const rows = await admin<{ email: string }>`
      SELECT email FROM mandu_test_users WHERE email = ${malicious}
    `;
    expect(rows).toEqual([]);

    // The table still exists and the legitimate row is intact.
    const original = await admin.one<{ email: string }>`
      SELECT email FROM mandu_test_users WHERE email = ${"inject@example.com"}
    `;
    expect(original).toEqual({ email: "inject@example.com" });
  });

  // --- 8. Constraint violation surfaces a clear error ----------------------

  it("UNIQUE violation surfaces a descriptive error, not a generic crash", async () => {
    await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"dup@example.com"}, ${"First"})`;

    let caught: unknown = null;
    try {
      await admin`
        INSERT INTO mandu_test_users (email, name) VALUES (${"dup@example.com"}, ${"Second"})
      `;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    // Postgres error text contains "duplicate key" and/or "unique constraint".
    // We check loosely — the contract is "recognizably a constraint error".
    expect(String(caught)).toMatch(/duplicate|unique|constraint/i);
  });

  // --- 9. Close releases connections ---------------------------------------

  it("close() rejects subsequent queries", async () => {
    const db = createDb({ url: PG_URL!, provider: "postgres" });
    await db`SELECT 1`; // warm the connection
    await db.close();

    let caught: unknown = null;
    try {
      await db`SELECT 1`;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  // --- 10. Postgres-specific: RETURNING clause + JSONB ---------------------

  it("Postgres RETURNING clause yields inserted columns", async () => {
    const rows = await admin<{ id: number; email: string }>`
      INSERT INTO mandu_test_users (email, name)
      VALUES (${"return@example.com"}, ${"Returner"})
      RETURNING id, email
    `;
    expect(rows.length).toBe(1);
    expect(rows[0].email).toBe("return@example.com");
    expect(typeof rows[0].id).toBe("number");
    expect(rows[0].id).toBeGreaterThan(0);
  });

  it("Postgres JSONB column roundtrip preserves structure", async () => {
    const meta = { tags: ["mandu", "db"], count: 42, nested: { ok: true } };

    await admin`
      INSERT INTO mandu_test_events (kind, meta)
      VALUES (${"signup"}, ${JSON.stringify(meta)}::jsonb)
    `;

    const row = await admin.one<{ kind: string; meta: typeof meta }>`
      SELECT kind, meta FROM mandu_test_events WHERE kind = ${"signup"}
    `;
    expect(row?.kind).toBe("signup");
    // Bun.sql typically auto-parses JSONB into JS objects; if a consumer
    // gets back a string they should JSON.parse. We accept both shapes.
    const parsed =
      typeof row?.meta === "string" ? JSON.parse(row.meta) : row?.meta;
    expect(parsed).toEqual(meta);
  });
});
