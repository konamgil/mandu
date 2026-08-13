/**
 * SQLite-backed session storage — integration tests.
 *
 * These tests exercise the real `Bun.SQL` SQLite adapter through
 * `@mandujs/core/db`. Each test constructs a fresh storage with either
 * `:memory:` (fast path, default) or a file-backed scratch DB (used for
 * the WAL-mode and concurrency probes where we need a real journal
 * file).
 *
 * Fixture conventions:
 *   - `:memory:` DBs are created per-test and closed in `afterEach`.
 *   - File-backed DBs live under a `mkdtempSync` scratch dir that's
 *     deleted in `afterAll`.
 *   - We pass `gcSchedule: false` everywhere to avoid registering a
 *     real cron with Bun.cron — schedule registration itself is tested
 *     via a fake scheduler in the dedicated test at the bottom.
 *   - Cookies are assembled with the real `CookieManager` so signature
 *     validation goes through the same codec the production code uses.
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
  createSqliteSessionStorage,
  type SqliteSessionStorage,
} from "../session-sqlite";
import { Session } from "../session";
import { CookieManager } from "../context";

// ─── Gate: Bun.SQL required ────────────────────────────────────────────────

const hasBunSql = (() => {
  const g = globalThis as unknown as { Bun?: { SQL?: unknown } };
  return typeof g.Bun?.SQL === "function";
})();

const describeIfBunSql = hasBunSql ? describe : describe.skip;
const describeFileBackedIfBunSql =
  hasBunSql && process.env.MANDU_SKIP_CORE_ISOLATED_TESTS !== "1"
    ? describe
    : describe.skip;

// ─── Shared helpers ────────────────────────────────────────────────────────

const SECRET = "sqlite-session-test-secret-32bytes!!";

function makeCookieManager(cookieHeader?: string): CookieManager {
  const headers = new Headers();
  if (cookieHeader) headers.set("cookie", cookieHeader);
  return new CookieManager(new Request("http://localhost/", { headers }));
}

/**
 * Extract the cookie `name=value` substring from a full Set-Cookie line.
 * Attributes (Path, HttpOnly, etc.) are stripped.
 */
function readCookiePair(setCookieLine: string): { name: string; value: string } {
  const [nameValue] = setCookieLine.split(";");
  const eq = nameValue.indexOf("=");
  if (eq <= 0) throw new Error(`Malformed Set-Cookie line: ${setCookieLine}`);
  return {
    name: nameValue.slice(0, eq).trim(),
    value: nameValue.slice(eq + 1).trim(),
  };
}

// ─── Fixtures: in-memory ────────────────────────────────────────────────────

