/**
 * CSRF middleware tests
 *
 * Covers the double-submit cookie contract:
 *   - Safe methods pass through and establish a cookie on first contact.
 *   - Unsafe methods require BOTH a matching cookie and signed token.
 *   - Tampered or missing tokens fail closed (403) without leaking which
 *     check failed.
 *
 * Integration test at the bottom confirms the middleware plugs into
 * `Mandu.filling().use(csrf(...)).post(handler)` correctly.
 */
import { describe, it, expect } from "bun:test";
import { csrf } from "../../src/middleware/csrf";
import { ManduContext } from "../../src/filling/context";
import { ManduFilling } from "../../src/filling/filling";

// ========== Helpers ==========

function makeReq(
  url: string,
  init: RequestInit & { cookie?: string } = {}
): Request {
  const { cookie, headers: rawHeaders, ...rest } = init;
  const headers = new Headers(rawHeaders as HeadersInit | undefined);
  if (cookie) headers.set("cookie", cookie);
  return new Request(url, { ...rest, headers });
}

function makeCtx(req: Request): ManduContext {
  return new ManduContext(req);
}

/**
 * Extract the first Set-Cookie value for the given cookie name, stripping
 * any attributes (Path, HttpOnly, ...).
 */
function readSetCookie(res: Response, name: string): string | null {
  const headers = res.headers.getSetCookie?.() ?? [];
  for (const line of headers) {
    const [nv] = line.split(";");
    const eq = nv.indexOf("=");
    if (eq > 0) {
      const cn = nv.slice(0, eq).trim();
      if (cn === name) return decodeURIComponent(nv.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Produce a cookie header value (`name=value`) from a raw token, matching
 * how the browser would echo back a token we previously issued.
 */
function cookieHeader(name: string, value: string): string {
  return `${name}=${encodeURIComponent(value)}`;
}

/**
 * Run the middleware to completion, returning either the early-return
 * Response (on failure) or `undefined` (on pass-through). When the middleware
 * returns `undefined`, the handler stage would normally run; we simulate
 * that here by crafting a minimal 200 response and applying pending cookies
 * so callers can inspect Set-Cookie headers.
 */
async function runMw(
  mw: (ctx: ManduContext) => Promise<Response | void>,
  ctx: ManduContext
): Promise<Response> {
  const result = await mw(ctx);
  if (result) return result;
  return ctx.ok({ ok: true });
}

const SECRET = "csrf-test-secret-32bytes!!!";

// ========== Safe methods ==========

describe("csrf: safe methods", () => {
  it("GET passes through without a token", async () => {
    const mw = csrf({ secret: SECRET });
    const ctx = makeCtx(makeReq("http://localhost/items", { method: "GET" }));
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(200);
  });

  it("HEAD passes through without a token", async () => {
    const mw = csrf({ secret: SECRET });
    const ctx = makeCtx(makeReq("http://localhost/items", { method: "HEAD" }));
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(200);
  });

  it("OPTIONS passes through without a token", async () => {
    const mw = csrf({ secret: SECRET });
    const ctx = makeCtx(makeReq("http://localhost/items", { method: "OPTIONS" }));
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(200);
  });

  it("safe-method request without existing cookie issues a fresh one", async () => {
    const mw = csrf({ secret: SECRET });
    const ctx = makeCtx(makeReq("http://localhost/items", { method: "GET" }));
    const res = await runMw(mw, ctx);

    const setToken = readSetCookie(res, "__csrf");
    expect(setToken).toBeTruthy();
    expect(setToken!.length).toBeGreaterThan(10);
  });

  it("safe-method request with an existing valid cookie keeps the same token", async () => {
    const mw = csrf({ secret: SECRET });

    // First call: obtain a fresh token.
    const ctx1 = makeCtx(makeReq("http://localhost/", { method: "GET" }));
    const res1 = await runMw(mw, ctx1);
    const token = readSetCookie(res1, "__csrf");
    expect(token).toBeTruthy();

    // Second call: present the same cookie — middleware should NOT rotate.
    const ctx2 = makeCtx(
      makeReq("http://localhost/", {
        method: "GET",
        cookie: cookieHeader("__csrf", token!),
      })
    );
    const res2 = await runMw(mw, ctx2);
    const setAgain = readSetCookie(res2, "__csrf");
    expect(setAgain).toBeNull();
  });

  it("safe-method request with a tampered cookie rotates to a fresh one", async () => {
    const mw = csrf({ secret: SECRET });
    const ctx = makeCtx(
      makeReq("http://localhost/", {
        method: "GET",
        cookie: cookieHeader("__csrf", "not.a.valid.token"),
      })
    );
    const res = await runMw(mw, ctx);
    const fresh = readSetCookie(res, "__csrf");
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe("not.a.valid.token");
  });
});

// ========== Unsafe methods — failure paths ==========

describe("csrf: unsafe methods (reject)", () => {
  it("POST without any token returns 403", async () => {
    const mw = csrf({ secret: SECRET });
    const ctx = makeCtx(makeReq("http://localhost/items", { method: "POST" }));
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(403);
  });

  it("POST with mismatched header token returns 403", async () => {
    const mw = csrf({ secret: SECRET });

    // First, establish a valid cookie.
    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const cookieToken = readSetCookie(bootstrap, "__csrf");
    expect(cookieToken).toBeTruthy();

    // Generate a different, independently-signed token.
    const alt = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const altToken = readSetCookie(alt, "__csrf");
    expect(altToken).toBeTruthy();
    expect(altToken).not.toBe(cookieToken);

    // Submit the alt token against the original cookie — must fail.
    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("__csrf", cookieToken!),
        headers: { "x-csrf-token": altToken! },
      })
    );
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(403);
  });

  it("POST with a tampered signature returns 403", async () => {
    const mw = csrf({ secret: SECRET });
    const fake = "notreallya.validtoken";
    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("__csrf", fake),
        headers: { "x-csrf-token": fake },
      })
    );
    // Cookie is garbage → middleware treats it as missing and issues a fresh
    // one, then validates the submitted header against THAT fresh cookie.
    // Submitted == old fake ≠ fresh cookie → 403.
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(403);
  });

  it("POST with missing cookie but valid header token returns 403", async () => {
    const mw = csrf({ secret: SECRET });
    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const someToken = readSetCookie(bootstrap, "__csrf");
    expect(someToken).toBeTruthy();

    // No cookie on this request — only a header. Must fail.
    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        headers: { "x-csrf-token": someToken! },
      })
    );
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(403);
  });

  it("failure responses do not leak which check failed", async () => {
    const mw = csrf({ secret: SECRET });
    const ctx = makeCtx(makeReq("http://localhost/items", { method: "POST" }));
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(403);
    const body = await res.json() as { message?: string };
    expect(body.message).toBe("CSRF token missing or invalid");
  });
});

