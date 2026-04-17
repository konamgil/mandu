/**
 * @mandujs/core/auth/login tests
 *
 * Covers ergonomic login helpers that wrap Phase 2.3's session middleware.
 * Fixture style mirrors `tests/middleware/session.test.ts` — real Request /
 * Response objects, real `createCookieSessionStorage`, no mocks.
 *
 * What we verify:
 *   - `loginUser` writes userId + loggedAt + extras and commits in one shot
 *   - Custom keys are honored
 *   - Missing session middleware throws `AuthenticationError`
 *   - `logoutUser` emits expiring Set-Cookie and is idempotent
 *   - `currentUserId` / `loggedAt` are non-throwing read paths
 *   - End-to-end roundtrip through `ManduFilling`
 *   - Composition with `requireUser` via a `loadUser` beforeHandle bridge
 *     (executable documentation for the common real-world pattern)
 */

import { describe, it, expect } from "bun:test";
import {
  loginUser,
  logoutUser,
  currentUserId,
  loggedAt,
} from "../login";
import { session } from "../../middleware/session";
import {
  Session,
  createCookieSessionStorage,
  type SessionStorage,
} from "../../filling/session";
import { ManduContext } from "../../filling/context";
import { ManduFilling } from "../../filling/filling";
import {
  AuthenticationError,
  requireUser,
  type BaseUser,
} from "../../filling/auth";

// ========== Helpers ==========

const SECRET = "login-helper-test-secret-32bytes!";

function makeReq(url: string, init: RequestInit & { cookie?: string } = {}): Request {
  const { cookie, headers: rawHeaders, ...rest } = init;
  const headers = new Headers(rawHeaders as HeadersInit | undefined);
  if (cookie) headers.set("cookie", cookie);
  return new Request(url, { ...rest, headers });
}

function makeCtx(req: Request): ManduContext {
  return new ManduContext(req);
}

function makeStorage(): SessionStorage {
  return createCookieSessionStorage({
    cookie: { secrets: [SECRET] },
  });
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

/** Extract just the raw (encoded) cookie value from a Set-Cookie line. */
function readSetCookieRawValue(res: Response, name: string): string | null {
  const line = readSetCookieLine(res, name);
  if (!line) return null;
  const [nv] = line.split(";");
  const eq = nv.indexOf("=");
  if (eq <= 0) return null;
  return nv.slice(eq + 1).trim();
}

// ========== loginUser ==========

describe("loginUser — stores userId + loggedAt and commits", () => {
  it("writes userId + loggedAt and emits Set-Cookie via saveSession", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    await loginUser(ctx, "user-123");

    // In-memory session state is visible immediately.
    const s = ctx.get<Session>("session")!;
    expect(s.get<string>("userId")).toBe("user-123");
    expect(typeof s.get<number>("loginAt")).toBe("number");

    // Set-Cookie lands on the next response built from this ctx.
    const res = ctx.ok({ ok: true });
    const line = readSetCookieLine(res, "__session");
    expect(line).toBeTruthy();
    expect(line!).toContain("HttpOnly");
  });

  it("honors a custom userIdKey", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    await loginUser(ctx, "u-42", { userIdKey: "uid" });

    const s = ctx.get<Session>("session")!;
    expect(s.get<string>("uid")).toBe("u-42");
    // Default key is NOT populated when custom key is supplied.
    expect(s.get<string>("userId")).toBeUndefined();
  });

  it("writes extras atomically with userId + loggedAt", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    await loginUser(ctx, "u-1", {
      extras: {
        role: "admin",
        tenantId: "acme",
        remember: true,
        seat: 7,
      },
    });

    const s = ctx.get<Session>("session")!;
    expect(s.get<string>("userId")).toBe("u-1");
    expect(s.get<string>("role")).toBe("admin");
    expect(s.get<string>("tenantId")).toBe("acme");
    expect(s.get<boolean>("remember")).toBe(true);
    expect(s.get<number>("seat")).toBe(7);
  });

  it("throws AuthenticationError when session middleware is not installed", async () => {
    // No `session()` middleware — ctx has no attached session.
    const ctx = makeCtx(makeReq("http://localhost/"));

    let thrown: unknown = null;
    try {
      await loginUser(ctx, "u-1");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AuthenticationError);
    expect((thrown as AuthenticationError).statusCode).toBe(401);
    expect(String(thrown)).toContain("Session middleware not installed");
  });

  it("rejects empty userId with AuthenticationError (never silently stores '')", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    await expect(loginUser(ctx, "")).rejects.toBeInstanceOf(AuthenticationError);
  });
});

