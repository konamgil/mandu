---
title: Typed RPC
phase: 18.κ
modules:
  - "@mandujs/core/contract/rpc"
  - "@mandujs/core/client/rpc"
---

# Typed RPC

Phase 18.κ ships a tRPC-style end-to-end typed RPC layer built on
Mandu's existing contract + client primitives. No external tRPC
dependency. Zod contracts on the server flow directly to an
auto-typed client proxy — call site type errors fire at compile time,
request + response validation fire at runtime.

## TL;DR

```ts
// server/rpc/posts.ts
import { z } from "zod";
import { defineRpc } from "@mandujs/core/contract/rpc";

export const postsRpc = defineRpc({
  list: {
    input: z.object({ limit: z.number().optional() }).optional(),
    output: z.array(z.object({ id: z.string(), title: z.string() })),
    handler: async ({ input }) => db.posts.list({ limit: input?.limit ?? 10 }),
  },
  get: {
    input: z.object({ id: z.string() }),
    output: z.object({ id: z.string(), title: z.string(), body: z.string() }),
    handler: async ({ input }) => db.posts.byId(input.id),
  },
});
```

```ts
// mandu.config.ts
import { postsRpc } from "./server/rpc/posts";
export default {
  rpc: {
    endpoints: { posts: postsRpc },
  },
};
```

```ts
// client/use-posts.ts
import { createRpcClient } from "@mandujs/core/client/rpc";
import type { postsRpc } from "../server/rpc/posts";

const api = createRpcClient<typeof postsRpc>({ baseUrl: "/api/rpc/posts" });
const posts = await api.list({ limit: 20 });     // fully typed
const one   = await api.get({ id: "abc" });      // fully typed
// api.list({ limit: "nope" })  // TS error
// api.get({ id: 123 })          // TS error
```

## Wire protocol

```
POST /api/rpc/<name>/<method>
Content-Type: application/json

{ "input": <value> }

--- response ---
200 { "ok": true,  "data": <value> }
4xx { "ok": false, "error": { "code": "...", "message": "...", "issues": [...] } }
```

Error codes:

| code                | HTTP | meaning                                    |
|---------------------|------|--------------------------------------------|
| `NOT_FOUND`         | 404  | unknown endpoint OR unknown procedure      |
| `METHOD_NOT_ALLOWED`| 405  | request was not POST                       |
| `BAD_JSON`          | 400  | request body failed JSON.parse             |
| `INPUT_INVALID`     | 400  | input did not match procedure input Zod    |
| `HANDLER_ERROR`     | 500  | handler threw (message masked in prod)     |
| `OUTPUT_INVALID`    | 500  | handler returned wrong shape (programmer bug) |

## Runtime dispatch placement

The dispatcher runs at a specific position inside
`runtime/server.ts#handleRequestInternal`:

```
(γ) prerendered pass-through  →  static files / internal endpoints
  →  Kitchen dashboard  →  (ε) middleware chain
  →  (κ) RPC dispatch    ←  this layer
  →  (β) file-system route match (api / page / metadata)
```

See the `Phase 18.κ` markers in `packages/core/src/runtime/server.ts`.
Placement guarantees:

- **After γ (prerendered)**: RPC URLs are never cached as prerendered
  HTML, which would never match anyway.
- **After ε (middleware)**: CSRF / session / auth middleware wraps
  RPC calls exactly like regular routes — same security guarantees.
- **Before β (route dispatch)**: `/api/rpc/...` URLs never clash with
  file-system `api/rpc/...` routes, and the RPC dispatch is always
  cheaper than the full route matcher.

## When to use RPC vs. plain API routes

| Criteria | RPC (`defineRpc`) | Contract Route (`Mandu.route`) |
|----------|------------------|-------------------------------|
| Consumer | Only your own client | Public or 3rd-party |
| Verbs    | POST only         | GET/POST/PUT/PATCH/DELETE     |
| URL shape | `/api/rpc/<name>/<method>` | Arbitrary REST hierarchy |
| Input    | Single `input` body (typed) | query / body / params / headers |
| Inference | Zero-codegen Proxy | Explicit `Mandu.client(contract)` |
| OpenAPI  | Not emitted (internal) | Emitted (public) |
| Caching / ISR | Not cached | Per-route `_cache` / `ctx.cache` |

Rule of thumb: **RPC for private, method-call-shaped internal APIs;
Contract Routes for the public REST surface** (where CDNs, cache tags,
OpenAPI clients, and HTTP verb semantics matter).

## Comparison

### vs. tRPC

