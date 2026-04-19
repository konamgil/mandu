---
title: "Edge adapters — Deno / Vercel / Netlify"
phase: "15.2"
status: "shipped"
owner: "@mandujs/edge"
updated: "2026-04-19"
---

# Deno Deploy / Vercel Edge / Netlify Edge adapters

Phase 15.2 expands Mandu's edge coverage from the single Cloudflare Workers
adapter (Phase 15.1) to three additional platforms. Each adapter is a thin
bridge between a runtime-neutral Mandu fetch handler and the target
platform's native contract.

## Implementation notes

### 1. Shared anatomy

Every adapter lives in `packages/edge/src/<name>/` and ships four files:

```
packages/edge/src/<name>/
  index.ts           — public API barrel
  fetch-handler.ts   — createXxxHandler() + getXxxCtx() + AsyncLocalStorage
  polyfills.ts       — installXxxPolyfills() + Bun shim surface
  guards.ts          — assertEdgeCompatibleManifest(), hintBunOnlyApiError()
  <target>-config.ts — config file generator (deno.json / vercel.json / netlify.toml)
```

The CLI emitters in `packages/cli/src/util/<name>-emitter.ts` tie everything
together at `mandu build --target=<name>` time.

### 2. Runtime isolation contract

All four adapters (including Phase 15.1 Workers) use **AsyncLocalStorage
with a per-Request WeakMap fallback** for per-request ctx isolation. The
rationale is identical — V8 isolates multiplex concurrent requests, and
a module-level mutable cannot carry per-request state safely across
`await` boundaries. Deno Deploy supports `node:async_hooks` out of the box;
Vercel Edge supports it as of early 2024; Netlify Edge inherits Deno's
support; Workers requires the `nodejs_als` / `nodejs_compat` flag.

When `node:async_hooks` is not resolvable, every adapter falls back to
`requestToStore.set(request, store)` keyed on the exact `Request` instance.
This path remains isolation-safe for the main fetch but cannot carry state
into `waitUntil()` callbacks that outlive the fetch.

### 3. Error body scrubbing

The `hintBunOnlyApiError()` helper in each adapter implements the same
scrubbing contract as Phase 15.1 Workers:

- **Production**: generic `"Internal Server Error"` message; correlation
  ID; `error.stack` never surfaces in the HTTP body.
- **Dev**: raw message preserved for debugging.
- **Bun-API errors**: generic message + hint in production (calls out the
  runtime-specific replacement); full message + hint in dev.

Production is detected via:
- All adapters: `process.env.NODE_ENV === "production"` or `env.ENVIRONMENT === "production"`
- Deno: `Deno.env.get("DENO_DEPLOYMENT_ID")` presence
- Vercel: `process.env.VERCEL_ENV === "production"` or `env.VERCEL_ENV === "production"`
- Netlify: `process.env.CONTEXT === "production"` or `env.CONTEXT === "production"`

### 4. Platform-specific wiring

| Platform | Entry file | Config file | Runtime marker |
| --- | --- | --- | --- |
| Workers | `.mandu/workers/worker.js` | `wrangler.toml` | `export default { fetch }` |
| Deno | `.mandu/deno/server.ts` | `deno.json` | `Deno.serve(fetch)` |
| Vercel | `api/_mandu.ts` | `vercel.json` | `export const config = { runtime: "edge" }` |
| Netlify | `netlify/edge-functions/ssr.ts` | `netlify.toml` | `export const config = { path: "/*" }` |

### 5. Bun-only API coverage

The throwing shim surface is identical across all four adapters —
`Bun.{sql,SQL,s3,S3Client,cron,file,write,spawn,password.{hash,verify}}`.
Each runtime's error message points at the platform-native replacement:

- **Workers** → Neon PG driver / aws4fetch / Workers Cron Triggers
- **Deno** → deno-postgres / aws4fetch / Deno Deploy Cron
- **Vercel Edge** → Vercel Postgres / aws4fetch / Vercel Cron Jobs
- **Netlify Edge** → deno-postgres / aws4fetch / Netlify Scheduled + Blobs

### 6. Dependencies

All adapters maintain the Phase 15.1 "zero new runtime deps" rule. Optional
peer deps (`@noble/hashes`, `aws4fetch`) are documented in
`packages/edge/package.json` under `peerDependenciesMeta` with
`optional: true` — they're only required when user code reaches the
relevant Bun-API replacement.

## CLI usage

```bash
mandu build --target=deno --project-name=my-app
mandu build --target=vercel-edge
mandu build --target=netlify-edge
mandu build --target=workers --worker-name=my-app
```

The `--project-name` flag defaults to a slug of the host `package.json`
`name` field (lowered, `@scope/` stripped, non-alphanumeric collapsed to
hyphens). `--worker-name` is kept as a Workers-specific alias for
backwards compatibility.

## Non-goals (intentional)

- **No Hono.** Each adapter's fetch handler is a thin wrapper around
  `createAppFetchHandler` — no routing rewrite, no middleware framework.
- **No Bun.serve compat on Workers / Vercel.** Users who rely on
  `Bun.serve`-specific APIs (hot reload, route options object) stay on
  the default Bun/Node adapter.
- **No cross-adapter migration tool.** Each `mandu build --target=...`
  call writes to a separate `.mandu/<name>/` directory; switching
  platforms is a rebuild, not a migration.

## Quality gates (reached in Phase 15.2)

- 107 edge tests pass (30 Phase 15.1 + 77 Phase 15.2 new): fetch handler
  factories, config generators, Bun shim surface, per-request isolation,
  production error scrubbing, emitter smoke.
- Typecheck clean across all 6 packages (core, cli, mcp, ate, edge, skills).
- No new runtime deps. `peerDependenciesMeta` documents optional peers.
- Workers adapter bundle size unchanged (see `workers-emitter-smoke`).

## Future work (not part of Phase 15.2)

- **Demo starters** — `demo/edge-deno-starter/`, `demo/edge-vercel-starter/`,
  `demo/edge-netlify-starter/` mirroring `demo/edge-workers-starter/`.
  Deferred to keep Phase 15.2 scope tight.
- **Integration tests** — Actual `deno task dev` / `vercel dev` /
  `netlify dev` roundtrips, not just emitter smoke + unit fetch tests.
- **Cloudflare Pages parity** — `mandu build --target=pages` once the
  shared `cf-pages` deploy adapter and Workers emitter converge on a
  single handler contract.
