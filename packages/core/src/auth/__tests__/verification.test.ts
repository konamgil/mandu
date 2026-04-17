/**
 * @mandujs/core/auth/verification — flow tests.
 *
 * End-to-end cover for `createEmailVerification` using the in-memory email
 * sender from `@mandujs/core/email` and a `:memory:` token store. The
 * token store is shared across tests in a `describe` to keep boot cost
 * low; each test mints fresh tokens, so cross-test contamination is
 * non-existent.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

import { createMemoryEmailSender, type MemoryEmailSender } from "../../email";
import { createAuthTokenStore, type AuthTokenStore } from "../tokens";
import { createEmailVerification } from "../verification";

// ─── Gate on Bun.SQL + CryptoHasher ─────────────────────────────────────────

const hasBun = (() => {
  const g = globalThis as unknown as {
    Bun?: { SQL?: unknown; CryptoHasher?: unknown };
  };
  return typeof g.Bun?.SQL === "function" && typeof g.Bun?.CryptoHasher === "function";
})();
const describeIfBun = hasBun ? describe : describe.skip;

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SECRET = "verification-test-secret-32-bytes-or-more!";
const URL_TEMPLATE = "https://app.example.com/verify?token={token}";
const FROM = "noreply@example.com";

interface Fixture {
  store: AuthTokenStore;
  sender: MemoryEmailSender;
  onVerifiedCalls: Array<{ userId: string; email: string }>;
}

function makeFixture(): Fixture {
  return {
    store: createAuthTokenStore({
      secret: SECRET,
      dbPath: ":memory:",
      gcSchedule: false,
    }),
    sender: createMemoryEmailSender(),
    onVerifiedCalls: [],
  };
}

describeIfBun("@mandujs/core/auth/verification — createEmailVerification", () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(async () => {
    await fx.store.close();
  });

  it("send() mints a token and dispatches an email with the rendered subject + html", async () => {
    const renderEmail = mock(({ url, userId, email }: { url: string; userId: string; email: string }) => ({
      subject: `Verify ${email}`,
      html: `<a href="${url}" data-uid="${userId}">go</a>`,
      text: `Verify: ${url}`,
    }));

    const verify = createEmailVerification({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      verifyUrlTemplate: URL_TEMPLATE,
      renderEmail,
      onVerified: async (args) => {
        fx.onVerifiedCalls.push(args);
      },
    });

    await verify.send("u-1", "alice@example.com");

    expect(renderEmail).toHaveBeenCalledTimes(1);
    expect(fx.sender.sent).toHaveLength(1);
    const msg = fx.sender.sent[0]!;
    expect(msg.subject).toBe("Verify alice@example.com");
    expect(msg.to).toBe("alice@example.com");
    expect(msg.html).toContain("data-uid=\"u-1\"");
    expect(msg.text).toContain("https://app.example.com/verify?token=");
  });

  it("email body contains the resolved URL with the token substituted", async () => {
    const verify = createEmailVerification({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      verifyUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "Verify", html: `<a href="${url}">v</a>` }),
      onVerified: async () => {},
    });

    await verify.send("u-2", "bob@example.com");
    const msg = fx.sender.sent[0]!;
    const href = /href="([^"]+)"/.exec(msg.html!)?.[1];
    expect(href).toBeTruthy();
    expect(href).toContain("https://app.example.com/verify?token=");
    // The placeholder must NOT survive in the rendered URL.
    expect(href).not.toContain("{token}");
  });

  it("consume(validToken) returns { userId, email } and invokes onVerified", async () => {
    const verify = createEmailVerification({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      verifyUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "Verify", html: `<a href="${url}">v</a>` }),
      onVerified: async (args) => {
        fx.onVerifiedCalls.push(args);
      },
    });

    await verify.send("u-3", "carol@example.com");
    const msg = fx.sender.sent[0]!;
    const token = extractTokenFromUrl(msg.html!);
    expect(token).toBeTruthy();

    const result = await verify.consume(token!);
    expect(result).toEqual({ userId: "u-3", email: "carol@example.com" });
    expect(fx.onVerifiedCalls).toHaveLength(1);
    expect(fx.onVerifiedCalls[0]).toEqual({ userId: "u-3", email: "carol@example.com" });
  });

  it("consume(consumedToken) returns null on the second call", async () => {
    const verify = createEmailVerification({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      verifyUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "Verify", html: `<a href="${url}">v</a>` }),
      onVerified: async () => {},
    });

    await verify.send("u-4", "dave@example.com");
    const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;

    const first = await verify.consume(token);
    expect(first).not.toBeNull();
    const second = await verify.consume(token);
    expect(second).toBeNull();
  });

  it("consume(expiredToken) returns null", async () => {
    const expiringStore = createAuthTokenStore({
      secret: SECRET,
      dbPath: ":memory:",
      gcSchedule: false,
      ttlSecondsByPurpose: { "verify-email": 0 },
    });
    try {
      const verify = createEmailVerification({
        store: expiringStore,
        sender: fx.sender,
        fromAddress: FROM,
        verifyUrlTemplate: URL_TEMPLATE,
        renderEmail: ({ url }) => ({ subject: "V", html: `<a href="${url}">v</a>` }),
        onVerified: async () => {},
      });
      await verify.send("u-5", "eve@example.com");
      const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;
      await new Promise((r) => setTimeout(r, 5));
      expect(await verify.consume(token)).toBeNull();
    } finally {
      await expiringStore.close();
    }
  });

  it("consume(bogus) returns null for structurally broken / unknown tokens", async () => {
    const verify = createEmailVerification({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      verifyUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "V", html: url }),
      onVerified: async () => {},
    });

    expect(await verify.consume("garbage-no-dot")).toBeNull();
    expect(await verify.consume("")).toBeNull();
    // Malformed percent-encoding — must not throw.
    expect(await verify.consume("%E0%A4%A")).toBeNull();
    // Well-formed structure but nothing in the DB.
    expect(await verify.consume("fakeid.fakenonce")).toBeNull();
  });

  it("verifyUrlTemplate without the {token} placeholder throws at create time", () => {
    expect(() =>
      createEmailVerification({
        store: fx.store,
        sender: fx.sender,
        fromAddress: FROM,
        verifyUrlTemplate: "https://app.example.com/verify?nope=1",
        renderEmail: () => ({ subject: "v", html: "<p>v</p>" }),
        onVerified: async () => {},
      }),
    ).toThrow(/\{token\}/);
  });

  it("empty fromAddress throws at create time", () => {
    expect(() =>
      createEmailVerification({
        store: fx.store,
        sender: fx.sender,
        fromAddress: "",
        verifyUrlTemplate: URL_TEMPLATE,
        renderEmail: () => ({ subject: "v", html: "<p>v</p>" }),
        onVerified: async () => {},
      }),
    ).toThrow(/fromAddress/);
  });

  it("fromAddress is honored on every outbound message", async () => {
    const customFrom = "\"App Name\" <no-reply@example.org>";
    const verify = createEmailVerification({
      store: fx.store,
      sender: fx.sender,
      fromAddress: customFrom,
      verifyUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "V", html: `<a href="${url}">v</a>` }),
      onVerified: async () => {},
    });
    await verify.send("u-6", "frank@example.com");
    await verify.send("u-7", "grace@example.com");
    expect(fx.sender.sent).toHaveLength(2);
    expect(fx.sender.sent[0]!.from).toBe(customFrom);
    expect(fx.sender.sent[1]!.from).toBe(customFrom);
  });

  it("onVerified throwing propagates — token is already consumed (idempotency note)", async () => {
    const verify = createEmailVerification({
      store: fx.store,
      sender: fx.sender,
      fromAddress: FROM,
      verifyUrlTemplate: URL_TEMPLATE,
      renderEmail: ({ url }) => ({ subject: "V", html: `<a href="${url}">v</a>` }),
      onVerified: async () => {
        throw new Error("DB write failed");
      },
    });

    await verify.send("u-8", "heidi@example.com");
    const token = extractTokenFromUrl(fx.sender.sent[0]!.html!)!;

    await expect(verify.consume(token)).rejects.toThrow(/DB write failed/);
    // Token is consumed — a retry returns null, forcing a fresh send.
    const retry = await verify.consume(token);
    expect(retry).toBeNull();
  });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract the `token` query parameter from a URL embedded in a rendered
 * HTML body. Returns `null` if the URL wasn't found — tests assert
 * non-null so a missing token fails loudly.
 */
function extractTokenFromUrl(html: string): string | null {
  // Match the URL carried inside the template. `href="..."` is our
  // rendering convention.
  const hrefMatch = /href="([^"]+)"/.exec(html);
  const url = hrefMatch ? hrefMatch[1]! : html;
  const tokenMatch = /[?&]token=([^&"\s]+)/.exec(url);
  return tokenMatch ? tokenMatch[1]! : null;
}
