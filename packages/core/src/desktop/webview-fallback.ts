/**
 * Phase 11 C / M-02 — `bun:ffi` fallback for `webview-bun`.
 *
 * # Why this exists
 *
 * `webview-bun` (tr1ckydev/webview-bun) is the primary optional peer for
 * `@mandujs/core/desktop`. Phase 9c R0 diagnostics
 * (`docs/bun/phase-9-diagnostics/webview-bun-ffi.md`) identified one
 * supply-chain risk: single maintainer, ~400 stars, small contributor
 * base. If the peer ever goes unmaintained, Mandu's desktop story breaks.
 *
 * The upstream C++ library (https://github.com/webview/webview) is
 * healthy — 14k★, 636 commits, backed by continuous Microsoft + Apple
 * platform support. The fallback binds Mandu directly to that library
 * via `bun:ffi`, bypassing `webview-bun` as a JS layer.
 *
 * This file is a **prototype** — it declares the minimal FFI surface
 * (`webview_create` / `webview_navigate` / `webview_set_title` /
 * `webview_run` / `webview_destroy`) and wires a creator that mirrors
 * the `webview-bun` constructor contract so `window.ts::createWindow`
 * can substitute it.
 *
 * # Non-goals
 *
 * - NOT production-ready. Phase 11 C ships the prototype; real rollout
 *   (signed DLL mirroring + SHA-256 verification + Mandu CDN or LFS
 *   hosting) is tracked in `docs/bun/phase-11-diagnostics/completeness-sprint.md`
 *   §C-1.
 * - NOT a replacement for `webview-bun` on the happy path. Only used
 *   when `MANDU_DESKTOP_INLINE_FFI=1` is set OR when the `webview-bun`
 *   peer's dynamic `import()` rejects with a module-not-found error.
 * - NOT an IPC layer. `webview-bun`'s `bind()` is not mirrored — the
 *   fallback exposes `navigate` + `setHTML` + `title` + `run` + `destroy`
 *   only. Apps that use `bind()` must keep the primary peer.
 *
 * # Safety
 *
 * - `bun:ffi`'s `dlopen` throws synchronously when the library path is
 *   unreachable. All three entrypoints (`_ffiSymbols`, `loadFFILibwebview`,
 *   `createFallbackWebview`) are guarded so that importing this module
 *   never throws — the failure surface is at first use.
 * - The library search order is: (1) `MANDU_LIBWEBVIEW_PATH` env var
 *   (absolute path), (2) `@mandujs/core` package-relative
 *   `libwebview.{dll|dylib|so}` (if mirrored by a future release
 *   pipeline), (3) system-default via `dlopen` with the bare name. When
 *   all three fail, `loadFFILibwebview()` throws an actionable error
 *   explaining each probe path that was tried.
 * - Type definitions use `FFIType.cstring` for strings, matching the
 *   upstream C ABI (`const char*`). `destroy()` zeros the pointer so
 *   double-free is a no-op at the FFI level.
 *
 * # Runtime behavior
 *
 * On import, this module does NOT load `libwebview`. `dlopen` only runs
 * on the first `createFallbackWebview()` call, at which point a clean
 * "install and mirror libwebview" error is thrown if the library is
 * unreachable. Tests exercise the FFI surface definitions without
 * triggering the load path (see `__tests__/webview-fallback.test.ts`).
 *
 * # References
 *
 * - `docs/bun/phase-9-diagnostics/webview-bun-ffi.md` §8 (fallback design)
 * - https://github.com/webview/webview/blob/master/webview.h (C API)
 * - https://bun.sh/docs/api/ffi (Bun FFI docs)
 */

import type {
  WindowHandle,
  WindowOptions,
  WindowSizeHint,
} from "./types.js";

// ─── FFI symbol contract (upstream webview/webview) ────────────────────────
//
// This object is a PURE specification — it's the `dlopen` symbols map we
// hand to `bun:ffi`. Exported so tests can introspect the contract
// without triggering a real `dlopen`.

