/**
 * @mandujs/core/desktop — window factory
 *
 * Wraps `webview-bun` (optional peer dependency, MIT, tr1ckydev/webview-bun
 * 2.4.0+). Phase 9c R0 diagnostic:
 *   - docs/bun/phase-9-diagnostics/webview-bun-ffi.md
 *
 * Design rules:
 *   1. **Lazy import** — `webview-bun` must NOT be loaded when this module is
 *      merely imported. A web-only project running `bun test` should pass
 *      even if the peer is absent. The import happens on the first
 *      `createWindow()` call, with a clear install-me error on failure.
 *   2. **No side-channel globals** — each handle is self-contained; multiple
 *      windows are allowed in a single process (though not a common use
 *      case).
 *   3. **Never surface the `Webview` instance** — consumers only see
 *      {@link WindowHandle}. Backend swaps (Bun.WebView native, direct FFI)
 *      stay transparent.
 *
 * Threading model: `webview-bun`'s `run()` is blocking and must be on the
 * thread that owns the window. For use with `Bun.serve()`, the standard
 * pattern is **Worker-based**: launch the server on the main thread, spawn
 * a Worker, and call `createWindow()` inside it. See `./worker.ts` for the
 * canonical entry. When `autoRun: false`, callers who control their own
 * event loop (e.g. running the window on the main thread while the HTTP
 * server sits in a Worker) can call `handle.run()` themselves.
 */

import type {
  WindowHandle,
  WindowOptions,
  WindowSizeHint,
} from "./types.js";

// ─── Optional-peer loader ───────────────────────────────────────────────────

/**
 * Cached module once loaded. We do NOT pre-load at module evaluation — if
 * `webview-bun` is missing, `import @mandujs/core/desktop` must still succeed
 * (so `bun test` in a CI without the peer passes cleanly).
 */
type WebviewBunModule = {
  // We intentionally type the imported module as `any` here because
  // `webview-bun` publishes types that depend on its FFI pointers. A tighter
  // type contract is not worth pulling the peer's type graph into `core`.
  // Consumers never see this — they work against WindowHandle.
  Webview: new (
    debug?: boolean,
    size?: { width: number; height: number; hint: number } | null,
    window?: unknown,
  ) => {
    title: string;
    size: { width: number; height: number; hint: number };
    navigate(url: string): void;
    setHTML(html: string): void;
    init(source: string): void;
    eval(source: string): void;
    bind(name: string, cb: (...args: unknown[]) => unknown): void;
    unbind(name: string): void;
    run(): void;
    destroy(): void;
  };
  SizeHint: { NONE: number; MIN: number; MAX: number; FIXED: number };
};

let webviewBunCache: WebviewBunModule | null = null;

/**
 * Lazy-load `webview-bun`. Throws with an actionable error message when the
 * peer is missing — the only surface on which end users hit this is desktop
 * launch, so we can afford a long-form hint.
 *
 * @internal
 */
export async function _loadWebviewBun(): Promise<WebviewBunModule> {
  if (webviewBunCache) return webviewBunCache;
  try {
    // Dynamic import so `bun test` in a CI without `webview-bun` installed
    // still passes. The import specifier is a bare module — no file-path
    // probing — so bundlers can tree-shake the whole desktop subtree in a
    // web-only build.
    //
    // `@ts-ignore` is used because `webview-bun` is an OPTIONAL peer — tsc
    // must not hard-fail module resolution when the peer is absent. The
    // runtime behaviour is guarded: the try/catch below rethrows a clean
    // "please install" error if the import itself rejects at runtime.
    // @ts-ignore -- optional peer, may not be resolvable at typecheck time
    const mod = (await import("webview-bun")) as unknown as WebviewBunModule;
    webviewBunCache = mod;
    return mod;
  } catch (cause) {
    throw new Error(
      [
        "[@mandujs/core/desktop] Failed to load the optional peer 'webview-bun'.",
        "Install it alongside Mandu for desktop targets:",
        "",
        "    bun add webview-bun",
        "",
        "Then pin the version in package.json. Tested: ^2.4.0 (MIT).",
        "Docs: https://github.com/tr1ckydev/webview-bun",
      ].join("\n"),
      { cause: cause as Error },
    );
  }
}

