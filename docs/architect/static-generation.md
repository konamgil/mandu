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
`Cache-Control: public, max-age=0, must-revalidate` + a strong ETag
(see [prerender cache](#prerender-cache) below).

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
| Runtime cache header                  | long-lived via CDN          | `max-age=0, must-revalidate` + strong ETag |

Mandu differs in one deliberate place:

1. **No per-route revalidation window.** Prerendered HTML is regenerated
   on every build and served with a conditional-GET friendly ETag —
   browsers hit a cheap `304 Not Modified` when nothing changed, and
   get fresh bytes automatically on every deploy. For time-based
   revalidation of server-rendered pages use the ISR cache helpers in
   `@mandujs/core/runtime/cache` on an SSR route instead.

## Prerender cache {#prerender-cache}

Issue #221 — earlier releases stamped prerendered responses with
`Cache-Control: public, max-age=31536000, immutable`. `immutable`
(RFC 8246) is a **contract**: browsers skip revalidation for the
full `max-age` window even after deploys. Because prerendered URLs
don't carry a content hash (route → file — the path is stable across
builds), users saw stale HTML for up to a year after a fix landed.

The runtime now mirrors the [static-asset policy](./static-assets.md):

| Scenario                                    | Cache-Control                                      | ETag   |
| ------------------------------------------- | -------------------------------------------------- | ------ |
| Default (framework-chosen)                  | `public, max-age=0, must-revalidate`               | strong |
| `isDev: true`                               | `no-cache, no-store, must-revalidate`              | strong |
| `PrerenderSettings.cacheControl` override   | user-supplied string (verbatim)                    | strong |

Key behaviours:

- Every response carries a strong ETag derived from the HTML bytes
  via `Bun.hash`. `If-None-Match` round-trips to `304 Not Modified`
  with an empty body — the steady-state cost is a ~300-byte header
  exchange, not a full re-download.
- The `X-Mandu-Cache: PRERENDERED` observability header is stamped
  on both `200` and `304` responses (log parity with the ISR path).
- When an adapter legitimately wants aggressive caching — e.g. a CDN
  that performs per-deploy invalidation by path — set
  `cacheControl` on `startServer({ prerender: { ... } })`. The
  override is honoured verbatim.
- For migration safety, the pre-#221 `immutable` string is treated
  as "framework default" and replaced with the safe policy — projects
  upgrading from persisted registry state don't stay on the broken
  policy.

```bash
# Default policy
curl -I http://localhost:3000/docs/intro
# HTTP/1.1 200 OK
# Cache-Control: public, max-age=0, must-revalidate
# ETag: "jijm4qlja2w2"
# X-Mandu-Cache: PRERENDERED

# Conditional GET → cheap 304
curl -I -H 'If-None-Match: "jijm4qlja2w2"' http://localhost:3000/docs/intro
# HTTP/1.1 304 Not Modified
```

See [`docs/architect/static-assets.md` → Prerendered HTML](./static-assets.md#prerendered-html-issue-221)
for the shared helpers (`computeStrongEtag`, `computeStaticCacheControl`,
`matchesEtag`) and the matching `/.mandu/client/*` policy.

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

## Prerender link crawling

After rendering the initial set (static routes + `generateStaticParams`
output), `mandu build` crawls the emitted HTML for internal `<a
href="/...">` links and feeds any discovered paths back into the
render queue. This lets a single static entry point seed the whole
prerendered graph — your `<Link href="/docs/intro">` on the home page
becomes a prerendered `/docs/intro` without an explicit config entry.

### What's scanned

- Every rendered HTML file (including the ones emitted by the crawler
  itself, breadth-first).
- Only `<a href>` attributes on the *visible* markup — the crawler
  deliberately ignores anything inside doc code examples (see below).

### What's excluded (Issue #213)

Before the `href` regex runs, the engine strips the following regions
so illustrative URLs inside docs don't leak into the render queue:

- HTML comments (`<!-- ... -->`)
- Fenced markdown code blocks (``` ``` ``` and `~~~`)
- Block HTML code containers (`<pre>...</pre>`, `<code>...</code>`,
  including `<pre class="language-tsx">` attributes)
- Inline code spans (`` `...` ``)

A small default denylist then filters out the remaining obvious
placeholders that appear in tutorials but never as real routes:

| Entry        | Matches                 |
| ------------ | ----------------------- |
| `/path`      | exactly `/path`         |
| `/...`       | exactly `/...`          |
| `/example`   | exactly `/example`      |
| `/your-*`    | any `/your-<suffix>`    |
| `/my-*`      | any `/my-<suffix>`      |
| `/foo` / `/bar` / `/baz` | exact demo stubs        |
| `/some-path` | exact demo stub         |

External (`https://...`) and protocol-relative (`//cdn.example.com/...`)
hrefs are ignored automatically.

### Asset-extension exclusion (Issue #219)

Markup like `<picture><source srcset="/hero.avif"><img
src="/hero.webp"></picture>` and `<a href="/whitepaper.pdf">` is
common. Before Issue #219 the crawler would enqueue every such URL,
invoke the SSR fetch handler on it, receive a non-HTML response (or
an HTML error page), and write it to
`.mandu/prerendered/hero.webp/index.html` — corrupting the real
asset's dispatch on subsequent requests.

The crawler now filters out URLs whose pathname ends with a known
non-HTML extension. Matching is case-insensitive; query strings
(`/hero.webp?v=2`) and hash fragments (`/hero.webp#alt`) are stripped
before comparison. The default set covers:

| Category   | Extensions                                        |
| ---------- | ------------------------------------------------- |
| Images     | `.webp`, `.avif`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.ico` |
| Documents  | `.pdf`, `.zip`                                    |
| Media      | `.mp4`, `.webm`, `.mp3`, `.wav`                   |
| Fonts      | `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`         |
| Text assets| `.css`, `.js`, `.map`, `.json`, `.xml`, `.txt`    |

### Overriding the denylist

Extend the defaults or replace them entirely from `mandu.config.ts`:

```ts
import { defineManduConfig } from "@mandujs/core/config/mandu";

export default defineManduConfig({
  build: {
    crawl: {
      // Extend the defaults: `/api/internal/*` joins the default denylist.
      exclude: ["/api/internal/*", "/admin/*"],

      // Or replace the defaults entirely for tighter control:
      // replaceDefaultExclude: true,
      // exclude: ["/api/internal/*"],

      // Issue #219 — teach the crawler to skip additional asset types.
      // Entries may be written with or without a leading dot.
      assetExtensions: [".apk", ".dmg", "mobileprovision"],

      // Or replace the default asset-extension set entirely (rare):
      // replaceDefaultAssetExtensions: true,
      // assetExtensions: [".webp", ".png", ".css"],
    },
  },
});
```

## Prerender error handling (Issue #216)

`mandu build` now distinguishes three failure modes that used to be
collapsed into a single silent skip:

| Failure mode                                              | Behavior                  |
| --------------------------------------------------------- | ------------------------- |
| Page module loads, `generateStaticParams` export missing  | silent (legitimate opt-out) |
| Page module **fails to load** (compile error, missing dep)| **build fails (exit 1)**  |
| User's `generateStaticParams` throws                       | **build fails (exit 1)**  |
| `generateStaticParams()` returns non-array                 | **build fails (exit 1)**  |

Errors are aggregated across every route so you see the full list in a
single summary. Each entry includes the route pattern, the module
path, and the underlying `cause` chain for fast triage.

To downgrade the hard-failure to a warning (handy while migrating an
existing project), pass `--prerender-skip-errors` to the CLI:

```bash
mandu build --prerender-skip-errors
```

The errors are still printed, but `exit 0` is preserved.

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

**`/path/index.html` appeared in my build output.**
The link crawler picked up a `<Link href="/path">` example from a doc
code block. This is fixed as of Issue #213 — the crawler strips code
regions and excludes known placeholders. If you rely on a literal
`/path` route, name it something concrete or add its path to
`build.crawl.exclude` so the crawler ignores it.

**`/hero.webp/index.html` appeared and now the image 404s.**
Fixed as of Issue #219 — the crawler previously enqueued `<a
href="/hero.webp">` / `<picture>` / `<img src>` companion URLs as
prerender targets, wrote an HTML payload under
`.mandu/prerendered/hero.webp/index.html`, and the runtime served the
HTML instead of the real asset on subsequent requests. The default
asset-extension list now filters out `.webp`, `.avif`, `.png`,
`.pdf`, `.css`, `.js`, and friends (see table above). For project-
specific extensions use `build.crawl.assetExtensions`.

**Build fails with `PrerenderError: Prerender failed for 1 route(s)`.**
Issue #216 — one of your dynamic page modules either fails to load
(import/compile error) or throws from `generateStaticParams`. The
error summary names the offending route pattern + the `cause`. Fix the
module, or pass `--prerender-skip-errors` to downgrade the failure to
a warning while you migrate.

**Stale HTML after a deploy.**
Issue #221 — prerendered responses now default to
`Cache-Control: public, max-age=0, must-revalidate` + a strong ETag,
so browsers revalidate on every navigation and the `304 Not Modified`
round-trip keeps the steady-state cost cheap. Pair every deploy with a
fresh build (prerendered files are regenerated from scratch, so the
on-disk content always matches the committed source). If you
previously set `PrerenderSettings.cacheControl` to the old
`immutable` default, drop the override or replace it with the new
default — the runtime also reinterprets the old string as "framework
default" for migration safety.

**Request returns SSR instead of the prerendered HTML.**
Check `.mandu/prerendered/_manifest.json` exists and lists the
pathname. The index is required for runtime pass-through — deleting
or corrupting it reverts the route to SSR (by design).