describeIfBunSql("createSqliteSessionStorage — in-memory", () => {
  let storage: SqliteSessionStorage;

  beforeEach(() => {
    storage = createSqliteSessionStorage({
      dbPath: ":memory:",
      cookie: {
        name: "__session",
        secrets: [SECRET],
      },
      gcSchedule: false,
    });
  });

  afterEach(async () => {
    await storage.close();
  });

  it("returns a fresh Session when no cookie is present", async () => {
    const cm = makeCookieManager();
    const session = await storage.getSession(cm);
    expect(session).toBeInstanceOf(Session);
    expect(session.isDirty()).toBe(false);
    expect(session.toJSON()).toEqual({});
  });

  it("commitSession + getSession roundtrip preserves data", async () => {
    const writer = makeCookieManager();
    const s = await storage.getSession(writer);
    s.set("userId", "u-42");
    s.set("role", "admin");
    const setCookie = await storage.commitSession(s);
    expect(setCookie.length).toBeGreaterThan(0);

    // Build a reader CookieManager seeded with the cookie the writer
    // would have emitted. `setCookie` is a full Set-Cookie header; the
    // client request echoes only `name=value`.
    const { name, value } = readCookiePair(setCookie);
    const reader = makeCookieManager(`${name}=${value}`);
    const restored = await storage.getSession(reader);
    expect(restored.get<string>("userId")).toBe("u-42");
    expect(restored.get<string>("role")).toBe("admin");
  });

  it("commitSession on a clean (non-dirty) session is a no-op", async () => {
    const cm = makeCookieManager();
    const s = await storage.getSession(cm);
    // No mutation — must emit empty Set-Cookie (nothing to persist).
    const setCookie = await storage.commitSession(s);
    expect(setCookie).toBe("");
  });

  it("destroySession deletes the row and subsequent getSession returns empty", async () => {
    // Persist a session.
    const writer = makeCookieManager();
    const s = await storage.getSession(writer);
    s.set("secret", "top");
    const setCookie = await storage.commitSession(s);
    const { name, value } = readCookiePair(setCookie);

    // Destroy it.
    const reader = makeCookieManager(`${name}=${value}`);
    const loaded = await storage.getSession(reader);
    expect(loaded.get<string>("secret")).toBe("top");
    await storage.destroySession(loaded);

    // Third reader (cookie still presented) — row gone from DB, so empty
    // Session comes back.
    const reader2 = makeCookieManager(`${name}=${value}`);
    const after = await storage.getSession(reader2);
    expect(after.toJSON()).toEqual({});
  });

  it("expired rows come back as an empty Session", async () => {
    // Short-TTL storage so we can age out a row without faking clocks.
    const expiring = createSqliteSessionStorage({
      dbPath: ":memory:",
      cookie: { name: "__exp", secrets: [SECRET] },
      // 0 seconds → expires_at == now() at insert time, which is `<= now`
      // in the DELETE sweep, so the next read treats it as gone.
      ttlSeconds: 0,
      gcSchedule: false,
    });
    try {
      const s = await expiring.getSession(makeCookieManager());
      s.set("k", "v");
      const setCookie = await expiring.commitSession(s);
      const { name, value } = readCookiePair(setCookie);

      // Sleep 5 ms so expires_at < Date.now() on the read.
      await new Promise((r) => setTimeout(r, 5));

      const reader = makeCookieManager(`${name}=${value}`);
      const restored = await expiring.getSession(reader);
      expect(restored.toJSON()).toEqual({});
    } finally {
      await expiring.close();
    }
  });

  it("gcNow sweeps expired rows and returns the deleted count", async () => {
    // Write two rows at TTL=0, two rows at TTL=3600.
    const shortLived = createSqliteSessionStorage({
      dbPath: ":memory:",
      cookie: { name: "__s1", secrets: [SECRET] },
      ttlSeconds: 0,
      gcSchedule: false,
    });
    try {
      const s1 = await shortLived.getSession(makeCookieManager());
      s1.set("x", "1");
      await shortLived.commitSession(s1);
      const s2 = await shortLived.getSession(makeCookieManager());
      s2.set("x", "2");
      await shortLived.commitSession(s2);

      // Hand-insert a row that's still in the future to verify survival.
      // Easiest path: a fresh storage on the same in-memory DB is not
      // possible (each `:memory:` is isolated), so we simulate survival
      // by asserting gcNow deletes exactly 2.
      await new Promise((r) => setTimeout(r, 3));
      const deleted = await shortLived.gcNow();
      expect(deleted).toBe(2);

      // Second sweep is a no-op.
      expect(await shortLived.gcNow()).toBe(0);
    } finally {
      await shortLived.close();
    }
  });

  it("the cookie carries the signed session id — not any session data", async () => {
    const s = await storage.getSession(makeCookieManager());
    s.set("shouldNotAppearInCookie", "secret-value-xyz");
    const setCookie = await storage.commitSession(s);
    const { value } = readCookiePair(setCookie);
    const decoded = decodeURIComponent(value);

    // The whole payload must NOT contain the user's session data.
    expect(decoded).not.toContain("secret-value-xyz");
    expect(decoded).not.toContain("shouldNotAppearInCookie");

    // Structure: exactly one dot separating id from signature.
    const parts = decoded.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0]!.length).toBeGreaterThan(0);
    expect(parts[1]!.length).toBeGreaterThan(0);
  });

  it("tampered signature yields an empty Session (no throw)", async () => {
    const s = await storage.getSession(makeCookieManager());
    s.set("role", "admin");
    const setCookie = await storage.commitSession(s);
    const { name, value } = readCookiePair(setCookie);

    // Flip the last character of the signature portion.
    const decoded = decodeURIComponent(value);
    const dot = decoded.lastIndexOf(".");
    const tampered = decoded.slice(0, dot + 1) +
      (decoded.charAt(dot + 1) === "A" ? "B" : "A") +
      decoded.slice(dot + 2);
    const tamperedCookie = `${name}=${encodeURIComponent(tampered)}`;

    const reader = makeCookieManager(tamperedCookie);
    // Must NOT throw — returns empty Session instead.
    const restored = await storage.getSession(reader);
    expect(restored.toJSON()).toEqual({});
  });

  it("round-trips payloads larger than the 4 KB cookie budget", async () => {
    // Produce ~8 KB of data — anything over ~4 KB would break the
    // cookie-storage code path.
    const s = await storage.getSession(makeCookieManager());
    const big = "x".repeat(8192);
    s.set("big", big);
    s.set("meta", { size: big.length, tag: "big-payload" });
    const setCookie = await storage.commitSession(s);
    const { name, value } = readCookiePair(setCookie);

    // Cookie value itself is tiny (just the signed id).
    expect(value.length).toBeLessThan(200);

    const reader = makeCookieManager(`${name}=${value}`);
    const restored = await storage.getSession(reader);
    expect(restored.get<string>("big")).toBe(big);
    expect(restored.get<{ size: number; tag: string }>("meta")).toEqual({
      size: 8192,
      tag: "big-payload",
    });
  });

  it("close() rejects subsequent getSession calls with a clear error", async () => {
    await storage.close();
    await expect(storage.getSession(makeCookieManager())).rejects.toThrow(
      /closed/i,
    );
  });

  it("emits a Set-Cookie with a UUID v7 shaped id", async () => {
    const s = await storage.getSession(makeCookieManager());
    s.set("k", "v");
    const setCookie = await storage.commitSession(s);
    const { value } = readCookiePair(setCookie);
    const decoded = decodeURIComponent(value);
    const id = decoded.slice(0, decoded.lastIndexOf("."));
    // UUID v7 shape: 8-4-4-4-12 hex, with "7" at the version nibble.
    const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidV7);
  });

  it("destroySession emits an expiring cookie with Max-Age=0", async () => {
    const s = await storage.getSession(makeCookieManager());
    s.set("k", "v");
    await storage.commitSession(s);
    const destroyCookie = await storage.destroySession(s);
    expect(destroyCookie).toMatch(/Max-Age=0/);
    expect(destroyCookie).toMatch(/^__session=(;|$)/);
  });
});

