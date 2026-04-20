/**
 * Issue #222 — SPA-nav helper hash-anchor preservation tests.
 *
 * Regression coverage for the fix that replaces the unconditional
 * `window.scrollTo(0,0)` after a body swap with a hash-aware scroll:
 *
 *   1. target with <a href="/docs#intro"> → swaps body, then
 *      scrollIntoView on the #intro element
 *   2. target with <a href="/docs#missing"> (no such id) → swaps body,
 *      then falls back to scrollTo(0,0) and logs a [mandu-spa-nav]
 *      debug line explaining the fallback
 *   3. target with <a href="/docs"> (no hash) → swaps body, then
 *      scrollTo(0,0) — unchanged legacy behavior
 *   4. same-page hash nav <a href="#intro"> (pathname unchanged) →
 *      MUST NOT fetch / swap — pushState + scrollIntoView only
 *   5. same-page hash with missing target → pushState + scrollTo(0,0)
 *   6. CSS.escape handles ids with punctuation ("foo.bar" etc)
 *   7. CSS.escape missing (older browser) → regex fallback still
 *      escapes the attribute selector enough to avoid a SyntaxError
 *   8. pushState preserves the hash — the URL the history layer sees
 *      ends with #intro
 *   9. [name="..."] fallback resolves anchors that use the legacy
 *      <a name> pattern
 *
 * Mock strategy mirrors `spa-nav-body-swap.test.ts` (no JSDOM dep) —
 * we keep the two files separate to isolate Wave #220 and #222 cases.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { SPA_NAV_HELPER_BODY } from "../../src/client/spa-nav-helper";

// ---------------------------------------------------------------------------
// Mock element with scrollIntoView spy
// ---------------------------------------------------------------------------

interface ScrollIntoViewCall {
  args: unknown;
}

interface HashTargetEl {
  id: string;
  scrollIntoViewCalls: ScrollIntoViewCall[];
  scrollIntoView: (arg?: unknown) => void;
}

function makeHashTarget(id: string): HashTargetEl {
  const calls: ScrollIntoViewCall[] = [];
  return {
    id,
    scrollIntoViewCalls: calls,
    scrollIntoView(arg?: unknown) {
      calls.push({ args: arg });
    },
  };
}

// ---------------------------------------------------------------------------
// Install shared mocks (fetch + DOMParser + document + window)
// ---------------------------------------------------------------------------

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalHistory = globalThis.history;
const originalFetch = globalThis.fetch;
const originalDOMParser = (globalThis as Record<string, unknown>).DOMParser;
const originalCSS = (globalThis as Record<string, unknown>).CSS;

type ClickListener = (ev: Record<string, unknown>) => void;

interface InstalledState {
  clickListeners: ClickListener[];
  warnLog: string[];
  debugLog: string[];
  scrollToCalls: Array<{ x: number; y: number }>;
  pushStateHistory: string[];
  replaceStateHistory: string[];
  hardNavTo: string | null;
  fetchHits: number;
  dispatched: Array<{ type: string; detail: unknown }>;
  locState: {
    href: string;
    origin: string;
    pathname: string;
    search: string;
    hash: string;
    protocol: string;
  };
  getElementByIdHits: string[];
  querySelectorHits: string[];
}

let state: InstalledState;

interface InstallOpts {
  initialPathname?: string;
  initialSearch?: string;
  initialHash?: string;
  hashTargets?: Record<string, HashTargetEl>;
  nameTargets?: Record<string, HashTargetEl>;
  cssEscapeAvailable?: boolean;
  fetchImpl?: typeof fetch;
  /** Synthetic stub — the parsed document returned by DOMParser. */
  incomingDocMainInner?: string;
}

