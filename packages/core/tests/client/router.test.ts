import { afterEach, describe, expect, it } from "bun:test";
import {
  getActionData,
  getRouterState,
  navigate,
  setShouldRevalidate,
  submitAction,
} from "../../src/client/router";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalHistory = globalThis.history;
const originalFetch = globalThis.fetch;

type MockRoute = {
  id: string;
  pattern: string;
  params: Record<string, string>;
};

function installMockBrowser(
  initialHref: string,
  route: MockRoute = {
    id: "posts",
    pattern: "/posts/:id",
    params: { id: "1" },
  },
) {
  const location = new URL(initialHref);
  const windowObject: any = {
    location,
    scrollTo() {},
    addEventListener() {},
    removeEventListener() {},
    __MANDU_DATA__: {},
    __MANDU_ROUTE__: route,
    __MANDU_ROUTER_STATE__: {
      currentRoute: route,
      loaderData: { items: ["before"] },
      actionData: { stale: true },
      navigation: { state: "idle" },
    },
    __MANDU_ROUTER_LISTENERS__: new Set(),
  };

  const historyObject = {
    pushState(_state: unknown, _title: string, url?: string | URL | null) {
      if (url) {
        location.href = new URL(String(url), location.origin).href;
      }
    },
    replaceState(_state: unknown, _title: string, url?: string | URL | null) {
      if (url) {
        location.href = new URL(String(url), location.origin).href;
      }
    },
  };

  windowObject.history = historyObject;
  (globalThis as any).window = windowObject;
  (globalThis as any).document = {};
  (globalThis as any).history = historyObject;
}

afterEach(() => {
  setShouldRevalidate(null);
  (globalThis as any).window = originalWindow;
  (globalThis as any).document = originalDocument;
  (globalThis as any).history = originalHistory;
  globalThis.fetch = originalFetch;
});

describe("client router", () => {
  it("keeps loader data but updates route state when shouldRevalidate returns false", async () => {
    installMockBrowser("http://localhost/posts/1");
    let fetchCalled = false;
    globalThis.fetch = ((async () => {
      fetchCalled = true;
      return Response.json({});
    }) as unknown) as typeof fetch;

    setShouldRevalidate(() => false);
    await navigate("/posts/2?tab=summary", { scroll: false });

    expect(fetchCalled).toBe(false);
    expect(getRouterState().currentRoute).toEqual({
      id: "posts",
      pattern: "/posts/:id",
      params: { id: "2" },
    });
    expect(getRouterState().loaderData).toEqual({ items: ["before"] });
    expect(getRouterState().actionData).toBeUndefined();
    expect(globalThis.window.location.href).toBe("http://localhost/posts/2?tab=summary");
  });

  it("extracts catch-all params when revalidation is skipped", async () => {
    installMockBrowser("http://localhost/docs/guide/intro", {
      id: "docs",
      pattern: "/docs/:slug*",
      params: { slug: "guide/intro" },
    });
    let fetchCalled = false;
    globalThis.fetch = ((async () => {
      fetchCalled = true;
      return Response.json({});
    }) as unknown) as typeof fetch;

    setShouldRevalidate(() => false);
    await navigate("/docs/advanced/hooks", { scroll: false });

    expect(fetchCalled).toBe(false);
    expect(getRouterState().currentRoute).toEqual({
      id: "docs",
      pattern: "/docs/:slug*",
      params: { slug: "advanced/hooks" },
    });
  });

  it("extracts empty optional catch-all params on base-path navigation", async () => {
    installMockBrowser("http://localhost/docs/guide/intro", {
      id: "docs",
      pattern: "/docs/:slug*?",
      params: { slug: "guide/intro" },
    });
    let fetchCalled = false;
    globalThis.fetch = ((async () => {
      fetchCalled = true;
      return Response.json({});
    }) as unknown) as typeof fetch;

    setShouldRevalidate(() => false);
    await navigate("/docs", { scroll: false });

    expect(fetchCalled).toBe(false);
    expect(getRouterState().currentRoute).toEqual({
      id: "docs",
      pattern: "/docs/:slug*?",
      params: { slug: "" },
    });
  });

  it("issue #253 — first click is not lost when startViewTransition aborts before its callback runs", async () => {
    installMockBrowser("http://localhost/posts/1");
    globalThis.fetch = ((async () =>
      Response.json({
        routeId: "posts",
        pattern: "/posts/:id",
        params: { id: "2" },
        loaderData: { items: ["after"] },
      })) as unknown) as typeof fetch;

    // Install a startViewTransition that mimics the spec's abort path:
    // the callback is NEVER called, and `updateCallbackDone` rejects
    // with InvalidStateError. Pre-#253 fix this would leave the URL
    // and router state untouched (the click "vanishes").
    let callbackInvoked = false;
    (globalThis as unknown as { document: { startViewTransition: unknown } }).document = {
      startViewTransition: (cb: () => void) => {
        // Track whether the framework chose to call the callback
        // itself as a fallback. The spec-compliant browser would NOT
        // call cb here; we leave it to the rejection path.
        return {
          updateCallbackDone: Promise.reject(
            new DOMException("Transition was aborted because of invalid state", "InvalidStateError"),
          ).catch(() => {
            // Mirror the spec: the framework's `.catch` handler
            // becomes the fallback that runs the callback.
            if (!callbackInvoked) {
              callbackInvoked = true;
              cb();
            }
            throw new DOMException("aborted", "InvalidStateError");
          }),
          ready: Promise.reject(new DOMException("aborted", "InvalidStateError")),
          finished: Promise.reject(new DOMException("aborted", "InvalidStateError")),
        };
      },
    };

    await navigate("/posts/2", { scroll: false });
    // Give the rejection-driven `safeApply()` a microtask to settle.
    await Promise.resolve();
    await Promise.resolve();

    // Despite the transition aborting, the navigation completed.
    expect(globalThis.window.location.href).toBe("http://localhost/posts/2");
    expect(getRouterState().currentRoute).toEqual({
      id: "posts",
      pattern: "/posts/:id",
      params: { id: "2" },
    });
  });

  it("stores the action payload instead of the transport envelope", async () => {
    installMockBrowser("http://localhost/posts/1");
    globalThis.fetch = ((async () =>
      Response.json({
        _revalidated: true,
        actionData: { created: true },
        loaderData: { items: ["after"] },
      })) as unknown) as typeof fetch;

    const result = await submitAction("http://localhost/api/posts", { title: "hello" }, "create");

    expect(result.ok).toBe(true);
    expect(result.actionData).toEqual({ created: true });
    expect(getActionData<{ created: boolean }>()).toEqual({ created: true });
    expect(getRouterState().loaderData).toEqual({ items: ["after"] });
  });
});
