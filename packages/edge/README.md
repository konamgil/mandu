# @mandujs/edge

Edge runtime adapters for Mandu apps. Ships four adapters:

- **Cloudflare Workers** (`@mandujs/edge/workers`) — Phase 15.1
- **Deno Deploy** (`@mandujs/edge/deno`) — Phase 15.2
- **Vercel Edge** (`@mandujs/edge/vercel`) — Phase 15.2
- **Netlify Edge** (`@mandujs/edge/netlify`) — Phase 15.2

Each adapter plugs into the same runtime-neutral `createAppFetchHandler`
from `@mandujs/core` — you write your routes once and pick a platform at
build time via `mandu build --target=<name>`.

## Install

```bash
bun add @mandujs/edge
```

Platform CLIs are peer dependencies — install the one you deploy to:

```bash
bun add -D wrangler          # Cloudflare Workers
# Deno / Vercel / Netlify CLIs are installed via their own tooling
# (deployctl / vercel / netlify-cli). No peer install needed from @mandujs/edge.
```

## Cloudflare Workers (Phase 15.1 MVP)

### Build

```bash
# From your Mandu project root
mandu build --target=workers
```

This emits:
- `.mandu/workers/worker.js` — bundled Workers entry
- `wrangler.toml` — ready-to-use Cloudflare config (only if it does not
  already exist — your edits survive rebuilds)

### Dev & deploy

```bash
# Local dev against the real Workers runtime
wrangler dev

# Deploy
wrangler deploy
```

### Manual wiring

If you prefer to assemble the Worker entry yourself:

```ts
import { createWorkersHandler } from "@mandujs/edge/workers";
import manifest from "./.mandu/routes.manifest.json";
import "./.mandu/workers/register.js"; // populates registries

const fetch = createWorkersHandler(manifest, {
  cssPath: "/.mandu/client/globals.css",
});

export default { fetch };
```

## Bun API compatibility

Mandu's runtime paths are already 90% Web Fetch standard. The remaining
Bun-specific APIs map to Workers equivalents as follows:

| Bun API         | Workers equivalent                      | Status (15.1) |
| --------------- | --------------------------------------- | ------------- |
| `Bun.serve`     | `export default { fetch }`              | Done          |
| `Bun.CookieMap` | `LegacyCookieCodec` (WebCrypto)         | Done          |
| `Bun.CSRF`      | `crypto.subtle` HMAC-SHA256             | Done          |
| `Bun.password`  | `@noble/hashes/argon2` (planned)        | Coming soon   |
| `Bun.sql`       | Neon serverless driver / D1             | Coming soon   |
| `Bun.s3`        | `aws4fetch` / R2 binding                | Coming soon   |
| `Bun.file`      | KV binding / build-time inlining        | Coming soon   |
| `Bun.cron`      | Workers Cron Triggers                   | Coming soon   |
| SMTP            | Permanent skip (use Resend)             | Not planned   |

Calling an unsupported Bun API from inside a Worker returns a structured
500 response with a `BunApiUnsupportedOnEdge` error payload pointing at the
migration guide.

## Accessing Workers bindings

Cloudflare bindings (`env`, `ctx`) are tracked via `AsyncLocalStorage`
with a per-Request WeakMap fallback, so concurrent requests in the same
isolate never see each other's bindings. Read them with:

```ts
import { getWorkersEnv, getWorkersCtx } from "@mandujs/edge/workers";

export async function POST(req: Request) {
  const env = getWorkersEnv();
  const ctx = getWorkersCtx();
  ctx?.waitUntil(env?.ANALYTICS_QUEUE.send({ at: Date.now() }));
  return Response.json({ ok: true });
}
```

### Compatibility flag

`AsyncLocalStorage` requires Node.js compatibility in the Workers
runtime. Ensure your `wrangler.toml` enables it:

```toml
# wrangler.toml
compatibility_flags = ["nodejs_als"]
# or the full compat bundle:
# compatibility_flags = ["nodejs_compat"]
```

The emitted `wrangler.toml` from `mandu build --target=workers` already
includes this flag. If you hand-roll your config, add the flag yourself —
without it, `getWorkersEnv()` / `getWorkersCtx()` fall back to a
per-Request WeakMap which is isolated per-request but won't carry ctx
across `waitUntil` callbacks that outlive the fetch.

### Error responses

Uncaught exceptions return a 500 JSON payload with:

- `error` — `"InternalServerError"` or `"BunApiUnsupportedOnEdge"`
- `correlationId` — unique per-request ID to grep server logs
- `message` — generic `"Internal Server Error"` in production
  (`NODE_ENV === "production"` or `env.ENVIRONMENT === "production"`);
  the raw error message in dev
- `runtime` — `"workers"`

Stack traces and `cause` are never included in the HTTP body. The full
error (with stack) is logged via `console.error` for Cloudflare Logpush.

## Deno Deploy (Phase 15.2)

### Build

```bash
mandu build --target=deno
```

Emits:
- `.mandu/deno/server.ts` — `Deno.serve(fetch)` entry
- `.mandu/deno/register.ts` — route registration wiring
- `.mandu/deno/manifest.json` — manifest clone
- `deno.json` — generated if absent; preserved otherwise

### Dev & deploy

```bash
deno task dev
deno task deploy   # wraps deployctl
```

### Manual wiring

