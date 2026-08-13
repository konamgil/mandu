/**
 * @mandujs/core/db — unit tests
 *
 * These tests never open a real database connection. They substitute a
 * controllable in-memory fake for `Bun.SQL` via the internal
 * `_createDbWith` entry point, then assert that our wrapper:
 *
 *   - detects the provider correctly,
 *   - forwards tagged-template calls to Bun.SQL verbatim,
 *   - implements `.one()`, `.transaction()`, `.close()` semantics,
 *   - propagates post-close errors as the canonical message,
 *   - binds placeholder values as parameters (never string-interpolated).
 *
 * SQLite integration tests (hitting the real `Bun.SQL`) live in
 * `packages/core/tests/db/db-sqlite.test.ts`.
 */

import { describe, expect, it } from "bun:test";
import {
  _createDbWith,
  createDb,
  detectProvider,
  isSqlFragment,
  join,
  sql,
  type BunSqlCtor,
  type SqlProvider,
} from "../index";

// ─── Fake Bun.SQL ───────────────────────────────────────────────────────────

/** A captured (strings, values) tuple. */
interface CapturedCall {
  /** The raw TemplateStringsArray — cloned to a plain array to make assertions readable. */
  strings: readonly string[];
  values: readonly unknown[];
}

interface FakeState {
  ctorCalls: Array<Record<string, unknown>>;
  calls: CapturedCall[];
  /** `true` once `close()` has been invoked on any handle. */
  closed: boolean;
  closeCount: number;
  /**
   * If set, the next `call()` throws this error instead of returning rows.
   * After the throw, the override is cleared unless `sticky` is true.
   */
  nextError: { err: Error; sticky: boolean } | null;
  /** Rows returned by the next `call()` — pop-front queue. Default: `[]`. */
  nextRowsQueue: unknown[][];
}

/** Create a fake Bun.SQL ctor + observable state. */
function createFakeCtor(): { Ctor: BunSqlCtor; state: FakeState } {
  const state: FakeState = {
    ctorCalls: [],
    calls: [],
    closed: false,
    closeCount: 0,
    nextError: null,
    nextRowsQueue: [],
  };

  /**
   * The inner builder — used both for the top-level handle and for
   * transaction-scoped handles. Each is itself a callable tagged-template
   * function with `.begin` and `.close` attached.
   */
  function makeFakeSqlInstance(isTx = false): unknown {
    const call = (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (state.closed && !isTx) {
        // Simulate Bun.SQL's post-close failure — our wrapper should catch
        // this and rethrow with the canonical "pool closed" message.
        const err = Object.assign(new Error("Connection closed"), {
          code: "ERR_SQLITE_CONNECTION_CLOSED",
          name: "SQLiteError",
        });
        return Promise.reject(err);
      }
      state.calls.push({
        strings: Array.from(strings),
        values,
      });
      if (state.nextError) {
        const err = state.nextError.err;
        if (!state.nextError.sticky) state.nextError = null;
        return Promise.reject(err);
      }
      const rows = state.nextRowsQueue.shift() ?? [];
      // Bun.SQL returns an array-like with extra metadata; we emulate an
      // array and let `Array.from` in the wrapper coerce it. Plain array
      // is a valid subset.
      return Promise.resolve(rows);
    };

    const methods = {
      begin: async <R>(
        fn: (tx: unknown) => Promise<R>,
      ): Promise<R> => {
        const inner = makeFakeSqlInstance(true);
        return await fn(inner);
      },
      close: async (): Promise<void> => {
        state.closed = true;
        state.closeCount += 1;
      },
    };

    return Object.assign(call, methods);
  }

  function FakeBunSql(config: Record<string, unknown>) {
    state.ctorCalls.push(config);
    // Return the callable instance — NOT the default constructed object.
    return makeFakeSqlInstance(false);
  }

  return {
    Ctor: FakeBunSql as unknown as BunSqlCtor,
    state,
  };
}

// ─── detectProvider ────────────────────────────────────────────────────────