/**
 * Reset the lazy-load cache. Tests only.
 *
 * @internal
 */
export function _resetWebviewBunCache(): void {
  webviewBunCache = null;
}

// ─── Size hint mapping ──────────────────────────────────────────────────────

/**
 * Map the string hint to `webview-bun`'s `SizeHint` numeric enum. We accept
 * the string because (a) the string survives Worker `postMessage` cleanly
 * and (b) it doesn't pin our public API to the peer's enum numbering.
 *
 * @internal
 */
export function _mapSizeHint(
  hint: WindowSizeHint | undefined,
  enumRef: WebviewBunModule["SizeHint"],
): number {
  switch (hint) {
    case "fixed":
      return enumRef.FIXED;
    case "min":
      return enumRef.MIN;
    case "max":
      return enumRef.MAX;
    case "none":
    case undefined:
    default:
      return enumRef.NONE;
  }
}

// ─── Option validation ──────────────────────────────────────────────────────

/**
 * Validates `options` before we touch the FFI peer. Throws `TypeError` on
 * the first problem found.
 *
 * @internal
 */
export function _validateOptions(options: WindowOptions): void {
  if (!options || typeof options !== "object") {
    throw new TypeError(
      "[@mandujs/core/desktop] createWindow: options must be an object.",
    );
  }
  if (typeof options.url !== "string" || options.url.length === 0) {
    throw new TypeError(
      "[@mandujs/core/desktop] createWindow: 'url' must be a non-empty string.",
    );
  }
  // Accept http/https/file/data — reject everything else. Remote URLs work
  // but are actively discouraged; document that elsewhere.
  const allowedProtocols = ["http:", "https:", "file:", "data:"];
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new TypeError(
      `[@mandujs/core/desktop] createWindow: 'url' is not a valid URL: ${JSON.stringify(
        options.url,
      )}.`,
    );
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new TypeError(
      `[@mandujs/core/desktop] createWindow: 'url' protocol ${parsed.protocol} is not allowed (use http/https/file/data).`,
    );
  }
  if (options.width !== undefined) {
    if (
      typeof options.width !== "number" ||
      !Number.isFinite(options.width) ||
      options.width <= 0
    ) {
      throw new TypeError(
        "[@mandujs/core/desktop] createWindow: 'width' must be a positive finite number.",
      );
    }
  }
  if (options.height !== undefined) {
    if (
      typeof options.height !== "number" ||
      !Number.isFinite(options.height) ||
      options.height <= 0
    ) {
      throw new TypeError(
        "[@mandujs/core/desktop] createWindow: 'height' must be a positive finite number.",
      );
    }
  }
  if (
    options.hint !== undefined &&
    !["none", "min", "max", "fixed"].includes(options.hint)
  ) {
    throw new TypeError(
      `[@mandujs/core/desktop] createWindow: 'hint' must be one of none|min|max|fixed (got ${JSON.stringify(
        options.hint,
      )}).`,
    );
  }
  if (options.handlers !== undefined) {
    if (typeof options.handlers !== "object" || options.handlers === null) {
      throw new TypeError(
        "[@mandujs/core/desktop] createWindow: 'handlers' must be an object of functions.",
      );
    }
    for (const [name, fn] of Object.entries(options.handlers)) {
      if (typeof fn !== "function") {
        throw new TypeError(
          `[@mandujs/core/desktop] createWindow: handlers.${name} must be a function.`,
        );
      }
    }
  }
}

// ─── Defaults ───────────────────────────────────────────────────────────────

/** @internal */
export const _DEFAULTS: Required<Pick<WindowOptions, "title" | "width" | "height" | "hint" | "debug">> = {
  title: "Mandu Desktop",
  width: 1024,
  height: 768,
  hint: "none",
  debug: false,
};

// ─── createWindow ───────────────────────────────────────────────────────────

