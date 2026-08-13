/**
 * @mandujs/core/desktop — Worker entry
 *
 * Canonical Worker body that owns a single Webview instance. Import as a
 * module URL to spawn alongside a Mandu HTTP server on the main thread:
 *
 * @example
 * ```ts
 * // main.ts  — main thread owns the Bun.serve() instance
 * import { startServer } from "@mandujs/core";
 * import manifest from "../../.mandu/manifest.json" with { type: "json" };
 *
 * const server = startServer(manifest, { port: 0, hostname: "127.0.0.1" });
 *
 * // Worker owns the Webview — its blocking `run()` never competes with
 * // `Bun.serve()` for the event loop on the main thread.
 * const worker = new Worker(
 *   new URL("@mandujs/core/compat/desktop/worker", import.meta.url),
 * );
 *
 * worker.postMessage({
 *   type: "open",
 *   options: {
 *     url: `http://127.0.0.1:${server.server.port}`,
 *     title: "Mandu Desktop",
 *     width: 1280,
 *     height: 800,
 *   },
 * });
 *
 * worker.onmessage = (ev) => {
 *   if (ev.data?.type === "closed") {
 *     server.stop();
 *     process.exit(0);
 *   }
 * };
 * ```
 *
 * Protocol — exact shapes in `./types.ts`:
 *   - Parent → Worker: `{ type: "open", options }` | `{ type: "close" }` | `{ type: "eval", js }`
 *   - Worker → Parent: `{ type: "ready" }` | `{ type: "closed" }` | `{ type: "error", message }`
 *                    | `{ type: "bind-call", name, args, seq }` — reserved for bidirectional bind bridges
 *
 * Functions (bind handlers, onReady, onClose) do NOT cross the `postMessage`
 * boundary — structured clone cannot serialize them. Authoring a Worker with
 * bound handlers requires copying this file into the app and registering
 * handlers locally inside the Worker thread.
 */

import type { WorkerInbound, WorkerOutbound } from "./types.js";
import { createWindow } from "./window.js";
import type { WindowHandle } from "./types.js";

/**
 * Safely post a message to the parent. Bun's Worker global type does not
 * export `postMessage` on `self` in all strictness modes, so we gate on it.
 *
 * @internal
 */
export function _postToParent(msg: WorkerOutbound): void {
  const gPost = (globalThis as { postMessage?: (msg: unknown) => void })
    .postMessage;
  if (typeof gPost === "function") {
    gPost(msg);
  }
}

/**
 * Install the worker message handler. Split out so tests can construct a
 * mock message-event emitter without actually spawning a Worker.
 *
 * @internal
 */
export function _installHandler(
  addListener: (
    cb: (ev: { data: WorkerInbound }) => Promise<void> | void,
  ) => void,
  createWindowImpl: typeof createWindow = createWindow,
): { getHandle: () => WindowHandle | null } {
  let handle: WindowHandle | null = null;
  let running = false;

  addListener(async (ev) => {
    const msg = ev?.data;
    if (!msg || typeof msg !== "object") return;

    try {
      switch (msg.type) {
        case "open": {
          if (handle) {
            _postToParent({
              type: "error",
              message: "Window already open — ignoring duplicate 'open'.",
            });
            return;
          }
          handle = await createWindowImpl(msg.options);
          _postToParent({ type: "ready" });

          // Block the Worker thread on `run()`. When the window closes we
          // report back and let the parent decide whether to process.exit().
          // We wrap in a microtask to unblock the postMessage pipeline; the
          // subsequent `run()` is synchronous-blocking by design.
          if (!running) {
            running = true;
            queueMicrotask(() => {
              try {
                handle!.run();
              } catch (error) {
                _postToParent({
                  type: "error",
                  message: `window.run() threw: ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                });
              } finally {
                _postToParent({ type: "closed" });
              }
            });
          }
          return;
        }

        case "close": {
          if (!handle) return;
          await handle.close();
          return;
        }

        case "eval": {
          if (!handle) {
            _postToParent({
              type: "error",
              message: "eval received before 'open'.",
            });
            return;
          }
          await handle.eval(msg.js);
          return;
        }

        default: {
          const unknownType = (msg as { type?: string }).type ?? "<missing>";
          _postToParent({
            type: "error",
            message: `Unknown message type: ${unknownType}`,
          });
        }
      }
    } catch (error) {
      _postToParent({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return {
    getHandle() {
      return handle;
    },
  };
}

// Install the handler on module evaluation — Bun Worker entries run this
// module body on spawn. We gate on `addEventListener` presence so the file
// can still be imported from a non-Worker context (tests, type-checking).
// Bun's Worker global has `addEventListener("message", ...)` but omits the
// `on`-prefixed shim; we use the standard DOM-style name.
{
  const gAdd = (globalThis as {
    addEventListener?: (
      type: string,
      listener: (ev: { data: WorkerInbound }) => void | Promise<void>,
    ) => void;
  }).addEventListener;
  if (typeof gAdd === "function") {
    _installHandler((cb) => gAdd.call(globalThis, "message", cb));
  }
}