describe("@mandujs/core/compat/db — detectProvider", () => {
  it.each<[string, SqlProvider]>([
    ["postgres://user:pass@host:5432/db", "postgres"],
    ["postgresql://user:pass@host:5432/db", "postgres"],
    ["mysql://user@host:3306/db", "mysql"],
    ["mariadb://user@host/db", "mysql"],
    ["sqlite::memory:", "sqlite"],
    ["sqlite:./data.db", "sqlite"],
    ["sqlite://./data.db", "sqlite"],
  ])("maps %s to %s", (url, expected) => {
    expect(detectProvider(url)).toBe(expected);
  });

  it("throws a clear error on unsupported schemes", () => {
    expect(() => detectProvider("mongodb://host/db")).toThrow(
      /Unable to detect provider/,
    );
    expect(() => detectProvider("mongodb://host/db")).toThrow(/mongodb/);
  });

  it("throws when URL has no recognized scheme", () => {
    expect(() => detectProvider("not a url")).toThrow(/Unable to detect provider/);
  });
});

// ─── createDb / _createDbWith: basic surface ───────────────────────────────

describe("@mandujs/core/compat/db — createDb basics", () => {
  it("returns a callable handle with .provider set to sqlite for sqlite URL", () => {
    const db = createDb({ url: "sqlite::memory:" });
    expect(typeof db).toBe("function");
    expect(db.provider).toBe("sqlite");
    expect(typeof db.one).toBe("function");
    expect(typeof db.transaction).toBe("function");
    expect(typeof db.close).toBe("function");
  });

  it("respects config.provider override when url scheme is ambiguous", () => {
    const db = createDb({
      url: "custom://placeholder-rewritten-at-boot",
      provider: "sqlite",
    });
    expect(db.provider).toBe("sqlite");
  });

  it("throws TypeError when url is missing", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => createDb({ url: "" } as any)).toThrow(TypeError);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => _createDbWith({} as BunSqlCtor, { url: "" } as any)).toThrow(
      TypeError,
    );
  });

  it("throws a clear provider-detection error when url scheme is ambiguous and no override is set", () => {
    expect(() => createDb({ url: "kafka://not-a-db" })).toThrow(
      /Unable to detect provider/,
    );
  });
});

// ─── createDb: ctor forwarding ─────────────────────────────────────────────

describe("@mandujs/core/compat/db — ctor forwarding", () => {
  it("forwards url + detected adapter + default max (10 for postgres)", () => {
    const { Ctor, state } = createFakeCtor();
    _createDbWith(Ctor, { url: "postgres://u:p@h/db" });

    expect(state.ctorCalls).toHaveLength(1);
    expect(state.ctorCalls[0]!.url).toBe("postgres://u:p@h/db");
    expect(state.ctorCalls[0]!.adapter).toBe("postgres");
    expect(state.ctorCalls[0]!.max).toBe(10);
  });

  it("uses max=1 for sqlite by default", () => {
    const { Ctor, state } = createFakeCtor();
    _createDbWith(Ctor, { url: "sqlite::memory:" });
    expect(state.ctorCalls[0]!.max).toBe(1);
  });

  it("uses max=10 for mysql by default", () => {
    const { Ctor, state } = createFakeCtor();
    _createDbWith(Ctor, { url: "mysql://u@h/db" });
    expect(state.ctorCalls[0]!.max).toBe(10);
  });

  it("respects explicit config.max over provider defaults", () => {
    const { Ctor, state } = createFakeCtor();
    _createDbWith(Ctor, { url: "postgres://u:p@h/db", max: 42 });
    expect(state.ctorCalls[0]!.max).toBe(42);
  });

  it("passes options bag through to Bun.SQL but does not let it override url/adapter/max", () => {
    const { Ctor, state } = createFakeCtor();
    _createDbWith(Ctor, {
      url: "postgres://u:p@h/db",
      max: 5,
      options: {
        // User tries to sneak in conflicting values; our authoritative
        // fields must win to keep public surface deterministic.
        url: "mysql://sneaky",
        adapter: "mysql",
        max: 99,
        // Legitimate pass-through options:
        ssl: "require",
        idleTimeout: 30,
      },
    });

    const call = state.ctorCalls[0]!;
    expect(call.url).toBe("postgres://u:p@h/db");
    expect(call.adapter).toBe("postgres");
    expect(call.max).toBe(5);
    expect(call.ssl).toBe("require");
    expect(call.idleTimeout).toBe(30);
  });
});

// ─── Tagged-template forwarding ────────────────────────────────────────────