// ─── Fixtures: file-backed (for WAL + concurrency tests) ────────────────────

describeFileBackedIfBunSql("createSqliteSessionStorage — file-backed", () => {
  const scratchDir = mkdtempSync(join(tmpdir(), "mandu-sess-sqlite-"));

  afterAll(() => {
    try {
      rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      // Windows file locks occasionally linger — not worth failing the suite.
    }
  });

  it("enables WAL journal mode at initialisation", async () => {
    const path = join(scratchDir, `wal-${Date.now()}.db`);
    const storage = createSqliteSessionStorage({
      dbPath: path,
      cookie: { secrets: [SECRET] },
      gcSchedule: false,
    });
    try {
      // Kick init by running any real query (getSession does it implicitly).
      await storage.getSession(makeCookieManager());

      // Open the same file through Bun.SQL directly to inspect PRAGMAs
      // without reaching into the storage's private db handle.
      const { createDb } = await import("../../db");
      const probe = createDb({ url: `sqlite:${path}` });
      try {
        const row = await probe<{ journal_mode: string }>`PRAGMA journal_mode`;
        expect(row[0]!.journal_mode.toLowerCase()).toBe("wal");
      } finally {
        await probe.close();
      }
    } finally {
      await storage.close();
    }
  });

  it("concurrent writes on the same id resolve to last-write-wins without corruption", async () => {
    const path = join(scratchDir, `conc-${Date.now()}.db`);
    const storage = createSqliteSessionStorage({
      dbPath: path,
      cookie: { secrets: [SECRET] },
      gcSchedule: false,
    });
    try {
      // Create one session, then issue two overlapping commits with
      // different payloads on the SAME id.
      const s = await storage.getSession(makeCookieManager());
      s.set("initial", "true");
      const setCookie = await storage.commitSession(s);
      const { name, value } = readCookiePair(setCookie);

      const pair = `${name}=${value}`;
      const a = await storage.getSession(makeCookieManager(pair));
      a.set("writer", "A");
      const b = await storage.getSession(makeCookieManager(pair));
      b.set("writer", "B");

      // Intentional race — both commits on same id.
      await Promise.all([storage.commitSession(a), storage.commitSession(b)]);

      // Must not corrupt. One of {A, B} won; the row is still parseable.
      const after = await storage.getSession(makeCookieManager(pair));
      const winner = after.get<string>("writer");
      expect(typeof winner).toBe("string");
      expect(["A", "B"]).toContain(winner as string);
    } finally {
      await storage.close();
    }
  });
});

