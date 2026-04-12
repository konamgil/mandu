// @ts-nocheck — test file, runtime correctness verified by bun:test
/**
 * Session & Cookie Session Storage Tests
 */

import { describe, it, expect } from "bun:test";
import { Session, createCookieSessionStorage } from "../../src/filling/session";
import { CookieManager } from "../../src/filling/context";

function cookieManagerFrom(cookieHeader: string): CookieManager {
  const req = new Request("http://localhost/", {
    headers: { Cookie: cookieHeader },
  });
  return new CookieManager(req);
}

function emptyCookieManager(): CookieManager {
  return new CookieManager(new Request("http://localhost/"));
}

/** Build a signed cookie value matching CookieManager.getSigned expectations (no trailing =). */
async function buildSignedCookie(
  name: string, jsonValue: string, secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(jsonValue));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "");
  const cookieValue = `${jsonValue}.${sigB64}`;
  return `${name}=${encodeURIComponent(cookieValue)}`;
}

describe("Session class", () => {
  it("get/set stores and retrieves values", () => {
    const s = new Session();
    s.set("user", "alice");
    expect(s.get("user")).toBe("alice");
  });

  it("has returns true for existing keys", () => {
    const s = new Session();
    s.set("token", "abc");
    expect(s.has("token")).toBe(true);
    expect(s.has("missing")).toBe(false);
  });

  it("unset removes a key", () => {
    const s = new Session();
    s.set("x", 1);
    s.unset("x");
    expect(s.get("x")).toBeUndefined();
    expect(s.has("x")).toBe(false);
  });

  it("setFlash is read-once then gone", () => {
    const s = new Session();
    s.setFlash("msg", "hello");
    expect(s.has("msg")).toBe(true);
    expect(s.get("msg")).toBe("hello");
    // second read falls back to data (not flash)
    expect(s.get("msg")).toBeUndefined();
  });

  it("toJSON includes flash data for serialization", () => {
    const s = new Session();
    s.set("user", "bob");
    s.setFlash("notice", "saved");
    const json = s.toJSON();
    expect(json.user).toBe("bob");
    expect(json.__flash_notice).toBe("saved");
  });

  it("fromJSON restores flash so it is read-once", () => {
    const raw = { user: "carol", __flash_alert: "warning" };
    const s = Session.fromJSON(raw);
    expect(s.get("user")).toBe("carol");
    expect(s.has("alert")).toBe(true);
    expect(s.get("alert")).toBe("warning");
    expect(s.get("alert")).toBeUndefined();
  });
});

describe("createCookieSessionStorage", () => {
  const secret = "test-secret-that-is-long-enough";

  it("throws when secrets array is empty", () => {
    expect(() =>
      createCookieSessionStorage({ cookie: { secrets: [] } })
    ).toThrow("At least one secret is required");
  });

  it("getSession returns empty session when no cookie", async () => {
    const storage = createCookieSessionStorage({ cookie: { secrets: [secret] } });
    const session = await storage.getSession(emptyCookieManager());
    expect(session.get("user")).toBeUndefined();
  });

  it("commitSession returns Set-Cookie string with expected parts", async () => {
    const storage = createCookieSessionStorage({ cookie: { secrets: [secret], path: "/" } });
    const session = new Session();
    session.set("user", "dave");
    const setCookie = await storage.commitSession(session);

    expect(setCookie).toContain("__session=");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
  });

  it("getSession recovers data from correctly-signed cookie", async () => {
    const storage = createCookieSessionStorage({ cookie: { secrets: [secret] } });
    const data = JSON.stringify({ role: "admin" });
    const cookieHeader = await buildSignedCookie("__session", data, secret);

    const cookies = cookieManagerFrom(cookieHeader);
    const s = await storage.getSession(cookies);

    expect(s.get("role")).toBe("admin");
  });

  it("getSession returns empty session for tampered cookie", async () => {
    const storage = createCookieSessionStorage({ cookie: { secrets: [secret] } });
    const data = JSON.stringify({ id: "123" });
    const cookieHeader = await buildSignedCookie("__session", data, secret);

    const tampered = cookieHeader + "TAMPERED";
    const cookies = cookieManagerFrom(tampered);
    const s = await storage.getSession(cookies);

    expect(s.get("id")).toBeUndefined();
  });

  it("secret rotation: old secret still decodes", async () => {
    const secret1 = "old-secret-key-for-rotation";
    const secret2 = "new-secret-key-for-rotation";

    const data = JSON.stringify({ token: "abc" });
    const cookieHeader = await buildSignedCookie("__session", data, secret1);

    // Read with [secret2, secret1] -- secret1 is second, should still match
    const storage = createCookieSessionStorage({
      cookie: { secrets: [secret2, secret1] },
    });
    const cookies = cookieManagerFrom(cookieHeader);
    const s = await storage.getSession(cookies);

    expect(s.get("token")).toBe("abc");
  });

  it("destroySession returns a Max-Age=0 cookie", async () => {
    const storage = createCookieSessionStorage({ cookie: { secrets: [secret] } });
    const s = new Session();
    const destroy = await storage.destroySession(s);

    expect(destroy).toContain("__session=");
    expect(destroy).toContain("Max-Age=0");
  });

  it("commitSession + getSession round-trip preserves data", async () => {
    // This documents a known mismatch between commitSession (keeps base64 padding)
    // and CookieManager.getSigned (strips trailing =). Round-trip via commitSession
    // then getSession will fail to verify the signature.
    const storage = createCookieSessionStorage({ cookie: { secrets: [secret] } });
    const s1 = new Session();
    s1.set("user", "test");
    const setCookie = await storage.commitSession(s1);

    const cookieKV = setCookie.split(";")[0];
    const cookies = cookieManagerFrom(cookieKV);
    const s2 = await storage.getSession(cookies);

    // 패딩 수정 후 round-trip 정상 동작
    expect(s2.get("user")).toBe("test");
  });
});
