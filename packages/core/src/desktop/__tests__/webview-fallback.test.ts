/**
 * Phase 11 C / M-02 — FFI fallback unit tests.
 *
 * Scope:
 *   1. The module imports cleanly even when the webview-bun peer and the
 *      libwebview shared library are BOTH absent. Phase 9 released the
 *      barrel as importable under these conditions; Phase 11 C preserves
 *      that invariant for the fallback.
 *   2. `_ffiSymbols` shape is frozen — matches the upstream C ABI we
 *      pinned in `webview-fallback.ts` header.
 *   3. `_mapHintToInt` mirrors the upstream `WEBVIEW_HINT_*` enum.
 *   4. `_getLibraryCandidates()` probes the three expected slots
 *      (env var → package-relative mirror → system default).
 *   5. `createFallbackWebview` rejects bad options BEFORE any `dlopen`
 *      attempt, so a CI without libwebview still passes.
 *   6. `loadFFILibwebview` failure yields a user-actionable error
 *      message enumerating every probed path.
 *   7. (opt-in E2E) On a machine with libwebview installed, a real
 *      window can be created via the fallback. Gated by
 *      `MANDU_DESKTOP_FALLBACK_E2E=1`.
 *
 * These tests deliberately exercise the FFI contract WITHOUT actually
 * dlopening the library — CI cannot assume libwebview is installed. The
 * opt-in block (test 7) is only active under an explicit env flag.
 *
 * References:
 *   docs/bun/phase-9-diagnostics/webview-bun-ffi.md §8 (fallback design)
 *   packages/core/src/desktop/webview-fallback.ts
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "bun:test";

describe("@mandujs/core/desktop/webview-fallback — module import", () => {
  it("imports without loading libwebview", async () => {
    // The import itself must succeed even when `bun:ffi.dlopen` would
    // fail (no libwebview). Module-level code must not `dlopen` — that
    // happens only on `createFallbackWebview()`.
    const mod = await import("../webview-fallback");
    expect(typeof mod.createFallbackWebview).toBe("function");
    expect(typeof mod.loadFFILibwebview).toBe("function");
    expect(typeof mod._mapHintToInt).toBe("function");
    expect(typeof mod._getLibraryCandidates).toBe("function");
    expect(typeof mod._defaultLibName).toBe("function");
    expect(typeof mod._resetFFICache).toBe("function");
  });

  it("module import is idempotent — cache loader does not fire on import", async () => {
    // Import twice; neither call should throw. If `import.meta.url`-based
    // candidate probing has a side effect, that would manifest on the
    // second call.
    const a = await import("../webview-fallback");
    const b = await import("../webview-fallback");
    expect(a).toBe(b); // same module instance from Bun's ESM cache
  });
});

describe("@mandujs/core/desktop/webview-fallback — FFI symbol contract", () => {
  it("_ffiSymbols declares the minimal webview C ABI we depend on", async () => {
    const { _ffiSymbols } = await import("../webview-fallback");
    // The set of symbols MUST match the upstream webview.h surface we
    // pinned in Phase 11 C. Test the shape, not the exact order.
    const expected = [
      "webview_create",
      "webview_navigate",
      "webview_set_title",
      "webview_set_size",
      "webview_set_html",
      "webview_run",
      "webview_terminate",
      "webview_destroy",
    ];
    for (const sym of expected) {
      expect(_ffiSymbols).toHaveProperty(sym);
      const entry = (_ffiSymbols as Record<string, { args: unknown; returns: unknown }>)[sym];
      expect(Array.isArray(entry.args)).toBe(true);
      expect(typeof entry.returns).toBe("string");
    }
  });

  it("_ffiSymbols is frozen — no mutation allowed at runtime", async () => {
    const { _ffiSymbols } = await import("../webview-fallback");
    expect(Object.isFrozen(_ffiSymbols)).toBe(true);
  });

  it("webview_create returns a pointer and takes (i32, ptr)", async () => {
    const { _ffiSymbols } = await import("../webview-fallback");
    expect(_ffiSymbols.webview_create.args).toEqual(["i32", "ptr"]);
    expect(_ffiSymbols.webview_create.returns).toBe("ptr");
  });

  it("webview_set_size has 4 args matching (ptr,i32,i32,i32)", async () => {
    const { _ffiSymbols } = await import("../webview-fallback");
    expect(_ffiSymbols.webview_set_size.args).toEqual([
      "ptr",
      "i32",
      "i32",
      "i32",
    ]);
  });
});

describe("@mandujs/core/desktop/webview-fallback — _mapHintToInt", () => {
  it("matches WEBVIEW_HINT_* enum values from upstream webview.h", async () => {
    const { _mapHintToInt } = await import("../webview-fallback");
    expect(_mapHintToInt("none")).toBe(0);
    expect(_mapHintToInt("min")).toBe(1);
    expect(_mapHintToInt("max")).toBe(2);
    expect(_mapHintToInt("fixed")).toBe(3);
    expect(_mapHintToInt(undefined)).toBe(0);
  });
});

describe("@mandujs/core/desktop/webview-fallback — library candidate probe", () => {
  const ORIGINAL_ENV = process.env.MANDU_LIBWEBVIEW_PATH;

  beforeEach(() => {
    delete process.env.MANDU_LIBWEBVIEW_PATH;
  });

  afterEach(() => {
    if (ORIGINAL_ENV !== undefined) {
      process.env.MANDU_LIBWEBVIEW_PATH = ORIGINAL_ENV;
    } else {
      delete process.env.MANDU_LIBWEBVIEW_PATH;
    }
  });

  it("_getLibraryCandidates includes the system default when no env is set", async () => {
    const { _getLibraryCandidates, _defaultLibName } = await import(
      "../webview-fallback"
    );
    const candidates = _getLibraryCandidates();
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    // Last candidate is always the bare lib name.
    expect(candidates[candidates.length - 1]).toBe(_defaultLibName());
  });

  it("_getLibraryCandidates prepends MANDU_LIBWEBVIEW_PATH when set", async () => {
    process.env.MANDU_LIBWEBVIEW_PATH = "/opt/custom/libwebview.so";
    const { _getLibraryCandidates } = await import("../webview-fallback");
    const candidates = _getLibraryCandidates();
    expect(candidates[0]).toBe("/opt/custom/libwebview.so");
  });

  it("_defaultLibName maps to platform extension", async () => {
    const { _defaultLibName } = await import("../webview-fallback");
    const name = _defaultLibName();
    if (process.platform === "win32") expect(name).toBe("libwebview.dll");
    else if (process.platform === "darwin")
      expect(name).toBe("libwebview.dylib");
    else expect(name).toBe("libwebview.so");
  });
});

describe("@mandujs/core/desktop/webview-fallback — createFallbackWebview", () => {
  it("rejects missing options before any dlopen attempt", async () => {
    const { createFallbackWebview } = await import("../webview-fallback");
    // An empty-object options bag must be caught by defensive guards
    // BEFORE we touch the FFI peer — so this test passes on CI without
    // libwebview.
    await expect(
      createFallbackWebview({} as never),
    ).rejects.toThrow(TypeError);
  });

  it("rejects non-string url before any dlopen attempt", async () => {
    const { createFallbackWebview } = await import("../webview-fallback");
    await expect(
      createFallbackWebview({ url: 42 as unknown as string }),
    ).rejects.toThrow(TypeError);
  });

  it("rejects empty url before any dlopen attempt", async () => {
    const { createFallbackWebview } = await import("../webview-fallback");
    await expect(
      createFallbackWebview({ url: "" }),
    ).rejects.toThrow(TypeError);
  });
});

describe("@mandujs/core/desktop/webview-fallback — loadFFILibwebview failure surface", () => {
  const ORIGINAL_ENV = process.env.MANDU_LIBWEBVIEW_PATH;

  beforeEach(async () => {
    // Force an unreachable path so the loader's failure hint is
    // exercised without depending on the actual libwebview install
    // state of the CI runner.
    process.env.MANDU_LIBWEBVIEW_PATH =
      "/path/that/definitely/does/not/exist/libwebview.so";
    const mod = await import("../webview-fallback");
    mod._resetFFICache();
  });

  afterEach(async () => {
    if (ORIGINAL_ENV !== undefined) {
      process.env.MANDU_LIBWEBVIEW_PATH = ORIGINAL_ENV;
    } else {
      delete process.env.MANDU_LIBWEBVIEW_PATH;
    }
    const mod = await import("../webview-fallback");
    mod._resetFFICache();
  });

  it("throws an actionable error enumerating every probed path", async () => {
    const { loadFFILibwebview } = await import("../webview-fallback");
    try {
      await loadFFILibwebview();
      throw new Error("unreachable — loadFFILibwebview should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const msg = (err as Error).message;
      // Actionable hints — install options + env var hint.
      expect(msg).toContain("libwebview");
      expect(msg).toContain("MANDU_LIBWEBVIEW_PATH");
      expect(msg).toContain("webview/webview");
      // Should enumerate the failing candidate we injected.
      expect(msg).toContain("libwebview.so");
    }
  });
});

// ─── Opt-in E2E (real window) ──────────────────────────────────────────────
//
// Runs ONLY when MANDU_DESKTOP_FALLBACK_E2E=1 AND platform supports it.
// CI skips this block unconditionally.

const canOpenFallbackWindow =
  process.env.MANDU_DESKTOP_FALLBACK_E2E === "1" &&
  (process.platform === "win32" ||
    process.platform === "darwin" ||
    process.platform === "linux");

describe.skipIf(!canOpenFallbackWindow)(
  "@mandujs/core/desktop/webview-fallback — browser smoke (opt-in)",
  () => {
    it("opens a data: URL window via the FFI fallback", async () => {
      const { createFallbackWebview } = await import("../webview-fallback");
      const handle = await createFallbackWebview({
        url: "data:text/html,<h1>Mandu FFI fallback smoke</h1>",
        title: "Mandu Fallback E2E",
        width: 400,
        height: 300,
      });
      await handle.close();
      await handle.closed;
    });
  },
);