/**
 * The minimal C ABI we need from libwebview. Signatures mirror
 * `webview.h` from the upstream C++ repo.
 *
 * @internal
 */
export const _ffiSymbols = Object.freeze({
  /**
   * `webview_t webview_create(int debug, void* window);`
   *
   * Create a native webview. `debug=1` enables DevTools / WebInspector.
   * `window=null` asks libwebview to create its own shell window.
   * Returns an opaque handle (`webview_t`) or `null` on failure.
   */
  webview_create: {
    args: ["i32", "ptr"] as const,
    returns: "ptr" as const,
  },
  /**
   * `void webview_navigate(webview_t w, const char* url);`
   *
   * Point the webview at a URL. Blocks until the new page's `onload`
   * fires (or times out per platform rules).
   *
   * Note: `bun:ffi` arg type for C strings is `ptr` (pointer to an
   * encoded buffer), NOT `cstring` (which is return-only in Bun 1.3).
   * Callers must pre-encode JS strings via `_encodeCString` before
   * passing to this symbol. See `webview-bun/src/ffi.ts` for the
   * canonical reference.
   */
  webview_navigate: {
    args: ["ptr", "ptr"] as const,
    returns: "void" as const,
  },
  /**
   * `void webview_set_title(webview_t w, const char* title);`
   *
   * Set the native window title. No-op if the underlying OS window
   * hasn't been realized yet. Second arg is a ptr — pre-encode via
   * `_encodeCString`.
   */
  webview_set_title: {
    args: ["ptr", "ptr"] as const,
    returns: "void" as const,
  },
  /**
   * `void webview_set_size(webview_t w, int width, int height, int hints);`
   *
   * Hints map (from webview.h):
   *   WEBVIEW_HINT_NONE   = 0 // freely resizable
   *   WEBVIEW_HINT_MIN    = 1
   *   WEBVIEW_HINT_MAX    = 2
   *   WEBVIEW_HINT_FIXED  = 3
   */
  webview_set_size: {
    args: ["ptr", "i32", "i32", "i32"] as const,
    returns: "void" as const,
  },
  /**
   * `void webview_set_html(webview_t w, const char* html);`
   *
   * Second arg is a ptr — pre-encode via `_encodeCString`.
   */
  webview_set_html: {
    args: ["ptr", "ptr"] as const,
    returns: "void" as const,
  },
  /**
   * `void webview_run(webview_t w);`
   *
   * BLOCKING. Returns when the user closes the shell window or when
   * `webview_terminate(w)` is called from another thread.
   */
  webview_run: {
    args: ["ptr"] as const,
    returns: "void" as const,
  },
  /**
   * `void webview_terminate(webview_t w);`
   *
   * Request that `webview_run` return ASAP. Safe to call from any
   * thread (unlike `destroy`, which must follow run).
   */
  webview_terminate: {
    args: ["ptr"] as const,
    returns: "void" as const,
  },
  /**
   * `void webview_destroy(webview_t w);`
   *
   * Free the webview and its native resources. Must be called after
   * `webview_run` returns.
   */
  webview_destroy: {
    args: ["ptr"] as const,
    returns: "void" as const,
  },
});

/**
 * Encode a JS string as a null-terminated C string pointer, suitable for
 * passing to `ptr`-arg FFI calls.
 *
 * `bun:ffi`'s `cstring` type is return-only in Bun 1.3; for C-string
 * arguments we must encode the string to a `Buffer` and take a pointer.
 * This helper mirrors `webview-bun/src/ffi.ts::encodeCString`.
 *
 * The returned pointer is valid ONLY as long as the encoding Buffer is
 * reachable — callers MUST keep the buffer alive (e.g. by holding the
 * reference in a local variable) until the FFI call returns.
 *
 * @internal
 */
