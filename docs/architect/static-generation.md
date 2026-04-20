---
title: Static Generation (generateStaticParams)
status: mvp
owner: core
updated: 2026-04-20
order: 8
---

# Static Generation

Mandu can turn any page route into pure static HTML at build time. The
contract is the same one Next.js popularised: a page module exports
`generateStaticParams`, and `mandu build` enumerates the returned
parameter sets, renders each one, and writes the result to
`.mandu/prerendered/`. At request time the runtime serves the cached
HTML directly — no SSR, no data loaders, no island boot — with
`Cache-Control: public, max-age=31536000, immutable`.

## Contract

```tsx
// app/docs/[slug]/page.tsx
export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const slugs = await loadSlugsFromCMS();
  return slugs.map((slug) => ({ slug }));
}

export default function Page({ params }: { params: { slug: string } }) {
  return <Article slug={params.slug} />;
}
```

Rules:

- The function may be `async` or synchronous.
- It must return an array of plain objects. Each object is one concrete
  param set. Every dynamic segment in the route pattern must be a key.
- Scalar segments (`[slug]`) map to a `string`.
- Catch-all segments (`[...slug]`) map to a `string[]` — one entry per
  URL segment. Empty arrays are rejected.
- Optional catch-all (`[[...slug]]`) may be omitted, `[]`, or populated.
  An empty value resolves to the prefix path (`/docs` rather than
  `/docs/`).
- Duplicate param sets are silently de-duped.
- Individual invalid entries are skipped with an error logged by the
  build; sibling entries still render.

## File-system mapping

| File                              | Pattern            | Return shape          |
| --------------------------------- | ------------------ | --------------------- |
| `app/docs/[slug]/page.tsx`        | `/docs/:slug`      | `{ slug: string }[]`  |
| `app/[lang]/[slug]/page.tsx`      | `/:lang/:slug`     | `{ lang; slug }[]`    |
| `app/docs/[...slug]/page.tsx`     | `/docs/:slug*`     | `{ slug: string[] }[]`|
| `app/docs/[[...slug]]/page.tsx`   | `/docs/:slug*?`    | `{ slug?: string[] }[]` |

## Output layout

```
.mandu/
└── prerendered/
    ├── _manifest.json        # runtime index (pathname → file)
    ├── index.html            # from app/page.tsx
    ├── about/index.html      # from app/about/page.tsx
    └── docs/
        ├── intro/index.html
        └── quickstart/index.html
```

The runtime reads `_manifest.json` on the first request (single-flight,
cached forever) and short-circuits matching URLs before any other
dispatch stage runs. Non-prerendered URLs fall through to SSR
unchanged.

## Next.js comparison

| Capability                            | Next.js                     | Mandu                        |
| ------------------------------------- | --------------------------- | ---------------------------- |
| Declarative params function           | `generateStaticParams`      | `generateStaticParams`       |
| Return type                           | `{ ... }[]`                 | `{ ... }[]`                  |
| Catch-all params                      | `string[]`                  | `string[]`                   |
| Optional catch-all (missing prefix)   | resolves to prefix          | resolves to prefix           |
| Fallback mode (ISR on-miss)           | `dynamicParams` flag        | `dynamicParams` flag         |
| Runtime cache header                  | long-lived via CDN          | `immutable`, 1-year `max-age`|

Mandu differs in one deliberate place:

1. **No per-route revalidation window.** Prerendered HTML is immutable
   until the next build. For time-based revalidation use the ISR cache
   helpers in `@mandujs/core/runtime/cache` on an SSR route instead.

## `dynamicParams` — opt out of SSR fallback (Issue #214)

By default, when a user requests a dynamic URL that wasn't prerendered
(for example `/es` on a page that only enumerated `en` / `ko`), Mandu
falls through to SSR and returns 200. That preserves graceful long-tail
handling but opens two concrete problems:

- **Duplicate content / SEO.** A catch-all `app/[lang]/page.tsx` will
  happily 200-render `/path`, `/does-not-exist`, `/favicon`, and every
  other URL the router can pattern-match — even when only two real
  locales exist.
- **Wasted compute.** Every bogus URL runs the page's data loaders,
  SSR, and island boot before (ideally) hitting a domain-specific
  `notFound()`.

Export `dynamicParams` on the page module to opt out of that fallback.
Values outside the `generateStaticParams` set then 404 at the dispatch
layer — before any loader runs, before any layout wraps, before the
ISR cache is consulted.

