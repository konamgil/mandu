/**
 * @mandujs/core/desktop — Worker protocol tests
 *
 * The Worker file auto-installs a global message listener on module
 * evaluation, so to test the protocol we reach for the exported
 * `_installHandler` helper and drive it with a mock message emitter and
 * a mock `createWindow` implementation. No real Worker spawn, no FFI.
 */

import { describe, it, expect } from "bun:test";
import { _installHandler } from "../worker";
import type {
  WindowHandle,
  WindowOptions,
  WorkerInbound,
  WorkerOutbound,
} from "../types";

type MessageListener = (ev: { data: WorkerInbound }) => Promise<void> | void;

/**
 * Stand in for `addEventListener('message', ...)` — retains the listener
 * and exposes a `fire()` helper so tests can synchronously drive messages.
 */
function createEmitter(): {
  listen: (cb: MessageListener) => void;
  fire: (data: WorkerInbound) => Promise<void>;
} {
  let listener: MessageListener | null = null;
  return {
    listen(cb) {
      listener = cb;
    },
    async fire(data) {
      if (!listener) throw new Error("no listener installed");
      await listener({ data });
    },
  };
}

/**
 * A fake WindowHandle we can wire up to _installHandler so we don't need a
 * real Webview. Tracks every call so tests can assert order.
 */
function createFakeHandle(options: WindowOptions): {
  handle: WindowHandle;
  calls: string[];
  closed: () => void;
} {
  const calls: string[] = [];
  calls.push(`ctor:${options.url}`);
  let resolveClosed: (() => void) | null = null;
  const closedPromise = new Promise<void>((r) => {
    resolveClosed = r;
  });
  const handle: WindowHandle = {
    async close() {
      calls.push("close");
      resolveClosed?.();
    },
    onClose(cb) {
      closedPromise.then(cb);
    },
    async eval(js) {
      calls.push(`eval:${js}`);
    },
    bind() {
      calls.push("bind");
    },
    closed: closedPromise,
    run() {
      calls.push("run");
      // Run returns synchronously in tests — no blocking.
    },
  };
  return {
    handle,
    calls,
    closed: () => resolveClosed?.(),
  };
}

