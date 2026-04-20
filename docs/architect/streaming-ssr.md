---
title: Streaming SSR + React.use()
phase: 18.ξ
status: stable
related:
  - route-conventions.md
  - island-hydration.md
  - smooth-navigation.md
---

# Streaming SSR + React 19 `use()` hook

Mandu's streaming pipeline uses React 19's `renderToReadableStream`. This
document explains what that means for your app, when the shell flushes
early, and how to write async server components and `use(promise)` calls
that stream progressively instead of blocking TTFB.

## TL;DR

- `streaming: true` on a route enables shell-first flushing.
- `export default async function Page()` is supported; Mandu hands the
  raw async tree to React 19 so the shell can flush before the async
  component resolves.
- `React.use(promise)` works inside any server component. To see a
  fallback on the wire, wrap the `use()` call in a sync component placed
  inside a `<Suspense>` boundary — and make sure there is non-suspended
  content in the same tree (otherwise React may elide the fallback).
- `loading.tsx` (route convention) wraps the page in
  `<Suspense fallback={<Loading/>}>` automatically.

## The three modes

| Mode | API | When | Async component support |
|------|-----|------|-------------------------|
| Non-streaming SSR | `renderToString` | `streaming: false` (default) | Pre-resolved via `resolveAsyncElement` |
| Streaming SSR | `renderToReadableStream` | `streaming: true` on route or `settings.streaming` | Native (React 19) |
| Deferred streaming | `renderWithDeferredData` | critical + deferred loader split | Native |

Non-streaming cannot render async components directly (React limitation),
so Mandu awaits them up-front. That regresses TTFB to the slowest
component's latency. For any page where TTFB matters, switch to
`streaming: true`.

## Shell-first streaming timeline

```
t=0ms    Request arrives
t=5ms    renderPageSSR loads page module
t=8ms    renderToReadableStream returns (shell ready)
t=10ms   First chunk on wire:  <!DOCTYPE><head>...<div id="root">
                                <h1>Layout header</h1>
                                <!--$?--><template id="B:0"></template>
                                <p class="loading">Loading...</p>
                                <!--/$-->
         → Browser paints shell + fallback immediately

t=250ms  async component resolves
t=255ms  Second chunk on wire:  <div hidden id="S:0"><main>content</main></div>
                                <script>$RC("B:0","S:0")</script>
         → React's inline script swaps fallback → resolved content
t=260ms  </body></html>
```

TTFB = ~10ms regardless of how slow the async component is.

## Writing async server components

```tsx
// app/posts/[id]/page.tsx
import { getPost } from "@/lib/db";

export default async function PostPage({ params }: { params: { id: string } }) {
  const post = await getPost(params.id);   // runs on the server
  return (
    <article>
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.body }} />
    </article>
  );
}
```

Opt in to streaming in `mandu.config.ts`:

```ts
export default defineConfig({
  streaming: true,  // enable globally
});
```

Or per-route via the manifest/route-level flag.

## Using `React.use(promise)`

`React.use()` suspends the current render until the promise resolves.
Inside a streaming route this works naturally:

```tsx
// app/dashboard/page.tsx
import { use, Suspense } from "react";

function Stats() {
  // use() suspends this component; React emits a fallback first, then
  // swaps in the resolved content via an inline script.
  const data = use(fetch("/api/stats").then((r) => r.json()));
  return <dl>{/* ... */}</dl>;
}

export default function Dashboard() {
  return (
    <main>
      <h1>Dashboard</h1>     {/* flushes in shell */}
      <Suspense fallback={<p>Loading stats...</p>}>
        <Stats />            {/* streams when ready */}
      </Suspense>
    </main>
  );
}
```

### Fallback elision (React 19 optimization)

React 19 will **not** emit the fallback if:

1. The `Suspense` is at the **root** of the React tree (no sibling shell
   content), AND
2. The promise resolves before React flushes the first chunk.

In practice this rarely matters in Mandu because pages always render
inside a `<div id="root">` wrapper + layout chain. If you do see
unexpected fallback elision in tests, add a sibling shell element or use
the full server path in an integration test.

## `loading.tsx` integration

Any route with a sibling `loading.tsx` gets an implicit Suspense boundary:

```
app/
  posts/
    [id]/
      page.tsx         ← async Page (or contains <Suspense>/use())
      loading.tsx      ← rendered as fallback while page suspends
```

```tsx
// app/posts/[id]/loading.tsx
export default function Loading() {
  return <p className="loading">Loading post...</p>;
}
```

The wrapping is done in `renderPageSSR`:

```tsx
// Conceptually:
<Suspense fallback={<Loading />}>
  <Page />
</Suspense>
```

Import failure of `loading.tsx` downgrades gracefully — the page still
renders without the fallback.

## Error boundaries

- Errors **before the shell flushes** → caller's `onShellError` fires,
  response is still 200 with partial content. If stream-gen itself
  throws, `renderStreamingResponse` returns a 500.
- Errors **after the shell flushes** → `onStreamError` fires; Mandu
  injects an error `<script>` that dispatches
  `mandu:streaming-error` on `window`. Client-side error boundaries can
  listen for this.
- Errors inside `use(promise)` rejection → propagate to the nearest
  `<ErrorBoundary>` (if any) or bubble up to `onError`.

## Performance characteristics

| Metric | Non-streaming | Streaming |
|--------|--------------|-----------|
| TTFB | O(slowest component) | O(shell gen) ≈ 5-15ms |
| Time-to-interactive (visible pixels) | After all data ready | After shell — browser paints fallback |
| Total payload size | Same | Slightly larger (+~300 bytes for reveal script) |
| CPU on server | Single render pass | Same tree rendered once (streaming engine) |

Do NOT put a compression middleware that buffers whole responses in
front of a streaming route — gzip streaming is fine (`nginx` default
behavior); brotli-CRC requires opt-in flush hints.

## Proxy caveats

- **nginx**: `proxy_buffering off;` or send `X-Accel-Buffering: no`
  (Mandu already sets this header).
- **Cloudflare**: streaming works on enterprise and workers; the free
  tier buffers.
- **AWS CloudFront**: supports chunked transfer since 2024; no flag
  required.
- **Compression**: Cloudflare/Bun compress at the connection layer,
  which is safe. Manually inserting a `compression` middleware in
  `Bun.serve` is NOT — it buffers the whole response.

## Testing streaming locally

```ts
import { createTestServer } from "@mandujs/core/testing";

const server = await createTestServer(manifest, { /* ... */ });
const res = await server.fetch("/slow-page");

// Read the body as a stream to observe chunks
const reader = res.body!.getReader();
const { value: first } = await reader.read();
// `first` is the shell; subsequent reads return suspense-resolved content.
```

`res.headers.get("X-Accel-Buffering")` returns `"no"` — a good smoke
test that the response is streaming-configured.

## Internals pointer

- `packages/core/src/runtime/streaming-ssr.ts` — `renderToStream`,
  `renderStreamingResponse`, `renderWithDeferredData`.
- `packages/core/src/runtime/ssr.ts` — `resolveAsyncElement` (used only
  for the non-streaming path as of Phase 18.ξ).
- `packages/core/src/runtime/server.ts` — `renderPageSSR` dispatcher:
  chooses streaming vs non-streaming based on `route.streaming`.
- Tests: `packages/core/tests/runtime/streaming-suspense.test.ts`,
  `packages/core/tests/runtime/react-use.test.ts`,
  `packages/core/tests/server/streaming-async-page.test.ts`.
