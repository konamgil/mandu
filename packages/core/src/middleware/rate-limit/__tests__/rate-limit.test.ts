/**
 * Rate-limit middleware tests.
 *
 * Structure:
 *   1. Middleware — uses the injectable clock (__now) to drive scenarios
 *      deterministically; no real timers.
 *   2. In-memory store — same clock injection, symmetric to SQLite
 *      contract below.
 *   3. SQLite store — uses real Bun.SQL through @mandujs/core/db (gated on
 *      Bun.SQL being available so a generic Node runner can still load the
 *      file without failing to compile imports).
 *   4. Guard — exercises the imperative `enforce` / `check` surface.
 *
 * The module-level `__now` clock is mutated in tests via the internal
 * `_setClockForTests` export. `beforeEach` / `afterEach` restore the real
 * clock so a failing assert cannot leak a frozen clock into another test.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createInMemoryStore,
  createRateLimitGuard,
  createSqliteStore,
  rateLimit,
  RateLimitError,
  _setClockForTests,
  type RateLimitStore,
} from "../index";
import { ManduContext } from "../../../filling/context";

// ─── Test helpers ───────────────────────────────────────────────────────────

/** Mutable fake clock. Reset in beforeEach. */
let fakeNow = 0;

function setNow(ms: number): void {
  fakeNow = ms;
  _setClockForTests(() => fakeNow);
}

function advance(ms: number): void {
  fakeNow += ms;
}

function restoreClock(): void {
  _setClockForTests(null);
}

function makeReq(
  url: string,
  init: RequestInit & { xForwardedFor?: string; xRealIp?: string } = {},
): Request {
  const { xForwardedFor, xRealIp, headers: rawHeaders, ...rest } = init;
  const headers = new Headers(rawHeaders as HeadersInit | undefined);
  if (xForwardedFor) headers.set("x-forwarded-for", xForwardedFor);
  if (xRealIp) headers.set("x-real-ip", xRealIp);
  return new Request(url, { ...rest, headers });
}

function makeCtx(req: Request): ManduContext {
  return new ManduContext(req);
}

/**
 * Run the middleware. When it returns void (allowed), synthesise a 200
 * response so tests can uniformly inspect `res.headers`. When it returns a
 * response (blocked), pass it through.
 */
async function runMw(
  mw: (ctx: ManduContext) => Promise<Response | void>,
  ctx: ManduContext,
): Promise<{ res: Response; passed: boolean }> {
  const out = await mw(ctx);
  if (out) return { res: out, passed: false };
  return { res: new Response(null, { status: 200 }), passed: true };
}

// Keep fake clock fresh across every test.
beforeEach(() => {
  setNow(1_700_000_000_000); // a fixed moment in 2023
});
afterEach(() => {
  restoreClock();
});

// ─── Middleware tests ──────────────────────────────────────────────────────

