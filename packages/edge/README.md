# @mandujs/edge

Edge runtime adapters for Mandu apps. Currently ships the Cloudflare Workers
adapter (Phase 15.1). Deno Deploy, Vercel Edge, and Netlify Edge adapters are
stubbed and scheduled for Phase 15.2+.

## Install

```bash
bun add @mandujs/edge
# or
bun add @mandujs/edge@latest
```

Wrangler is a peer dependency — install separately:

```bash
bun add -D wrangler
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

## License

MPL-2.0
