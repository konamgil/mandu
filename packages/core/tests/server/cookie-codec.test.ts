/**
 * Cookie codec parity + backward-compat tests.
 *
 * Verifies that the Bun.CookieMap-backed codec and the pure-JS legacy codec
 * are behaviorally equivalent on parse and (semantically) on serialize, and
 * that HMAC-signed cookies interoperate across both codecs.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  LegacyCookieCodec,
  _setCodecForTesting,
  createBunCookieMapCodec,
  getCookieCodec,
  type CookieCodec,
} from "../../src/filling/cookie-codec";
import { CookieManager, type CookieOptions } from "../../src/filling/context";

// Bun 1.3+ is required by this package (engines.bun >= 1.3.0). The Bun codec
// should always be available in the test runtime.
const bunCodec = createBunCookieMapCodec();
if (!bunCodec) {
  throw new Error("BunCookieMapCodec unavailable — these tests require Bun >= 1.3");
}
const BunCookieMapCodec: CookieCodec = bunCodec;

// ========== Parse parity ==========

describe("CookieCodec.parseRequestHeader parity", () => {
  // Each case produces the same `Map<string, string>` across codecs.
  const cases: Array<[string, string | null]> = [
    ["null header", null],
    ["empty string", ""],
    ["single cookie", "a=1"],
    ["multiple cookies", "a=1; b=2; c=3"],
    ["URL-encoded value", "session=abc%20def"],
    ["value with encoded comma", "prefs=val%2Cue"],
    ["value containing equals sign", "session=hello.abc%3Ddef"],
    ["no-value cookie (name only)", "flag; a=1"],
    ["duplicated name (first wins per RFC 6265)", "a=1; a=2"],
    ["whitespace tolerance", "  a=1 ;  b=2  "],
    ["URL-encoded name", "my%20key=val"],
  ];

  for (const [label, header] of cases) {
    it(label, () => {
      const legacy = LegacyCookieCodec.parseRequestHeader(header);
      const bun = BunCookieMapCodec.parseRequestHeader(header);
      expect([...bun.entries()]).toEqual([...legacy.entries()]);
    });
  }

  it("handles malformed URL encoding without throwing", () => {
    // Bare '%' is invalid UTF-8 URI — legacy catches and preserves raw; we
    // only require the Bun codec to not throw. The codecs may diverge on the
    // stored value for this malformed case (documented in test comment).
    expect(() => LegacyCookieCodec.parseRequestHeader("x=%")).not.toThrow();
    expect(() => BunCookieMapCodec.parseRequestHeader("x=%")).not.toThrow();
  });
});

// ========== Serialize parity ==========

/**
 * Compare two Set-Cookie header strings as unordered attribute sets.
 *
 * RFC 6265 treats Set-Cookie attributes as an unordered bag. Bun.CookieMap
 * emits attributes in a different order than the legacy serializer; both are
 * semantically identical and every browser accepts either ordering. We
 * compare on the canonical unordered form so tests remain meaningful without
 * overfitting to a specific emission order.
 */
function canonicalizeSetCookie(header: string): { nameValue: string; attrs: Set<string> } {
  const [nameValue, ...rest] = header.split(";").map((s) => s.trim());
  // Normalize attribute casing (e.g. "HttpOnly" === "httponly"). Values
  // (after '=') preserve case except for SameSite which both codecs emit
  // Title-Cased already.
  const attrs = new Set(
    rest.filter((s) => s.length > 0).map((s) => {
      const eq = s.indexOf("=");
      if (eq === -1) return s.toLowerCase();
      return s.slice(0, eq).toLowerCase() + "=" + s.slice(eq + 1);
    })
  );
  return { nameValue, attrs };
}