/**
 * Create a desktop window backed by the system WebView (WebView2 on Windows,
 * WKWebView on macOS, WebKitGTK on Linux). Optional peer `webview-bun` must
 * be installed.
 *
 * The returned {@link WindowHandle} does NOT auto-start the platform event
 * loop — callers must either call `handle.run()` (blocking) or await
 * `handle.closed`. In Worker-based setups the loop is typically started by
 * the Worker host (see `./worker.ts`).
 *
 * @example Main-thread use (window only, no HTTP server):
 * ```ts
 * import { createWindow } from "@mandujs/core/desktop";
 *
 * const win = await createWindow({
 *   url: "https://example.com",
 *   title: "Read later",
 *   width: 1200,
 *   height: 800,
 * });
 * win.run(); // blocks until user closes
 * ```
 *
 * @example With a Mandu server (Worker pattern — recommended):
 * ```ts
 * // main.ts
 * import { startServer } from "@mandujs/core";
 * import manifest from "../../.mandu/manifest.json" with { type: "json" };
 *
 * const server = startServer(manifest, { port: 0, hostname: "127.0.0.1" });
 * const worker = new Worker(new URL("./worker.ts", import.meta.url));
 * worker.postMessage({
 *   type: "open",
 *   options: { url: `http://127.0.0.1:${server.server.port}`, title: "My App" },
 * });
 * ```
 */