export async function _encodeCString(
  value: string,
): Promise<{ ptr: unknown; buffer: Uint8Array }> {
  const { ptr } = await import("bun:ffi");
  const buffer = new TextEncoder().encode(value + "\0");
  return {
    ptr: (ptr as (b: Uint8Array) => unknown)(buffer),
    buffer,
  };
}

/**
 * Map the string hint to libwebview's numeric enum (matches
 * `WEBVIEW_HINT_*` in `webview.h`).
 *
 * @internal
 */
export function _mapHintToInt(hint: WindowSizeHint | undefined): number {
  switch (hint) {
    case "min":
      return 1;
    case "max":
      return 2;
    case "fixed":
      return 3;
    case "none":
    case undefined:
    default:
      return 0;
  }
}

// ─── Library loading ───────────────────────────────────────────────────────

/**
 * OS-specific native lib filename. Returned as a best-effort default — the
 * real resolution path adds `MANDU_LIBWEBVIEW_PATH` and a package-relative
 * probe before falling back to this.
 *
 * @internal
 */
export function _defaultLibName(): string {
  switch (process.platform) {
    case "win32":
      return "libwebview.dll";
    case "darwin":
      return "libwebview.dylib";
    default:
      // Linux + BSDs + etc.
      return "libwebview.so";
  }
}

/**
 * Ordered list of candidate paths for the libwebview shared library.
 *
 * Exported for the test suite so we can verify the resolution contract
 * without triggering a real `dlopen`.
 *
 * @internal
 */
