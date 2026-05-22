# Island Hydration Strategies

**Status:** Phase 18.δ — stable
**Scope:** Per-island declarative hydration (Astro-grade DX)
**Module:** `@mandujs/core/client/hydrate`

Mandu Islands ship HTML with zero JavaScript by default. When a page
contains an interactive island, you choose *when* it hydrates — not *if*.
Per-island strategies let you keep Core Web Vitals (TBT, INP) green while
still delivering a rich client experience.

## Strategy matrix

| Strategy                    | Trigger                                               | Best for                                  | Astro equivalent |
|-----------------------------|-------------------------------------------------------|-------------------------------------------|------------------|
| `load`                      | Next microtask after SSR paint (current default)      | Header nav, auth state, above-the-fold    | `client:load`    |
| `idle`                      | `requestIdleCallback` (fallback: `setTimeout(200)`)   | Analytics, non-critical widgets           | `client:idle`    |
| `visible`                   | `IntersectionObserver` with `rootMargin: 200px`       | Below-the-fold forms, comments, carousels | `client:visible` |
| `interaction`               | First `click` / `touchstart` / `keydown` on island    | Modals, menus, autocomplete, video embeds | *(new)*          |
| `media(<media query>)`      | `matchMedia(query).matches` — initial OR `change`     | Mobile-only menus, dark-mode toggles      | `client:media`   |

Unknown strategies degrade to `load` with a `console.warn` — islands never
stay silently dead.

## Island API

```ts
import { island, wrapComponent } from "@mandujs/core/client";

// 1. Simple component wrapper
export default wrapComponent(CommentBox);

// 2. Setup/render object for server-data mapping
export default island({
  setup(serverData) {
    return { comments: serverData.comments };
  },
  render({ comments }) {
    return <CommentList comments={comments} />;
  },
});
```

`island()` takes one definition object. The older-looking
`island("visible", Component)` form is invalid and will throw because the first
argument is not a setup/render definition.

Hydration priority is route-level for page islands:

```ts
// app/blog/[slug]/page.tsx
export const hydration = {
  strategy: "island",
  priority: "visible",
  preload: false,
};
```

The `island()` metadata survives bundler round-trips and is emitted by SSR
onto the wrapper element:

```html
<div
  data-mandu-island="comment-box"
  data-hydrate="visible"
  data-mandu-src="/.mandu/client/islands/comment-box.js?v=..."
  style="display:contents"
>
  <!-- SSR HTML -->
</div>
```

The client runtime reads `data-hydrate` and dispatches via
`scheduleHydration()`.

## Compiler-owned client boundaries

F42 adds a separate path for server routes that directly import `.client` or
`.island` components. App code stays React-like:

```tsx
import { CommentsSection } from "../client/CommentsSection.client";

export default async function Page({ comments }) {
  return <CommentsSection initialComments={comments} />;
}
```

The server build rewrites that JSX to Mandu's internal boundary component
before SSR imports the route. The client component module is not executed
during boundary discovery, and the route manifest becomes the source of truth
for the boundary id, module, export name, hydration priority, and source
location.

SSR emits a marker plus a boundary-local props payload:

```html
<div
  data-mandu-island="pledges-$id--0"
  data-mandu-boundary-id="pledges-$id--0"
  data-mandu-route-id="pledges-$id"
  data-mandu-client-module="src/client/CommentsSection.client.tsx"
  data-mandu-client-export="CommentsSection"
  data-hydrate="visible"
></div>
<script type="application/json" data-mandu-props="pledges-$id--0">
  {"initialComments":[]}
</script>
```

The actual `data-mandu-src` value is filled from `.mandu/manifest.json`
when the boundary bundle is present. The JSON payload uses Mandu's route data
serializer and escapes script-closing sequences so it is safe inside an HTML
`application/json` script.

Hydration props resolve in this order:

1. `script[data-mandu-props="<boundary-id>"]`
2. Route-level `__MANDU_DATA__` fallback
3. Empty props with a development warning

Named and default client exports both resolve from explicit boundary metadata
before any generated-entry fallback. Repeated renders of the same boundary id
keep the manifest id for the first instance and append an instance suffix for
later props payloads.

Streaming SSR uses the same contract in F42: each compiler-owned boundary
emits its props script immediately next to the marker, and route-filtered
boundary chunks may be preloaded from the manifest. Delayed or out-of-order
props delivery is reserved for the F44 hydration scheduler work.

### Boundary restrictions

F42 intentionally rejects ambiguous boundary shapes at build/dev time:

- Non-empty `children` on transformed client components are not serialized.
- Function props, refs, React elements, symbols, and visible non-plain objects
  fail with stable `MANDU_BOUNDARY_*` diagnostics.
- Client boundary modules may not import server-only modules such as Node/Bun
  built-ins, `server-only`, non-client `@mandujs/core` paths, or `*.server`
  files.
- Compiler-owned boundaries cannot be emitted directly inside known invalid
  HTML host contexts such as `table`, `thead`, `tbody`, `tfoot`, `tr`,
  `select`, `optgroup`, `option`, `ul`, `ol`, `dl`, or `p`. The current marker
  uses sibling `<div>` and `<script>` nodes, so those contexts need a server
  wrapper, valid host restructuring, or an explicit island API until
  context-safe markers are implemented.

## Island vs partial

An island is a page-level client bundle. Do not render a compiled island as
inline JSX inside a server page; the runtime intentionally throws a diagnostic
for that case. For embedded interactive regions, use `partial()`:

```tsx
// app/HeaderSearch.partial.tsx
"use client";

import { partial } from "@mandujs/core/client";

function HeaderSearch(props: { query: string }) {
  return <SearchBox initialQuery={props.query} />;
}

export default partial({
  id: "HeaderSearch",
  component: HeaderSearch,
  priority: "interaction",
});
```