```tsx
// app/[lang]/page.tsx
export const dynamicParams = false; // default: true

export async function generateStaticParams() {
  return [{ lang: "en" }, { lang: "ko" }];
}

export default function Page({ params }: { params: { lang: string } }) {
  return <Hello lang={params.lang} />;
}
```

Runtime behavior:

| Request URL   | `dynamicParams: true` (default) | `dynamicParams: false`        |
| ------------- | ------------------------------- | ----------------------------- |
| `/en`         | 200 (prerendered or SSR)        | 200 (prerendered)             |
| `/ko`         | 200 (prerendered or SSR)        | 200 (prerendered)             |
| `/es`         | 200 (SSR fallback)              | **404** (via `not-found.tsx`) |
| `/anything`   | 200 (SSR fallback)              | **404** (via `not-found.tsx`) |

The guard honors the usual not-found chain:

1. Nearest-ancestor `app/**/not-found.tsx` if present.
2. Global `notFoundHandler` registered at boot.
3. Built-in JSON 404 as the last resort.

Notes:

- The flag applies only to page routes. API routes (`route.ts`) and
  metadata routes (`sitemap.ts`, etc.) are never gated.
- Setting `dynamicParams: false` with an empty `generateStaticParams`
  array renders *no* dynamic URLs at all — every request 404s. That's
  the right choice when you want to kill a `[slug]` route without
  deleting the file.
- Catch-all (`[...slug]`) matching compares the joined path: declaring
  `{ slug: ["guide", "intro"] }` matches `/docs/guide/intro` and
  nothing else.
- Nested dynamics (`app/[lang]/[slug]/page.tsx`) only serve pairs that
  were explicitly enumerated. `{ lang: "en", slug: "intro" }` matches
  `/en/intro`; `/en/random` and `/de/intro` both 404.

### Comparison with Next.js

| Capability                            | Next.js                     | Mandu                        |
| ------------------------------------- | --------------------------- | ---------------------------- |
| `dynamicParams` flag                  | yes                         | yes                          |
| Default                               | `true`                      | `true`                       |
| `false` → unknown param 404s          | yes                         | yes                          |
| Guard runs before loader              | yes                         | yes                          |
| Honors `not-found.tsx`                | yes                         | yes                          |
| Per-route revalidation window         | `revalidate`                | not yet (use ISR cache tags) |

## When to use SSR vs. prerender

Use **prerender** when:

- The set of URLs is known at build time (docs, marketing pages, blog
  archives, i18n static content).
- The page is safe to serve to every user with identical HTML.
- You want the best TTFB and the lowest ongoing cost.

Use **SSR** when:

- The response depends on request-scoped state (session, geo, A/B
  bucket, feature flags with per-user targeting).
- The parameter space is unbounded at build time (search queries,
  user-generated URLs with long tails).
- You need to react to mutations within seconds (live dashboards,
  inventory, chat) — pair SSR with ISR-style cache tags for a
  middle ground.

A hybrid pattern is common and supported: prerender the N most
popular entries via `generateStaticParams`, then let SSR handle the
tail. No extra config required — the long tail simply misses the
prerender index and falls through.

## Configuration

```ts
// mandu.config.ts
import { defineManduConfig } from "@mandujs/core/config/mandu";

export default defineManduConfig({
  build: {
    // Prerender is on by default. Set to `false` to disable entirely.
    prerender: true,
  },
});
```

The runtime side has matching controls on `startServer`:

```ts
startServer(manifest, {
  prerender: true,                          // default — pass-through on
  // prerender: false,                     // force SSR for every URL
  // prerender: {
  //   dir: ".mandu/prerendered",           // override output dir
  //   cacheControl: "public, max-age=3600",// tune CDN hint
  // },
});
```

## Troubleshooting

**My page isn't being prerendered.**
Confirm the module exports `generateStaticParams` *as a named export*
(not on `default`). A default-exported function is the React component;
named exports are the contract.

**`HTTP 500 /docs/intro` during build.**
The transient build server rendered the page and the page loader
threw. The build keeps going and logs the error — other routes still
render. Fix the loader or guard with `try/catch` and return fallback
data.

**Stale HTML after a deploy.**
`Cache-Control: immutable` tells the browser never to revalidate. Pair
every deploy with a fresh build (prerendered files are regenerated
from scratch, so the on-disk content always matches the committed
source).

**Request returns SSR instead of the prerendered HTML.**
Check `.mandu/prerendered/_manifest.json` exists and lists the
pathname. The index is required for runtime pass-through — deleting
or corrupting it reverts the route to SSR (by design).
