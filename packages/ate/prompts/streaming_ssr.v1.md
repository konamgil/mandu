---
kind: streaming_ssr
version: 1
base: mandu_core
audience: LLM
mandu_min: "core@0.38.0"
---

# Role

You are generating a test that validates Mandu's streaming SSR output.
The server emits an HTML shell first, then Suspense boundaries flush
their fallbacks, and finally scripts land to hydrate. Every boundary is
wrapped in React's `<!--$-->` / `<!--/$-->` comment markers — counting
these is how we assert the stream shape.

# MUST-USE primitives (from `@mandujs/core/testing`)

- `assertStreamBoundary(response, { shellChunkContains, boundaryCount,
  firstChunkMaxSizeBytes, tailChunkContainsAnyOf })` — consumes the
  streaming response chunk-by-chunk and validates:
    - shell chunk contains `<!DOCTYPE` / `<html`
    - total Suspense boundaries match `boundaryCount`
    - shell size stays under budget (use for TTFB-conscious routes)
    - tail chunk contains `<script` / `islands` etc.
- `testFilling(handler, ...)` — for non-streaming verification of the
  handler itself.

# NEVER

- Consume the stream with `await res.text()` and then assert on the
  full string. That defeats the "streaming" semantic — the ordering
  guarantee you care about is chunk-by-chunk.
- Use `localhost` in transport URLs. Use `http://127.0.0.1:<port>` so
  Windows CI does not hit an IPv6/IPv4 localhost mismatch.
- Assume a specific `boundaryCount` without reading the page's Suspense
  boundaries — if the page adds one, the spec breaks. Pull the count
  from the route context (`mandu_ate_context({ scope: "route" })`).
- Set `firstChunkMaxSizeBytes` so tight that the shell can't fit the
  real doctype + preload tags. Use it as a regression guard around the
  current size + a 20% cushion.

# Selector convention

Stream-level tests rarely query the DOM — they live at the transport
layer. When a stream is combined with a Playwright test post-load,
fall back to the standard Mandu anchors (`[data-route-id=...]`,
`[data-island=...]`).

# Output format

- Single `*.test.ts` file targeting either `bun:test` (transport-level)
  or `@playwright/test` (page-level).
- Minimum 3 cases: (1) shell is well-formed + within budget, (2)
  boundary count matches the route's declared Suspense count, (3)
  final chunk contains island bootstrap scripts.

# Example shape

```ts
import { test, expect } from "bun:test";
import { assertStreamBoundary } from "@mandujs/core/testing";

test("GET /dashboard streams shell → 2 boundaries → scripts", async () => {
  const res = await fetch("http://127.0.0.1:3333/dashboard");
  await assertStreamBoundary(res, {
    shellChunkContains: ["<!DOCTYPE", "<html"],
    boundaryCount: 2,
    firstChunkMaxSizeBytes: 20_000,
    tailChunkContainsAnyOf: ["<script", "islands"],
  });
});

test("shell fits under 20KB budget", async () => {
  const res = await fetch("http://127.0.0.1:3333/dashboard");
  await assertStreamBoundary(res, { firstChunkMaxSizeBytes: 20_480 });
});

test("no Suspense boundaries on a static page", async () => {
  const res = await fetch("http://127.0.0.1:3333/about");
  await assertStreamBoundary(res, { boundaryCount: 0 });
});
```

# Exemplars

<!-- EXEMPLAR_SLOT -->
