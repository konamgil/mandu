---
title: Middleware Composition
phase: 18.ε
status: stable
audience: framework-users, contributors
---

# Middleware Composition

Mandu exposes two middleware layers that coexist without overlap:

1. **Filling-level** (ctx-based). Runs inside a single filling chain with
   a `ManduContext`. Great for per-route concerns like CSRF, session
   hydration, and security headers that want route-aware context.
2. **Request-level** (Phase 18.ε — canonical composition API). Runs
   BEFORE route dispatch on the raw `Request`. Great for app-wide
   policies: auth gates, tenant resolution, rate limiting, request
   logging, URL rewrites, redirects.

This document covers layer (2): `defineMiddleware()` + `compose()`. It
is the Mandu analogue of Next.js `middleware.ts` and SvelteKit's
`hooks.server.ts` `handle` sequence.

## Quick start

```ts
// mandu.config.ts
import {
  defineMiddleware,
  csrfMiddleware,
  sessionMiddleware,
} from "@mandujs/core/middleware";
import { createCookieSessionStorage } from "@mandujs/core";

const storage = createCookieSessionStorage({
  cookie: { secrets: [process.env.SESSION_SECRET!] },
});

const requestId = defineMiddleware({
  name: "request-id",
  async handler(req, next) {
    const id = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const res = await next();
    res.headers.set("x-request-id", id);
    return res;
  },
});

const authGate = defineMiddleware({
  name: "auth-gate",
  match: (req) => new URL(req.url).pathname.startsWith("/admin"),
  async handler(req, next) {
    const authed = req.headers.has("authorization");
    if (!authed) return new Response("Unauthorized", { status: 401 });
    return next();
  },
});

export default {
  middleware: [
    requestId,
    sessionMiddleware({ storage }),
    csrfMiddleware({ secret: process.env.CSRF_SECRET! }),
    authGate,
  ],
};
```

## The `Middleware` interface

```ts
interface Middleware {
  name: string;
  match?: (req: Request) => boolean;
  handler: (
    req: Request,
    next: (req?: Request) => Promise<Response>
  ) => Promise<Response>;
}
```

- `name` — displayed in diagnostic messages (required, non-empty).
- `match` — optional synchronous filter. Middleware whose `match(req)`
  returns `false` are skipped at their position in the chain; `next()`
  transparently advances to the following layer.
- `handler` — the actual work. Returns a `Response`.

### Using `defineMiddleware`

```ts
import { defineMiddleware } from "@mandujs/core/middleware";

const logger = defineMiddleware({
  name: "logger",
  async handler(req, next) {
    const start = performance.now();
    const res = await next();
    console.log(`${req.method} ${new URL(req.url).pathname} ${res.status} ${Math.round(performance.now() - start)}ms`);
    return res;
  },
});
```

`defineMiddleware()` is a typed passthrough — it preserves inference and
validates the shape (non-empty `name`, `handler` is a function, `match`
is a function when present) at definition time. Fail-fast beats silent
no-op layers.

## Composition semantics

`compose(a, b, c)` produces an onion: the outer layer sees the request
first and the final Response last.

```
request → a.handler(req, nextA)
            └─ nextA() → b.handler(req, nextB)
                          └─ nextB() → c.handler(req, nextC)
                                        └─ nextC() → finalHandler(req)
                                        ↑ Response flows back up ↑
```

### Short-circuit

Any middleware may return a Response without calling `next()`. Downstream
middleware and the final route handler are skipped. Outer layers still
see the short-circuit Response in their own `await next()`.

```ts
const ipBan = defineMiddleware({
  name: "ip-ban",
  async handler(req) {
    if (BANNED.has(req.headers.get("x-forwarded-for") ?? "")) {
      return new Response("Forbidden", { status: 403 });
    }
    // falling off without calling next() is a programming error
    // if you want to continue, call `next()`.
  },
});
```

### Rewrite

`next(rewrittenReq)` propagates a modified Request to downstream
middleware and the final handler. The current layer still sees the
original `req` — `compose()` does not mutate arguments in place.

```ts
const aliasApi = defineMiddleware({
  name: "api-alias",
  async handler(req, next) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/v1/")) {
      url.pathname = "/api" + url.pathname.slice(3);
      return next(new Request(url, req));
    }
    return next();
  },
});
```

### Double-next guard

Calling `next()` twice is a programming error (it would re-execute
downstream layers and duplicate their side effects). Mandu throws
`MiddlewareError` on the second call, naming the offending middleware so
the bug surfaces immediately in dev.

### Error propagation

Throws inside a middleware handler propagate to the caller. Mandu's
outer `handleRequest` catches them and converts the error to a 5xx via
`errorToResponse`, so you don't need a top-level try/catch unless you
want to convert specific errors to specific responses.

## Pipeline position

Request-level middleware runs AFTER Mandu's infrastructure fast-paths
and BEFORE route dispatch:

```
1. CORS preflight
2. Static files
3. Internal endpoints (/_mandu/image, /_mandu/heap, /_mandu/metrics, …)
4. Prerendered HTML pass-through (SSG)
5. Kitchen dev dashboard (dev only)
6. ─── Phase 18.ε composition chain ───
7. Route match + dispatch (api / page / metadata)
```

