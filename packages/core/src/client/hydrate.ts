/**
 * Mandu Per-Island Hydration Scheduler
 *
 * Phase 18.δ — Formal hydration strategy spec for Islands.
 *
 * Strategies (Astro-compatible naming):
 *   - `load`                — hydrate immediately (current default; equiv. to Astro `client:load`)
 *   - `idle`                — `requestIdleCallback` (Astro `client:idle`)
 *   - `visible`             — `IntersectionObserver` rootMargin 200px (Astro `client:visible`)
 *   - `interaction`         — hydrate on first click/touchstart/keydown (Astro `client:only` equivalent for events)
 *   - `media(<query>)`      — hydrate only when `matchMedia(query).matches` (Astro `client:media`)
 *
 * This module is the **single source of truth** for hydration scheduling on
 * the client. It is intentionally side-effect-free on import so that:
 *   1. Bundlers can tree-shake unused strategies.
 *   2. Unit tests can import it under happy-dom/JSDOM without triggering
 *      global mutation (no `document.querySelectorAll` on module eval).
 *
 * The bundler-generated runtime (`bundler/build.ts::generateRuntimeSource`)
 * delegates strategy selection to `scheduleHydration()` here — SSR emits the
 * `data-hydrate` attribute, the runtime reads it and dispatches.
 *
 * Design contract:
 *   - Every strategy invokes its `hydrate` callback at most ONCE.
 *   - Every strategy returns a `dispose()` cleanup that detaches observers
 *     and event listeners (no memory leaks on route change / unmount).
 *   - Unknown / malformed strategies fall back to `load` with a console
 *     warning so broken islands never silently stay un-interactive.
 */

export type HydrationStrategyName =
  | "load"
  | "idle"
  | "visible"
  | "interaction"
  | "media";

export interface ParsedStrategy {
  name: HydrationStrategyName;
  /** media query string when `name === "media"`, else `undefined`. */
  media?: string;
}

/** `rootMargin` used by the `visible` IntersectionObserver. */
export const VISIBLE_ROOT_MARGIN = "200px";

/** Events that trigger `interaction` hydration. */
export const INTERACTION_EVENTS = ["click", "touchstart", "keydown"] as const;

/**
 * Parse a `data-hydrate` attribute value into a normalized strategy.
 *
 * Accepts:
 *   - `"load"` | `"idle"` | `"visible"` | `"interaction"`
 *   - `"media(min-width: 768px)"` — media query in parentheses
 *
 * Returns `{ name: "load" }` with a `console.warn` for unknown/malformed
 * inputs (fail-open default — never leave an island dead).
 */
export function parseHydrateStrategy(
  attr: string | null | undefined,
): ParsedStrategy {
  if (!attr) return { name: "load" };

  const trimmed = attr.trim();

  if (
    trimmed === "load" ||
    trimmed === "idle" ||
    trimmed === "visible" ||
    trimmed === "interaction"
  ) {
    return { name: trimmed };
  }

  // media(<query>) — extract inner query
  const mediaMatch = /^media\(\s*(.+?)\s*\)$/.exec(trimmed);
  if (mediaMatch && mediaMatch[1]) {
    return { name: "media", media: mediaMatch[1] };
  }

  // Fallback: legacy `immediate` alias → `load`
  if (trimmed === "immediate") return { name: "load" };

  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(
      `[Mandu] Unknown hydrate strategy "${attr}", falling back to "load".`,
    );
  }
  return { name: "load" };
}

/**
 * A function returned by each strategy scheduler. Invoke to detach any
 * observers / listeners BEFORE the actual hydration kicks in. Safe to call
 * multiple times (idempotent).
 */
export type Disposer = () => void;

function noopDispose(): Disposer {
  return () => {};
}

/**
 * `load` — hydrate synchronously on next microtask.
 *
 * We use a microtask (Promise.resolve().then) rather than calling `hydrate`
 * directly so that callers can install listeners on `mandu:hydrated` events
 * after `scheduleHydration` returns. Matches Astro `client:load` semantics.
 */
function scheduleLoad(hydrate: () => void): Disposer {
  let cancelled = false;
  Promise.resolve().then(() => {
    if (!cancelled) hydrate();
  });
  return () => {
    cancelled = true;
  };
}

/**
 * `idle` — hydrate when the browser is idle.
 * Falls back to `setTimeout(200)` when `requestIdleCallback` is unavailable
 * (Safari < 16.4, some WebViews).
 */
function scheduleIdle(hydrate: () => void): Disposer {
  const w = typeof window !== "undefined" ? window : undefined;
  if (!w) return noopDispose();

  if (typeof w.requestIdleCallback === "function") {
    const handle = w.requestIdleCallback(() => hydrate());
    return () => {
      if (typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(handle);
      }
    };
  }

  const timer = setTimeout(hydrate, 200);
  return () => clearTimeout(timer);
}

/**
 * `visible` — hydrate when the element enters the viewport (+200px margin).
 * Falls back to immediate hydration when `IntersectionObserver` is missing.
 */
