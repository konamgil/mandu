/**
 * @mandujs/core/desktop
 *
 * Native desktop windowing for Mandu apps via `webview-bun` (optional peer).
 * Phase 9c — see `docs/bun/phase-9-diagnostics/webview-bun-ffi.md`.
 *
 * Supported backends (from the peer):
 *   - Windows: WebView2 (Chromium Evergreen; 10/11)
 *   - macOS:   WKWebView (11+)
 *   - Linux:   WebKitGTK 6 + GTK 4
 *
 * `webview-bun` is declared as an **optional peer dependency** — Mandu's core
 * runtime continues to work on web-only projects that never install it.
 * Importing this module is safe in any environment; loading only occurs the
 * first time `createWindow()` is called, at which point a missing peer throws
 * with an actionable install message.
 *
 * @example Minimal desktop entry
 * ```ts
 * import { startServer } from "@mandujs/core";
 * import { createWindow } from "@mandujs/core/compat/desktop/index";
 * import manifest from "../../.mandu/manifest.json" with { type: "json" };
 *
 * const server = startServer(manifest, { port: 0, hostname: "127.0.0.1" });
 * const win = await createWindow({
 *   url: `http://127.0.0.1:${server.server.port}`,
 *   title: "My App",
 *   width: 1280,
 *   height: 800,
 * });
 * win.run();  // blocking; returns on user close
 * server.stop();
 * ```
 */

export { createWindow } from "./window.js";
export type {
  WindowHandle,
  WindowOptions,
  WindowSizeHint,
  WorkerInbound,
  WorkerOutbound,
} from "./types.js";