// ========== Unsafe methods — success paths ==========

describe("csrf: unsafe methods (accept)", () => {
  it("POST with a valid header token matching the cookie passes", async () => {
    const mw = csrf({ secret: SECRET });
    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const token = readSetCookie(bootstrap, "__csrf");
    expect(token).toBeTruthy();

    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("__csrf", token!),
        headers: { "x-csrf-token": token! },
      })
    );
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(200);
  });

  it("POST with a valid form-field token matching the cookie passes", async () => {
    const mw = csrf({ secret: SECRET });
    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const token = readSetCookie(bootstrap, "__csrf");
    expect(token).toBeTruthy();

    const body = new URLSearchParams({ _csrf: token!, hello: "world" });
    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("__csrf", token!),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
    );
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(200);
  });

  it("header takes precedence when both header and form field are present", async () => {
    const mw = csrf({ secret: SECRET });
    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const token = readSetCookie(bootstrap, "__csrf");
    expect(token).toBeTruthy();

    // Header has the RIGHT token, form field has garbage — request must pass
    // because header is checked first and matches.
    const body = new URLSearchParams({ _csrf: "garbage", x: "1" });
    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("__csrf", token!),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-csrf-token": token!,
        },
        body: body.toString(),
      })
    );
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(200);
  });

  it("form-field token is ignored for JSON bodies", async () => {
    // A JSON request putting `_csrf` in the body must NOT be accepted — the
    // form-field fallback only applies to form content types.
    const mw = csrf({ secret: SECRET });
    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const token = readSetCookie(bootstrap, "__csrf");
    expect(token).toBeTruthy();

    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("__csrf", token!),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ _csrf: token, hello: "world" }),
      })
    );
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(403);
  });

  it("body can still be read by the handler after form-field check (clone semantics)", async () => {
    // Middleware clones the request before reading the form, so downstream
    // code can still consume the body.
    const mw = csrf({ secret: SECRET });
    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const token = readSetCookie(bootstrap, "__csrf");
    expect(token).toBeTruthy();

    const body = new URLSearchParams({ _csrf: token!, value: "kept" });
    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("__csrf", token!),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      })
    );
    const mwResult = await mw(ctx);
    expect(mwResult).toBeUndefined();

    // Handler consumes the ORIGINAL request body — must still work.
    const form = await ctx.request.formData();
    expect(form.get("value")).toBe("kept");
  });
});

// ========== Configuration knobs ==========

