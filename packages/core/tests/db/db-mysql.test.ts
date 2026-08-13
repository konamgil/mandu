/**
 * @mandujs/core/db — MySQL integration tests
 *
 * These tests run against a real MySQL 8 server provisioned by
 * `packages/core/tests/fixtures/db/docker-compose.yml`. They exercise the
 * createDb contract end-to-end — no fakes, no in-memory swap — across the
 * 10 symmetry cases the db-postgres suite also covers, plus MySQL-specific
 * features (AUTO_INCREMENT + LAST_INSERT_ID()).
 *
 * ### Gate
 *
 * The suite is gated on the `DB_TEST_MYSQL_URL` env var so CI (and
 * contributors who haven't brought up docker) no-op the suite cleanly.
 * With `DB_TEST_MYSQL_URL` unset, every `it` is `describe.skip`-ed and the
 * runner reports the tests as skipped (not failed).
 *
 * ### Identifier handling
 *
 * `@mandujs/core/db` deliberately binds every `${…}` in a tagged template
 * as a SQL **parameter**, not as SQL text. That's the right default (zero
 * injection surface) but it means DDL like `CREATE TABLE ${name}` can't
 * work through the tagged template. The suite therefore uses **fixed
 * identifier literals** hard-coded into the SQL strings, with `DROP TABLE
 * IF EXISTS` in `beforeAll` to guarantee a clean slate.
 *
 * ### How to run locally
 *
 * ```bash
 * docker compose -f packages/core/tests/fixtures/db/docker-compose.yml up -d
 * export DB_TEST_MYSQL_URL=mysql://test:test@localhost:3307/testdb
 * bun test packages/core/tests/db/db-mysql.test.ts
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

const MYSQL_URL = process.env.DB_TEST_MYSQL_URL;

const describeIfMysql = MYSQL_URL ? describe : describe.skip;

describeIfMysql("@mandujs/core/compat/db — MySQL integration", () => {
  async function withMysqlDb<T>(
    fn: (db: ReturnType<typeof createDb>) => Promise<T>,
  ): Promise<T> {
    // Bun 1.3.12's MySQL driver can hang under bun:test when a handle created
    // in a lifecycle hook is reused by a test body. Keep handles hook/test local.
    const db = createDb({ url: MYSQL_URL!, provider: "mysql" });
    try {
      return await fn(db);
    } finally {
      await db.close();
    }
  }

  beforeAll(async () => {
    await withMysqlDb(async (db) => {
      // Clean slate — the container volume may have survived a previous run
      // that crashed before teardown. Child tables first (FK ordering).
      await db`DROP TABLE IF EXISTS mandu_test_posts`.catch(() => {});
      await db`DROP TABLE IF EXISTS mandu_test_events`.catch(() => {});
      await db`DROP TABLE IF EXISTS mandu_test_users`.catch(() => {});

      // Minimal schemas. The suite owns creating these; the fixture only
      // provisions the empty `testdb` database.
      await db`
        CREATE TABLE mandu_test_users (
          id    INT AUTO_INCREMENT PRIMARY KEY,
          email VARCHAR(191) NOT NULL UNIQUE,
          name  VARCHAR(191) NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `;
      await db`
        CREATE TABLE mandu_test_posts (
          id        INT AUTO_INCREMENT PRIMARY KEY,
          author_id INT NOT NULL,
          title     VARCHAR(191) NOT NULL,
          FOREIGN KEY (author_id) REFERENCES mandu_test_users(id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `;
      await db`
        CREATE TABLE mandu_test_events (
          id   INT AUTO_INCREMENT PRIMARY KEY,
          kind VARCHAR(64) NOT NULL,
          meta JSON NOT NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `;
    });
  });

  afterAll(async () => {
    await withMysqlDb(async (db) => {
      // Best-effort — the fixture's `down -v` is authoritative.
      await db`DROP TABLE IF EXISTS mandu_test_posts`.catch(() => {});
      await db`DROP TABLE IF EXISTS mandu_test_events`.catch(() => {});
      await db`DROP TABLE IF EXISTS mandu_test_users`.catch(() => {});
    });
  });

  afterEach(async () => {
    // MySQL doesn't allow TRUNCATE on a table with FK references from a
    // non-empty child, so we DELETE + reset AUTO_INCREMENT manually. We
    // delete child tables first.
    await withMysqlDb(async (db) => {
      await db`DELETE FROM mandu_test_posts`;
      await db`DELETE FROM mandu_test_events`;
      await db`DELETE FROM mandu_test_users`;
      await db`ALTER TABLE mandu_test_users AUTO_INCREMENT = 1`;
      await db`ALTER TABLE mandu_test_posts AUTO_INCREMENT = 1`;
      await db`ALTER TABLE mandu_test_events AUTO_INCREMENT = 1`;
    });
  });

  // --- 1. createDb + simple SELECT ------------------------------------------

  it("createDb + simple SELECT returns rows", async () => {
    const db = createDb({ url: MYSQL_URL!, provider: "mysql" });
    try {
      const rows = await db<{ one: number }>`SELECT 1 AS one`;
      expect(rows).toEqual([{ one: 1 }]);
      expect(db.provider).toBe("mysql");
    } finally {
      await db.close();
    }
  });

  // --- 2. INSERT + SELECT roundtrip with parameter binding ------------------

  it("INSERT + SELECT roundtrip with parameter binding", async () => {
    await withMysqlDb(async (admin) => {
      const email = "alice@example.com";
      const name = "Alice";

      await admin`INSERT INTO mandu_test_users (email, name) VALUES (${email}, ${name})`;

      const rows = await admin<{ email: string; name: string }>`
        SELECT email, name FROM mandu_test_users WHERE email = ${email}
      `;
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual({ email, name });
    });
  });

  // --- 3. .one() — 0/1/2+ row cases -----------------------------------------

  it(".one() returns null on zero rows", async () => {
    await withMysqlDb(async (admin) => {
      const row = await admin.one<{ id: number }>`
        SELECT id FROM mandu_test_users WHERE email = ${"nobody@example.com"}
      `;
      expect(row).toBeNull();
    });
  });

  it(".one() returns the single row on one-row result", async () => {
    await withMysqlDb(async (admin) => {
      await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"bob@example.com"}, ${"Bob"})`;

      const row = await admin.one<{ email: string; name: string }>`
        SELECT email, name FROM mandu_test_users WHERE email = ${"bob@example.com"}
      `;
      expect(row).toEqual({ email: "bob@example.com", name: "Bob" });
    });
  });

  it(".one() on a multi-row result surfaces a descriptive error", async () => {
    await withMysqlDb(async (admin) => {
      await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"c1@example.com"}, ${"C1"})`;
      await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"c2@example.com"}, ${"C2"})`;

      // Contract: multi-row under .one() must throw, not silently truncate.
      let threw: unknown = null;
      try {
        await admin.one`SELECT email FROM mandu_test_users`;
      } catch (err) {
        threw = err;
      }
      expect(threw).toBeInstanceOf(Error);
      expect(String(threw)).toMatch(/one|single|multiple|row/i);
    });
  });

  // --- 4. Transaction commit path ------------------------------------------

  it("transaction commits on success", async () => {
    await withMysqlDb(async (admin) => {
      await admin.transaction(async (tx) => {
        await tx`INSERT INTO mandu_test_users (email, name) VALUES (${"tx-ok@example.com"}, ${"TxOK"})`;
      });

      const row = await admin.one<{ email: string }>`
        SELECT email FROM mandu_test_users WHERE email = ${"tx-ok@example.com"}
      `;
      expect(row).toEqual({ email: "tx-ok@example.com" });
    });
  });

  // --- 5. Transaction rollback path ----------------------------------------

  it("transaction rolls back on thrown error", async () => {
    const sentinel = new Error("rollback me");
    await withMysqlDb(async (admin) => {
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

      const row = await admin.one`
        SELECT email FROM mandu_test_users WHERE email = ${"tx-rollback@example.com"}
        `;
      expect(row).toBeNull();
    });
  });

  // --- 6. Concurrent connections -------------------------------------------

  it("two independent handles can write concurrently without interference", async () => {
    await withMysqlDb(async (admin) => {
      const a = createDb({ url: MYSQL_URL!, provider: "mysql" });
      const b = createDb({ url: MYSQL_URL!, provider: "mysql" });
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
  });

  // --- 7. SQL injection resistance -----------------------------------------

  it("tagged-template params are bound, not concatenated (injection safe)", async () => {
    await withMysqlDb(async (admin) => {
      await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"inject@example.com"}, ${"Real"})`;

      const malicious = `inject@example.com' OR '1'='1`;
      const rows = await admin<{ email: string }>`
        SELECT email FROM mandu_test_users WHERE email = ${malicious}
      `;
      expect(rows).toEqual([]);

      const original = await admin.one<{ email: string }>`
        SELECT email FROM mandu_test_users WHERE email = ${"inject@example.com"}
      `;
      expect(original).toEqual({ email: "inject@example.com" });
    });
  });

  // --- 8. Constraint violation surfaces a clear error ----------------------

  it("UNIQUE violation surfaces a descriptive error, not a generic crash", async () => {
    await withMysqlDb(async (admin) => {
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
      // MySQL 8 reports: "Duplicate entry 'dup@example.com' for key '<name>'".
      expect(String(caught)).toMatch(/duplicate|unique|constraint/i);
    });
  });

  // --- 9. Close releases connections ---------------------------------------

  it("close() rejects subsequent queries", async () => {
    const db = createDb({ url: MYSQL_URL!, provider: "mysql" });
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

  // --- 10. MySQL-specific: AUTO_INCREMENT + LAST_INSERT_ID() ---------------

  it("MySQL AUTO_INCREMENT yields monotonically increasing ids", async () => {
    await withMysqlDb(async (admin) => {
      await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"ai-1@example.com"}, ${"AI1"})`;
      await admin`INSERT INTO mandu_test_users (email, name) VALUES (${"ai-2@example.com"}, ${"AI2"})`;

      const rows = await admin<{ id: number; email: string }>`
        SELECT id, email FROM mandu_test_users
        WHERE email IN (${"ai-1@example.com"}, ${"ai-2@example.com"})
        ORDER BY id ASC
      `;
      expect(rows.length).toBe(2);
      expect(rows[0].email).toBe("ai-1@example.com");
      expect(rows[1].email).toBe("ai-2@example.com");
      expect(rows[1].id).toBeGreaterThan(rows[0].id);
    });
  });

  it("MySQL LAST_INSERT_ID() within a transaction returns the inserted row id", async () => {
    const lastId = await withMysqlDb(async (admin) => {
      const insertedId = await admin.transaction(async (tx) => {
        await tx`INSERT INTO mandu_test_users (email, name) VALUES (${"lid@example.com"}, ${"LID"})`;
        const row = await tx.one<{ id: number }>`SELECT LAST_INSERT_ID() AS id`;
        return row?.id ?? -1;
      });

      expect(insertedId).toBeGreaterThan(0);

      const persisted = await admin.one<{ id: number; email: string }>`
        SELECT id, email FROM mandu_test_users WHERE email = ${"lid@example.com"}
      `;
      expect(persisted).not.toBeNull();
      expect(persisted!.id).toBe(insertedId);
      return insertedId;
    });

    expect(lastId).toBeGreaterThan(0);
  });
});