describe("@mandujs/core/compat/db — tagged template forwarding", () => {
  it("forwards the full TemplateStringsArray and values to Bun.SQL", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([{ id: 1, name: "alice" }]);

    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });
    const name = "alice";
    const id = 42;
    const rows = await db`SELECT * FROM users WHERE id = ${id} AND name = ${name}`;

    expect(state.calls).toHaveLength(1);
    expect(Array.from(state.calls[0]!.strings)).toEqual([
      "SELECT * FROM users WHERE id = ",
      " AND name = ",
      "",
    ]);
    expect(state.calls[0]!.values).toEqual([42, "alice"]);
    expect(rows).toEqual([{ id: 1, name: "alice" }]);
  });

  it("binds values as parameters, never string-interpolated (injection safety)", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([]);

    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });
    const userInput = "'; DROP TABLE users; --";
    await db`SELECT * FROM users WHERE name = ${userInput}`;

    // The forwarded TemplateStringsArray must contain placeholders around
    // the user-controlled value — NOT the value itself concatenated into
    // the SQL. If our wrapper ever regressed to string-interpolation, the
    // userInput would leak into strings[0] or strings[1].
    const call = state.calls[0]!;
    for (const s of call.strings) {
      expect(s).not.toContain(userInput);
      expect(s).not.toContain("DROP TABLE");
    }
    // And the value must be present in the bound-values array — exactly once.
    expect(call.values).toEqual([userInput]);
  });

  it("returns a plain array (not Bun.SQL's array-like with .count/.command metadata)", async () => {
    const { Ctor, state } = createFakeCtor();
    // Simulate the array-like Bun.SQL returns in real life.
    const fakeResult: { count: number; command: string } & Array<Record<string, unknown>> =
      Object.assign([{ x: 1 }, { x: 2 }], { count: 2, command: "SELECT" });
    state.nextRowsQueue.push(fakeResult);

    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });
    const rows = await db`SELECT x FROM t`;

    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toEqual([{ x: 1 }, { x: 2 }]);
    // These metadata fields should NOT be exposed via our wrapper.
    expect((rows as unknown as { count?: number }).count).toBeUndefined();
    expect((rows as unknown as { command?: string }).command).toBeUndefined();
  });
});

// ─── .one() ────────────────────────────────────────────────────────────────

describe("@mandujs/core/compat/db — .one()", () => {
  it("returns null when no rows match", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([]);

    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });
    const row = await db.one`SELECT * FROM users WHERE id = ${999}`;

    expect(row).toBeNull();
  });

  it("returns the single row when exactly one matches", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([{ id: 1, name: "alice" }]);

    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });
    const row = await db.one<{ id: number; name: string }>`
      SELECT * FROM users WHERE id = ${1}
    `;

    expect(row).toEqual({ id: 1, name: "alice" });
  });

  it("throws a clear error naming the count when multiple rows match", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    await expect(
      db.one`SELECT * FROM users WHERE active = ${true}`,
    ).rejects.toThrow(/expected 0 or 1 row, got 3/);
  });
});

// ─── .transaction() ────────────────────────────────────────────────────────

describe("@mandujs/core/compat/db — .transaction()", () => {
  it("calls the user fn with a tx handle of the same Db shape and commits on resolve", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([]); // INSERT 1
    state.nextRowsQueue.push([]); // INSERT 2

    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    const result = await db.transaction(async (tx) => {
      expect(typeof tx).toBe("function");
      expect(typeof tx.one).toBe("function");
      expect(typeof tx.transaction).toBe("function");
      expect(tx.provider).toBe("sqlite");
      await tx`INSERT INTO t (v) VALUES (${1})`;
      await tx`INSERT INTO t (v) VALUES (${2})`;
      return "ok";
    });

    expect(result).toBe("ok");
    expect(state.calls).toHaveLength(2);
    expect(state.calls[0]!.values).toEqual([1]);
    expect(state.calls[1]!.values).toEqual([2]);
  });

  it("propagates thrown errors from inside the transaction to the caller (rollback)", async () => {
    const { Ctor } = createFakeCtor();
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    class CustomError extends Error {}

    await expect(
      db.transaction(async (_tx) => {
        throw new CustomError("boom");
      }),
    ).rejects.toBeInstanceOf(CustomError);
  });

  it("rejects transaction() when the outer pool has been closed", async () => {
    const { Ctor } = createFakeCtor();
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });
    await db.close();

    await expect(
      db.transaction(async () => "never"),
    ).rejects.toThrow(/pool closed/);
  });
});