// ========== logoutUser ==========

describe("logoutUser — expiring cookie, idempotent", () => {
  it("emits an expiring Set-Cookie (Max-Age=0)", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);
    await loginUser(ctx, "u-1");

    // Now log out on a fresh ctx with the just-issued cookie — but for a unit
    // test we can call logoutUser on the same ctx; destroySession will emit a
    // new Set-Cookie line. There will be multiple Set-Cookie lines for
    // __session because the first loginUser already queued one; we're checking
    // that at least one Max-Age=0 line is present.
    await logoutUser(ctx);
    const res = ctx.ok({ ok: true });

    const headers = res.headers.getSetCookie?.() ?? [];
    const sessionLines = headers.filter((l) => l.startsWith("__session="));
    expect(sessionLines.length).toBeGreaterThan(0);
    const hasExpiring = sessionLines.some((l) => l.includes("Max-Age=0"));
    expect(hasExpiring).toBe(true);
  });

  it("is idempotent — two successive calls do not throw", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    // No prior login — session is empty. Two back-to-back logout calls must
    // not throw. This exercises the "already logged out" code path.
    await logoutUser(ctx);
    await logoutUser(ctx);

    const res = ctx.ok({ ok: true });
    const line = readSetCookieLine(res, "__session");
    expect(line).toBeTruthy();
    expect(line!).toContain("Max-Age=0");
  });

  it("throws AuthenticationError when session middleware is not installed", async () => {
    const ctx = makeCtx(makeReq("http://localhost/"));
    await expect(logoutUser(ctx)).rejects.toBeInstanceOf(AuthenticationError);
  });
});

// ========== currentUserId ==========

describe("currentUserId — non-throwing reader", () => {
  it("returns the userId after loginUser", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    expect(currentUserId(ctx)).toBeNull();
    await loginUser(ctx, "abc-999");
    expect(currentUserId(ctx)).toBe("abc-999");
  });

  it("returns null WITHOUT throwing when session middleware is absent", () => {
    const ctx = makeCtx(makeReq("http://localhost/"));
    expect(() => currentUserId(ctx)).not.toThrow();
    expect(currentUserId(ctx)).toBeNull();
  });

  it("returns null after logoutUser (in-memory wipe)", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    await loginUser(ctx, "u-1");
    expect(currentUserId(ctx)).toBe("u-1");

    await logoutUser(ctx);
    // destroySession wipes in-memory state → currentUserId sees no user.
    expect(currentUserId(ctx)).toBeNull();
  });

  it("honors a custom userIdKey", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    await loginUser(ctx, "u-custom", { userIdKey: "uid" });
    expect(currentUserId(ctx)).toBeNull(); // default key empty
    expect(currentUserId(ctx, { userIdKey: "uid" })).toBe("u-custom");
  });
});

// ========== loggedAt ==========

describe("loggedAt — numeric timestamp reader", () => {
  it("returns a timestamp close to Date.now() after login (within 1s)", async () => {
    const storage = makeStorage();
    const mw = session({ storage });
    const ctx = makeCtx(makeReq("http://localhost/"));
    await mw(ctx);

    const before = Date.now();
    await loginUser(ctx, "u-1");
    const after = Date.now();

    const ts = loggedAt(ctx);
    expect(ts).not.toBeNull();
    expect(typeof ts).toBe("number");
    expect(ts!).toBeGreaterThanOrEqual(before);
    expect(ts!).toBeLessThanOrEqual(after);
  });

  it("returns null when session middleware is absent", () => {
    const ctx = makeCtx(makeReq("http://localhost/"));
    expect(loggedAt(ctx)).toBeNull();
  });
});

// ========== End-to-end roundtrip through ManduFilling ==========