describe("@mandujs/core/compat/desktop — Worker protocol", () => {
  it("handles open → ready sequence and stores handle", async () => {
    const emitter = createEmitter();
    let fake: ReturnType<typeof createFakeHandle> | null = null;
    const outbound: WorkerOutbound[] = [];

    // Install message handler with a fake createWindow.
    const installed = _installHandler(emitter.listen, async (opts) => {
      fake = createFakeHandle(opts);
      return fake.handle;
    });

    // Intercept `postMessage` on globalThis to capture outbound messages.
    const prevPost = (globalThis as { postMessage?: unknown }).postMessage;
    (globalThis as { postMessage?: unknown }).postMessage = (
      msg: WorkerOutbound,
    ) => {
      outbound.push(msg);
    };

    try {
      await emitter.fire({
        type: "open",
        options: { url: "http://127.0.0.1:3333/" },
      });

      // Give the microtask queue a chance to drain the deferred run() call.
      await new Promise((r) => setTimeout(r, 10));

      expect(fake).not.toBeNull();
      expect(fake!.calls).toContain("ctor:http://127.0.0.1:3333/");
      expect(fake!.calls).toContain("run");
      expect(outbound.some((m) => m.type === "ready")).toBe(true);
      expect(installed.getHandle()).not.toBeNull();
    } finally {
      (globalThis as { postMessage?: unknown }).postMessage = prevPost;
    }
  });

  it("rejects duplicate open messages", async () => {
    const emitter = createEmitter();
    const outbound: WorkerOutbound[] = [];

    _installHandler(emitter.listen, async (opts) =>
      createFakeHandle(opts).handle,
    );

    const prevPost = (globalThis as { postMessage?: unknown }).postMessage;
    (globalThis as { postMessage?: unknown }).postMessage = (
      msg: WorkerOutbound,
    ) => {
      outbound.push(msg);
    };

    try {
      await emitter.fire({
        type: "open",
        options: { url: "http://127.0.0.1:3333/" },
      });
      outbound.length = 0; // reset
      await emitter.fire({
        type: "open",
        options: { url: "http://127.0.0.1:3333/" },
      });
      const error = outbound.find((m) => m.type === "error");
      expect(error).toBeDefined();
      if (error && error.type === "error") {
        expect(error.message).toMatch(/already open/);
      }
    } finally {
      (globalThis as { postMessage?: unknown }).postMessage = prevPost;
    }
  });

  it("handles eval after open", async () => {
    const emitter = createEmitter();
    let fake: ReturnType<typeof createFakeHandle> | null = null;

    _installHandler(emitter.listen, async (opts) => {
      fake = createFakeHandle(opts);
      return fake.handle;
    });

    const prevPost = (globalThis as { postMessage?: unknown }).postMessage;
    (globalThis as { postMessage?: unknown }).postMessage = () => {};

    try {
      await emitter.fire({
        type: "open",
        options: { url: "http://127.0.0.1:3333/" },
      });
      await emitter.fire({
        type: "eval",
        js: "console.log('hi')",
      });
      expect(fake!.calls).toContain("eval:console.log('hi')");
    } finally {
      (globalThis as { postMessage?: unknown }).postMessage = prevPost;
    }
  });

  it("reports error when eval is received before open", async () => {
    const emitter = createEmitter();
    const outbound: WorkerOutbound[] = [];

    _installHandler(emitter.listen, async (opts) =>
      createFakeHandle(opts).handle,
    );

    const prevPost = (globalThis as { postMessage?: unknown }).postMessage;
    (globalThis as { postMessage?: unknown }).postMessage = (
      msg: WorkerOutbound,
    ) => {
      outbound.push(msg);
    };

    try {
      await emitter.fire({
        type: "eval",
        js: "console.log('early')",
      });
      const error = outbound.find((m) => m.type === "error");
      expect(error).toBeDefined();
      if (error && error.type === "error") {
        expect(error.message).toMatch(/before 'open'/);
      }
    } finally {
      (globalThis as { postMessage?: unknown }).postMessage = prevPost;
    }
  });

  it("handles close message gracefully when no window is open", async () => {
    const emitter = createEmitter();
    const outbound: WorkerOutbound[] = [];

    _installHandler(emitter.listen, async (opts) =>
      createFakeHandle(opts).handle,
    );

    const prevPost = (globalThis as { postMessage?: unknown }).postMessage;
    (globalThis as { postMessage?: unknown }).postMessage = (
      msg: WorkerOutbound,
    ) => {
      outbound.push(msg);
    };

    try {
      await emitter.fire({ type: "close" });
      // Should not throw or emit an error — close on nothing is a no-op.
      expect(outbound.filter((m) => m.type === "error").length).toBe(0);
    } finally {
      (globalThis as { postMessage?: unknown }).postMessage = prevPost;
    }
  });

  it("reports errors for unknown message types", async () => {
    const emitter = createEmitter();
    const outbound: WorkerOutbound[] = [];

    _installHandler(emitter.listen, async (opts) =>
      createFakeHandle(opts).handle,
    );

    const prevPost = (globalThis as { postMessage?: unknown }).postMessage;
    (globalThis as { postMessage?: unknown }).postMessage = (
      msg: WorkerOutbound,
    ) => {
      outbound.push(msg);
    };

    try {
      await emitter.fire({
        type: "bogus" as unknown as "open",
      } as WorkerInbound);
      const error = outbound.find((m) => m.type === "error");
      expect(error).toBeDefined();
      if (error && error.type === "error") {
        expect(error.message).toMatch(/Unknown message type/);
      }
    } finally {
      (globalThis as { postMessage?: unknown }).postMessage = prevPost;
    }
  });
});
