/**
 * Session middleware tests
 *
 * Covers the thin wrapper around `SessionStorage`:
 *   - Attaches a Session to ctx (fresh or reconstructed from cookie)
 *   - `saveSession` commits when dirty, no-ops when clean
 *   - `destroySession` emits expiring cookie AND wipes in-memory data
 *   - Throws when helpers are invoked without the middleware installed
 *   - Secret rotation round-trip
 *   - `appendRawSetCookie` coexists with `set()` on CookieManager
 *
 * Fixture style mirrors `csrf.test.ts` and `cookie-ssr.test.ts` — real
 * Request/Response objects, no mocks.
 */
import { describe, it, expect } from "bun:test";
import {
  session,
  saveSession,
  destroySession,
} from "../../src/middleware/session";
import {
  Session,
  createCookieSessionStorage,
  type SessionStorage,
} from "../../src/filling/session";
import { CookieManager, ManduContext } from "../../src/filling/context";
import { ManduFilling } from "../../src/filling/filling";

// ========== Helpers ==========

function makeReq(url: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, headers: rawHeaders, ...rest } = init;
  const headers = new Headers(rawHeaders as HeadersInit | undefined);
  if (cookie) headers.set("cookie", cookie);
  return new Request(url, { ...rest, headers });
}

function makeCtx(req: Request): ManduContext {
  return new ManduContext(req);
}

/** Extract the first Set-Cookie line matching `name=`. */
function readSetCookieLine(res: Response, name: string): string | null {
  const headers = res.headers.getSetCookie?.() ?? [];
  const needle = `${name}=`;
  for (const line of headers) {
    if (line.startsWith(needle)) return line;
  }
  return null;
}

/**
 * Read the cookie *value* (without attributes, URL-decoded). Mirrors
 * `readSetCookie` in csrf.test.ts.
 */
function readSetCookieValue(res: Response, name: string): string | null {
  const line = readSetCookieLine(res, name);
  if (!line) return null;
  const [nv] = line.split(";");
  const eq = nv.indexOf("=");
  if (eq <= 0) return null;
  return decodeURIComponent(nv.slice(eq + 1).trim());
}

/** Build a signed cookie header using the same HMAC shape as CookieManager.getSigned. */
async function buildSignedCookie(
  name: string,
  jsonValue: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(jsonValue));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, "");
  const cookieValue = `${jsonValue}.${sigB64}`;
  return `${name}=${encodeURIComponent(cookieValue)}`;
}

/** Run the middleware; simulate handler continuation by returning 200 ok. */
async function runMw(
  mw: (ctx: ManduContext) => Promise<Response | void>,
  ctx: ManduContext
): Promise<Response> {
  const result = await mw(ctx);
  if (result) return result;
  return ctx.ok({ ok: true });
}

const SECRET = "session-mw-test-secret-32bytes!!";

function makeStorage(opts?: { secrets?: string[] }): SessionStorage {
  return createCookieSessionStorage({
    cookie: { secrets: opts?.secrets ?? [SECRET] },
  });
}

// ========== Middleware attach ==========

describe("session middleware: attach", () => {
  it("attaches a fresh Session when no session cookie exists", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));

    const result = await mw(ctx);
    expect(result).toBeUndefined();

    const s = ctx.get<Session>("session");
    expect(s).toBeInstanceOf(Session);
    expect(s!.get("userId")).toBeUndefined();
    expect(s!.isDirty()).toBe(false);
  });

  it("attaches an existing Session reconstructed from a valid signed cookie", async () => {
    const storage = makeStorage();
    const data = JSON.stringify({ userId: "alice", role: "admin" });
    const cookieHeader = await buildSignedCookie("__session", data, SECRET);

    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/", { cookie: cookieHeader }));

    await mw(ctx);
    const s = ctx.get<Session>("session")!;
    expect(s.get<string>("userId")).toBe("alice");
    expect(s.get<string>("role")).toBe("admin");
    // Freshly loaded from cookie — clean, not dirty.
    expect(s.isDirty()).toBe(false);
  });

  it("exposes both session and storage under configurable keys", async () => {
    const storage = makeStorage();
    const mw = session({ storage, attachAs: "sess", storageKey: "sessStorage" });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    expect(ctx.get("sess")).toBeInstanceOf(Session);
    expect(ctx.get<SessionStorage>("sessStorage")).toBe(storage);
    // Default keys must NOT be populated when custom keys are used.
    expect(ctx.get("session")).toBeUndefined();
    expect(ctx.get("_sessionStorage")).toBeUndefined();
  });

  it("default keys are 'session' and '_sessionStorage'", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    expect(ctx.get("session")).toBeInstanceOf(Session);
    expect(ctx.get<SessionStorage>("_sessionStorage")).toBe(storage);
  });

  it("throws when storage option is missing", () => {
    // @ts-expect-error — testing runtime guard against misuse
    expect(() => session({})).toThrow();
    // @ts-expect-error — testing runtime guard against misuse
    expect(() => session(null)).toThrow();
  });
});

// ========== saveSession ==========