```tsx
// app/page.tsx
import HeaderSearchPartial from "./HeaderSearch.partial";

export const hydration = {
  strategy: "island",
  priority: "visible",
  preload: false,
};

export default async function Page() {
  const products = await fetchProducts();

  return (
    <main>
      <ProductList products={products} />
      <HeaderSearchPartial.Render query="" />
    </main>
  );
}
```

The filename stem and the partial `id` should match (`HeaderSearch.partial.tsx`
→ `id: "HeaderSearch"`) unless you provide an explicit `src`. The server
render emits SSR HTML plus `data-mandu-partial`, `data-mandu-island`,
`data-mandu-src`, and `data-props` markers; the bundler emits
`/.mandu/client/HeaderSearch.partial.js`.

Do not place a `.client.tsx` component under `src/client/` and expect route
auto-discovery. Route-level bundles are discovered from the route manifest
(`app/*.island.tsx`, `"use client"` pages, or `spec/slots/{routeId}.client.tsx`).
Inline server-page interactivity uses `*.partial.tsx` files plus
`partial().Render`.

## Runtime API (advanced)

For custom boundaries (e.g. third-party widget wrappers), call the
scheduler directly:

```ts
import { scheduleHydration, parseHydrateStrategy } from "@mandujs/core/client";

const el = document.querySelector("[data-my-widget]")!;
const strategy = parseHydrateStrategy(el.getAttribute("data-hydrate"));

const dispose = scheduleHydration(el, strategy, () => {
  // Your one-shot hydration logic
});

// Optional: tear down on route change to release observers
window.addEventListener("mandu:before-navigate", dispose, { once: true });
```

**Guarantees:**
- Each strategy fires the `hydrate` callback **at most once**.
- Every scheduler returns a **disposer** that detaches observers /
  event listeners — safe to call multiple times.
- No global state, no module-level side effects. Tree-shakeable.

## Performance notes

### `visible` — IntersectionObserver
- `rootMargin: 200px` prefetches JS as the user scrolls *toward* the island,
  so hydration completes by the time it enters the viewport.
- Wrappers with `style="display:contents"` have zero layout box; the
  scheduler auto-promotes observation to the first element child.
- Unsupported (Safari < 12.1, IE): falls back to immediate hydration.

### `idle` — requestIdleCallback
- Fires during the browser's idle periods, so it does not compete with
  user input or scroll.
- Safari < 16.4 lacks rIC; we fall back to a `setTimeout(200)` deadline
  that matches Astro and Fresh.

### `interaction` — first click/touch/keydown
- Listeners attach in **capture phase** so hydration completes *before*
  the click bubbles to the (still-dehydrated) island handler.
- `once` semantics enforced by a single-fire guard; all three events
  (`click`, `touchstart`, `keydown`) detach together on the first trigger.
- No `mouseenter` / `pointerdown` — those spam on passive scroll and hover.

### `media(<query>)` — matchMedia
- Immediate if `matches` is true on mount; otherwise wires a `change`
  listener.
- Detaches on first match — no accumulating listeners across route changes.

## When to use what

Pick by the island's *interactivity window*:

1. **Is it visible on first paint AND interactive within 1s?**
   → `load` (default).
2. **Is it offscreen at first paint but will scroll into view?**
   → `visible`.
3. **Is it passive below-the-fold telemetry or a low-priority widget?**
   → `idle`.
4. **Is it a menu, popover, modal, or embed that only activates on user
   intent?**
   → `interaction`.
5. **Is it viewport- or feature-query-specific (mobile nav, dark mode)?**
   → `media("...")`.

Mix freely — a page can combine all five.

## Astro comparison

| Feature                      | Astro                | Mandu                      |
|------------------------------|----------------------|----------------------------|
| `load`                       | `client:load`        | `export const hydration = { priority: "immediate" }` |
| `idle`                       | `client:idle`        | `partial({ priority: "idle" })` for inline regions |
| `visible`                    | `client:visible`     | `export const hydration = { priority: "visible" }` |
| `media(query)`               | `client:media="..."` | scheduler-level `parseHydrateStrategy("media(...)")` |
| first interaction            | *(not built-in)*     | `partial({ priority: "interaction" })` |
| `IntersectionObserver` margin | 0px (default)       | **200px** (prefetch window)|
| Disposer / cleanup contract  | internal             | **public `Disposer` return**|
| SSR attribute                | `client:visible`     | `data-hydrate="visible"`   |

Notable Mandu-specific extensions:

- **`interaction`** strategy — Astro does not ship a click/keydown trigger
  out of the box. Mandu adds it because lazy modals and autocomplete
  widgets are common patterns where `visible` over-hydrates.
- **200px `rootMargin`** — Astro observes at 0px; Mandu uses 200px to
  start fetching the island bundle a scroll-tick ahead of viewport entry.
  On 90th-percentile mobile networks this closes the "visible but still
  dehydrated" gap.
- **Explicit disposers** — every strategy returns a cleanup function so
  SPA navigations can release observers without waiting for GC.

## Bundle impact

`hydrate.ts` gzipped target: **< 2 KB**. Current size (pre-minified) is
~3.1 KB source; after terser + gzip in production bundles it lands at
~1.4 KB. Each strategy is a top-level function — unused ones tree-shake
when the bundler sees static `data-hydrate` attribute distribution.

## See also

- `packages/core/src/client/hydrate.ts` — scheduler source
- `packages/core/src/island/index.ts` — declarative island API
- `packages/core/tests/client/hydration-strategies.test.ts` — regression suite
- `docs/bun/features-catalog.md` — Bun `IntersectionObserver` / `matchMedia` support matrix