function scheduleVisible(
  element: Element,
  hydrate: () => void,
): Disposer {
  if (typeof IntersectionObserver === "undefined") {
    hydrate();
    return noopDispose();
  }

  let disposed = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (disposed) return;
      for (const entry of entries) {
        if (entry.isIntersecting) {
          disposed = true;
          observer.disconnect();
          hydrate();
          return;
        }
      }
    },
    { rootMargin: VISIBLE_ROOT_MARGIN },
  );

  // `display:contents` wrappers have zero layout size → observe the first
  // element child when available so IntersectionObserver sees real geometry.
  const target = resolveObservationTarget(element);
  observer.observe(target);

  return () => {
    disposed = true;
    observer.disconnect();
  };
}

/**
 * `interaction` — hydrate on the first click / touchstart / keydown within
 * the island. Matches the task spec (click/touch/keydown only; no
 * mouseenter or pointerdown to keep scroll & hover passive).
 */
function scheduleInteraction(
  element: Element,
  hydrate: () => void,
): Disposer {
  let fired = false;
  const target = resolveObservationTarget(element);

  const onEvent = () => {
    if (fired) return;
    fired = true;
    dispose();
    hydrate();
  };

  const dispose: Disposer = () => {
    for (const evt of INTERACTION_EVENTS) {
      target.removeEventListener(evt, onEvent, true);
    }
  };

  for (const evt of INTERACTION_EVENTS) {
    // Capture phase so the island hydrates BEFORE the user's click bubbles
    // to their still-dehydrated event handler.
    target.addEventListener(evt, onEvent, { capture: true, once: false });
  }

  return dispose;
}

/**
 * `media(<query>)` — hydrate only when `matchMedia(query).matches` becomes
 * true. If already matching on mount, hydrate immediately; otherwise wait
 * for the first `change` event.
 */
function scheduleMedia(query: string, hydrate: () => void): Disposer {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    // No matchMedia support → fall back to `load` so the island is at least
    // interactive. Conservative: users can't debug silent no-ops.
    hydrate();
    return noopDispose();
  }

  const mql = window.matchMedia(query);
  if (mql.matches) {
    hydrate();
    return noopDispose();
  }

  let disposed = false;
  const onChange = (e: MediaQueryListEvent) => {
    if (disposed) return;
    if (e.matches) {
      disposed = true;
      detach();
      hydrate();
    }
  };

  const detach: Disposer = () => {
    if (typeof mql.removeEventListener === "function") {
      mql.removeEventListener("change", onChange);
    } else if (typeof (mql as unknown as { removeListener?: (l: unknown) => void }).removeListener === "function") {
      // Safari < 14 legacy API
      (mql as unknown as { removeListener: (l: (e: MediaQueryListEvent) => void) => void }).removeListener(onChange);
    }
  };

  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
  } else if (typeof (mql as unknown as { addListener?: (l: unknown) => void }).addListener === "function") {
    (mql as unknown as { addListener: (l: (e: MediaQueryListEvent) => void) => void }).addListener(onChange);
  }

  return () => {
    disposed = true;
    detach();
  };
}

/**
 * Resolve the DOM node to actually observe / listen on. Island wrappers use
 * `style="display:contents"` which has zero layout box — IntersectionObserver
 * refuses to fire for such elements. Promote to the first element child when
 * available, else fall back to the wrapper itself.
 */
function resolveObservationTarget(element: Element): Element {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") {
    return element;
  }
  try {
    const cs = getComputedStyle(element);
    if (cs.display === "contents" && element.firstElementChild) {
      return element.firstElementChild;
    }
  } catch {
    /* happy-dom may reject partial stylesheet queries — treat as layout element */
  }
  return element;
}

/**
 * Public entry — schedule hydration of `element` according to `strategy`,
 * invoking `hydrate` at most once. Returns a disposer for cleanup.
 *
 * Unknown strategies degrade to `load` with a console warning.
 *
 * @param element  — the island root (typically `[data-mandu-island]`)
 * @param strategy — either a `ParsedStrategy` from `parseHydrateStrategy`
 *                   OR a raw attribute string (e.g. `"media(min-width: 768px)"`)
 * @param hydrate  — callback invoked once when the strategy trigger fires
 */
export function scheduleHydration(
  element: Element,
  strategy: ParsedStrategy | string | null | undefined,
  hydrate: () => void,
): Disposer {
  const parsed =
    typeof strategy === "string" || strategy == null
      ? parseHydrateStrategy(strategy as string | null | undefined)
      : strategy;

  switch (parsed.name) {
    case "load":
      return scheduleLoad(hydrate);
    case "idle":
      return scheduleIdle(hydrate);
    case "visible":
      return scheduleVisible(element, hydrate);
    case "interaction":
      return scheduleInteraction(element, hydrate);
    case "media":
      return parsed.media
        ? scheduleMedia(parsed.media, hydrate)
        : scheduleLoad(hydrate);
    default:
      // Exhaustiveness: if a new strategy is added to the union without a
      // handler, TypeScript flags the `never` check below at compile time.
      ((_x: never) => _x)(parsed.name);
      return scheduleLoad(hydrate);
  }
}

/**
 * Internal test helpers — expose resolveObservationTarget so that unit
 * tests can verify the `display:contents` promotion rule without relying
 * on public API side-effects.
 *
 * @internal
 */
export const _testOnly_resolveObservationTarget = resolveObservationTarget;
