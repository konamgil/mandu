/**
 * @mandujs/core/auth/tokens — store tests.
 *
 * Each case builds a fresh `:memory:` store (gated on Bun.SQL availability)
 * with `gcSchedule: false` so no real cron fires during tests. Closed in
 * `afterEach`.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  createAuthTokenStore,
  type AuthTokenStore,
  type TokenRecord,
} from "../tokens";

// ─── Gate on Bun.SQL + Bun.CryptoHasher ─────────────────────────────────────

const hasBunSql = (() => {
  const g = globalThis as unknown as {
    Bun?: { SQL?: unknown; CryptoHasher?: unknown };
  };
  return typeof g.Bun?.SQL === "function" && typeof g.Bun?.CryptoHasher === "function";
})();
const describeIfBun = hasBunSql ? describe : describe.skip;

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SECRET = "tokens-test-secret-at-least-32-bytes-long!";

describeIfBun("@mandujs/core/auth/tokens — createAuthTokenStore", () => {
  let store: AuthTokenStore;

  beforeEach(() => {
    store = createAuthTokenStore({
      secret: SECRET,
      dbPath: ":memory:",
      gcSchedule: false,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("mint → consume roundtrip returns the record with userId + purpose", async () => {
    const { token, record } = await store.mint("verify-email", "u-1", {
      email: "a@b.com",
    });
    expect(token).toContain(".");
    expect(record.userId).toBe("u-1");
    expect(record.purpose).toBe("verify-email");
    expect(record.consumedAt).toBeNull();
    expect(record.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    const consumed = await store.consume("verify-email", token);
    expect(consumed).not.toBeNull();
    expect(consumed!.userId).toBe("u-1");
    expect(consumed!.id).toBe(record.id);
    expect(consumed!.consumedAt).toBeTypeOf("number");
    expect(consumed!.consumedAt).not.toBeNull();
  });

  it("consuming twice: second call returns null (single-use)", async () => {
    const { token } = await store.mint("verify-email", "u-2", { email: "a@b.com" });
    const first = await store.consume("verify-email", token);
    expect(first).not.toBeNull();
    const second = await store.consume("verify-email", token);
    expect(second).toBeNull();
  });

  it("expired token returns null", async () => {
    // Zero TTL means expires_at == now at insert. The insert completes at
    // T, and consume() reads `now > T` → treated as expired. We sleep a
    // few ms to be defensive against same-millisecond flakiness.
    const shortLived = createAuthTokenStore({
      secret: SECRET,
      dbPath: ":memory:",
      gcSchedule: false,
      ttlSecondsByPurpose: { "verify-email": 0 },
    });
    try {
      const { token } = await shortLived.mint("verify-email", "u-3");
      await new Promise((r) => setTimeout(r, 5));
      const result = await shortLived.consume("verify-email", token);
      expect(result).toBeNull();
    } finally {
      await shortLived.close();
    }
  });

  it("tampered nonce returns null (hash mismatch)", async () => {
    const { token } = await store.mint("verify-email", "u-4");
    const [id, nonce] = token.split(".");
    // Flip one character in the nonce. Keep length the same to exercise
    // the byte-wise hash compare (length mismatch would short-circuit).
    const flipped = (nonce!.charAt(0) === "A" ? "B" : "A") + nonce!.slice(1);
    const tampered = `${id}.${flipped}`;
    const result = await store.consume("verify-email", tampered);
    expect(result).toBeNull();
  });

  it("tampered id (pointing to real row) still returns null — hash mismatch", async () => {
    const { token: a } = await store.mint("verify-email", "u-5a");
    const { token: b } = await store.mint("verify-email", "u-5b");
    const aNonce = a.split(".")[1]!;
    const bId = b.split(".")[0]!;
    // Forged token: use B's id with A's nonce. B's stored hash was
    // computed against B's nonce, so the compare fails.
    const forged = `${bId}.${aNonce}`;
    const result = await store.consume("verify-email", forged);
    expect(result).toBeNull();

    // Sanity: the real B token still consumes cleanly afterwards. The
    // forged attempt did NOT mark B as consumed.
    const real = await store.consume("verify-email", b);
    expect(real).not.toBeNull();
  });

  it("wrong purpose returns null (purpose binds to the hash)", async () => {
    const { token } = await store.mint("verify-email", "u-6");
    const result = await store.consume("reset-password", token);
    expect(result).toBeNull();

    // Real purpose still works — wrong-purpose attempt did NOT mark it
    // consumed.
    const real = await store.consume("verify-email", token);
    expect(real).not.toBeNull();
  });

  it("unknown id returns null without touching other rows", async () => {
    const { token } = await store.mint("verify-email", "u-7");
    // Use a random UUID as the id so the row simply doesn't exist.
    const fakeId = crypto.randomUUID();
    const nonce = token.split(".")[1]!;
    const bogus = `${fakeId}.${nonce}`;
    const result = await store.consume("verify-email", bogus);
    expect(result).toBeNull();

    // Real token still usable.
    const real = await store.consume("verify-email", token);
    expect(real).not.toBeNull();
  });

  it("gcNow() sweeps expired + consumed rows and returns the count", async () => {
    // Consume one row to create a "consumed" candidate.
    const { token: consumedToken } = await store.mint("verify-email", "u-8a");
    await store.consume("verify-email", consumedToken);

    // Build a short-lived entry via a second store on the same (in-memory)
    // semantics — we can't share a :memory: DB across handles, so mint
    // into a different short-TTL store to prove the delete query works.
    const expiring = createAuthTokenStore({
      secret: SECRET,
      dbPath: ":memory:",
      gcSchedule: false,
      ttlSecondsByPurpose: { "verify-email": 0 },
    });
    try {
      await expiring.mint("verify-email", "u-8b");
      await expiring.mint("verify-email", "u-8c");
      await new Promise((r) => setTimeout(r, 5));
      const deleted = await expiring.gcNow();
      expect(deleted).toBe(2);
      // Second sweep is a no-op.
      expect(await expiring.gcNow()).toBe(0);
    } finally {
      await expiring.close();
    }

    // The original store has exactly one row (consumed); gcNow removes it.
    const cleaned = await store.gcNow();
    expect(cleaned).toBe(1);
  });

  it("meta round-trips as JSON for verify-email tokens", async () => {
    const { token, record: minted } = await store.mint("verify-email", "u-9", {
      email: "alice@example.com",
      signupSource: "marketing-page",
    });
    expect(minted.meta?.email).toBe("alice@example.com");

    const consumed = await store.consume("verify-email", token);
    expect(consumed).not.toBeNull();
    expect(consumed!.meta?.email).toBe("alice@example.com");
    expect(consumed!.meta?.signupSource).toBe("marketing-page");
  });

  it("sequential consumes serialise through the UPDATE predicate — only the first wins", async () => {
    // True wall-clock concurrency is not expressible against a single
    // SQLite connection (Bun.SQL surfaces "cannot start a transaction
    // within a transaction" when two callers share the handle). The
    // atomicity guarantee we actually care about is observable
    // sequentially: consume #2 must see `consumed_at IS NOT NULL` from
    // consume #1's committed transaction and return null.
    //
    // The defense-in-depth `UPDATE … WHERE consumed_at IS NULL` predicate
    // is what guards against a hypothetical interleaving if multiple
    // writer connections ever land in the future (e.g., Postgres).
    const { token } = await store.mint("verify-email", "u-10");
    const a = await store.consume("verify-email", token);
    const b = await store.consume("verify-email", token);
    const successes: TokenRecord[] = [];
    if (a) successes.push(a);
    if (b) successes.push(b);
    expect(successes).toHaveLength(1);
    expect(a!.consumedAt).not.toBeNull();
  });

  it("malformed token (no dot) returns null without throwing", async () => {
    // Exercise the `parseToken` no-dot path, the empty-string path, and
    // the multi-dot path — all must collapse to null.
    const nodot = await store.consume("verify-email", "not-a-token");
    expect(nodot).toBeNull();

    const empty = await store.consume("verify-email", "");
    expect(empty).toBeNull();

    const multiDot = await store.consume("verify-email", "a.b.c");
    expect(multiDot).toBeNull();

    const leadingDot = await store.consume("verify-email", ".nonce");
    expect(leadingDot).toBeNull();

    const trailingDot = await store.consume("verify-email", "id.");
    expect(trailingDot).toBeNull();
  });

  it("close() then mint/consume/gcNow rejects with a clear error", async () => {
    const tempStore = createAuthTokenStore({
      secret: SECRET,
      dbPath: ":memory:",
      gcSchedule: false,
    });
    // Populate one row so gcNow has something to scan.
    await tempStore.mint("verify-email", "u-11");
    await tempStore.close();

    await expect(tempStore.mint("verify-email", "u-12")).rejects.toThrow(
      /store is closed/,
    );
    await expect(tempStore.consume("verify-email", "x.y")).rejects.toThrow(
      /store is closed/,
    );
    await expect(tempStore.gcNow()).rejects.toThrow(/store is closed/);
    // close() is idempotent.
    await expect(tempStore.close()).resolves.toBeUndefined();
  });

  it("empty secret is rejected synchronously at construction", () => {
    expect(() =>
      createAuthTokenStore({ secret: "", dbPath: ":memory:", gcSchedule: false }),
    ).toThrow(/secret/);
  });

  it("invalid table name is rejected synchronously at construction", () => {
    expect(() =>
      createAuthTokenStore({
        secret: SECRET,
        dbPath: ":memory:",
        table: "bad-name; DROP TABLE users",
        gcSchedule: false,
      }),
    ).toThrow(/table name/);
  });

  it("reset-password token consumed at the wrong purpose returns null", async () => {
    const { token } = await store.mint("reset-password", "u-13");
    const wrongPurpose = await store.consume("verify-email", token);
    expect(wrongPurpose).toBeNull();
    const rightPurpose = await store.consume("reset-password", token);
    expect(rightPurpose).not.toBeNull();
  });
});
