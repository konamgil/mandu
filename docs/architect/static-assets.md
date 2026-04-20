---
title: "Static asset Cache-Control & ETag policy"
description: "How Mandu serves /.mandu/client/* — per-URL-shape Cache-Control, strong ETag revalidation, and the migration path to content-hashed bundle names."
stable-since: v0.33
order: 20
---

# Static asset Cache-Control & ETag policy

The Mandu runtime serves three classes of static content:

| Prefix | Source | Who owns the bytes |
|---|---|---|
| `/.mandu/client/*` | Build output — client bundles, runtime shims, CSS | Framework / bundler |
| `/public/*` | User-committed assets (images, fonts, plain `.txt`) | User |
| `/favicon.ico`, `/robots.txt`, `/sitemap.xml`, `/manifest.json` | Root-level siblings of `/public/` | User |

Each class uses a different Cache-Control policy. This page documents the
rules, the reasoning, and the migration recipe for enabling content-hashed
bundle names (Part B of issue #218).

## TL;DR

```text
/.mandu/client/globals.css          → public, max-age=0, must-revalidate  + strong ETag
/.mandu/client/runtime.js           → public, max-age=0, must-revalidate  + strong ETag
/.mandu/client/chunk.a1b2c3d4.js    → public, max-age=31536000, immutable + strong ETag
/public/logo.png                    → public, max-age=86400               + weak  ETag
(dev mode, any of the above)        → no-cache, no-store, must-revalidate
```

Browsers revalidate stable-name URLs on every navigation. The `If-None-Match`
round-trip returns `304 Not Modified` with zero body bytes, so the cost is a
tiny header exchange — not a full re-download.

## Why stable URLs cannot use `immutable`

The `immutable` directive (RFC 8246) is a **contract**: the bytes at this URL
will never change. Browsers that honour it — Chrome, Safari, Firefox — skip
revalidation entirely for the full `max-age` window, even on hard refresh in
some cases.

If you ship `globals.css` with `immutable, max-age=31536000` and then overwrite
that same URL on your next deploy, users keep seeing the old bytes for up to a
year. This is exactly what was reported in [issue #218](https://github.com/mandu-org/mandu/issues/218):
a fix to `mandujs.com` didn't propagate until users hard-refreshed, because
the CDN and browser tiers had both pinned the stale CSS as immutable.

The rule Mandu enforces:

> `immutable` is only emitted when the URL pathname contains a content hash.

The detection heuristic lives in `packages/core/src/runtime/server.ts`:

```ts
// Matches: chunk.a1b2c3d4.js, vendor-8f3a2b9c.css, app.1234567890abcdef.js
// Doesn't match: globals.css, runtime.js, chunk.js
/[.\-][a-f0-9]{8,}\.[a-z0-9]+$/i
```

Everything else — `globals.css`, `runtime.js`, stable vendor bundles — gets
`max-age=0, must-revalidate`, which forces a conditional GET on every request.

## ETag revalidation

Every `/.mandu/client/*` response carries a **strong** ETag computed from the
file bytes via `Bun.hash` (wyhash, ~5 GB/s throughput). Results are cached in
the runtime by `absolute path + size + mtime`, so hot files are hashed once
per change, not once per request.

```http
GET /.mandu/client/globals.css
→ 200 OK
  Cache-Control: public, max-age=0, must-revalidate
  ETag: "jijm4qlja2w2"
  Content-Type: text/css
  [body]

GET /.mandu/client/globals.css
If-None-Match: "jijm4qlja2w2"
→ 304 Not Modified
  Cache-Control: public, max-age=0, must-revalidate
  ETag: "jijm4qlja2w2"
  [no body]
```

The `matchesEtag` helper implements RFC 7232 §3.2:

- `*` wildcard matches any current representation
- Comma-separated lists (`"v1", "v2"`) match if any entry matches
- Weak/strong mismatch (`W/"abc"` vs `"abc"`) uses weak-comparison and still
  matches — some CDNs downgrade strong ETags during rewrite

Non-bundle assets under `/public/*` keep a **weak** ETag (`W/"size-mtime"`)
because Mandu doesn't own the bytes and re-hashing user content on every
request is unwarranted for the relatively short `max-age=86400` TTL.

## Dev mode

In dev (`mandu dev`), every static response is stamped with:

```
Cache-Control: no-cache, no-store, must-revalidate
```

This bypasses every layer of cache so the HMR client always pulls the latest
bundle. ETag is still emitted but the `no-store` directive prevents storage.

## Verifying the policy

```bash
# Stable URL → must-revalidate
curl -I http://localhost:3000/.mandu/client/globals.css
# HTTP/1.1 200 OK
# Cache-Control: public, max-age=0, must-revalidate
# ETag: "abc123def456"

# Conditional GET → 304 with no body
curl -I -H 'If-None-Match: "abc123def456"' http://localhost:3000/.mandu/client/globals.css
# HTTP/1.1 304 Not Modified
# Cache-Control: public, max-age=0, must-revalidate
# ETag: "abc123def456"
```

Regression tests live in `packages/core/tests/runtime/static-cache-control.test.ts`.

## Prerendered HTML (Issue #221)

The same policy applies to static HTML emitted by `mandu build` under
`.mandu/prerendered/<route>/index.html` (see
[Static Generation](./static-generation.md) for the build-side
contract). Prerendered URLs are stable by construction — the request
path maps 1:1 to a file path, with no content hash anywhere — so
`immutable` would pin stale HTML for up to a year after every deploy,
the same failure mode Issue #221 closed.

```text
/                          → public, max-age=0, must-revalidate  + strong ETag
/docs/intro                → public, max-age=0, must-revalidate  + strong ETag
(dev mode)                 → no-cache, no-store, must-revalidate
```

Runtime specifics:

- `tryServePrerendered()` computes a strong ETag from the HTML bytes
  using the same `computeStrongEtag()` helper that covers
  `/.mandu/client/*` — the LRU cache is shared across both paths.
- `If-None-Match` returns `304 Not Modified` with an empty body;
  `ETag`, `Cache-Control`, and `X-Mandu-Cache: PRERENDERED` are kept
  so intermediaries update their freshness state.
- Adapters fronting the runtime with a CDN capable of per-deploy
  invalidation can still opt into aggressive caching via
  `PrerenderSettings.cacheControl` at the `startServer` call site
  (the override is honoured verbatim; the framework default applies
  only when the caller leaves it unset or passes the pre-#221
  `immutable` string).

```bash
# Default: must-revalidate + ETag
curl -I http://localhost:3000/docs/intro
# HTTP/1.1 200 OK
# Cache-Control: public, max-age=0, must-revalidate
# ETag: "jijm4qlja2w2"
# X-Mandu-Cache: PRERENDERED

# Conditional GET → 304
curl -I -H 'If-None-Match: "jijm4qlja2w2"' http://localhost:3000/docs/intro
# HTTP/1.1 304 Not Modified
```

Regression tests live in
`packages/core/tests/runtime/prerender-cache-control.test.ts`.

## Migration: opt into content-hashed bundle names (follow-up)

The long-term cure for cache-driven staleness is to change the URL shape on
every bundle mutation — then `immutable` is safe to apply aggressively and
browsers can cache bundles for a year without the revalidation round-trip.

This is **not yet wired** in Mandu (see the follow-up issue below). The plan:

1. **Build**: `Bun.build()` is already content-addressable for code splits; emit
   `globals.<hash>.css`, `runtime.<hash>.js`, `vendor.<hash>.js` alongside a
   manifest that maps logical → hashed names.

   ```json
   // .mandu/client/_assets.json
   {
     "globals.css": "globals.a1b2c3d4.css",
     "runtime.js":  "runtime.8f3a2b9c.js"
   }
   ```

2. **Runtime SSR**: rewrite `<link rel="stylesheet" href>` and `<script src>`
   injections to the hashed names by reading the manifest at boot.

3. **Config**: gated behind
   ```ts
   // mandu.config.ts
   export default defineConfig({
     build: { contentHash: true }, // default: false for MVP
   });
   ```
   Default is `false` so existing deployed projects don't break their deep
   links / cache rules on upgrade. Once the config knob is stable we'll flip
   the default in a major bump.

4. **Migration note for users**: the old URLs will 404 after a deploy that
   enables content-hashing. If you had CDN rules pinning `/.mandu/client/globals.css`
   (for `purge-cache` calls, security headers, etc.), update them to
   `/.mandu/client/_assets.json → lookup`.

### Why it's deferred

Getting content-hashing right requires coordinated changes across the
bundler, SSR link/script injection, dev HMR (stable URL during a session),
and the user-facing config surface. Issue #218 Part A (this page) ships the
safe fallback — stable URLs revalidate via ETag — which already eliminates
the stale-CSS problem in production with zero user-visible change beyond a
single header round-trip per asset per visit.

Follow-up: track content-hash emission in a separate issue referenced from
the #218 close-out comment.

## Related

- [Issue #218](https://github.com/mandu-org/mandu/issues/218) — immutable header on stable URL (`/.mandu/client/*`)
- [Issue #221](https://github.com/mandu-org/mandu/issues/221) — same failure mode on prerendered HTML
- [Static Generation](./static-generation.md#prerender-cache) — prerender cache policy (build side)
- [RFC 7232](https://datatracker.ietf.org/doc/html/rfc7232) — Conditional Requests
- [RFC 8246](https://datatracker.ietf.org/doc/html/rfc8246) — `Cache-Control: immutable`
- `packages/core/src/runtime/server.ts` — `serveStaticFile`, `tryServePrerendered`, `computeStaticCacheControl`, `computeStrongEtag`
- `packages/core/tests/runtime/static-cache-control.test.ts` — #218 regression suite
- `packages/core/tests/runtime/prerender-cache-control.test.ts` — #221 regression suite