```ts
import { createDenoHandler } from "@mandujs/edge/deno";
import manifest from "./.mandu/deno/manifest.json" with { type: "json" };
import "./.mandu/deno/register.ts";

const fetch = createDenoHandler(manifest);
Deno.serve(fetch);
```

### Bindings

Access the Deno env snapshot + per-request serve info:

```ts
import { getDenoEnv, getDenoInfo } from "@mandujs/edge/deno";

export async function GET() {
  const env = getDenoEnv();
  const info = getDenoInfo(); // { remoteAddr, deploymentId }
  return Response.json({ deploymentId: info?.deploymentId });
}
```

## Vercel Edge (Phase 15.2)

### Build

```bash
mandu build --target=vercel-edge
```

Emits:
- `api/_mandu.ts` — Vercel Edge Function entry with
  `export const config = { runtime: "edge" }`
- `.mandu/vercel/register.ts` — route registration wiring
- `.mandu/vercel/manifest.json` — manifest clone
- `vercel.json` — generated if absent; preserved otherwise

### Deploy

```bash
vercel deploy
```

### Manual wiring

```ts
// api/_mandu.ts
export const config = { runtime: "edge" };

import { createVercelEdgeHandler } from "@mandujs/edge/vercel";
import manifest from "../.mandu/vercel/manifest.json";
import "../.mandu/vercel/register.ts";

const fetch = createVercelEdgeHandler(manifest);
export default fetch;
```

### Bindings

Vercel passes a `context` object with `waitUntil`, `geo`, and `ip`:

```ts
import { getVercelEdgeCtx } from "@mandujs/edge/vercel";

export async function GET() {
  const ctx = getVercelEdgeCtx();
  const country = ctx?.geo?.country ?? "unknown";
  ctx?.waitUntil(analytics.track({ country }));
  return Response.json({ country });
}
```

## Netlify Edge (Phase 15.2)

Netlify Edge Functions run on Deno Deploy, so the constraints mirror the
Deno adapter. Netlify adds its own build-time config (`netlify.toml`)
and deploy contexts (`production` / `deploy-preview` / `branch-deploy`).

### Build

```bash
mandu build --target=netlify-edge
```

Emits:
- `netlify/edge-functions/ssr.ts` — Netlify Edge Function entry with
  `export const config = { path: "/*" }`
- `.mandu/netlify/register.ts` — route registration wiring
- `.mandu/netlify/manifest.json` — manifest clone
- `netlify.toml` — generated if absent; preserved otherwise

### Deploy

```bash
netlify deploy         # preview
netlify deploy --prod  # production
```

### Manual wiring

```ts
// netlify/edge-functions/ssr.ts
import { createNetlifyEdgeHandler } from "@mandujs/edge/netlify";
import manifest from "../../.mandu/netlify/manifest.json" with { type: "json" };
import "../../.mandu/netlify/register.ts";

const fetch = createNetlifyEdgeHandler(manifest);
export default fetch;
export const config = { path: "/*" };
```

### Bindings

Netlify's `Context` object exposes `geo`, `ip`, `deploy`, `env.get()`:

```ts
import { getNetlifyEdgeCtx } from "@mandujs/edge/netlify";

export async function GET() {
  const ctx = getNetlifyEdgeCtx();
  const secret = ctx?.env?.get("API_KEY");
  const deployCtx = ctx?.deploy?.context; // production | deploy-preview | branch-deploy
  return Response.json({ deployCtx });
}
```

## Bun API compatibility across adapters

The runtime polyfill strategy is identical across all four edge adapters —
Mandu's runtime-neutral fallbacks (`LegacyCookieCodec`, WebCrypto HMAC) kick
in automatically when `globalThis.Bun` is absent, and a throwing shim is
installed for Bun-only APIs that cannot be fulfilled (`Bun.sql`, `Bun.s3`,
`Bun.cron`, `Bun.file`, `Bun.write`, `Bun.spawn`, `Bun.password`).

| Bun API         | Workers              | Deno                 | Vercel Edge          | Netlify Edge         |
| --------------- | -------------------- | -------------------- | -------------------- | -------------------- |
| `Bun.serve`     | `fetch` default      | `Deno.serve`         | default export       | default export       |
| `Bun.CookieMap` | LegacyCookieCodec    | LegacyCookieCodec    | LegacyCookieCodec    | LegacyCookieCodec    |
| `Bun.CSRF`      | WebCrypto HMAC       | WebCrypto HMAC       | WebCrypto HMAC       | WebCrypto HMAC       |
| `Bun.password`  | `@noble/hashes`†     | `@noble/hashes`†     | `@noble/hashes`†     | `@noble/hashes`†     |
| `Bun.sql`       | Neon / D1            | `deno-postgres`      | Vercel Postgres      | deno-postgres        |
| `Bun.s3`        | `aws4fetch`          | `aws4fetch`          | `aws4fetch`          | `aws4fetch`          |
| `Bun.cron`      | Workers Cron         | Deno Deploy Cron     | Vercel Cron Jobs     | Netlify Scheduled    |

† Optional peer dep. Not installed by default — add when you use it.

Each adapter returns a structured 500 with runtime-specific payload on
unsupported Bun APIs (`runtime: "workers" | "deno" | "vercel-edge" | "netlify-edge"`)
with a correlation ID, generic message in production (`NODE_ENV === "production"`
or platform-native production signal), and the raw message in dev.

## License

MPL-2.0