describe("session middleware: saveSession", () => {
  it("emits a Set-Cookie on the response after mutation", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    const s = ctx.get<Session>("session")!;
    s.set("userId", "42");
    expect(s.isDirty()).toBe(true);

    await saveSession(ctx);
    // Build the response the same way a handler would — cookies are applied
    // here if any are pending.
    const res = ctx.ok({ ok: true });

    const line = readSetCookieLine(res, "__session");
    expect(line).toBeTruthy();
    expect(line!).toContain("HttpOnly");
    expect(line!).toContain("SameSite=lax");
  });

  it("is a no-op when session is not dirty", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    // No mutations → not dirty → saveSession should not emit anything.
    await saveSession(ctx);
    const res = ctx.ok({ ok: true });
    expect(readSetCookieLine(res, "__session")).toBeNull();
  });

  it("force: true commits even when session is clean", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    const s = ctx.get<Session>("session")!;
    expect(s.isDirty()).toBe(false);

    await saveSession(ctx, { force: true });
    const res = ctx.ok({ ok: true });
    expect(readSetCookieLine(res, "__session")).toBeTruthy();
  });

  it("resets isDirty() to false after a successful commit", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    const s = ctx.get<Session>("session")!;
    s.set("userId", "42");
    expect(s.isDirty()).toBe(true);

    await saveSession(ctx);
    expect(s.isDirty()).toBe(false);
  });

  it("throws when called without the middleware installed", async () => {
    // No `use(session(...))` — ctx has no attached session.
    const ctx = makeCtx(makeReq("http://localhost/"));
    let threw = false;
    try {
      await saveSession(ctx);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(Error);
      expect(String(err)).toContain("session()");
    }
    expect(threw).toBe(true);
  });

  it("throws for destroySession too when middleware not installed", async () => {
    const ctx = makeCtx(makeReq("http://localhost/"));
    let threw = false;
    try {
      await destroySession(ctx);
    } catch (err) {
      threw = true;
      expect(err).toBeInstanceOf(Error);
    }
    expect(threw).toBe(true);
  });
});

// ========== Dirty tracking ==========

describe("session middleware: dirty tracking", () => {
  it("session.set(...) marks the session dirty", async () => {
    const s = new Session();
    expect(s.isDirty()).toBe(false);
    s.set("k", "v");
    expect(s.isDirty()).toBe(true);
  });

  it("session.unset(...) marks the session dirty", async () => {
    const s = new Session();
    s.set("k", "v");
    // Reset to clean so we isolate unset's effect.
    (s as unknown as { markClean: () => void }).markClean();
    expect(s.isDirty()).toBe(false);
    s.unset("k");
    expect(s.isDirty()).toBe(true);
  });

  it("session.setFlash(...) marks the session dirty", async () => {
    const s = new Session();
    expect(s.isDirty()).toBe(false);
    s.setFlash("msg", "hi");
    expect(s.isDirty()).toBe(true);
  });

  it("fromJSON produces a clean session regardless of payload", () => {
    // Loaded state is, by definition, already persisted — not dirty.
    const s = Session.fromJSON({ user: "bob", __flash_notice: "saved" });
    expect(s.isDirty()).toBe(false);
    expect(s.get<string>("user")).toBe("bob");
  });
});

// ========== destroySession ==========

describe("session middleware: destroySession", () => {
  it("emits an expiring Set-Cookie (Max-Age=0)", async () => {
    const storage = makeStorage();
    const mw = session({ storage });

    // Start with an existing populated session cookie so there's something to
    // visibly destroy.
    const initialData = JSON.stringify({ userId: "alice" });
    const cookieHeader = await buildSignedCookie("__session", initialData, SECRET);

    const ctx = makeCtx(makeReq("http://localhost/", { cookie: cookieHeader }));
    await mw(ctx);

    await destroySession(ctx);
    const res = ctx.ok({ ok: true });

    const line = readSetCookieLine(res, "__session");
    expect(line).toBeTruthy();
    expect(line!).toContain("Max-Age=0");
  });

  it("clears in-memory session data so subsequent reads see empty", async () => {
    const storage = makeStorage();
    const mw = session({ storage });

    const initialData = JSON.stringify({ userId: "alice", role: "admin" });
    const cookieHeader = await buildSignedCookie("__session", initialData, SECRET);

    const ctx = makeCtx(makeReq("http://localhost/", { cookie: cookieHeader }));
    await mw(ctx);

    const s = ctx.get<Session>("session")!;
    expect(s.get<string>("userId")).toBe("alice");

    await destroySession(ctx);
    expect(s.get<string>("userId")).toBeUndefined();
    expect(s.get<string>("role")).toBeUndefined();
    expect(s.has("userId")).toBe(false);
  });
});

// ========== Secret rotation ==========