function installMock(opts: InstallOpts = {}): void {
  state = {
    clickListeners: [],
    warnLog: [],
    debugLog: [],
    scrollToCalls: [],
    pushStateHistory: [],
    replaceStateHistory: [],
    hardNavTo: null,
    fetchHits: 0,
    dispatched: [],
    locState: {
      href: `http://localhost${opts.initialPathname ?? "/"}${opts.initialSearch ?? ""}${opts.initialHash ?? ""}`,
      origin: "http://localhost",
      pathname: opts.initialPathname ?? "/",
      search: opts.initialSearch ?? "",
      hash: opts.initialHash ?? "",
      protocol: "http:",
    },
    getElementByIdHits: [],
    querySelectorHits: [],
  };

  const captured = state;
  const location = {
    get href() {
      return captured.locState.href;
    },
    set href(v: string) {
      captured.hardNavTo = v;
    },
    get origin() {
      return captured.locState.origin;
    },
    get pathname() {
      return captured.locState.pathname;
    },
    get search() {
      return captured.locState.search;
    },
    get hash() {
      return captured.locState.hash;
    },
    set hash(v: string) {
      captured.locState.hash = v;
      captured.locState.href = `${captured.locState.origin}${captured.locState.pathname}${captured.locState.search}${v}`;
    },
    get protocol() {
      return captured.locState.protocol;
    },
  };

  const mainEl = { innerHTML: "", tagName: "MAIN" } as Record<string, unknown>;
  const bodyEl = { innerHTML: "", tagName: "BODY" } as Record<string, unknown>;
  const headEl = { appendChild: () => undefined, querySelectorAll: (): unknown[] => [] } as Record<string, unknown>;

  const hashTargets = opts.hashTargets ?? {};
  const nameTargets = opts.nameTargets ?? {};

  const doc: Record<string, unknown> = {
    addEventListener: (type: string, listener: EventListener) => {
      if (type === "click") captured.clickListeners.push(listener as unknown as ClickListener);
    },
    removeEventListener: () => {},
    documentElement: {},
    head: headEl,
    body: bodyEl,
    title: "",
    querySelector: (sel: string) => {
      captured.querySelectorHits.push(sel);
      if (sel === "main") return mainEl;
      // [name="xyz"] fallback
      const m = sel.match(/^\[name="(.+)"\]$/);
      if (m) {
        // The helper CSS-escapes the hash before building the selector, so
        // strip backslashes the helper injected to recover the raw id.
        const rawName = m[1].replace(/\\(.)/g, "$1");
        return nameTargets[rawName] ?? null;
      }
      return null;
    },
    getElementById: (id: string) => {
      captured.getElementByIdHits.push(id);
      return hashTargets[id] ?? null;
    },
    createElement: () => ({ setAttribute: () => undefined, appendChild: () => undefined }),
    startViewTransition: undefined,
  };

  const win: Record<string, unknown> = {
    location,
    history: {
      pushState(_s: unknown, _t: string, url?: string | null) {
        if (url != null) captured.pushStateHistory.push(String(url));
      },
      replaceState(_s: unknown, _t: string, url?: string | null) {
        if (url != null) captured.replaceStateHistory.push(String(url));
      },
    },
    scrollTo: (x: number, y: number) => {
      captured.scrollToCalls.push({ x, y });
    },
    addEventListener: () => {},
    dispatchEvent: (ev: { type: string; detail?: unknown }) => {
      captured.dispatched.push({ type: ev.type, detail: ev.detail });
      return true;
    },
    CustomEvent: class {
      type: string;
      detail: unknown;
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  };

  // Provide / omit CSS.escape globally.
  if (opts.cssEscapeAvailable === false) {
    (globalThis as Record<string, unknown>).CSS = undefined;
  } else {
    (globalThis as Record<string, unknown>).CSS = { escape: (s: string) => String(s).replace(/([^a-zA-Z0-9_-])/g, "\\$1") };
  }

  // DOMParser — returns a synthetic document shape compatible with
  // pickContainer (it needs <main> + body). We emit a minimal structure
  // that the helper's pickContainer() resolves to "main".
  class MockDOMParser {
    parseFromString(): Record<string, unknown> {
      const parsedMain: Record<string, unknown> = { innerHTML: opts.incomingDocMainInner ?? "<h1>new</h1>", tagName: "MAIN" };
      const parsedBody: Record<string, unknown> = { innerHTML: "", tagName: "BODY" };
      const parsedHead: Record<string, unknown> = { querySelectorAll: (): unknown[] => [], appendChild: () => undefined };
      const parsedDoc: Record<string, unknown> = {
        head: parsedHead,
        body: parsedBody,
        querySelector: (sel: string) => {
          if (sel === "main") return parsedMain;
          if (sel === "title") return null;
          if (sel === "parsererror") return null;
          return null;
        },
        getElementById: () => null,
      };
      return parsedDoc;
    }
  }
  (globalThis as Record<string, unknown>).DOMParser = MockDOMParser;

  (globalThis as Record<string, unknown>).window = win;
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).history = win.history;
  globalThis.fetch =
    opts.fetchImpl ??
    ((async () => {
      captured.fetchHits += 1;
      return new Response("<html><body><main><h1>hi</h1></main></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch);

  // Route console.warn / console.debug into our collector.
  const origWarn = console.warn;
  const origDebug = console.debug;
  console.warn = (msg: string) => {
    captured.warnLog.push(String(msg));
  };
  console.debug = (msg: string) => {
    captured.debugLog.push(String(msg));
  };
  (globalThis as Record<string, unknown>).__origWarn = origWarn;
  (globalThis as Record<string, unknown>).__origDebug = origDebug;
}

function runHelper(): void {
  new Function(SPA_NAV_HELPER_BODY)();
}

function makeAnchor(href: string): unknown {
  return {
    getAttribute(name: string): string | null {
      return name === "href" ? href : null;
    },
    hasAttribute(): boolean {
      return false;
    },
    closest(sel: string): unknown {
      return sel === "a" ? this : null;
    },
  };
}

function makeClick(anchor: unknown): Record<string, unknown> {
  let prevented = false;
  return {
    target: anchor,
    button: 0,
    metaKey: false,
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault() {
      prevented = true;
    },
  };
}

async function click(href: string): Promise<Record<string, unknown>> {
  const ev = makeClick(makeAnchor(href));
  for (const l of state.clickListeners) l(ev);
  // Let fetch + microtasks settle.
  await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 5));
  return ev;
}

afterEach(() => {
  (globalThis as Record<string, unknown>).window = originalWindow;
  (globalThis as Record<string, unknown>).document = originalDocument;
  (globalThis as Record<string, unknown>).history = originalHistory;
  globalThis.fetch = originalFetch;
  (globalThis as Record<string, unknown>).DOMParser = originalDOMParser;
  (globalThis as Record<string, unknown>).CSS = originalCSS;
  const w = (globalThis as Record<string, unknown>).__origWarn as typeof console.warn | undefined;
  const d = (globalThis as Record<string, unknown>).__origDebug as typeof console.debug | undefined;
  if (w) console.warn = w;
  if (d) console.debug = d;
});

// ---------------------------------------------------------------------------
// 1. Cross-page nav with hash → scrollIntoView on the target element
// ---------------------------------------------------------------------------

describe("SPA_NAV_HELPER — hash anchor preservation (issue #222)", () => {
  it("1. /docs#intro swaps body and scrolls to <h1 id=\"intro\">", async () => {
    const intro = makeHashTarget("intro");
    installMock({
      initialPathname: "/",
      hashTargets: { intro },
    });
    runHelper();
    const ev = await click("/docs#intro");
    expect(ev.defaultPrevented).toBe(true);
    expect(state.hardNavTo).toBeNull();
    expect(intro.scrollIntoViewCalls.length).toBe(1);
    expect((intro.scrollIntoViewCalls[0].args as { block?: string })?.block).toBe("start");
    // Legacy scrollTo(0,0) MUST NOT fire when we found the anchor.
    expect(state.scrollToCalls.length).toBe(0);
    // location.hash is pushed so :target CSS pseudo fires.
    expect(state.locState.hash).toBe("#intro");
  });

  it("2. /docs#missing (no such id, no [name]) → fallback scrollTo(0,0) + debug log", async () => {
    installMock({
      initialPathname: "/",
      hashTargets: {}, // nothing
    });
    runHelper();
    await click("/docs#missing");
    expect(state.hardNavTo).toBeNull();
    expect(state.scrollToCalls).toEqual([{ x: 0, y: 0 }]);
    expect(state.debugLog.some((m) => m.includes("hash target #missing not found"))).toBe(true);
  });

  it("3. /docs (no hash) → swaps body + scrollTo(0,0) (legacy path preserved)", async () => {
    installMock({ initialPathname: "/" });
    runHelper();
    await click("/docs");
    expect(state.scrollToCalls).toEqual([{ x: 0, y: 0 }]);
  });

  it("4. same-page #intro → pushState + scrollIntoView, no fetch, no body swap", async () => {
    const intro = makeHashTarget("intro");
    installMock({
      initialPathname: "/docs",
      hashTargets: { intro },
    });
    runHelper();
    const ev = await click("#intro");
    expect(ev.defaultPrevented).toBe(true);
    // No fetch fired.
    expect(state.fetchHits).toBe(0);
    expect(intro.scrollIntoViewCalls.length).toBe(1);
    // pushState receives the full path+hash.
    expect(state.pushStateHistory.length).toBe(1);
    expect(state.pushStateHistory[0]).toContain("#intro");
  });

  it("5. same-page #ghost (missing target) → pushState + scrollTo(0,0) fallback", async () => {
    installMock({
      initialPathname: "/docs",
      hashTargets: {},
    });
    runHelper();
    await click("#ghost");
    expect(state.pushStateHistory.length).toBe(1);
    expect(state.scrollToCalls).toEqual([{ x: 0, y: 0 }]);
    expect(state.fetchHits).toBe(0);
  });

  it("6. CSS.escape handles ids with punctuation (foo.bar) via [name=] fallback", async () => {
    // No getElementById match — the helper then falls back to a
    // [name="<escaped>"] query. The mock strips CSS-escape backslashes
    // to recover the raw name; we verify the raw name round-trips.
    const target = makeHashTarget("foo.bar");
    installMock({
      initialPathname: "/",
      hashTargets: {},
      nameTargets: { "foo.bar": target },
    });
    runHelper();
    await click("/docs#foo.bar");
    expect(target.scrollIntoViewCalls.length).toBe(1);
    // Selector must have been built (indicates [name=] path fired).
    expect(state.querySelectorHits.some((s) => s.startsWith("[name="))).toBe(true);
  });

  it("7. CSS.escape missing (older browser) → regex fallback still runs without throwing", async () => {
    const target = makeHashTarget("plain");
    installMock({
      initialPathname: "/",
      hashTargets: {},
      nameTargets: { plain: target },
      cssEscapeAvailable: false,
    });
    runHelper();
    await click("/docs#plain");
    // Either via getElementById (found nothing) then [name=] succeeded.
    expect(target.scrollIntoViewCalls.length).toBe(1);
    expect(state.hardNavTo).toBeNull();
  });

  it("8. cross-page hash is preserved through pushState (URL ends with #intro)", async () => {
    const intro = makeHashTarget("intro");
    installMock({
      initialPathname: "/",
      hashTargets: { intro },
    });
    runHelper();
    await click("/docs#intro");
    // One pushState for the cross-page fetch.
    expect(state.pushStateHistory.length).toBeGreaterThanOrEqual(1);
    expect(state.pushStateHistory[0]).toBe("/docs#intro");
  });

  it("9. [name] legacy anchor (<a name='intro'/>) resolves when no id match", async () => {
    const intro = makeHashTarget("intro"); // we reuse the stub
    installMock({
      initialPathname: "/",
      hashTargets: {}, // no #intro id
      nameTargets: { intro },
    });
    runHelper();
    await click("/docs#intro");
    expect(intro.scrollIntoViewCalls.length).toBe(1);
    expect(state.scrollToCalls.length).toBe(0);
  });
});