describe("roundtrip — login → cookie → read → logout", () => {
  it("completes a full login/read/logout flow across three requests", async () => {
    const storage = makeStorage();

    // Single filling pipeline handles all three paths via ?action=.
    const filling = new ManduFilling()
      .use(session({ storage }))
      .get(async (ctx) => {
        const action = new URL(ctx.request.url).searchParams.get("action");
        if (action === "login") {
          await loginUser(ctx, "roundtrip-user");
          return ctx.ok({ stage: "login" });
        }
        if (action === "logout") {
          await logoutUser(ctx);
          return ctx.ok({ stage: "logout" });
        }
        // Default: read side.
        return ctx.ok({ uid: currentUserId(ctx) });
      });

    // 1. Login — capture the Set-Cookie the browser would keep.
    const loginRes = await filling.handle(makeReq("http://localhost/?action=login"));
    expect(loginRes.status).toBe(200);
    const cookieLine = readSetCookieLine(loginRes, "__session");
    expect(cookieLine).toBeTruthy();
    const cookieValue = readSetCookieRawValue(loginRes, "__session");
    expect(cookieValue).toBeTruthy();

    // 2. Read — re-attach the issued cookie and verify currentUserId finds
    //    the id we stored.
    const readRes = await filling.handle(
      makeReq("http://localhost/", { cookie: `__session=${cookieValue}` }),
    );
    expect(readRes.status).toBe(200);
    const readBody = (await readRes.json()) as { uid: string | null };
    expect(readBody.uid).toBe("roundtrip-user");

    // 3. Logout — issues expiring cookie; subsequent read with *that* cookie
    //    returns null userId because the client would drop the cookie on
    //    Max-Age=0. We simulate this by not passing any cookie on the fourth
    //    request (emulating what the browser does after receiving the
    //    expiring Set-Cookie).
    const logoutRes = await filling.handle(
      makeReq("http://localhost/?action=logout", { cookie: `__session=${cookieValue}` }),
    );
    expect(logoutRes.status).toBe(200);
    const logoutLine = readSetCookieLine(logoutRes, "__session");
    expect(logoutLine).toBeTruthy();
    expect(logoutLine!).toContain("Max-Age=0");

    // 4. Post-logout read with NO cookie — currentUserId is null.
    const postLogoutRes = await filling.handle(makeReq("http://localhost/"));
    const postLogoutBody = (await postLogoutRes.json()) as { uid: string | null };
    expect(postLogoutBody.uid).toBeNull();
  });
});

// ========== Composition with requireUser from filling/auth ==========

describe("composition with requireUser — the loadUser bridge pattern", () => {
  it("a loadUser beforeHandle bridges session.userId → ctx.set('user', ...) for requireUser", async () => {
    // This is the common real-world pattern worth documenting as a test:
    //
    //   - `loginUser` writes `userId` to the SESSION (persisted across
    //     requests via cookie).
    //   - `requireUser` reads the USER OBJECT from ctx.store at key "user"
    //     (a request-scoped store, wiped every request).
    //   - A tiny middleware placed AFTER `session()` reads the session
    //     userId, fetches the user record from your data layer, and calls
    //     `ctx.set("user", user)`. That's the bridge.

    interface User extends BaseUser {
      id: string;
      name: string;
    }

    // Fake user store.
    const users = new Map<string, User>([
      ["u-1", { id: "u-1", name: "Alice" }],
      ["u-2", { id: "u-2", name: "Bob" }],
    ]);

    const storage = makeStorage();

    const filling = new ManduFilling()
      .use(session({ storage }))
      // ⭐️ The bridge: after session() installs the Session, hydrate the
      //    request-scoped `user` from the session's userId. Placed in
      //    beforeHandle so ALL subsequent handler code can rely on
      //    `requireUser(ctx)`.
      .beforeHandle(async (ctx) => {
        const uid = currentUserId(ctx);
        if (uid) {
          const user = users.get(uid);
          if (user) ctx.set("user", user);
        }
      })
      .get(async (ctx) => {
        const action = new URL(ctx.request.url).searchParams.get("action");
        if (action === "login") {
          await loginUser(ctx, "u-1");
          return ctx.ok({ stage: "login" });
        }
        // requireUser reads ctx.get("user") — the bridge populated it above
        // IFF the session had a valid userId.
        const user = requireUser<User>(ctx);
        return ctx.ok({ id: user.id, name: user.name });
      });

    // 1. Login issues the cookie.
    const loginRes = await filling.handle(makeReq("http://localhost/?action=login"));
    expect(loginRes.status).toBe(200);
    const cookieValue = readSetCookieRawValue(loginRes, "__session");
    expect(cookieValue).toBeTruthy();

    // 2. Second request re-attaches cookie → bridge hydrates → requireUser
    //    returns the full user record.
    const res = await filling.handle(
      makeReq("http://localhost/", { cookie: `__session=${cookieValue}` }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string };
    expect(body.id).toBe("u-1");
    expect(body.name).toBe("Alice");

    // 3. Third request with NO cookie → no session userId → bridge does
    //    nothing → requireUser throws → filling maps to 401.
    const unauthRes = await filling.handle(makeReq("http://localhost/"));
    expect(unauthRes.status).toBe(401);
  });
});