describe("rateLimit middleware", () => {
  it("allows a request under the limit and returns void (pass-through)", async () => {
    const mw = rateLimit({ limit: 5, windowMs: 60_000 });
    const ctx = makeCtx(
      makeReq("http://localhost/", {
        method: "POST",
        xForwardedFor: "10.0.0.1",
      }),
    );
    const { passed, res } = await runMw(mw, ctx);
    expect(passed).toBe(true);
    expect(res.status).toBe(200);
  });

  it("blocks the (limit+1)th request with 429 + Retry-After", async () => {
    const mw = rateLimit({ limit: 2, windowMs: 60_000 });
    const ip = "10.0.0.2";

    // burn the budget
    for (let i = 0; i < 2; i++) {
      const ctx = makeCtx(
        makeReq("http://localhost/", { method: "POST", xForwardedFor: ip }),
      );
      const { passed } = await runMw(mw, ctx);
      expect(passed).toBe(true);
    }

    const blockedCtx = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: ip }),
    );
    const { passed, res } = await runMw(mw, blockedCtx);
    expect(passed).toBe(false);
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(res.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    const resetHeader = res.headers.get("X-RateLimit-Reset");
    expect(resetHeader).not.toBeNull();
    // Reset header is Unix seconds (not ms).
    expect(Number(resetHeader)).toBeLessThan(2_000_000_000);
  });

  it("resets the budget after windowMs elapses", async () => {
    const mw = rateLimit({ limit: 1, windowMs: 60_000 });
    const ip = "10.0.0.3";

    // exhaust then confirm blocked
    const c1 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: ip }),
    );
    expect((await runMw(mw, c1)).passed).toBe(true);
    const c2 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: ip }),
    );
    expect((await runMw(mw, c2)).passed).toBe(false);

    // advance past the window → allowed again
    advance(60_001);
    const c3 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: ip }),
    );
    expect((await runMw(mw, c3)).passed).toBe(true);
  });

  it("honours a custom keyFn", async () => {
    const observedKeys: string[] = [];
    const store = createInMemoryStore();
    // Wrap store to observe the key passed through.
    const wrapped: RateLimitStore = {
      async hit(key, limit, windowMs) {
        observedKeys.push(key);
        return store.hit(key, limit, windowMs);
      },
      async gcNow(olderThanMs) {
        return store.gcNow(olderThanMs);
      },
    };
    const mw = rateLimit({
      limit: 5,
      windowMs: 60_000,
      store: wrapped,
      keyFn: () => "custom-key-42",
    });
    const ctx = makeCtx(makeReq("http://localhost/", { method: "POST" }));
    await runMw(mw, ctx);
    expect(observedKeys).toEqual(["custom-key-42"]);
  });

  it("treats keyFn returning null as skip (store untouched, no headers)", async () => {
    let hitCount = 0;
    const store: RateLimitStore = {
      async hit(...args) {
        hitCount++;
        return createInMemoryStore().hit(...args);
      },
      async gcNow() {
        return 0;
      },
    };
    const mw = rateLimit({
      limit: 1,
      windowMs: 60_000,
      store,
      keyFn: () => null,
    });
    const ctx = makeCtx(makeReq("http://localhost/", { method: "POST" }));
    const { passed, res } = await runMw(mw, ctx);
    expect(passed).toBe(true);
    expect(hitCount).toBe(0);
    // No rate-limit headers on pass-through.
    expect(res.headers.has("X-RateLimit-Limit")).toBe(false);
  });

  it("bypasses the store when skip(ctx) returns true", async () => {
    let hitCount = 0;
    const store: RateLimitStore = {
      async hit(...args) {
        hitCount++;
        return createInMemoryStore().hit(...args);
      },
      async gcNow() {
        return 0;
      },
    };
    const mw = rateLimit({
      limit: 1,
      windowMs: 60_000,
      store,
      skip: () => true,
    });
    const ctx = makeCtx(makeReq("http://localhost/", { method: "POST" }));
    const { passed } = await runMw(mw, ctx);
    expect(passed).toBe(true);
    expect(hitCount).toBe(0);
  });

  it("isolates limits across keys — blocking key A does not affect key B", async () => {
    const mw = rateLimit({ limit: 1, windowMs: 60_000 });

    // A: burn and block
    const a1 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: "1.1.1.1" }),
    );
    expect((await runMw(mw, a1)).passed).toBe(true);
    const a2 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: "1.1.1.1" }),
    );
    expect((await runMw(mw, a2)).passed).toBe(false);

    // B: first hit still allowed
    const b1 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: "2.2.2.2" }),
    );
    expect((await runMw(mw, b1)).passed).toBe(true);
  });

  it("uses x-real-ip fallback when x-forwarded-for is absent", async () => {
    const mw = rateLimit({ limit: 1, windowMs: 60_000 });
    const c1 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xRealIp: "3.3.3.3" }),
    );
    expect((await runMw(mw, c1)).passed).toBe(true);
    const c2 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xRealIp: "3.3.3.3" }),
    );
    expect((await runMw(mw, c2)).passed).toBe(false);
  });

  it("skips safe methods via a custom `skip` predicate", async () => {
    const mw = rateLimit({
      limit: 1,
      windowMs: 60_000,
      skip: (ctx) =>
        ctx.request.method === "GET" || ctx.request.method === "HEAD",
    });

    // GET: allowed and again allowed (skipped).
    const g1 = makeCtx(
      makeReq("http://localhost/", { method: "GET", xForwardedFor: "4.4.4.4" }),
    );
    expect((await runMw(mw, g1)).passed).toBe(true);
    const g2 = makeCtx(
      makeReq("http://localhost/", { method: "GET", xForwardedFor: "4.4.4.4" }),
    );
    expect((await runMw(mw, g2)).passed).toBe(true);

    // POST on the same IP is still rate-limited.
    const p1 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: "4.4.4.4" }),
    );
    expect((await runMw(mw, p1)).passed).toBe(true);
    const p2 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: "4.4.4.4" }),
    );
    expect((await runMw(mw, p2)).passed).toBe(false);
  });

  it("custom handler: shapes the 429 body the caller's way", async () => {
    const mw = rateLimit({
      limit: 1,
      windowMs: 60_000,
      handler: (_ctx, result) =>
        Response.json(
          { kind: "too_many", wait: result.retryAfterSeconds },
          { status: 429 },
        ),
    });
    const c1 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: "5.5.5.5" }),
    );
    await runMw(mw, c1);
    const c2 = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: "5.5.5.5" }),
    );
    const { res } = await runMw(mw, c2);
    const body = await res.json();
    expect(body.kind).toBe("too_many");
    expect(typeof body.wait).toBe("number");
    expect(body.wait).toBeGreaterThan(0);
    // Retry-After is still stamped by the middleware on the caller's response.
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  it("concurrent hits increment strictly — no lost updates", async () => {
    const mw = rateLimit({ limit: 100, windowMs: 60_000 });
    const ip = "6.6.6.6";
    const ctxs = Array.from({ length: 50 }, () =>
      makeCtx(
        makeReq("http://localhost/", { method: "POST", xForwardedFor: ip }),
      ),
    );
    const results = await Promise.all(ctxs.map((c) => runMw(mw, c)));
    const passed = results.filter((r) => r.passed).length;
    // All 50 well under limit 100 — all must pass.
    expect(passed).toBe(50);

    // 51st more: must still pass. (Total 51, still under 100.)
    const extra = makeCtx(
      makeReq("http://localhost/", { method: "POST", xForwardedFor: ip }),
    );
    expect((await runMw(mw, extra)).passed).toBe(true);
  });

  it("rejects invalid options (limit / windowMs must be positive integers)", () => {
    expect(() => rateLimit({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => rateLimit({ limit: 1, windowMs: 0 })).toThrow();
    expect(() => rateLimit({ limit: 1.5, windowMs: 1000 })).toThrow();
    expect(() => rateLimit({ limit: -1, windowMs: 1000 })).toThrow();
  });
});