describe("CookieCodec.serializeSetCookie parity", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  const cases: Array<[string, string, string, CookieOptions]> = [
    ["plain value", "simple", "plain", {}],
    ["value with space", "x", "hello world", {}],
    ["value with comma", "x", "comma,value", {}],
    ["httpOnly + maxAge", "session", "abc123", { httpOnly: true, maxAge: 3600 }],
    ["delete cookie (maxAge=0 + expires=epoch)", "old", "", { maxAge: 0, expires: new Date(0) }],
    ["expires as Date", "x", "y", { expires: now }],
    ["maxAge + expires together", "x", "y", { maxAge: 60, expires: now }],
    ["sameSite=strict", "x", "y", { sameSite: "strict" }],
    ["sameSite=lax + secure", "x", "y", { sameSite: "lax", secure: true }],
    ["sameSite=none + secure + partitioned (CHIPS)", "x", "y", { sameSite: "none", secure: true, partitioned: true }],
    ["custom domain and path", "x", "y", { domain: "example.com", path: "/api" }],
    ["all attributes", "session", "abc", {
      httpOnly: true,
      secure: true,
      maxAge: 3600,
      expires: now,
      domain: "example.com",
      path: "/",
      sameSite: "lax",
      partitioned: true,
    }],
  ];

  for (const [label, name, value, options] of cases) {
    it(label, () => {
      const legacyHeader = LegacyCookieCodec.serializeSetCookie(name, value, options);
      const bunHeader = BunCookieMapCodec.serializeSetCookie(name, value, options);

      const legacyCanon = canonicalizeSetCookie(legacyHeader);
      const bunCanon = canonicalizeSetCookie(bunHeader);

      // name=value segment must be byte-identical: both codecs URL-encode
      // both name and value with encodeURIComponent, so this is a strong
      // invariant.
      expect(bunCanon.nameValue).toBe(legacyCanon.nameValue);
      // Attribute set must be identical (order irrelevant per RFC 6265).
      expect([...bunCanon.attrs].sort()).toEqual([...legacyCanon.attrs].sort());
    });
  }

  it("name=value segment is byte-identical across codecs", () => {
    // Critical for signed-cookie backward compatibility: HMAC value encoding
    // must match exactly so existing cookies still verify.
    const signed = "user.abcdef%2BZZ";
    const legacy = LegacyCookieCodec.serializeSetCookie("session", signed, {});
    const bun = BunCookieMapCodec.serializeSetCookie("session", signed, {});
    expect(legacy.split(";")[0]).toBe(bun.split(";")[0]);
  });

  it("omits SameSite when caller did not specify it (matches legacy)", () => {
    // Bun.CookieMap auto-injects `SameSite=Lax`; the Bun codec strips that
    // default so behavior matches the legacy codec for callers who haven't
    // opted into a sameSite policy.
    const bun = BunCookieMapCodec.serializeSetCookie("x", "y", { httpOnly: true });
    expect(bun.toLowerCase()).not.toContain("samesite=");
  });
});

// ========== Signed cookie backward compatibility ==========

describe("Signed cookie backward compatibility across codecs", () => {
  const SECRET = "test-secret-key-32bytes!";

  afterEach(() => {
    _setCodecForTesting(); // restore auto-detected default
  });

  it("cookie signed under Bun codec verifies under Legacy codec (and vice versa)", async () => {
    // 1. Sign with Bun.CookieMap codec active.
    _setCodecForTesting(BunCookieMapCodec);
    const writer = new CookieManager(new Request("http://localhost/"));
    await writer.setSigned("session", "user-123", SECRET, { httpOnly: true });
    const setCookie = writer.getSetCookieHeaders()[0];
    const cookieKV = setCookie.split(";")[0]; // "session=<encoded>.<sig>"

    // 2. Parse + verify with Legacy codec active.
    _setCodecForTesting(LegacyCookieCodec);
    const reader = new CookieManager(
      new Request("http://localhost/", { headers: { cookie: cookieKV } })
    );
    expect(await reader.getSigned("session", SECRET)).toBe("user-123");

    // 3. Reverse direction: sign with Legacy, verify with Bun.
    _setCodecForTesting(LegacyCookieCodec);
    const writer2 = new CookieManager(new Request("http://localhost/"));
    await writer2.setSigned("token", "payload/+=", SECRET);
    const setCookie2 = writer2.getSetCookieHeaders()[0];
    const cookieKV2 = setCookie2.split(";")[0];

    _setCodecForTesting(BunCookieMapCodec);
    const reader2 = new CookieManager(
      new Request("http://localhost/", { headers: { cookie: cookieKV2 } })
    );
    expect(await reader2.getSigned("token", SECRET)).toBe("payload/+=");
  });

  it("secret rotation still works across codec boundaries (session.ts pattern)", async () => {
    // session.ts iterates over `secrets[]` calling cookies.getSigned per secret.
    // Verify rotation succeeds when one secret matches and the codec changes
    // between sign and verify.
    const oldSecret = "rotated-out-key-v1";
    const currentSecret = "current-key-v2";

    _setCodecForTesting(LegacyCookieCodec);
    const writer = new CookieManager(new Request("http://localhost/"));
    await writer.setSigned("__session", '{"uid":42}', oldSecret);
    const cookieKV = writer.getSetCookieHeaders()[0].split(";")[0];

    _setCodecForTesting(BunCookieMapCodec);
    const reader = new CookieManager(
      new Request("http://localhost/", { headers: { cookie: cookieKV } })
    );

    // Simulate session.ts:172-174 rotation loop.
    const secrets = [currentSecret, oldSecret];
    let verified: string | null | false = false;
    for (const secret of secrets) {
      const result = await reader.getSigned("__session", secret);
      if (typeof result === "string") {
        verified = result;
        break;
      }
    }
    expect(verified).toBe('{"uid":42}');
  });
});

