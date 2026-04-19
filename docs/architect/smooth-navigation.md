---
title: Smooth Navigation
summary: CSS View Transitions auto-inject and hover-based link prefetch in Mandu.
issue: 192
status: shipped
---

# Smooth Navigation

Out of the box, Mandu makes cross-document navigation feel native with two tiny
additions to every SSR response:

1. **CSS View Transitions** — supported browsers (Chrome/Edge ≥ 111,
   Safari 18.2+) play a default crossfade between the outgoing and
   incoming pages. Non-supporting browsers (Firefox, older Safari)
   silently ignore the at-rule.
2. **Hover prefetch** — a ~500-byte inline script listens for
   `mouseover` on same-origin `<a href="/...">` anchors and issues a
   one-shot `<link rel="prefetch" as="document">`. The browser cache
   services the follow-up click with no extra network round trip.

Together they close most of the perceived gap against Next.js, Astro,
and SvelteKit defaults — without requiring a client-side SPA runtime.

## What gets injected

For every SSR response, Mandu adds this to the top of `<head>` (after
your CSS link, before any user-provided head content):

```html
<style>@view-transition{navigation:auto}</style>
<script>(function(){var s=new WeakSet();document.addEventListener("mouseover",...);})();</script>
```

Both blocks are inert unless the browser opts in:

| Feature        | Chrome/Edge 111+ | Safari 18.2+ | Firefox   | Older Safari |
|----------------|------------------|--------------|-----------|--------------|
| `@view-transition` | Crossfade       | Crossfade    | Ignored   | Ignored      |
| `<link rel=prefetch>` | HTTP cache      | HTTP cache   | HTTP cache | HTTP cache |

No build step is required — the tags come for free with `mandu dev`
and `mandu start`.

## Defaults

- `transitions`: **enabled** (default `true`)
- `prefetch`: **enabled** (default `true`)

You can opt out at two granularities:

### Global opt-out (`mandu.config.ts`)

```ts
// mandu.config.ts
import type { ManduConfig } from "@mandujs/core";

export default {
  // Disable view transitions (e.g. if your app ships a custom
  // navigation animation that conflicts)
  transitions: false,

  // Disable hover prefetch (e.g. if your server is latency-bound
  // or you want to keep bandwidth tight on mobile)
  prefetch: false,
} satisfies ManduConfig;
```

Either flag can be toggled independently.

### Per-link opt-out (`data-no-prefetch`)

For most apps the hover prefetch is a net win, but a specific link
might point to a large document, a download, or an expensive
server-rendered page you don't want pre-warmed speculatively:

```tsx
// Never prefetch this link — even on hover
<a href="/reports/annual-2024.pdf" data-no-prefetch>
  Annual Report (12 MB)
</a>
```

The helper honors three additional escape hatches automatically:

- `<a download>` — skipped (downloads shouldn't be cached)
- `<a target="_blank">` — skipped (opens in a new tab)
- `<a href="https://...">` — skipped (same-origin only, `href^="/"`)

## How it works

### View Transitions (`@view-transition`)

This is a **CSS spec**, not JavaScript. The browser sees the
`@view-transition { navigation: auto }` at-rule during SSR hydration
and, on the next **cross-document** (i.e. full-reload) navigation,
takes a snapshot of the current page, renders the next page, and
crossfades between them.

Because the behavior is entirely in the browser, there is no runtime
cost — no JS to evaluate, no DOM observers, no MutationObserver
juggling. The at-rule itself is ~70 bytes in the HTML.

No per-route customization is currently supported. If you need
per-route animations or custom easing, stay tuned — a
`transitions.perRoute` sub-block is on the roadmap.

### Hover prefetch

The helper is a self-contained IIFE. It installs exactly **one**
`document`-level capture-phase `mouseover` listener and stamps each
anchor it has seen into a `WeakSet`, so the overhead per hover event
is O(1).

When it finds an eligible anchor it creates
`<link rel="prefetch" as="document">` and appends it to `<head>`. The
browser then issues a low-priority background GET for the target URL.
If you click the link within a few seconds, the HTTP cache serves
the navigation from memory.

The helper is injected inline (not as an external bundle) because:

1. At ~500 bytes compressed, an extra HTTP round trip would cost more
   than the helper saves.
2. Keeping it in `<head>` means it runs during parse, before the
   first paint — so hovers during initial page render are caught.
3. No module graph change — zero impact on the bundler's caching
   invariants.

## Known limits

### Link prefetch ≠ SPA navigation

Prefetch makes the **follow-up GET instant**, but clicking still
triggers a full document reload. You'll still see a brief white flash
in browsers that don't implement View Transitions, and your scroll
position / focus ring will reset on navigate.

If you need true SPA-style navigation (persistent scroll, component
state across routes, zero flash even on Firefox), you have two
options today:

1. **Wrap navigable links in `<Link>`** — Mandu's
   `@mandujs/core/client` `Link` component performs an explicit
   client-side fetch and uses the built-in router to swap the route
   tree without a full reload. This is currently **opt-in** per link.
2. **Mark routes as islands** — hydrated routes participate in
   client-side router transitions automatically.

**A future release will reverse this default** (opt-in → opt-out),
making SPA navigation the baseline. That change is tracked as a
follow-up to issue #192 — it's a breaking change that will land in a
dedicated release note when scheduled.

### Prefetch doesn't compose with CSP `script-src`

The prefetch helper is an **inline script**, so if you ship a strict
Content-Security-Policy you need either:

- `'unsafe-inline'` (not recommended), or
- A nonce that Mandu's SSR layer attaches (currently only the Fast
  Refresh dev preamble receives a nonce; prefetch CSP wiring is
  tracked as a follow-up).

If CSP conflicts are blocking you, the safe workaround today is to
set `prefetch: false` in `mandu.config.ts` and use Mandu's explicit
`prefetch()` API from `@mandujs/core/client` in code.

### View transitions and fixed-position elements

Browsers without a `view-transition-name` on fixed-position elements
(headers, sidebars) will crossfade them along with the rest of the
page — which can look janky. If you notice a header flicker:

```css
/* app.css or a layout stylesheet */
header {
  view-transition-name: site-header;
}
```

Mandu does not emit these rules automatically — they're
application-specific. See the
[MDN docs on view-transition-name](https://developer.mozilla.org/en-US/docs/Web/CSS/view-transition-name)
for the full taxonomy.

## Performance characteristics

Measured on a 1-page "Hello World" SSR response (dev mode, Bun 1.3.12,
Windows 10 + local Chrome 128):

| Metric                       | Before #192 | After #192 | Delta  |
|------------------------------|-------------|------------|--------|
| HTML response bytes          | 1 486       | 2 041      | +555 B |
| HTML response bytes (gzip)   | 748         | 1 011      | +263 B |
| TTFB                         | 4 ms        | 4 ms       | ±0 ms  |
| First hover → prefetch fire  | n/a         | ~2 ms       | new   |
| Prefetch → cache hit window  | n/a         | ~20 s default (browser) | new |

The `+555 B` uncompressed cost is paid once per SSR response. In
production with gzip/brotli the effective overhead is under 300
bytes — a rounding error next to a typical `index.html` that already
ships multiple KB of meta tags.

## Related

- **Issue #192** — origin thread for this feature
- **Follow-up: opt-in → opt-out SPA nav reversal** — breaking change
  to make `<a>` clicks perform client-side navigation by default
  (tracked separately; requires a major release note)
- **`@mandujs/core/client` prefetch API** — programmatic prefetch
  for route IDs (lower-level; wires through the router)
- **`Bun.CookieMap`** — unrelated but same area — Bun-native cookie
  helpers we use alongside SSR for auth flows