This ordering keeps infrastructure Responses (e.g. `/.mandu/*.js`
assets) off the middleware hot path. If you need to observe asset
requests too, wrap the Bun fetch handler externally (Mandu will expose
a lower-level hook in a follow-up phase).

## Bridge wrappers

Mandu's existing ctx-based middleware (`csrf`, `session`, `secure`,
`rateLimit`) plug into the composition chain via bridge wrappers:

```ts
import {
  csrfMiddleware,
  sessionMiddleware,
  secureMiddleware,
  rateLimitMiddleware,
} from "@mandujs/core/middleware";
```

Each bridge takes the same options as its ctx-based counterpart, builds
a throwaway `ManduContext` per request, invokes the ctx handler, and
folds any Set-Cookie writes onto the final Response.

**Pick a layer, not both.** Running `csrfMiddleware(...)` in the chain
AND `.use(csrf(...))` inside the filling double-validates and re-issues
cookies — avoid it. Typical rule of thumb:

- `csrfMiddleware` / `sessionMiddleware` in the chain when you want
  app-wide enforcement.
- `.use(csrf(...))` / `.use(session(...))` on the filling when only
  certain routes need it.

## Comparison with Next.js and SvelteKit

| Feature                 | Mandu (Phase 18.ε)             | Next.js `middleware.ts`                 | SvelteKit `hooks.server.ts`        |
| ----------------------- | ------------------------------ | ---------------------------------------- | ---------------------------------- |
| Definition helper       | `defineMiddleware({...})`      | `export function middleware(req)`        | `export const handle: Handle`      |
| Composition             | `compose(a, b, c)`             | Single function; use `NextResponse.next` | `sequence(a, b, c)`                |
| Path filter             | `match?: (req) => boolean`     | `export const config = { matcher }`      | Compute inside `handle`            |
| Short-circuit           | Return a Response              | Return a Response                        | Return a Response                  |
| Rewrite                 | `next(rewrittenReq)`           | `NextResponse.rewrite(url)`              | Pass modified event to `resolve`   |
| Pipeline position       | After infra, before dispatch   | Before all route handlers                | Before all route handlers          |
| Runtime                 | Bun                            | Edge (by default)                        | Node / adapters                    |

## Full example — auth → rate-limit → CSRF chain

```ts
import {
  defineMiddleware,
  rateLimitMiddleware,
  csrfMiddleware,
  sessionMiddleware,
} from "@mandujs/core/middleware";
import { createCookieSessionStorage } from "@mandujs/core";

const storage = createCookieSessionStorage({
  cookie: { secrets: [process.env.SESSION_SECRET!] },
});

const auth = defineMiddleware({
  name: "auth-gate",
  match: (req) => new URL(req.url).pathname.startsWith("/admin"),
  async handler(req, next) {
    // session middleware has already attached the Session under
    // ctx.get("session"); but at request level we read the cookie directly.
    const cookie = req.headers.get("cookie") ?? "";
    if (!cookie.includes("session=")) {
      return new Response("Unauthorized", { status: 401 });
    }
    return next();
  },
});

export default {
  middleware: [
    sessionMiddleware({ storage }),
    rateLimitMiddleware({ limit: 60, windowMs: 60_000 }),
    csrfMiddleware({ secret: process.env.CSRF_SECRET! }),
    auth,
  ],
};
```

Order matters. In this chain:

- Session runs first so every downstream layer can read it.
- Rate limit runs before CSRF so a flooder can't exhaust CPU on crypto
  before being rejected.
- CSRF runs before the auth gate so invalid tokens get 403 without
  revealing whether the admin path exists.
- Auth runs last because it only applies to `/admin/*`.

## Testing

Request-level middleware is plain async functions — unit-test them with
the same fixtures you'd use for a Worker:

```ts
import { compose, defineMiddleware } from "@mandujs/core/middleware";
import { describe, expect, it } from "bun:test";

describe("auth-gate", () => {
  const gate = defineMiddleware({
    name: "auth",
    async handler(req, next) {
      if (!req.headers.get("authorization")) {
        return new Response("401", { status: 401 });
      }
      return next();
    },
  });

  it("lets authorized requests through", async () => {
    const final = async () => new Response("ok");
    const res = await compose(gate)(
      new Request("https://x.test/", { headers: { authorization: "Bearer x" } }),
      final
    );
    expect(res.status).toBe(200);
  });

  it("rejects unauthorized requests", async () => {
    const res = await compose(gate)(new Request("https://x.test/"), async () => new Response("ok"));
    expect(res.status).toBe(401);
  });
});
```

See `packages/core/tests/middleware/compose.test.ts` for the full
regression suite covering order, short-circuit, error propagation,
match filters, rewrite, double-next guard, async timing, and defensive
array-copy semantics.

## Related

- `docs/architect/route-conventions.md` — file-system routing basics.
- `@mandujs/core/middleware` barrel — API surface reference.
- `packages/core/src/middleware/{define,compose,bridge}.ts` — source.