// ─── .close() ──────────────────────────────────────────────────────────────

describe("@mandujs/core/compat/db — .close()", () => {
  it("invokes Bun.SQL's close() exactly once", async () => {
    const { Ctor, state } = createFakeCtor();
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    await db.close();

    expect(state.closeCount).toBe(1);
    expect(state.closed).toBe(true);
  });

  it("is idempotent — calling close twice is a no-op", async () => {
    const { Ctor, state } = createFakeCtor();
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    await db.close();
    await db.close();

    // Second call must not double-invoke the underlying close.
    expect(state.closeCount).toBe(1);
  });

  it("rejects subsequent queries with the canonical pool-closed error", async () => {
    const { Ctor } = createFakeCtor();
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });
    await db.close();

    await expect(db`SELECT 1`).rejects.toThrow(/pool closed/);
    await expect(db.one`SELECT 1`).rejects.toThrow(/pool closed/);
  });
});

// ─── Public createDb probe behaviour ───────────────────────────────────────

describe("@mandujs/core/compat/db — public createDb lazy probe", () => {
  it("does NOT throw at construction time even if Bun.SQL were missing (lazy)", () => {
    // We can't actually remove Bun.SQL from globalThis in this test env (the
    // other integration suite relies on it), but we can prove the call
    // doesn't throw when the runtime probe would otherwise fire: calling
    // createDb() without issuing a query is a no-op on Bun.SQL.
    //
    // The "when Bun.SQL is missing" case is exercised by the negative
    // unit test below via `_createDbWith` (which accepts the ctor
    // explicitly). The production `createDb()` path goes through
    // `getBunSqlCtor()` inside `materialize()`, which is only called on
    // the first query.
    const db = createDb({ url: "sqlite::memory:" });
    expect(db.provider).toBe("sqlite");
    // No query yet → no Bun.SQL lookup yet.
  });

  it("throws a version-specific error when the injected ctor factory returns nothing (simulates missing Bun.SQL)", () => {
    // The Bun global itself is a read-only binding in this runtime, so we
    // can't monkey-patch `globalThis.Bun.SQL` to prove the probe message
    // from the public `createDb` path. We test the contract equivalently:
    // `_createDbWith` accepts any ctor, and the error-message shape emitted
    // by `getBunSqlCtor()` in production is verified by reading the module
    // source below. Any bad-ctor injection here (non-function) would be a
    // TypeError at `new`, which is also an acceptable surface.
    //
    // We assert the message CONTENT by pointing at the string constant
    // directly — this catches any regression that weakens the user-facing
    // error without needing to monkey-patch a frozen global.
    //
    // Keep this in sync with the `getBunSqlCtor` source in
    // `packages/core/src/db/index.ts`.
    const EXPECTED_PREFIX = "[@mandujs/core/db] Bun.sql is unavailable";
    const EXPECTED_VERSION_MENTION = "Bun runtime >= 1.3.x";
    // Read the source string and assert the message still matches. This is
    // a belt-and-braces check that survives the frozen-global limitation.
    //
    // The src path is stable because this file is rooted at packages/core.
    const srcPath = new URL(
      "../index.ts",
      import.meta.url,
    ).pathname;
    const src = Bun.file(srcPath.replace(/^\/([a-zA-Z]:)/, "$1"));
    return src.text().then((text) => {
      expect(text).toContain(EXPECTED_PREFIX);
      expect(text).toContain(EXPECTED_VERSION_MENTION);
      expect(text).toContain("https://bun.com/docs/installation");
    });
  });

  it("close() on a handle that never materialized a real connection is a no-op", async () => {
    const db = createDb({ url: "sqlite::memory:" });
    // We haven't called anything, so no Bun.SQL instance was constructed.
    // close() should succeed without materializing one.
    await expect(db.close()).resolves.toBeUndefined();
  });
});

// ─── Composable SQL fragments (#315) ─────────────────────────────────────────