describe("csrf: configuration", () => {
  it("respects cookieOptions.httpOnly: true (attribute set; caveat documented)", async () => {
    const mw = csrf({ secret: SECRET, cookieOptions: { httpOnly: true } });
    const ctx = makeCtx(makeReq("http://localhost/", { method: "GET" }));
    const res = await runMw(mw, ctx);
    const raw = res.headers.getSetCookie();
    const line = raw.find((l) => l.startsWith("__csrf="));
    expect(line).toBeTruthy();
    expect(line!).toContain("HttpOnly");
  });

  it("custom safeMethods skips TRACE as requested", async () => {
    const mw = csrf({
      secret: SECRET,
      safeMethods: ["GET", "HEAD", "OPTIONS", "TRACE"],
    });
    const ctx = makeCtx(makeReq("http://localhost/", { method: "TRACE" }));
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(200);
  });

  it("custom cookieName is honored for read + write", async () => {
    const mw = csrf({ secret: SECRET, cookieName: "x-forge" });

    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const token = readSetCookie(bootstrap, "x-forge");
    expect(token).toBeTruthy();

    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("x-forge", token!),
        headers: { "x-csrf-token": token! },
      })
    );
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(200);
  });

  it("custom headerName is honored on submission", async () => {
    const mw = csrf({ secret: SECRET, headerName: "x-xsrf" });

    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const token = readSetCookie(bootstrap, "__csrf");
    expect(token).toBeTruthy();

    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("__csrf", token!),
        headers: { "x-xsrf": token! },
      })
    );
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(200);
  });

  it("throws when secret is missing", () => {
    expect(() => csrf({ secret: "" })).toThrow();
    expect(() =>
      csrf({ secret: undefined as unknown as string })
    ).toThrow();
  });
});

// ========== Integration with filling.use() ==========

describe("csrf: integration with filling.use()", () => {
  it("plugs into Mandu.filling().use(csrf(...)).post(handler) end-to-end", async () => {
    const filling = new ManduFilling()
      .use(csrf({ secret: SECRET }))
      .post((ctx) => ctx.ok({ ok: true, hit: "handler" }));

    // Unsafe method without token → 403.
    const rejected = await filling.handle(
      makeReq("http://localhost/api", { method: "POST" })
    );
    expect(rejected.status).toBe(403);

    // Safe method → pass, obtain cookie.
    const getRes = await filling.handle(
      makeReq("http://localhost/api", { method: "GET" })
    );
    // GET has no handler registered — so 405 is expected here. But the
    // middleware should still have set a cookie prior to the 405.
    // Actually because cookie is set in beforeHandle via `use()`, it ends up
    // on the response. Confirm that at least when the middleware passes
    // safe-method through, the path resolves (status is 405 OR 200).
    expect([200, 405]).toContain(getRes.status);

    // Round-trip: first obtain a token via a dedicated GET handler.
    const getable = new ManduFilling()
      .use(csrf({ secret: SECRET }))
      .get((ctx) => ctx.ok({ ok: true }))
      .post((ctx) => ctx.ok({ ok: true, hit: "post" }));

    const gr = await getable.handle(
      makeReq("http://localhost/api", { method: "GET" })
    );
    expect(gr.status).toBe(200);
    const token = readSetCookie(gr, "__csrf");
    expect(token).toBeTruthy();

    const pr = await getable.handle(
      makeReq("http://localhost/api", {
        method: "POST",
        cookie: cookieHeader("__csrf", token!),
        headers: { "x-csrf-token": token! },
      })
    );
    expect(pr.status).toBe(200);
    const body = await pr.json() as { hit?: string };
    expect(body.hit).toBe("post");
  });
});

// ========== safeEqual sanity ==========

describe("csrf: constant-time equality sanity", () => {
  // The safeEqual helper is internal — we exercise it indirectly by crafting
  // a mismatched-but-equal-length token pair and ensuring the middleware
  // rejects them. Full timing measurement is out of scope for CI.
  it("rejects equal-length but different tokens", async () => {
    const mw = csrf({ secret: SECRET });
    const bootstrap = await runMw(
      mw,
      makeCtx(makeReq("http://localhost/", { method: "GET" }))
    );
    const token = readSetCookie(bootstrap, "__csrf");
    expect(token).toBeTruthy();

    // Flip one character to produce a same-length, different string.
    const flipped =
      token!.charAt(0) === "A"
        ? "B" + token!.slice(1)
        : "A" + token!.slice(1);
    expect(flipped).not.toBe(token);
    expect(flipped.length).toBe(token!.length);

    const ctx = makeCtx(
      makeReq("http://localhost/items", {
        method: "POST",
        cookie: cookieHeader("__csrf", token!),
        headers: { "x-csrf-token": flipped },
      })
    );
    const res = await runMw(mw, ctx);
    expect(res.status).toBe(403);
  });
});
