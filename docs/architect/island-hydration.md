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

## Declarative API

```ts
import { island } from "@mandujs/core";

// 1. Short form — strategy + component
export default island("visible", function CommentBox({ postId }) {
  // ...
});

// 2. Options form — media queries + extras
export default island(
  { hydrate: "media", media: "(max-width: 768px)" },
  MobileNavDrawer,
);

// 3. Default (load) — no strategy attached
export default island("load", Analytics);
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
| `load`                       | `client:load`        | `island('load', Comp)`     |
| `idle`                       | `client:idle`        | `island('idle', Comp)`     |
| `visible`                    | `client:visible`     | `island('visible', Comp)`  |
| `media(query)`               | `client:media="..."` | `island({hydrate:'media', media:'...'}, Comp)` |
| first interaction            | *(not built-in)*     | `island('interaction', Comp)` |
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
