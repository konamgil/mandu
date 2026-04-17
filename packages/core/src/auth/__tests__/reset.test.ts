/**
 * @mandujs/core/auth/reset — flow tests.
 *
 * Cover `createPasswordReset` end-to-end: mint + send via in-memory email,
 * consume + onReset via `hashPassword`. The KDF hot path is CPU-bound —
 * we pass minimal argon2id cost parameters everywhere to keep wall-clock
 * time short.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { createMemoryEmailSender, type MemoryEmailSender } from "../../email";
import { verifyPassword } from "../password";
import { createAuthTokenStore, type AuthTokenStore } from "../tokens";
import { createPasswordReset } from "../reset";

// ─── Gate on Bun.SQL + CryptoHasher + Bun.password ──────────────────────────

const hasBun = (() => {
  const g = globalThis as unknown as {
    Bun?: { SQL?: unknown; CryptoHasher?: unknown; password?: unknown };
  };
  return (
    typeof g.Bun?.SQL === "function" &&
    typeof g.Bun?.CryptoHasher === "function" &&
    g.Bun?.password !== undefined
  );
})();
const describeIfBun = hasBun ? describe : describe.skip;

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SECRET = "reset-flow-test-secret-32-bytes-or-more!!";
const URL_TEMPLATE = "https://app.example.com/reset?token={token}";
const FROM = "noreply@example.com";
const ARGON2ID_PREFIX = "$argon2id$";
const FAST_ARGON2 = { algorithm: "argon2id", memoryCost: 4, timeCost: 2 } as const;

interface Fixture {
  store: AuthTokenStore;
  sender: MemoryEmailSender;
  onResetCalls: Array<{ userId: string; newHash: string }>;
}

function makeFixture(): Fixture {
  return {
    store: createAuthTokenStore({
      secret: SECRET,
      dbPath: ":memory:",
      gcSchedule: false,
    }),
    sender: createMemoryEmailSender(),
    onResetCalls: [],
  };
}

describeIfBun("@mandujs/core/auth/reset — createPasswordReset", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(async () => {
    await fx.store.close();
  });

  it("send() mints a reset token and dispatches an email with the link", async () => {
    const renderEmail = mock(({ url }: { url: string }) => ({
      subject: "Reset your password",
      html: `<a href="${url}">reset</a>`,
    }));
    const reset = createPasswordReset({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      resetUrlTemplate: URL_TEMPLATE,
      renderEmail,
      passwordOptions: FAST_ARGON2,
      onReset: async (args) => {
        fx.onResetCalls.push(args);
      },
    });

    await reset.send("u-1", "alice@example.com");
    expect(fx.sender.sent).toHaveLength(1);
    const msg = fx.sender.sent[0]!;
    expect(msg.from).toBe(FROM);
    expect(msg.to).toBe("alice@example.com");
    expect(msg.subject).toBe("Reset your password");
    expect(msg.html).toContain("https://app.example.com/reset?token=");
  });

  it("consume(validToken, newPassword) returns { userId } and calls onReset with an argon2id hash", async () => {
    const reset = createPasswordReset({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      resetUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "R", html: `<a href="${url}">r</a>` }),
      passwordOptions: FAST_ARGON2,
      onReset: async (args) => {
        fx.onResetCalls.push(args);
      },
    });

    await reset.send("u-2", "bob@example.com");
    const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;

    const result = await reset.consume(token, "newPass123");
    expect(result).toEqual({ userId: "u-2" });
    expect(fx.onResetCalls).toHaveLength(1);
    expect(fx.onResetCalls[0]!.userId).toBe("u-2");
    expect(fx.onResetCalls[0]!.newHash.startsWith(ARGON2ID_PREFIX)).toBe(true);
  });

  it("empty newPassword throws TypeError without consuming the token", async () => {
    const reset = createPasswordReset({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      resetUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "R", html: `<a href="${url}">r</a>` }),
      passwordOptions: FAST_ARGON2,
      onReset: async () => {},
    });

    await reset.send("u-3", "carol@example.com");
    const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;

    await expect(reset.consume(token, "")).rejects.toThrow(/non-empty/);
    // Token was NOT consumed — a real call still works.
    const ok = await reset.consume(token, "validPass123");
    expect(ok).toEqual({ userId: "u-3" });
  });

  it("onReset receives the hash, not the plaintext password", async () => {
    let captured: { userId: string; newHash: string } | null = null;
    const reset = createPasswordReset({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      resetUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "R", html: `<a href="${url}">r</a>` }),
      passwordOptions: FAST_ARGON2,
      onReset: async (args) => {
        captured = args;
      },
    });
    await reset.send("u-4", "dave@example.com");
    const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;

    const plaintext = "totally-secret-password";
    await reset.consume(token, plaintext);

    expect(captured).not.toBeNull();
    const hash = captured!.newHash;
    // The plaintext must NEVER appear in the hash payload.
    expect(hash).not.toContain(plaintext);
    // verifyPassword round-trips correctly against the hash.
    expect(await verifyPassword(plaintext, hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("reusing a consumed token returns null and onReset fires exactly once", async () => {
    const reset = createPasswordReset({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      resetUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "R", html: `<a href="${url}">r</a>` }),
      passwordOptions: FAST_ARGON2,
      onReset: async (args) => {
        fx.onResetCalls.push(args);
      },
    });
    await reset.send("u-5", "eve@example.com");
    const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;

    const first = await reset.consume(token, "first-pass");
    expect(first).not.toBeNull();
    const second = await reset.consume(token, "second-pass");
    expect(second).toBeNull();
    expect(fx.onResetCalls).toHaveLength(1);
  });

  it("reset does NOT auto-login — we don't touch sessions", async () => {
    // This test guards the contract: the returned shape is `{ userId }`
    // only — there are no cookie side-effects, no session helpers called.
    // We construct the flow with NO session storage at all and expect
    // consume() to still succeed.
    const reset = createPasswordReset({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      resetUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "R", html: `<a href="${url}">r</a>` }),
      passwordOptions: FAST_ARGON2,
      onReset: async () => {},
    });
    await reset.send("u-6", "frank@example.com");
    const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;

    const result = await reset.consume(token, "fresh-pass");
    expect(result).toEqual({ userId: "u-6" });
    // Contract: ReturnType<consume> is never {userId, cookie, session, …}.
    // The runtime shape must match — if a future refactor adds fields we
    // need to revisit the doc + this guard.
    expect(Object.keys(result!).sort()).toEqual(["userId"]);
  });

  it("hashPassword is invoked with the raw plaintext (argon2id default)", async () => {
    // Black-box: the only way to observe "hashPassword was called with
    // this plaintext" without reaching past the module boundary is to
    // verify the emitted hash authenticates the plaintext.
    let newHash: string | null = null;
    const reset = createPasswordReset({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      resetUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "R", html: `<a href="${url}">r</a>` }),
      passwordOptions: FAST_ARGON2,
      onReset: async (args) => {
        newHash = args.newHash;
      },
    });
    await reset.send("u-7", "grace@example.com");
    const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;
    await reset.consume(token, "plaintext-checked");

    expect(newHash).not.toBeNull();
    expect(newHash!.startsWith(ARGON2ID_PREFIX)).toBe(true);
    expect(await verifyPassword("plaintext-checked", newHash!)).toBe(true);
  });

  it("bcrypt's 72-byte limit: hashPassword error propagates (token is already spent)", async () => {
    const reset = createPasswordReset({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      resetUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "R", html: `<a href="${url}">r</a>` }),
      // Force bcrypt so the 72-byte guard in hashPassword fires.
      passwordOptions: { algorithm: "bcrypt", cost: 4 },
      onReset: async () => {
        throw new Error("onReset should not be invoked when hashPassword throws");
      },
    });
    await reset.send("u-8", "heidi@example.com");
    const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;

    const tooLong = "a".repeat(100); // 100 UTF-8 bytes, over the 72 limit.
    await expect(reset.consume(token, tooLong)).rejects.toThrow(/72-byte limit/);
    // Token IS consumed by the time hashPassword throws — a retry returns null.
    const retry = await reset.consume(token, "shortPass");
    expect(retry).toBeNull();
  });

  it("resetUrlTemplate without {token} throws at create time", () => {
    expect(() =>
      createPasswordReset({
        store: fx.store,
        sender: fx.sender,
        fromAddress: FROM,
        resetUrlTemplate: "https://app.example.com/reset?nope=1",
        renderEmail: () => ({ subject: "r", html: "<p>r</p>" }),
        passwordOptions: FAST_ARGON2,
        onReset: async () => {},
      }),
    ).toThrow(/\{token\}/);
  });

  it("empty fromAddress throws at create time", () => {
    expect(() =>
      createPasswordReset({
        store: fx.store,
        sender: fx.sender,
        fromAddress: "",
        resetUrlTemplate: URL_TEMPLATE,
        renderEmail: () => ({ subject: "r", html: "<p>r</p>" }),
        passwordOptions: FAST_ARGON2,
        onReset: async () => {},
      }),
    ).toThrow(/fromAddress/);
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function extractTokenFromUrl(html: string): string | null {
  const hrefMatch = /href="([^"]+)"/.exec(html);
  const url = hrefMatch ? hrefMatch[1]! : html;
  const tokenMatch = /[?&]token=([^&"\s]+)/.exec(url);
  return tokenMatch ? tokenMatch[1]! : null;
}
