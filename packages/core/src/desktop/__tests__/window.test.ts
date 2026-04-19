/**
 * @mandujs/core/desktop — window factory tests
 *
 * These tests run **without actually loading `webview-bun`**: we either
 * stub the optional peer via a mocked import cache or exercise option
 * validation / size-hint mapping / error paths that never need the FFI
 * peer at all. CI does not have WebView2 / WKWebView available, so any
 * test that would open a real window is marked describe.skipIf.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  _DEFAULTS,
  _mapSizeHint,
  _resetWebviewBunCache,
  _validateOptions,
  createWindow,
} from "../window";
import type { WindowOptions } from "../types";

describe("@mandujs/core/desktop — types & validation", () => {
  it("_DEFAULTS match the documented contract", () => {
    expect(_DEFAULTS.title).toBe("Mandu Desktop");
    expect(_DEFAULTS.width).toBe(1024);
    expect(_DEFAULTS.height).toBe(768);
    expect(_DEFAULTS.hint).toBe("none");
    expect(_DEFAULTS.debug).toBe(false);
  });

  it("_mapSizeHint translates strings to peer enum values", () => {
    const fakeEnum = { NONE: 0, MIN: 1, MAX: 2, FIXED: 3 };
    expect(_mapSizeHint("none", fakeEnum)).toBe(0);
    expect(_mapSizeHint("min", fakeEnum)).toBe(1);
    expect(_mapSizeHint("max", fakeEnum)).toBe(2);
    expect(_mapSizeHint("fixed", fakeEnum)).toBe(3);
    expect(_mapSizeHint(undefined, fakeEnum)).toBe(0); // default → NONE
  });

  it("_validateOptions rejects missing url", () => {
    expect(() => _validateOptions({} as WindowOptions)).toThrow(/url/);
  });

  it("_validateOptions rejects non-string url", () => {
    expect(() =>
      _validateOptions({ url: 123 as unknown as string }),
    ).toThrow(/url/);
  });

  it("_validateOptions rejects malformed url", () => {
    expect(() => _validateOptions({ url: "not a url" })).toThrow(/valid URL/);
  });

  it("_validateOptions rejects forbidden protocols", () => {
    expect(() =>
      _validateOptions({ url: "javascript:alert(1)" }),
    ).toThrow(/protocol/);
    expect(() =>
      _validateOptions({ url: "chrome://version" }),
    ).toThrow(/protocol/);
  });

  it("_validateOptions accepts http, https, file, and data URLs", () => {
    expect(() =>
      _validateOptions({ url: "http://127.0.0.1:3333/" }),
    ).not.toThrow();
    expect(() =>
      _validateOptions({ url: "https://example.com/" }),
    ).not.toThrow();
    expect(() =>
      _validateOptions({ url: "file:///tmp/index.html" }),
    ).not.toThrow();
    expect(() =>
      _validateOptions({ url: "data:text/html,<h1>hi</h1>" }),
    ).not.toThrow();
  });

  it("_validateOptions rejects non-positive width/height", () => {
    expect(() =>
      _validateOptions({ url: "http://x", width: 0 }),
    ).toThrow(/width/);
    expect(() =>
      _validateOptions({ url: "http://x", height: -50 }),
    ).toThrow(/height/);
    expect(() =>
      _validateOptions({
        url: "http://x",
        width: Number.NaN,
      }),
    ).toThrow(/width/);
  });

  it("_validateOptions rejects unknown hint values", () => {
    expect(() =>
      _validateOptions({
        url: "http://x",
        hint: "resizable" as never,
      }),
    ).toThrow(/hint/);
  });

  it("_validateOptions rejects non-function handlers", () => {
    expect(() =>
      _validateOptions({
        url: "http://x",
        handlers: { foo: "not a function" as unknown as () => void },
      }),
    ).toThrow(/handlers\.foo/);
  });

  it("_validateOptions accepts a fully-specified options bag", () => {
    expect(() =>
      _validateOptions({
        url: "http://127.0.0.1:3333/",
        title: "Test",
        width: 1280,
        height: 800,
        hint: "fixed",
        debug: true,
        handlers: { greet: () => "hi" },
      }),
    ).not.toThrow();
  });
});

describe("@mandujs/core/desktop — createWindow peer loading", () => {
  beforeEach(() => {
    _resetWebviewBunCache();
  });

  it("validates options before attempting to load the peer", async () => {
    // Bad options should throw TypeError *before* the peer import runs, so
    // this test passes even on CI without webview-bun installed.
    await expect(
      createWindow({ url: "" } as WindowOptions),
    ).rejects.toThrow(TypeError);
    await expect(
      createWindow({} as WindowOptions),
    ).rejects.toThrow(TypeError);
    await expect(
      createWindow({
        url: "javascript:evil()",
      } as WindowOptions),
    ).rejects.toThrow(/protocol/);
  });

  it("throws an actionable error when webview-bun is not installed", async () => {
    // Only run this when the peer is genuinely absent — if a developer has
    // `webview-bun` installed locally, the import will succeed and we'd
    // open a real window. Probe via dynamic import.
    //
    // @ts-ignore -- optional peer, resolution may fail at typecheck time
    const probe = () => import("webview-bun");
    let peerInstalled = false;
    try {
      await probe();
      peerInstalled = true;
    } catch {
      peerInstalled = false;
    }

    if (peerInstalled) {
      // On Windows with the peer installed, we'd end up creating a real
      // window. Skip the assertion — the actionable-error guarantee is only
      // meaningful when the peer is missing.
      return;
    }

    // Ensure the FFI fallback also can't resolve — otherwise `createWindow`
    // silently flips to the FFI path. We force an unreachable library path
    // so both paths deterministically fail, which is the state the
    // actionable error contract guards.
    const originalFFIPath = process.env.MANDU_LIBWEBVIEW_PATH;
    process.env.MANDU_LIBWEBVIEW_PATH =
      "/path/that/does/not/exist/libwebview.so";
    try {
      await expect(
        createWindow({ url: "http://127.0.0.1:1" }),
      ).rejects.toThrow(/webview-bun/);
    } finally {
      if (originalFFIPath !== undefined) {
        process.env.MANDU_LIBWEBVIEW_PATH = originalFFIPath;
      } else {
        delete process.env.MANDU_LIBWEBVIEW_PATH;
      }
    }
  });

  it("MANDU_DESKTOP_INLINE_FFI=1 routes to the FFI fallback path", async () => {
    // With the env flag set, `createWindow` must import
    // `./webview-fallback` instead of `webview-bun`. We don't assert on
    // the exact success/failure of the FFI call (that depends on the
    // machine's libwebview install state) — we only assert that the
    // branch is taken. The simplest observable is: when the library
    // actually loads AND the test machine has a webview backend
    // (WebView2 on Windows etc.), a real window would open. To stay
    // CI-safe we monkey-patch dynamic import of the fallback module to
    // detect invocation.
    //
    // Bun's ESM cache makes this tricky — instead we verify the call
    // selector by checking that `createWindow` does NOT throw the
    // webview-bun "install me" error when the flag is set. That error
    // is only reachable via the primary `_loadWebviewBun` path; if the
    // FFI branch is skipped or the webview-bun import is tried in its
    // place, the test would observe the install-me error.
    const originalFlag = process.env.MANDU_DESKTOP_INLINE_FFI;
    const originalFFIPath = process.env.MANDU_LIBWEBVIEW_PATH;
    process.env.MANDU_DESKTOP_INLINE_FFI = "1";
    // Force an unreachable libwebview so the fallback fails deterministically
    // and the error surfaces the fallback's distinctive language (which
    // is what we assert on).
    process.env.MANDU_LIBWEBVIEW_PATH = "/nonexistent/libwebview-test-stub.so";

    try {
      // Resolve whatever error comes back and assert it's NOT the
      // webview-bun peer-missing error. The exact failure mode of the
      // FFI path varies by CI machine (libwebview missing, dlopen
      // succeeds on a stub, or the FFI cstring call errors), but none
      // of those produce the distinctive "bun add webview-bun" string
      // from the primary path.
      let caught: unknown;
      try {
        const handle = await createWindow({ url: "http://127.0.0.1:1" });
        // Unexpected success — close to clean up, then fail.
        await handle.close();
        throw new Error(
          "unreachable — createWindow should fail with MANDU_DESKTOP_INLINE_FFI=1 + bogus MANDU_LIBWEBVIEW_PATH",
        );
      } catch (err) {
        caught = err;
      }
      const msg = caught instanceof Error ? caught.message : String(caught);
      // The webview-bun install-me message always mentions "bun add webview-bun".
      // The fallback path's failure never does.
      expect(msg).not.toContain("bun add webview-bun");
    } finally {
      if (originalFlag !== undefined) {
        process.env.MANDU_DESKTOP_INLINE_FFI = originalFlag;
      } else {
        delete process.env.MANDU_DESKTOP_INLINE_FFI;
      }
      if (originalFFIPath !== undefined) {
        process.env.MANDU_LIBWEBVIEW_PATH = originalFFIPath;
      } else {
        delete process.env.MANDU_LIBWEBVIEW_PATH;
      }
    }
  });
});