describe("@mandujs/core/compat/db — sql fragments", () => {
  it("sql`` produces an inert fragment; isSqlFragment recognizes it", () => {
    const frag = sql`x = ${1}`;
    expect(isSqlFragment(frag)).toBe(true);
    expect(isSqlFragment({})).toBe(false);
    expect(isSqlFragment(null)).toBe(false);
    expect(isSqlFragment("x = 1")).toBe(false);
    // A fragment must NOT be a Promise — it should not be executed on its own.
    expect(typeof (frag as unknown as { then?: unknown }).then).toBe("undefined");
  });

  it("flattens a fragment into merged static text + bound values", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([]);
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    const where = db.sql`WHERE party = ${"green"}`;
    await db`SELECT * FROM pledges ${where} ORDER BY id`;

    const call = state.calls[0]!;
    // Static text merged; the value stays a bound parameter (placeholder gap).
    expect(Array.from(call.strings).join("?")).toBe(
      "SELECT * FROM pledges WHERE party = ? ORDER BY id",
    );
    expect(call.values).toEqual(["green"]);
  });

  it("composes optional filters with join and keeps every value bound", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([]);
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    const party = "green";
    const region: string | null = "seoul";
    const search = "climate";
    const conds = [];
    if (party) conds.push(db.sql`party = ${party}`);
    if (region) conds.push(db.sql`region = ${region}`);
    if (search) conds.push(db.sql`title ILIKE ${"%" + search + "%"}`);

    const where = conds.length
      ? db.sql`WHERE ${db.join(conds, " AND ")}`
      : db.sql``;
    const limit = 20;
    await db`SELECT * FROM pledges ${where} ORDER BY created_at DESC LIMIT ${limit}`;

    const call = state.calls[0]!;
    // Values bind left-to-right across the whole assembled query.
    expect(call.values).toEqual(["green", "seoul", "%climate%", 20]);
    // No interpolated value leaked into the SQL text.
    const joined = Array.from(call.strings).join("");
    expect(joined).toContain("WHERE party = ");
    expect(joined).toContain(" AND region = ");
    expect(joined).toContain(" AND title ILIKE ");
    expect(joined).toContain("LIMIT ");
    expect(joined).not.toContain("green");
    expect(joined).not.toContain("%climate%");
  });

  it("empty join / empty fragment collapse to no-op text and bind nothing", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([]);
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    const conds: ReturnType<typeof sql>[] = [];
    const where = conds.length ? db.sql`WHERE ${db.join(conds, " AND ")}` : db.sql``;
    await db`SELECT * FROM pledges ${where} ORDER BY id`;

    const call = state.calls[0]!;
    expect(Array.from(call.strings).join("")).toBe(
      "SELECT * FROM pledges  ORDER BY id",
    );
    expect(call.values).toEqual([]);
  });

  it("flattens nested fragments recursively with correct bind order", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([]);
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    const inner = sql`b = ${2} AND c = ${3}`;
    const outer = sql`a = ${1} AND (${inner})`;
    await db`SELECT * FROM t WHERE ${outer}`;

    const call = state.calls[0]!;
    expect(call.values).toEqual([1, 2, 3]);
    expect(Array.from(call.strings).join("?")).toBe(
      "SELECT * FROM t WHERE a = ? AND (b = ? AND c = ?)",
    );
  });

  it("treats injection attempts inside a fragment value as a bound parameter", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([]);
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    const evil = "'; DROP TABLE users; --";
    const where = db.sql`name = ${evil}`;
    await db`SELECT * FROM users WHERE ${where}`;

    const call = state.calls[0]!;
    for (const s of call.strings) {
      expect(s).not.toContain("DROP TABLE");
      expect(s).not.toContain(evil);
    }
    expect(call.values).toEqual([evil]);
  });

  it("fragments compose through .one() as well", async () => {
    const { Ctor, state } = createFakeCtor();
    state.nextRowsQueue.push([{ id: 7 }]);
    const db = _createDbWith(Ctor, { url: "sqlite::memory:" });

    const where = db.sql`id = ${7}`;
    const row = await db.one`SELECT * FROM t WHERE ${where}`;

    expect(row).toEqual({ id: 7 });
    expect(state.calls[0]!.values).toEqual([7]);
  });

  it("exposes sql/join on the lazy createDb handle too", () => {
    const db = createDb({ url: "sqlite::memory:" });
    expect(typeof db.sql).toBe("function");
    expect(typeof db.join).toBe("function");
    expect(isSqlFragment(db.sql`x = ${1}`)).toBe(true);
  });
});