| Feature | Mandu RPC (κ) | tRPC v11 |
|---------|---------------|----------|
| Runtime dep | None (uses Mandu contract + Zod, already peer) | `@trpc/server`, `@trpc/client` |
| Protocol | Pure Fetch POST + JSON envelope | Batched HTTP + HTTP-over-WS |
| Validators | Zod (same as contract routes) | Zod, Yup, Valibot adapters |
| Middleware | Reuses Mandu's middleware chain | tRPC-specific `middleware()` |
| Context | Free-form `ctx` object | `createContext(req)` hook |
| React Query integration | Not bundled (user-level hook) | `@trpc/react-query` |
| Batching | Not bundled | Built-in `httpBatchLink` |
| Subscriptions | Use Mandu `useSSE` or WebSockets | `splitLink` + WebSocket link |

Mandu RPC is deliberately narrower than tRPC. It is the integration
point for the typed-client story when the app does not need tRPC's
batched transport, React Query plumbing, or subscriptions.

### vs. Next.js Server Actions

Next.js server actions co-locate the handler with the React
component via `"use server"`. They're tightly bound to the RSC
pipeline: no explicit contract, no client proxy, no OpenAPI
emission. Mandu RPC decouples server and client: the definition
lives in a plain `.ts` file, `typeof postsRpc` is the contract, and
the client is a standalone proxy you can use in any component,
island, or non-React context (CLI, tests).

### vs. SvelteKit form actions

SvelteKit form actions are HTML-form-driven: the client sends a
multipart POST, the server runs the action, redirects to a
re-rendered page. Mandu RPC is JSON-driven and returns data the
caller consumes directly — no redirect, no full page render.

## Migration recipe

### From `Mandu.contract` API routes

If you have a contract like:

```ts
// app/api/posts.contract.ts
export default Mandu.contract({
  request: {
    GET: { query: z.object({ limit: z.number().optional() }) },
    POST: { body: z.object({ title: z.string() }) },
  },
  response: {
    200: z.object({ posts: z.array(z.object({ id: z.string() })) }),
    201: z.object({ post: z.object({ id: z.string() }) }),
  },
});
```

...and you only consume it from your own client, migrate to RPC:

```ts
// server/rpc/posts.ts
export const postsRpc = defineRpc({
  list: {
    input: z.object({ limit: z.number().optional() }).optional(),
    output: z.array(z.object({ id: z.string() })),
    handler: async ({ input }) => db.posts.list(input?.limit),
  },
  create: {
    input: z.object({ title: z.string() }),
    output: z.object({ id: z.string() }),
    handler: async ({ input }) => db.posts.create(input),
  },
});
```

### From ad-hoc fetch calls

Replace:

```ts
const res = await fetch("/api/posts", { method: "POST", body: JSON.stringify(data) });
if (!res.ok) throw new Error("Failed");
const json = await res.json();
```

with:

```ts
const api = createRpcClient<typeof postsRpc>({ baseUrl: "/api/rpc/posts" });
try {
  const post = await api.create(data);  // typed return
} catch (err) {
  if (err instanceof RpcCallError && err.code === "INPUT_INVALID") {
    showFieldErrors(err.issues);
  }
}
```

## Security notes

- **Method gate**: RPC accepts POST only; GET/HEAD/OPTIONS short-circuit
  before any handler logic. CSRF middleware in the ε layer wraps RPC
  calls identically to regular routes.
- **Path hardening**: `matchRpcPath()` restricts `<name>` and
  `<method>` to `[A-Za-z0-9_-]+` — no dots, no slashes, no unicode —
  to eliminate path-traversal style abuse of the lookup key.
- **Error masking**: `HANDLER_ERROR` and `OUTPUT_INVALID` messages
  are replaced with `"Internal RPC error"` in production
  (`isDev === false`), and `issues` are elided. Dev mode preserves
  the raw Zod issue list for debugging.
- **Output validation**: every handler return value is re-parsed by
  the procedure's output Zod schema before shipping. A type-safe
  handler that drifts from the schema surfaces as a 500 with
  `OUTPUT_INVALID` — not as stealthily-corrupt client data.

## Related

- `packages/core/src/contract/rpc.ts` — `defineRpc`, `dispatchRpc`,
  registry APIs
- `packages/core/src/client/rpc.ts` — `createRpcClient`,
  `RpcCallError`
- `packages/core/src/runtime/server.ts` — Phase 18.κ dispatch section
- `docs/architect/middleware-composition.md` — how ε middleware
  interacts with the κ dispatcher
