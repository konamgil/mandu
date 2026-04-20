/**
 * Issue #208 — SPA-nav helper exclusion-matrix parity test.
 *
 * The inline IIFE injected by `ssr.ts` / `streaming-ssr.ts` must cover
 * the same 10 escape-hatch cases that the full client router
 * (`router.ts::handleLinkClick`) handles. When any of these fire, the
 * helper MUST NOT call `preventDefault()` — the browser owns the
 * navigation.
 *
 * We drive the helper by:
 *   1. Installing a minimal `window` / `document` / `history` / `fetch`
 *      mock on `globalThis`.
 *   2. Evaluating the helper source via `new Function(...)` so the IIFE
 *      registers its listeners on the mock `document`.
 *   3. Dispatching synthesized click events through the registered
 *      listener and observing `preventDefault` calls.
 *
 * Sibling of `handle-link-click.test.ts` — keep test IDs aligned.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SPA_NAV_HELPER_BODY } from "../../src/client/spa-nav-helper";

// ---------------------------------------------------------------------------
// Minimal DOM mock
// ---------------------------------------------------------------------------

type ClickListener = (ev: Record<string, unknown>) => void;

interface MockWindow {
  location: URL;
  history: {
    pushState: (state: unknown, title: string, url?: string) => void;
    replaceState: (state: unknown, title: string, url?: string) => void;
  };
  scrollTo: (x: number, y: number) => void;
  addEventListener: (type: string, listener: EventListener) => void;
  dispatchEvent?: (ev: unknown) => boolean;
  __MANDU_ROUTER_STATE__?: unknown;
  __MANDU_SPA_HELPER__?: number;
  CustomEvent?: typeof CustomEvent;
  DOMParser?: typeof DOMParser;
}

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalHistory = globalThis.history;
const originalFetch = globalThis.fetch;

let clickListeners: ClickListener[] = [];
let fetchHits = 0;

function installMock(opts: {
  routerStateInstalled?: boolean;
  origin?: string;
} = {}): void {
  const origin = opts.origin ?? "http://localhost";
  const location = new URL("/", origin);
  clickListeners = [];
  fetchHits = 0;

  const doc: Record<string, unknown> = {
    addEventListener: (type: string, listener: EventListener) => {
      if (type === "click") clickListeners.push(listener as unknown as ClickListener);
    },
    removeEventListener: () => {},
    head: {},
    body: { innerHTML: "" },
    title: "",
    startViewTransition: undefined,
    querySelector: () => null,
  };

  const win: Partial<MockWindow> & Record<string, unknown> = {
    location,
    history: {
      pushState(_s: unknown, _t: string, url?: string | null) {
        if (url) location.href = new URL(String(url), origin).href;
      },
      replaceState() {},
    },
    scrollTo: () => {},
    addEventListener: () => {},
    dispatchEvent: () => true,
    CustomEvent: globalThis.CustomEvent,
    DOMParser: globalThis.DOMParser,
  };
  if (opts.routerStateInstalled) {
    win.__MANDU_ROUTER_STATE__ = { currentRoute: { id: "x" } };
  }

  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).history = win.history;
  globalThis.fetch = (async () => {
    fetchHits += 1;
    return new Response(
      "<html><head><title>t</title></head><body><p>ok</p></body></html>",
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }) as unknown as typeof fetch;
}

function runHelper(): void {
  // `new Function` creates a function in the outer (non-module) scope so
  // references to `window` / `document` pick up our globals. The IIFE
  // installs its click listener on `document.addEventListener`, which we
  // captured into `clickListeners`.
  new Function(SPA_NAV_HELPER_BODY)();
}

function makeAnchor(attrs: Record<string, string | undefined>): unknown {
  const store: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) store[k] = v;
  }
  return {
    getAttribute(name: string): string | null {
      return Object.prototype.hasOwnProperty.call(store, name) ? store[name] : null;
    },
    hasAttribute(name: string): boolean {
      return Object.prototype.hasOwnProperty.call(store, name);
    },
    closest(selector: string): unknown {
      return selector === "a" ? this : null;
    },
  };
}

interface ClickInit {
  anchor: unknown;
  button?: number;
  metaKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
}

function makeClick(init: ClickInit): Record<string, unknown> {
  let prevented = !!init.defaultPrevented;
  return {
    target: init.anchor,
    button: init.button ?? 0,
    metaKey: !!init.metaKey,
    altKey: !!init.altKey,
    ctrlKey: !!init.ctrlKey,
    shiftKey: !!init.shiftKey,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    },
  };
}

function dispatch(click: Record<string, unknown>): void {
  for (const listener of clickListeners) {
    listener(click);
  }
}

afterEach(() => {
  (globalThis as Record<string, unknown>).window = originalWindow;
  (globalThis as Record<string, unknown>).document = originalDocument;
  (globalThis as Record<string, unknown>).history = originalHistory;
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Default — plain internal anchors intercept
// ---------------------------------------------------------------------------

describe("SPA_NAV_HELPER — default intercepts", () => {
  beforeEach(() => {
    installMock();
    runHelper();
  });

  it("intercepts a plain same-origin anchor", () => {
    const ev = makeClick({ anchor: makeAnchor({ href: "/about" }) });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("intercepts absolute same-origin links", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "http://localhost/docs" }),
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("intercepts query-string links", () => {
    const ev = makeClick({ anchor: makeAnchor({ href: "/search?q=mandu" }) });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("intercepts cross-page fragment links", () => {
    const ev = makeClick({ anchor: makeAnchor({ href: "/about#team" }) });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Exclusions — 10 cases that must fall through to the browser
// ---------------------------------------------------------------------------

describe("SPA_NAV_HELPER — exclusions parity with router.ts", () => {
  beforeEach(() => {
    installMock();
    runHelper();
  });

  it("[1] falls through on data-no-spa", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/about", "data-no-spa": "" }),
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[2] falls through when href is missing", () => {
    const ev = makeClick({ anchor: makeAnchor({}) });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[3] intercepts same-page fragment (#section) for issue #222 scroll handling", () => {
    // Issue #222: fragment-only links are now intercepted so the helper
    // can resolve the hash target and scrollIntoView (preserving :target
    // CSS pseudo). Previously the helper bailed out and the browser
    // scrolled — both paths land on the anchor, but interception lets us
    // ship a single consistent scroll-restoration path across the codebase.
    const ev = makeClick({ anchor: makeAnchor({ href: "#section" }) });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
    // Same-page hash MUST NOT trigger a fetch (no body swap).
    expect(fetchHits).toBe(0);
  });

  it("[4] falls through for mailto:", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "mailto:hello@example.com" }),
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[4b] falls through for tel:", () => {
    const ev = makeClick({ anchor: makeAnchor({ href: "tel:+15551234567" }) });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[4c] falls through for javascript: pseudo-URLs", () => {
    const ev = makeClick({ anchor: makeAnchor({ href: "javascript:void(0)" }) });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[5] falls through for target=_blank / _top / _parent", () => {
    for (const target of ["_blank", "_top", "_parent"]) {
      const ev = makeClick({
        anchor: makeAnchor({ href: "/about", target }),
      });
      dispatch(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
  });

  it("[5b] INTERCEPTS target=_self (explicit same-frame)", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/about", target: "_self" }),
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("[6] falls through when download attribute is present", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/report.pdf", download: "" }),
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[7] falls through on Ctrl+click", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/about" }),
      ctrlKey: true,
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[7b] falls through on Cmd+click (macOS)", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/about" }),
      metaKey: true,
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[7c] falls through on Shift+click", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/about" }),
      shiftKey: true,
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[7d] falls through on Alt+click", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/about" }),
      altKey: true,
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[8] falls through on middle-click (button=1)", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/about" }),
      button: 1,
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[8b] falls through on right-click (button=2)", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/about" }),
      button: 2,
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[9] falls through for cross-origin links", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "https://example.com/docs" }),
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("[10] falls through when a prior listener called preventDefault", () => {
    const ev = makeClick({
      anchor: makeAnchor({ href: "/about" }),
      defaultPrevented: true,
    });
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Co-existence with the full router
// ---------------------------------------------------------------------------

describe("SPA_NAV_HELPER — full router co-existence", () => {
  it("bails out when __MANDU_ROUTER_STATE__ is already installed", () => {
    installMock({ routerStateInstalled: true });
    runHelper();
    const ev = makeClick({ anchor: makeAnchor({ href: "/about" }) });
    dispatch(ev);
    // Full router will handle — helper must NOT preventDefault.
    expect(ev.defaultPrevented).toBe(false);
  });

  it("installs __MANDU_SPA_HELPER__ marker on window", () => {
    installMock();
    runHelper();
    const w = (globalThis as Record<string, unknown>).window as MockWindow;
    expect(w.__MANDU_SPA_HELPER__).toBe(1);
  });
});