// ─── In-memory store tests ─────────────────────────────────────────────────

describe("createInMemoryStore", () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = createInMemoryStore();
  });

  afterEach(async () => {
    if (store.close) await store.close();
  });

  it("allows hits under the limit, blocks above", async () => {
    const r1 = await store.hit("k", 3, 60_000);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await store.hit("k", 3, 60_000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await store.hit("k", 3, 60_000);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = await store.hit("k", 3, 60_000);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("gcNow drops stale entries and reports the count", async () => {
    // Timeline (T0 = fakeNow at start):
    //   T0:         hit("old")    → windowStart=T0,           count=1
    //   T0+30_000:  hit("fresh")  → windowStart=T0+30_000,    count=1
    //   advance to T0+40_000.
    //   gcNow(35_000) → stale when (now - windowStart) > 35_000:
    //     old:   40_000 - 0      = 40_000 > 35_000 → stale ✓
    //     fresh: 40_000 - 30_000 = 10_000         → alive ✓
    await store.hit("old", 5, 60_000);
    advance(30_000);
    await store.hit("fresh", 5, 60_000);
    advance(10_000);

    const deleted = await store.gcNow(35_000);
    expect(deleted).toBe(1);

    // `fresh` survives: its window is still the original one (not rolled
    // over, since only 10_000 ms have elapsed since it started). Second
    // hit increments count from 1 → 2; remaining = limit(5) - 2 = 3.
    const after = await store.hit("fresh", 5, 60_000);
    expect(after.remaining).toBe(3);
  });

  it("close() prevents subsequent use", async () => {
    await store.hit("k", 5, 60_000);
    await store.close!();
    await expect(store.hit("k", 5, 60_000)).rejects.toThrow(/closed/);
  });

  it("rollover: fresh window after the previous one fully elapsed", async () => {
    const r1 = await store.hit("k", 2, 60_000);
    expect(r1.allowed).toBe(true);
    const r2 = await store.hit("k", 2, 60_000);
    expect(r2.allowed).toBe(true);
    const r3 = await store.hit("k", 2, 60_000);
    expect(r3.allowed).toBe(false);

    advance(60_001);
    const r4 = await store.hit("k", 2, 60_000);
    expect(r4.allowed).toBe(true);
    expect(r4.remaining).toBe(1);
  });
});

// ─── SQLite store tests ─────────────────────────────────────────────────────

const hasBunSql = (() => {
  const g = globalThis as unknown as { Bun?: { SQL?: unknown } };
  return typeof g.Bun?.SQL === "function";
})();
const describeIfBunSql = hasBunSql ? describe : describe.skip;

describeIfBunSql("createSqliteStore", () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "mandu-rl-"));
  });

  afterEach(() => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("symmetric contract with in-memory: allowed → blocked → rolls over", async () => {
    const store = createSqliteStore({
      dbPath: ":memory:",
      gcSchedule: false,
    });
    try {
      const r1 = await store.hit("k", 2, 60_000);
      expect(r1.allowed).toBe(true);
      const r2 = await store.hit("k", 2, 60_000);
      expect(r2.allowed).toBe(true);
      const r3 = await store.hit("k", 2, 60_000);
      expect(r3.allowed).toBe(false);
      expect(r3.remaining).toBe(0);
      expect(r3.retryAfterSeconds).toBeGreaterThan(0);
    } finally {
      await store.close?.();
    }
  });

  it("WAL mode is enabled against a file-backed DB", async () => {
    // File-backed so the pragma is observable.
    const dbPath = join(scratch, "rl.db");
    const store = createSqliteStore({ dbPath, gcSchedule: false });
    try {
      // Issue a dummy hit to force init.
      await store.hit("probe", 5, 60_000);

      // Reopen the same file via createDb and check the journal mode.
      const { createDb } = await import("../../../db");
      const probe = createDb({ url: `sqlite:${dbPath}` });
      const rows = await probe<{ journal_mode: string }>`PRAGMA journal_mode`;
      const mode = rows[0]?.journal_mode?.toLowerCase();
      expect(mode).toBe("wal");
      await probe.close();
    } finally {
      await store.close?.();
    }
  });

  it("concurrent hits on the same key serialise (no lost updates)", async () => {
    const store = createSqliteStore({
      dbPath: join(scratch, "concurrent.db"),
      gcSchedule: false,
    });
    try {
      const hits = await Promise.all(
        Array.from({ length: 20 }, () => store.hit("concurrent", 12, 60_000)),
      );
      const allowed = hits.filter((hit) => hit.allowed);
      const blocked = hits.filter((hit) => !hit.allowed);
      expect(allowed.map((hit) => hit.remaining).sort((a, b) => a - b))
        .toEqual(Array.from({ length: 12 }, (_, index) => index));
      expect(blocked.map((hit) => hit.remaining)).toEqual(Array(8).fill(0));
    } finally {
      await store.close?.();
    }
  });

  it("gcNow deletes stale entries and reports accurate count", async () => {
    const store = createSqliteStore({
      dbPath: ":memory:",
      gcSchedule: false,
    });
    try {
      // Real clock here (no injection into SQLite helper). Insert a hit,
      // then call gcNow with olderThanMs = 0 which sets cutoff = now and
      // deletes everything whose window_start < now. The INSERT used
      // `Date.now()` as window_start — since Date.now() at cutoff
      // computation time is equal-or-greater, rows inserted strictly before
      // this instant are stale.
      await store.hit("a", 5, 60_000);
      // Brief async yield so the next Date.now() is likely greater.
      await new Promise((r) => setTimeout(r, 5));
      await store.hit("b", 5, 60_000);
      await new Promise((r) => setTimeout(r, 5));

      // `olderThanMs = 0` → cutoff = now; any row whose window_start < now
      // is stale. Both rows qualify.
      const deleted = await store.gcNow(0);
      expect(deleted).toBeGreaterThanOrEqual(2);
    } finally {
      await store.close?.();
    }
  });

  it("close() prevents subsequent use", async () => {
    const store = createSqliteStore({
      dbPath: ":memory:",
      gcSchedule: false,
    });
    await store.hit("k", 5, 60_000);
    await store.close?.();
    await expect(store.hit("k", 5, 60_000)).rejects.toThrow(/closed/);
  });

  it("rejects unsafe table names at construction", () => {
    expect(() =>
      createSqliteStore({
        dbPath: ":memory:",
        table: "bad name",
        gcSchedule: false,
      }),
    ).toThrow(/Invalid table name/);
    expect(() =>
      createSqliteStore({
        dbPath: ":memory:",
        table: "drop;--",
        gcSchedule: false,
      }),
    ).toThrow(/Invalid table name/);
  });
});