// ─── GC scheduling ──────────────────────────────────────────────────────────

describeIfBunSql("createSqliteSessionStorage — GC scheduling", () => {
  it("with gcSchedule: false, does NOT register a cron", async () => {
    // Monkey-patch Bun.cron temporarily to observe registration.
    const g = globalThis as unknown as { Bun?: { cron?: unknown } };
    const bun = g.Bun;
    if (!bun) {
      // Can only run this assertion under Bun — skip silently otherwise.
      return;
    }
    const original = bun.cron;
    let registrationCount = 0;
    bun.cron = ((_schedule: string, _handler: () => unknown) => {
      registrationCount += 1;
      return undefined;
    }) as typeof original;

    try {
      const storage = createSqliteSessionStorage({
        dbPath: ":memory:",
        cookie: { secrets: [SECRET] },
        gcSchedule: false,
      });
      // Force init to run so the cron registration branch is exercised.
      await storage.getSession(makeCookieManager());
      expect(registrationCount).toBe(0);
      await storage.close();
    } finally {
      bun.cron = original;
    }
  });

  it("with gcSchedule as string, attempts to register exactly one cron", async () => {
    const g = globalThis as unknown as { Bun?: { cron?: unknown } };
    const bun = g.Bun;
    if (!bun) return;
    const original = bun.cron;
    const registered: string[] = [];
    bun.cron = ((schedule: string, _handler: () => unknown) => {
      registered.push(schedule);
      return { stop: () => undefined };
    }) as typeof original;

    try {
      const storage = createSqliteSessionStorage({
        dbPath: ":memory:",
        cookie: { secrets: [SECRET] },
        gcSchedule: "*/30 * * * *",
      });
      // init is fire-and-forget — wait for it to settle.
      await storage.getSession(makeCookieManager());
      // Flush microtasks that may still be pending around the cron start.
      await new Promise((r) => setTimeout(r, 5));
      expect(registered).toEqual(["*/30 * * * *"]);
      await storage.close();
    } finally {
      bun.cron = original;
    }
  });
});

// ─── Construction-time validation ──────────────────────────────────────────

describe("createSqliteSessionStorage — construction validation", () => {
  it("throws when cookie.secrets is empty", () => {
    expect(() =>
      createSqliteSessionStorage({
        cookie: { secrets: [] },
        dbPath: ":memory:",
        gcSchedule: false,
      }),
    ).toThrow(/secret is required/i);
  });

  it("rejects an unsafe table name", () => {
    expect(() =>
      createSqliteSessionStorage({
        cookie: { secrets: [SECRET] },
        dbPath: ":memory:",
        table: "sessions; DROP TABLE users; --",
        gcSchedule: false,
      }),
    ).toThrow(/Invalid table name/i);
  });
});
