---
"@mandujs/core": patch
---

Fix two SSR/navigation correctness bugs:

- **#316 router**: the full SPA router now falls back to a real document navigation when the target route is server-only (no client-renderable bundle). Previously such links changed the URL but left the page content stale. The `_data` response carries a `clientRenderable` flag the router checks before a client-side state swap.
- **#317 SEO**: body-rendered `<meta property="og:*">` / `<meta name="twitter:*">` / `<meta name="description">` and `<script type="application/ld+json">` are now hoisted into `<head>` during SSR (matching the existing `<link>`/`<title>` hoisting). Microdata `<meta itemprop>` correctly stays in the body.
