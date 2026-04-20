/**
 * Phase 18.δ — Per-island hydration strategy tests.
 *
 * Coverage:
 *   - parseHydrateStrategy: load, idle, visible, interaction, media, legacy, unknown, null/empty
 *   - scheduleHydration: happy path per strategy + cleanup + fallback
 *   - SSR attribute emission: wrapWithIsland emits data-hydrate + legacy data-mandu-priority
 *   - Island API: declarative overloads (string + object) + backward compat
 *
 * Runs under happy-dom (see tests/setup.ts). IntersectionObserver and
 * matchMedia are shimmed per-test rather than globally to keep assertions
 * focused.
 */

import { setupHappyDom } from "../setup";
setupHappyDom();

import { afterEach, describe, expect, test } from "bun:test";
import {
  INTERACTION_EVENTS,
  parseHydrateStrategy,
  scheduleHydration,
  VISIBLE_ROOT_MARGIN,
} from "../../src/client/hydrate";
import { wrapWithIsland } from "../../src/runtime/ssr";
import { island } from "../../src/island";

// ---------------------------------------------------------------------------
// IntersectionObserver shim helpers — each test installs/removes its own.
// ---------------------------------------------------------------------------

interface MockIO {
  observe: (el: Element) => void;
  disconnect: () => void;
  trigger: (intersecting: boolean) => void;
  rootMargin: string | undefined;
  disconnected: boolean;
  observed: Element[];
}

function installMockIntersectionObserver(): MockIO {
  const state: MockIO = {
    observe: () => {},
    disconnect: () => {},
    trigger: () => {},
    rootMargin: undefined,
    disconnected: false,
    observed: [],
  };
  const observers: Array<{
    cb: IntersectionObserverCallback;
    state: MockIO;
  }> = [];

  class MockObserver {
    private cb: IntersectionObserverCallback;
    public rootMargin: string | undefined;
    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
      this.cb = cb;
      this.rootMargin = opts?.rootMargin;
      state.rootMargin = opts?.rootMargin;
      observers.push({ cb, state });
    }
    observe(el: Element) {
      state.observed.push(el);
    }
    disconnect() {
      state.disconnected = true;
    }
    unobserve() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  state.trigger = (intersecting: boolean) => {
    for (const { cb, state: s } of observers) {
      cb(
        s.observed.map(
          (target) =>
            ({
              isIntersecting: intersecting,
              target,
              intersectionRatio: intersecting ? 1 : 0,
            }) as IntersectionObserverEntry,
        ),
        {} as IntersectionObserver,
      );
    }
  };

  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = MockObserver as unknown;
  return state;
}

function removeIntersectionObserver() {
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
}

// matchMedia shim
interface MockMQL {
  matches: boolean;
  fire: (matches: boolean) => void;
  removed: boolean;
}