// ========== Fallback path ==========

describe("Legacy codec fallback (non-Bun runtime simulation)", () => {
  afterEach(() => {
    _setCodecForTesting();
  });

  it("forcing Legacy codec preserves full CookieManager contract", async () => {
    _setCodecForTesting(LegacyCookieCodec);
    expect(getCookieCodec().name).toBe("legacy");

    const req = new Request("http://localhost/", {
      headers: { cookie: "existing=preserved; other=kept" },
    });
    const manager = new CookieManager(req);

    // Read path
    expect(manager.get("existing")).toBe("preserved");
    expect(manager.has("other")).toBe(true);
    expect(manager.getAll()).toEqual({ existing: "preserved", other: "kept" });

    // Write path
    manager.set("new", "value", { httpOnly: true, maxAge: 60 });
    manager.delete("stale");
    expect(manager.hasPendingCookies()).toBe(true);

    const headers = manager.getSetCookieHeaders();
    expect(headers.length).toBe(2);
    expect(headers.some((h) => h.includes("new=value") && h.includes("HttpOnly") && h.includes("Max-Age=60"))).toBe(true);
    expect(headers.some((h) => h.includes("stale=") && h.includes("Max-Age=0"))).toBe(true);

    // Signed round-trip under legacy
    const SECRET = "fallback-secret";
    await manager.setSigned("signed", "data", SECRET);
    const signedHeader = manager.getSetCookieHeaders().find((h) => h.startsWith("signed="))!;
    const reader = new CookieManager(
      new Request("http://localhost/", { headers: { cookie: signedHeader.split(";")[0] } })
    );
    expect(await reader.getSigned("signed", SECRET)).toBe("data");
  });

  it("applyToResponse merges cookies into an existing Response under Legacy codec", () => {
    _setCodecForTesting(LegacyCookieCodec);
    const manager = new CookieManager(new Request("http://localhost/"));
    manager.set("a", "1");
    manager.set("b", "2");

    const base = new Response("ok", { status: 200, headers: { "X-Preserved": "yes" } });
    const merged = manager.applyToResponse(base);

    expect(merged.status).toBe(200);
    expect(merged.headers.get("X-Preserved")).toBe("yes");
    const setCookies = merged.headers.getSetCookie();
    expect(setCookies.length).toBe(2);
    expect(setCookies.some((h) => h.startsWith("a=1"))).toBe(true);
    expect(setCookies.some((h) => h.startsWith("b=2"))).toBe(true);
  });
});

// ========== Codec selection ==========

describe("Codec selection", () => {
  afterEach(() => {
    _setCodecForTesting();
  });

  it("defaults to bun-cookiemap when Bun.CookieMap is available", () => {
    _setCodecForTesting(); // restore default
    expect(getCookieCodec().name).toBe("bun-cookiemap");
  });

  it("_setCodecForTesting(undefined) restores auto-detected default", () => {
    _setCodecForTesting(LegacyCookieCodec);
    expect(getCookieCodec().name).toBe("legacy");
    _setCodecForTesting();
    expect(getCookieCodec().name).toBe("bun-cookiemap");
  });
});