describe("session middleware: secret rotation", () => {
  it("signs with secrets[0] and still reads cookies signed with secrets[1]", async () => {
    const oldSecret = "old-secret-for-rotation-test!!!";
    const newSecret = "new-secret-for-rotation-test!!!";

    // 1. Write a cookie signed with the OLD secret (simulates pre-rotation
    //    state). Build it directly using the HMAC shape that CookieManager
    //    expects.
    const data = JSON.stringify({ userId: "rot-user" });
    const cookieHeader = await buildSignedCookie("__session", data, oldSecret);

    // 2. Middleware now configured with [newSecret, oldSecret] — new signs,
    //    old still verifies.
    const storage = makeStorage({ secrets: [newSecret, oldSecret] });
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/", { cookie: cookieHeader }));
    await mw(ctx);

    const s = ctx.get<Session>("session")!;
    expect(s.get<string>("userId")).toBe("rot-user");

    // 3. Mutate + save → next cookie is re-signed with NEW secret.
    s.set("userId", "rot-user-v2");
    await saveSession(ctx);
    const res = ctx.ok({ ok: true });
    const line = readSetCookieLine(res, "__session");
    expect(line).toBeTruthy();

    // 4. Confirm the rewritten cookie verifies under the new secret by doing
    //    a second round-trip.
    const value = readSetCookieValue(res, "__session");
    expect(value).toBeTruthy();
    const ctx2 = makeCtx(makeReq("http://localhost/", {
      cookie: `__session=${encodeURIComponent(value!)}`,
    }));
    const mw2 = session({ storage });
    await mw2(ctx2);
    const s2 = ctx2.get<Session>("session")!;
    expect(s2.get<string>("userId")).toBe("rot-user-v2");
  });
});

// ========== CookieManager.appendRawSetCookie coexistence ==========

describe("CookieManager.appendRawSetCookie", () => {
  it("coexists with set() — both land in the final Set-Cookie list", async () => {
    const cm = new CookieManager(new Request("http://localhost/"));
    cm.set("regular", "A", { path: "/" });
    cm.appendRawSetCookie("raw=B; Path=/; HttpOnly");

    expect(cm.hasPendingCookies()).toBe(true);
    const headers = cm.getSetCookieHeaders();
    expect(headers.length).toBe(2);
    // Order: set() entries first, raw-append second (per documented contract).
    expect(headers[0]).toContain("regular=A");
    expect(headers[1]).toBe("raw=B; Path=/; HttpOnly");
  });

  it("applyToResponse includes both normal and raw Set-Cookie entries", () => {
    const cm = new CookieManager(new Request("http://localhost/"));
    cm.set("a", "1");
    cm.appendRawSetCookie("b=2; Path=/");
    const res = cm.applyToResponse(new Response("ok"));

    const lines = res.headers.getSetCookie();
    expect(lines.length).toBe(2);
    expect(lines.some((l) => l.startsWith("a=1"))).toBe(true);
    expect(lines.some((l) => l === "b=2; Path=/")).toBe(true);
  });

  it("ignores empty / non-string inputs", () => {
    const cm = new CookieManager(new Request("http://localhost/"));
    cm.appendRawSetCookie("");
    // @ts-expect-error — testing defensive behavior at the runtime boundary
    cm.appendRawSetCookie(null);
    // @ts-expect-error — testing defensive behavior at the runtime boundary
    cm.appendRawSetCookie(undefined);
    expect(cm.hasPendingCookies()).toBe(false);
    expect(cm.getSetCookieHeaders().length).toBe(0);
  });
});

// ========== Integration with filling.use() ==========

describe("session middleware: integration with filling.use()", () => {
  it("plugs into Mandu.filling().use(session(...)).post(handler) end-to-end", async () => {
    const storage = makeStorage();

    const filling = new ManduFilling()
      .use(session({ storage }))
      .post(async (ctx) => {
        const s = ctx.get<Session>("session")!;
        s.set("userId", "integration-user");
        await saveSession(ctx);
        return ctx.ok({ uid: s.get<string>("userId") });
      });

    const res = await filling.handle(
      makeReq("http://localhost/api", { method: "POST" })
    );
    expect(res.status).toBe(200);

    const line = readSetCookieLine(res, "__session");
    expect(line).toBeTruthy();
    expect(line!).toContain("HttpOnly");

    const body = (await res.json()) as { uid: string };
    expect(body.uid).toBe("integration-user");
  });

  it("destroySession via filling wipes cookie on the outgoing response", async () => {
    const storage = makeStorage();
    const data = JSON.stringify({ userId: "about-to-logout" });
    const cookieHeader = await buildSignedCookie("__session", data, SECRET);

    const filling = new ManduFilling()
      .use(session({ storage }))
      .post(async (ctx) => {
        const s = ctx.get<Session>("session")!;
        // Confirm session is loaded with the expected user before destroy.
        expect(s.get<string>("userId")).toBe("about-to-logout");
        await destroySession(ctx);
        return ctx.ok({ out: true });
      });

    const res = await filling.handle(
      makeReq("http://localhost/api", { method: "POST", cookie: cookieHeader })
    );
    expect(res.status).toBe(200);
    const line = readSetCookieLine(res, "__session");
    expect(line).toBeTruthy();
    expect(line!).toContain("Max-Age=0");
  });
});