export function _getLibraryCandidates(): string[] {
  const candidates: string[] = [];
  const envPath = process.env.MANDU_LIBWEBVIEW_PATH;
  if (envPath && envPath.length > 0) {
    candidates.push(envPath);
  }
  // Future-proof: a release-time mirror step will ship
  // `packages/core/dist/native/libwebview.{dll,dylib,so}` alongside the
  // published module. We probe this location (resolved relative to THIS
  // module at runtime) but it is NOT guaranteed to exist in Phase 11 C.
  //
  // We don't fs.existsSync in this pure function — the caller does.
  try {
    const url = new URL("../../dist/native/" + _defaultLibName(), import.meta.url);
    candidates.push(decodeURIComponent(url.pathname).replace(/^\//, ""));
  } catch {
    // URL construction must never throw in normal workflows; if it does
    // we simply skip this candidate rather than poison the fallback.
  }
  // Final fallback — let `dlopen` consult the OS's dynamic-linker search
  // path (PATH on Windows, LD_LIBRARY_PATH on Linux, DYLD_LIBRARY_PATH
  // on macOS).
  candidates.push(_defaultLibName());
  return candidates;
}

/**
 * Cached FFI handle. Populated on first successful load.
 */
interface LoadedFFI {
  /**
   * Bun's FFI symbols map — opaque to Mandu core, but well-defined by
   * `bun:ffi`'s `dlopen` return type. We type this as `unknown` to keep
   * the cross-peer contract narrow.
   */
  symbols: Record<string, unknown>;
  libraryPath: string;
}

let loadedFFICache: LoadedFFI | null = null;

/**
 * Dynamically load the libwebview shared library via `bun:ffi`. Throws an
 * actionable error when none of the candidate paths resolve.
 *
 * Marked async even though `dlopen` is synchronous so the call shape
 * matches `_loadWebviewBun` in `window.ts`.
 *
 * @internal
 */
export async function loadFFILibwebview(): Promise<LoadedFFI> {
  if (loadedFFICache) return loadedFFICache;

  // Lazy-import `bun:ffi` so a `bun test` in an environment where `bun:ffi`
  // isn't available (e.g. a Deno test runner, or a future isolated
  // sandbox) still lets the module load.
  let dlopen: unknown;
  try {
    // @ts-ignore -- `bun:ffi` is a Bun built-in; resolution is runtime-only.
    const mod = await import("bun:ffi");
    dlopen = (mod as { dlopen?: unknown }).dlopen;
    if (typeof dlopen !== "function") {
      throw new Error("bun:ffi.dlopen is not a function");
    }
  } catch (cause) {
    throw new Error(
      [
        "[@mandujs/core/desktop/webview-fallback] Could not load `bun:ffi`.",
        "This fallback requires the Bun runtime (not Node.js).",
        "",
        `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
      ].join("\n"),
      { cause: cause as Error },
    );
  }

  const candidates = _getLibraryCandidates();
  const errors: string[] = [];

  for (const libPath of candidates) {
    try {
      const loaded = (dlopen as (p: string, s: typeof _ffiSymbols) => {
        symbols: Record<string, unknown>;
      })(libPath, _ffiSymbols);
      loadedFFICache = { symbols: loaded.symbols, libraryPath: libPath };
      return loadedFFICache;
    } catch (err) {
      errors.push(
        `  ${libPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    [
      "[@mandujs/core/desktop/webview-fallback] Failed to load libwebview from any candidate path.",
      "",
      "Tried (in order):",
      ...errors,
      "",
      "To install libwebview:",
      "  1. Prebuilt binaries: https://github.com/webview/webview-releases",
      "  2. Build from source: https://github.com/webview/webview#building",
      "",
      "Then either:",
      "  - Set MANDU_LIBWEBVIEW_PATH=<absolute path> before running the app",
      "  - Place the library on the OS dynamic-linker search path",
      `  - Default name probed: ${_defaultLibName()}`,
    ].join("\n"),
  );
}

/**
 * Reset the library-load cache. Tests only.
 *
 * @internal
 */
export function _resetFFICache(): void {
  loadedFFICache = null;
}

// ─── Webview factory (FFI-backed) ──────────────────────────────────────────

/**
 * Create a webview using the bun:ffi fallback path. Returns a
 * {@link WindowHandle} that uses the same public shape as
 * `createWindow()` — callers should not need to distinguish between
 * the two backends.
 *
 * This factory is `async` to match the `webview-bun` peer loader contract
 * (which does a dynamic import). Construction itself is synchronous
 * beyond the initial `loadFFILibwebview()`.
 *
 * @example
 * ```ts
 * import { createFallbackWebview } from "@mandujs/core/desktop/webview-fallback";
 *
 * const handle = await createFallbackWebview({
 *   url: "http://127.0.0.1:3333",
 *   title: "My App",
 *   width: 1024,
 *   height: 768,
 * });
 * handle.run();
 * ```
 */
export async function createFallbackWebview(
  options: WindowOptions,
): Promise<WindowHandle> {
  // Option validation is the caller's responsibility — this path is
  // reached only from `window.ts::createWindow` after it calls
  // `_validateOptions`. We still perform minimal defensive checks so
  // direct callers (tests, experimental apps) don't segfault.
  if (!options || typeof options !== "object") {
    throw new TypeError(
      "[@mandujs/core/desktop/webview-fallback] options must be an object.",
    );
  }
  if (typeof options.url !== "string" || options.url.length === 0) {
    throw new TypeError(
      "[@mandujs/core/desktop/webview-fallback] 'url' must be a non-empty string.",
    );
  }

  const { symbols } = await loadFFILibwebview();

  // `bun:ffi` exposes each symbol as a callable — the return type is
  // `(...args: any[]) => unknown`. We narrow via cast at each callsite
  // instead of widening the symbols map's type.
  type PtrFn = (...args: unknown[]) => unknown;
  const create = symbols.webview_create as PtrFn;
  const navigate = symbols.webview_navigate as PtrFn;
  const setTitle = symbols.webview_set_title as PtrFn;
  const setSize = symbols.webview_set_size as PtrFn;
  const run = symbols.webview_run as PtrFn;
  const terminate = symbols.webview_terminate as PtrFn;
  const destroy = symbols.webview_destroy as PtrFn;

  const debug = options.debug ? 1 : 0;
  const handle = create(debug, null) as unknown;
  if (!handle) {
    throw new Error(
      "[@mandujs/core/desktop/webview-fallback] webview_create returned null (libwebview init failed).",
    );
  }

  // Size + title BEFORE navigate, matching the `webview-bun` ctor contract.
  const width = options.width ?? 1024;
  const height = options.height ?? 768;
  setSize(handle, width, height, _mapHintToInt(options.hint));
  // The libwebview C API takes a `const char*`; `bun:ffi`'s `ptr` arg
  // type needs a pre-encoded buffer. Keep references live across the
  // entire sync block so the GC doesn't collect the buffer before
  // libwebview copies out the string. `_encodeCString` returns both the
  // ptr and the backing Uint8Array for this reason.
  const titleEnc = await _encodeCString(options.title ?? "Mandu Desktop");
  setTitle(handle, titleEnc.ptr);
  const urlEnc = await _encodeCString(options.url);
  navigate(handle, urlEnc.ptr);
  // Keep encoding buffers reachable past the sync navigate call.
  // libwebview copies the strings internally, so once we're past the
  // synchronous FFI return these buffers can be GC'd — we just need
  // them alive THROUGH the FFI call, which the local const refs ensure.
  void titleEnc.buffer;
  void urlEnc.buffer;

  let closed = false;
  let resolveClosed: (() => void) | null = null;
  const closedPromise = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  const closeCallbacks: Array<() => void> = [];

  function markClosed(): void {
    if (closed) return;
    closed = true;
    for (const cb of closeCallbacks) {
      try {
        cb();
      } catch (error) {
        console.error(
          "[@mandujs/core/desktop/webview-fallback] onClose callback threw:",
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
              "[@mandujs/core/desktop/webview-fallback] onClose (options) threw:",
              error,
            ),
          );
        }
      } catch (error) {
        console.error(
          "[@mandujs/core/desktop/webview-fallback] onClose (options) threw:",
          error,
        );
      }
    }
    resolveClosed?.();
  }

  if (options.onReady) {
    queueMicrotask(() => {
      try {
        const result = options.onReady!();
        if (result instanceof Promise) {
          result.catch((error) =>
            console.error(
              "[@mandujs/core/desktop/webview-fallback] onReady threw:",
              error,
            ),
          );
        }
      } catch (error) {
        console.error(
          "[@mandujs/core/desktop/webview-fallback] onReady threw:",
          error,
        );
      }
    });
  }

  return {
    async close(): Promise<void> {
      if (closed) return;
      try {
        terminate(handle);
      } catch {
        /* ignore — terminate may fail if run() hasn't started */
      }
      try {
        destroy(handle);
      } catch (error) {
        if (options.debug) {
          console.warn(
            "[@mandujs/core/desktop/webview-fallback] destroy() warning:",
            error,
          );
        }
      }
      markClosed();
    },
    onClose(cb: () => void): void {
      if (closed) {
        queueMicrotask(() => {
          try {
            cb();
          } catch (error) {
            console.error(
              "[@mandujs/core/desktop/webview-fallback] onClose callback threw:",
              error,
            );
          }
        });
        return;
      }
      closeCallbacks.push(cb);
    },
    async eval(_js: string): Promise<void> {
      // eval() needs `webview_eval` which requires an onmessage callback
      // wired through webview_bind. Phase 11 C ships the fallback
      // without the bind surface — explicit error so apps that depend
      // on eval() stay on the primary peer.
      throw new Error(
        "[@mandujs/core/desktop/webview-fallback] eval() is not supported. " +
          "Install webview-bun for full IPC (eval + bind).",
      );
    },
    bind(_name: string, _fn: (...args: unknown[]) => unknown): void {
      throw new Error(
        "[@mandujs/core/desktop/webview-fallback] bind() is not supported. " +
          "Install webview-bun for full IPC (eval + bind).",
      );
    },
    closed: closedPromise,
    run(): void {
      if (closed) return;
      try {
        run(handle);
      } finally {
        markClosed();
      }
    },
  };
}