export async function createWindow(
  options: WindowOptions,
): Promise<WindowHandle> {
  _validateOptions(options);

  // Phase 11 C / M-02 — FFI fallback path. When `MANDU_DESKTOP_INLINE_FFI=1`
  // is set, OR when `webview-bun` dynamic import fails at runtime, we try
  // the `bun:ffi` fallback that binds directly to the upstream
  // `webview/webview` C library. The fallback is a supply-chain mitigation
  // for the webview-bun single-maintainer risk — see
  // `docs/bun/phase-9-diagnostics/webview-bun-ffi.md` §8.
  //
  // Behaviour matrix:
  //   MANDU_DESKTOP_INLINE_FFI=1:
  //     → SKIP webview-bun, go straight to FFI fallback.
  //   webview-bun resolves cleanly:
  //     → primary path (normal flow below).
  //   webview-bun rejects with a module-not-found error AND fallback
  //   succeeds: log a one-time hint, use fallback.
  //   Both fail: rethrow the webview-bun "install me" error (the original
  //   actionable hint).
  const forceFFI = process.env.MANDU_DESKTOP_INLINE_FFI === "1";
  if (forceFFI) {
    const { createFallbackWebview } = await import("./webview-fallback.js");
    return createFallbackWebview(options);
  }

  let peer: WebviewBunModule;
  try {
    peer = await _loadWebviewBun();
  } catch (primaryError) {
    // Try the fallback. If it also fails, surface the PRIMARY error since
    // it carries the actionable "bun add webview-bun" hint users expect.
    try {
      const { createFallbackWebview } = await import("./webview-fallback.js");
      return await createFallbackWebview(options);
    } catch {
      throw primaryError;
    }
  }
  const { Webview, SizeHint } = peer;

  const merged = {
    ..._DEFAULTS,
    ...options,
  };
  const hintNum = _mapSizeHint(merged.hint, SizeHint);

  // Construct the webview. `webview-bun` uses constructor args for size+hint
  // and exposes setters for title/size post-construction.
  const wv = new Webview(merged.debug, {
    width: merged.width,
    height: merged.height,
    hint: hintNum,
  });

  // Title must be set post-ctor — webview-bun API shape.
  try {
    wv.title = merged.title;
  } catch (error) {
    // Some libwebview builds throw if the window hasn't been realized yet;
    // best-effort, not fatal.
    if (merged.debug) {
      console.warn("[@mandujs/core/desktop] title set warning:", error);
    }
  }

  // Pre-register handlers BEFORE navigation so the page's first script doesn't
  // see an undefined global.
  if (options.handlers) {
    for (const [name, fn] of Object.entries(options.handlers)) {
      try {
        wv.bind(name, fn);
      } catch (error) {
        throw new Error(
          `[@mandujs/core/desktop] Failed to bind handler "${name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  // Set up closed-signal wiring. `webview-bun` does not expose a native
  // close event, so we rely on `run()` returning OR an explicit `destroy()`
  // call to flip the flag.
  let closed = false;
  let resolveClosed: (() => void) | null = null;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const closeCallbacks: Array<() => void> = [];

  function markClosed(): void {
    if (closed) return;
    closed = true;
    // Run user callbacks first so their exceptions don't prevent Promise
    // resolution. We swallow exceptions to match `setTimeout` semantics.
    for (const cb of closeCallbacks) {
      try {
        cb();
      } catch (error) {
        console.error(
          "[@mandujs/core/desktop] onClose callback threw:",
          error,
        );
      }
    }
    if (options.onClose) {
      try {
        const result = options.onClose();
        if (result instanceof Promise) {
          result.catch((error) =>
            console.error(
              "[@mandujs/core/desktop] onClose (options) threw:",
              error,
            ),
          );
        }
      } catch (error) {
        console.error(
          "[@mandujs/core/desktop] onClose (options) threw:",
          error,
        );
      }
    }
    resolveClosed?.();
  }

  // Navigate AFTER handlers are registered, so the first page load can
  // already call any bound globals.
  try {
    wv.navigate(merged.url);
  } catch (error) {
    // Navigation failure is fatal — tear down and rethrow.
    try {
      wv.destroy();
    } catch {
      /* ignore cleanup errors */
    }
    throw new Error(
      `[@mandujs/core/desktop] navigate() failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // Fire onReady on the next microtask so callers that chain `await
  // createWindow(...)` can attach listeners first.
  if (options.onReady) {
    queueMicrotask(() => {
      try {
        const result = options.onReady!();
        if (result instanceof Promise) {
          result.catch((error) =>
            console.error(
              "[@mandujs/core/desktop] onReady threw:",
              error,
            ),
          );
        }
      } catch (error) {
        console.error("[@mandujs/core/desktop] onReady threw:", error);
      }
    });
  }

  const handle: WindowHandle = {
    async close() {
      if (closed) return;
      try {
        wv.destroy();
      } catch (error) {
        // `webview-bun` #35: destroy() from a timer doesn't always interrupt
        // run(). We still mark closed so the `closed` promise resolves — the
        // native run() will exit on its own once the user closes the shell.
        if (merged.debug) {
          console.warn("[@mandujs/core/desktop] destroy() warning:", error);
        }
      }
      markClosed();
    },
    onClose(cb: () => void) {
      if (closed) {
        // Match `addEventListener('load')` semantics on a ready document —
        // fire on the next microtask so ordering is deterministic.
        queueMicrotask(() => {
          try {
            cb();
          } catch (error) {
            console.error(
              "[@mandujs/core/desktop] onClose callback threw:",
              error,
            );
          }
        });
        return;
      }
      closeCallbacks.push(cb);
    },
    async eval(js: string) {
      if (closed) {
        throw new Error(
          "[@mandujs/core/desktop] eval() called on closed window.",
        );
      }
      if (typeof js !== "string" || js.length === 0) {
        throw new TypeError(
          "[@mandujs/core/desktop] eval: 'js' must be a non-empty string.",
        );
      }
      wv.eval(js);
    },
    bind(name: string, fn: (...args: unknown[]) => unknown) {
      if (closed) {
        throw new Error(
          "[@mandujs/core/desktop] bind() called on closed window.",
        );
      }
      if (typeof name !== "string" || name.length === 0) {
        throw new TypeError(
          "[@mandujs/core/desktop] bind: 'name' must be a non-empty string.",
        );
      }
      if (typeof fn !== "function") {
        throw new TypeError(
          "[@mandujs/core/desktop] bind: 'fn' must be a function.",
        );
      }
      wv.bind(name, fn);
    },
    closed: closedPromise,
    run() {
      if (closed) {
        // No-op — already closed. `webview-bun`'s run() on a destroyed
        // instance would crash; avoid that class of footgun.
        return;
      }
      try {
        wv.run();
      } finally {
        // run() returned → the window was closed (either natively or via
        // destroy()). Flip the flag.
        markClosed();
      }
    },
  };

  return handle;
}