// ─── Guard tests ───────────────────────────────────────────────────────────

describe("createRateLimitGuard", () => {
  it("enforce: under limit resolves; at limit throws RateLimitError", async () => {
    const guard = createRateLimitGuard({ limit: 2, windowMs: 60_000 });
    await guard.enforce("u:1");
    await guard.enforce("u:1");
    await expect(guard.enforce("u:1")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("RateLimitError carries a result with retryAfterSeconds", async () => {
    const guard = createRateLimitGuard({ limit: 1, windowMs: 60_000 });
    await guard.enforce("u:2");
    try {
      await guard.enforce("u:2");
      throw new Error("expected RateLimitError");
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const rle = err as RateLimitError;
      expect(rle.result.allowed).toBe(false);
      expect(rle.result.retryAfterSeconds).toBeGreaterThan(0);
      expect(typeof rle.result.resetAt).toBe("number");
    }
  });

  it("check: never throws, returns the result object (allowed & blocked)", async () => {
    const guard = createRateLimitGuard({ limit: 1, windowMs: 60_000 });
    const r1 = await guard.check("u:3");
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(0);
    const r2 = await guard.check("u:3");
    expect(r2.allowed).toBe(false);
    expect(r2.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("different guards have independent default stores", async () => {
    const g1 = createRateLimitGuard({ limit: 1, windowMs: 60_000 });
    const g2 = createRateLimitGuard({ limit: 1, windowMs: 60_000 });
    await g1.enforce("k");
    await expect(g1.enforce("k")).rejects.toBeInstanceOf(RateLimitError);
    // Different guard → same key has its own budget.
    await g2.enforce("k");
  });

  it("shared store between guards pools the budget", async () => {
    const shared = createInMemoryStore();
    const g1 = createRateLimitGuard({
      limit: 1,
      windowMs: 60_000,
      store: shared,
    });
    const g2 = createRateLimitGuard({
      limit: 1,
      windowMs: 60_000,
      store: shared,
    });
    await g1.enforce("k");
    // Same key on the shared store → second guard now sees the budget used.
    await expect(g2.enforce("k")).rejects.toBeInstanceOf(RateLimitError);
  });

  it("rejects empty keys", async () => {
    const guard = createRateLimitGuard({ limit: 1, windowMs: 60_000 });
    await expect(guard.enforce("")).rejects.toThrow();
    await expect(guard.check("")).rejects.toThrow();
  });
});

// Keep test file fully tidy on early exit — global cleanup for the scratch
// dirs is per-test. This block is a belt-and-braces guarantee.
afterAll(() => {
  restoreClock();
});