function installMockMatchMedia(initialMatches: boolean): MockMQL {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const state: MockMQL = { matches: initialMatches, fire: () => {}, removed: false };

  const mql = {
    matches: initialMatches,
    media: "",
    onchange: null,
    addEventListener(_: string, l: (e: MediaQueryListEvent) => void) {
      listeners.add(l);
    },
    removeEventListener(_: string, l: (e: MediaQueryListEvent) => void) {
      listeners.delete(l);
      state.removed = true;
    },
    dispatchEvent: () => true,
    addListener() {},
    removeListener() {},
  } as unknown as MediaQueryList;

  state.fire = (matches: boolean) => {
    state.matches = matches;
    (mql as unknown as { matches: boolean }).matches = matches;
    for (const l of listeners) {
      l({ matches } as MediaQueryListEvent);
    }
  };

  (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = () => mql;
  return state;
}

afterEach(() => {
  removeIntersectionObserver();
  // restore happy-dom default matchMedia
  try {
    delete (window as unknown as Record<string, unknown>).matchMedia;
  } catch {
    /* readonly in some runtimes */
  }
});

// ---------------------------------------------------------------------------
// 1. parseHydrateStrategy
// ---------------------------------------------------------------------------

describe("parseHydrateStrategy", () => {
  test("parses 'load'", () => {
    expect(parseHydrateStrategy("load")).toEqual({ name: "load" });
  });

  test("parses 'idle'", () => {
    expect(parseHydrateStrategy("idle")).toEqual({ name: "idle" });
  });

  test("parses 'visible'", () => {
    expect(parseHydrateStrategy("visible")).toEqual({ name: "visible" });
  });

  test("parses 'interaction'", () => {
    expect(parseHydrateStrategy("interaction")).toEqual({ name: "interaction" });
  });

  test("parses 'media(min-width: 768px)' with query extraction", () => {
    expect(parseHydrateStrategy("media(min-width: 768px)")).toEqual({
      name: "media",
      media: "min-width: 768px",
    });
  });

  test("parses 'media( prefers-reduced-motion: reduce )' trimming whitespace", () => {
    expect(parseHydrateStrategy("media( prefers-reduced-motion: reduce )")).toEqual({
      name: "media",
      media: "prefers-reduced-motion: reduce",
    });
  });

  test("maps legacy 'immediate' → 'load'", () => {
    expect(parseHydrateStrategy("immediate")).toEqual({ name: "load" });
  });

  test("null / empty / undefined → 'load' fallback", () => {
    expect(parseHydrateStrategy(null)).toEqual({ name: "load" });
    expect(parseHydrateStrategy(undefined)).toEqual({ name: "load" });
    expect(parseHydrateStrategy("")).toEqual({ name: "load" });
  });

  test("unknown string → 'load' fallback with warning", () => {
    const originalWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    try {
      expect(parseHydrateStrategy("teleport")).toEqual({ name: "load" });
      expect(warned).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// 2. scheduleHydration — happy paths
// ---------------------------------------------------------------------------

describe("scheduleHydration", () => {
  test("'load' invokes hydrate on next microtask", async () => {
    const el = document.createElement("div");
    let called = 0;
    scheduleHydration(el, "load", () => called++);
    expect(called).toBe(0); // not synchronous
    await Promise.resolve();
    expect(called).toBe(1);
  });

  test("'load' disposer cancels pending hydration", async () => {
    const el = document.createElement("div");
    let called = 0;
    const dispose = scheduleHydration(el, "load", () => called++);
    dispose();
    await Promise.resolve();
    expect(called).toBe(0);
  });

  test("'idle' uses requestIdleCallback when available", async () => {
    const el = document.createElement("div");
    let called = 0;
    let ricInvoked = false;
    const originalRIC = (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback = (cb) => {
      ricInvoked = true;
      cb();
      return 1;
    };
    try {
      scheduleHydration(el, "idle", () => called++);
      expect(ricInvoked).toBe(true);
      expect(called).toBe(1);
    } finally {
      if (originalRIC === undefined) {
        delete (window as unknown as Record<string, unknown>).requestIdleCallback;
      } else {
        (window as unknown as Record<string, unknown>).requestIdleCallback = originalRIC;
      }
    }
  });

  test("'idle' falls back to setTimeout when requestIdleCallback is missing", async () => {
    const el = document.createElement("div");
    let called = 0;
    const originalRIC = (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    delete (window as unknown as Record<string, unknown>).requestIdleCallback;
    try {
      scheduleHydration(el, "idle", () => called++);
      await new Promise((r) => setTimeout(r, 250));
      expect(called).toBe(1);
    } finally {
      if (originalRIC !== undefined) {
        (window as unknown as Record<string, unknown>).requestIdleCallback = originalRIC;
      }
    }
  });

  test("'visible' uses IntersectionObserver with 200px rootMargin, hydrates on intersect", () => {
    const io = installMockIntersectionObserver();
    const el = document.createElement("div");
    document.body.appendChild(el);
    let called = 0;
    scheduleHydration(el, "visible", () => called++);
    expect(io.rootMargin).toBe(VISIBLE_ROOT_MARGIN);
    expect(called).toBe(0); // not yet visible
    io.trigger(true);
    expect(called).toBe(1);
    expect(io.disconnected).toBe(true); // cleanup observer after fire
    // Calling again does not double-hydrate
    io.trigger(true);
    expect(called).toBe(1);
    el.remove();
  });

  test("'visible' dispose cleans up observer (no memory leak)", () => {
    const io = installMockIntersectionObserver();
    const el = document.createElement("div");
    document.body.appendChild(el);
    let called = 0;
    const dispose = scheduleHydration(el, "visible", () => called++);
    dispose();
    expect(io.disconnected).toBe(true);
    // Post-dispose trigger must not hydrate
    io.trigger(true);
    expect(called).toBe(0);
    el.remove();
  });

  test("'visible' falls back to immediate hydration when IntersectionObserver missing", () => {
    removeIntersectionObserver();
    const el = document.createElement("div");
    let called = 0;
    scheduleHydration(el, "visible", () => called++);
    expect(called).toBe(1);
  });

  test("'interaction' hydrates on first click and cleans up all listeners", () => {
    const el = document.createElement("button");
    document.body.appendChild(el);
    let called = 0;
    scheduleHydration(el, "interaction", () => called++);
    expect(called).toBe(0);

    el.dispatchEvent(new Event("click", { bubbles: true }));
    expect(called).toBe(1);

    // Further events must NOT re-fire
    el.dispatchEvent(new Event("click", { bubbles: true }));
    el.dispatchEvent(new Event("keydown", { bubbles: true }));
    el.dispatchEvent(new Event("touchstart", { bubbles: true }));
    expect(called).toBe(1);
    el.remove();
  });

  test("'interaction' hydrates on keydown (keyboard a11y)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let called = 0;
    scheduleHydration(el, "interaction", () => called++);
    el.dispatchEvent(new Event("keydown", { bubbles: true }));
    expect(called).toBe(1);
    el.remove();
  });

  test("'interaction' listens for exactly click/touchstart/keydown (spec contract)", () => {
    expect([...INTERACTION_EVENTS].sort()).toEqual(["click", "keydown", "touchstart"]);
  });

  test("'interaction' dispose removes listeners before first fire", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    let called = 0;
    const dispose = scheduleHydration(el, "interaction", () => called++);
    dispose();
    el.dispatchEvent(new Event("click", { bubbles: true }));
    el.dispatchEvent(new Event("keydown", { bubbles: true }));
    expect(called).toBe(0);
    el.remove();
  });

  test("'media(<query>)' hydrates immediately when query matches on mount", () => {
    installMockMatchMedia(true);
    const el = document.createElement("div");
    let called = 0;
    scheduleHydration(el, "media(min-width: 768px)", () => called++);
    expect(called).toBe(1);
  });

  test("'media(<query>)' waits for change event when query initially does not match", () => {
    const mql = installMockMatchMedia(false);
    const el = document.createElement("div");
    let called = 0;
    scheduleHydration(el, "media(min-width: 768px)", () => called++);
    expect(called).toBe(0);
    mql.fire(true);
    expect(called).toBe(1);
    // change listener removed post-fire
    expect(mql.removed).toBe(true);
    // Further fires do not re-hydrate
    mql.fire(true);
    expect(called).toBe(1);
  });

  test("'media(<query>)' dispose removes change listener", () => {
    const mql = installMockMatchMedia(false);
    const el = document.createElement("div");
    let called = 0;
    const dispose = scheduleHydration(el, "media(min-width: 768px)", () => called++);
    dispose();
    expect(mql.removed).toBe(true);
    mql.fire(true);
    expect(called).toBe(0);
  });

  test("unknown strategy falls back to 'load'", async () => {
    const el = document.createElement("div");
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      let called = 0;
      scheduleHydration(el, "teleport" as string, () => called++);
      await Promise.resolve();
      expect(called).toBe(1);
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// 3. SSR attribute emission — wrapWithIsland emits data-hydrate
// ---------------------------------------------------------------------------

describe("SSR — wrapWithIsland emits data-hydrate", () => {
  test("default 'visible' priority emits data-hydrate=\"visible\"", () => {
    const html = wrapWithIsland("<p>hi</p>", "home", "visible");
    expect(html).toContain('data-hydrate="visible"');
    expect(html).toContain('data-mandu-priority="visible"');
    expect(html).toContain('data-mandu-island="home"');
  });

  test("legacy 'immediate' priority emits data-hydrate=\"load\"", () => {
    const html = wrapWithIsland("<p>hi</p>", "home", "immediate");
    expect(html).toContain('data-hydrate="load"');
    expect(html).toContain('data-mandu-priority="immediate"');
  });

  test("explicit hydrate override wins over priority mapping", () => {
    const html = wrapWithIsland("<p>hi</p>", "gated", "visible", undefined, "media(min-width: 768px)");
    expect(html).toContain('data-hydrate="media(min-width: 768px)"');
  });

  test("interaction priority maps to data-hydrate=\"interaction\"", () => {
    const html = wrapWithIsland("<p>hi</p>", "r1", "interaction");
    expect(html).toContain('data-hydrate="interaction"');
  });

  test("idle priority maps to data-hydrate=\"idle\"", () => {
    const html = wrapWithIsland("<p>hi</p>", "r2", "idle");
    expect(html).toContain('data-hydrate="idle"');
  });
});

// ---------------------------------------------------------------------------
// 4. Island API — declarative overloads
// ---------------------------------------------------------------------------

describe("island() — declarative overloads (Phase 18.δ contract)", () => {
  test("island('visible', Component) attaches __hydrate='visible'", () => {
    const Comp = (_: Record<string, unknown>) => null;
    const result = island("visible", Comp);
    expect(result.__island).toBe(true);
    expect(result.__hydrate).toBe("visible");
  });

  test("island('idle', Comp) attaches __hydrate='idle'", () => {
    const Comp = (_: Record<string, unknown>) => null;
    const result = island("idle", Comp);
    expect(result.__hydrate).toBe("idle");
  });

  test("island('load', Comp) default strategy wiring", () => {
    const Comp = (_: Record<string, unknown>) => null;
    const result = island("load", Comp);
    expect(result.__hydrate).toBe("load");
  });

  test("island({ hydrate, media }, Comp) object form with media query", () => {
    const Comp = (_: Record<string, unknown>) => null;
    const result = island(
      { hydrate: "media", media: "(min-width: 768px)" },
      Comp,
    );
    expect(result.__hydrate).toBe("media");
    expect(result.__media).toBe("(min-width: 768px)");
  });

  test("declarative API accepts the strategies required by SSR attribute emission", () => {
    // Regression: each strategy must round-trip through the declarative
    // API without throwing. Keeps the union type in lockstep with the
    // runtime scheduler's `ParsedStrategy`.
    const Comp = (_: Record<string, unknown>) => null;
    expect(island("load", Comp).__hydrate).toBe("load");
    expect(island("idle", Comp).__hydrate).toBe("idle");
    expect(island("visible", Comp).__hydrate).toBe("visible");
    expect(island({ hydrate: "media", media: "(min-width: 768px)" }, Comp).__hydrate).toBe("media");
    expect(island("never", Comp).__hydrate).toBe("never");
  });
});
