---
title: "Dev Error Overlay"
description: "Next.js / Astro-style full-screen error overlay for the Mandu dev server. Catches SSR crashes, window.onerror, and unhandled promise rejections."
stable-since: v0.29
order: 9
---

# Dev Error Overlay

Mandu injects a full-screen error overlay into every dev SSR response. When
something throws — in an SSR render, in a browser script, or in an
unhandled Promise — you see a structured modal with the error class, the
message, the source file (clickable in VS Code), a parsed stack, and a
**Copy for AI** button that formats a markdown snapshot for paste-into-Claude
triage.

The overlay runs **only in dev mode**. Production builds never emit the
overlay regardless of any flag — see [Security notes](#security-notes).

## What it looks like

When a crash happens the page dims behind a backdrop (`rgba(10,10,10,0.94)`)
and a dark-themed panel appears:

```
+----------------------------------------------------------+
| SSR RENDER FAILED                      [Copy for AI] [X] |
| TypeError                                                |
|----------------------------------------------------------|
| Cannot read properties of undefined (reading 'title')    |
|                                                          |
| Route: posts/[slug]   URL: /posts/hello   Time: 14:23:01 |
|                                                          |
| Stack frames                                             |
|  PostPage         /src/app/posts/[slug]/page.tsx:12:24   |
|  renderPageSSR    /packages/core/src/runtime/server.ts:… |
|  ...                                                     |
|----------------------------------------------------------|
|  Dev-only. Press Esc to dismiss.                         |
+----------------------------------------------------------+
```

The file locations are clickable — they open in VS Code via the
`vscode://file/` URI handler. (If you use a different editor, the link
will fail gracefully and you can still copy the path.)

## How it works

Two injection surfaces:

1. **Head injection** — `runtime/ssr.ts` adds a `<style>` + `<script>`
   block in the SSR `<head>` whenever `isDev === true`. The script is a
   scoped IIFE (~7 KB uncompressed, ~2 KB gzipped) that listens for:
   - `window.onerror`
   - `unhandledrejection`
   - custom `__MANDU_ERROR__` CustomEvent

2. **500-response embed** — `runtime/server.ts` catches SSR render
   failures and, in dev mode, returns a minimal HTML document with a
   `<script type="application/json" id="__MANDU_ERROR__">` payload
   embedded. The IIFE reads it on `DOMContentLoaded` and mounts the
   overlay immediately — so you see the error even when the React tree
   never produced any output.

## Opting out

Turn the overlay off in dev (e.g. when capturing clean screenshots):

```ts
// mandu.config.ts
export default {
  dev: {
    errorOverlay: false,
  },
};
```

Or at the SSR call-site:

```ts
renderSSR(element, { isDev: true, devErrorOverlay: false });
```

## Security notes

The overlay is protected by **three independent guards** — any one of
them returning `false` suppresses injection entirely:

| Guard | Check | Purpose |
|---|---|---|
| `isDev` | caller-supplied flag | Prevents accidental injection from unit tests or SSR-inside-prod toolchains |
| `NODE_ENV !== "production"` | env authoritative | Absolute final gate — even if `isDev` is wrong, prod NEVER renders |
| `dev.errorOverlay !== false` | user opt-out | Explicit kill switch |

This layered posture is deliberate:

- **Stack traces contain absolute paths.** Leaking those in production
  would disclose directory structure, username, and package layout. The
  `NODE_ENV` gate closes that door regardless of caller mistakes.
- **The 500-response HTML includes the full error message.** In dev this
  is invaluable; in prod it would leak internal state. Same gate covers
  both.
- **The client IIFE runs parse-time on every dev response.** Its
  contents are authored in this repo, inlined verbatim, and never load
  external resources — so it's not a supply-chain vector. The
  `__MANDU_ERROR__` JSON payload IS user-controlled (SSR error text can
  contain anything), but we route it through the existing
  `escapeJsonForInlineScript` helper that neutralises `</script>`
  sequences, matching the treatment of `__MANDU_DATA__`.

## "Copy for AI" format

Clicking the copy button writes a markdown block to the clipboard:

````text
# Mandu dev error snapshot

- kind: ssr
- name: TypeError
- message: Cannot read properties of undefined (reading 'title')
- url: /posts/hello
- routeId: posts/[slug]
- timestamp: 2026-04-20T05:23:01.234Z

## Stack

```
TypeError: Cannot read properties of undefined (reading 'title')
    at PostPage (/src/app/posts/[slug]/page.tsx:12:24)
    at renderPageSSR (...)
```
````

Paste directly into Claude / ChatGPT. No manual cleanup.

## Custom dispatches

User code can surface synthetic errors to the overlay:

```ts
window.dispatchEvent(
  new CustomEvent("__MANDU_ERROR__", {
    detail: {
      name: "ValidationError",
      message: "Submitted form failed schema check",
      stack: new Error().stack,
      kind: "manual",
      routeId: "forms/contact",
    },
  }),
);
```

Or programmatically:

```ts
window.__MANDU_DEV_OVERLAY__.show(new Error("boom"));
window.__MANDU_DEV_OVERLAY__.hide();
```

Both are **dev-only APIs**. In production they are `undefined` because
the overlay is never injected.

## Related

- `packages/core/src/dev-error-overlay/` — implementation
- `runtime/ssr.ts` — head-tag injection
- `runtime/server.ts` — 500-response path
- `error/formatter.ts` — structured error payloads (non-overlay)
