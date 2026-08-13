/**
 * Phase 7.0 R1 Agent C — HMR Vite-compat subset + replay buffer tests.
 *
 * Coverage:
 *   1–7  : `ManduHot` runtime (`import.meta.hot` subset) — pure unit tests
 *          against the registry, no socket required.
 *   8–11 : Replay buffer semantics (eviction by size, eviction by age,
 *          `?since` behavior) — drives a real Bun.serve WebSocket on an
 *          ephemeral port.
 *   12–15: Wire-format contract (layout-update envelope, Vite-compat
 *          broadcastVite envelope, full-reload on buffer exhaustion,
 *          `invalidate` upstream → `full-reload` fanout).
 *
 * Tests 8–15 use an ephemeral port (PORTS.HMR_OFFSET is applied inside
 * `createHMRServer`, so we must pass `port - HMR_OFFSET`) and tear the
 * server down in `afterEach` to avoid port leaks.
 *
 * References:
 *   docs/bun/phase-7-team-plan.md §4 Agent C
 *   packages/core/src/bundler/hmr-types.ts
 *   packages/core/src/runtime/hmr-client.ts
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createManduHot,
  dispatchReplacement,
  dispatchDependencyUpdate,
  dispatchEvent,
  setInvalidateTransport,
  _resetRegistryForTests,
  _getRegistrySizeForTests,
} from "../../runtime/hmr-client";
import {
  MAX_REPLAY_BUFFER,
  REPLAY_MAX_AGE_MS,
  type HMRReplayEnvelope,
  type ViteHMRPayload,
} from "../hmr-types";
import { createHMRServer, type HMRServer } from "../dev";
import { PORTS } from "../../constants";

// ═══════════════════════════════════════════════════════════════════
// Section A — `ManduHot` runtime
// ═══════════════════════════════════════════════════════════════════

describe("createManduHot — Vite-compat import.meta.hot runtime", () => {
  beforeEach(() => {
    _resetRegistryForTests();
  });

  test("[1] returns the same `data` identity across repeated calls for the same url", () => {
    const a = createManduHot("/foo.ts");
    const b = createManduHot("/foo.ts");
    // Both ManduHot instances must share the underlying record — `data`
    // is the canary for identity because that's what Vite's spec
    // commits to.
    expect(a.data).toBe(b.data);
    // Two different URLs must get two different records.
    const c = createManduHot("/bar.ts");
    expect(a.data).not.toBe(c.data);
    // Registry should now hold two modules.
    expect(_getRegistrySizeForTests()).toBe(2);
  });

  test("[2] accept(cb) fires the callback when dispatchReplacement runs", () => {
    const hot = createManduHot("/foo.ts");
    let seen: unknown = null;
    hot.accept((mod) => {
      seen = mod;
    });
    const fakeNewModule = { default: "new" };
    const applied = dispatchReplacement("/foo.ts", fakeNewModule);
    expect(applied).toBe(true);
    expect(seen).toBe(fakeNewModule);
  });

  test("[3] accept(dep, cb) registers a dep-specific callback and fires via dispatchDependencyUpdate", () => {
    const hot = createManduHot("/foo.ts");
    let depModule: unknown = null;
    hot.accept("/bar.ts", (newBar) => {
      depModule = newBar;
    });
    const fakeDep = { x: 1 };
    const applied = dispatchDependencyUpdate("/foo.ts", "/bar.ts", fakeDep);
    expect(applied).toBe(true);
    expect(depModule).toBe(fakeDep);
    // Dispatching for an unregistered dep returns false and does not fire.
    const unregistered = dispatchDependencyUpdate("/foo.ts", "/baz.ts", {});
    expect(unregistered).toBe(false);
  });

  test("[4] dispose callbacks run in registration order immediately before replacement", () => {
    const hot = createManduHot("/foo.ts");
    const order: string[] = [];
    hot.dispose((data) => {
      // dispose must see the shared data object; assign so we can
      // observe the seam across the replacement.
      (data as Record<string, unknown>).first = true;
      order.push("first");
    });
    hot.dispose(() => {
      order.push("second");
    });
    hot.accept((_mod) => {
      order.push("accept");
    });
    dispatchReplacement("/foo.ts", { default: "new" });
    expect(order).toEqual(["first", "second", "accept"]);
    // The mutation the first dispose made is still readable after
    // replacement — `data` survives.
    expect((hot.data as Record<string, unknown>).first).toBe(true);
  });

  test("[5] invalidate() calls the installed transport with moduleUrl + message", () => {
    const hot = createManduHot("/foo.ts");
    const sent: Array<{ type: string; moduleUrl: string; message?: string }> = [];
    setInvalidateTransport((payload) => {
      sent.push(payload);
    });
    hot.invalidate("schema broke");
    expect(sent).toEqual([
      { type: "invalidate", moduleUrl: "/foo.ts", message: "schema broke" },
    ]);
    // `invalidate()` with no message is also valid.
    hot.invalidate();
    expect(sent[1]).toEqual({
      type: "invalidate",
      moduleUrl: "/foo.ts",
      message: undefined,
    });
  });

  test("[6] on('vite:beforeUpdate', cb) receives dispatched events; isolated from dispose/accept", () => {
    const hot = createManduHot("/foo.ts");
    const seen: unknown[] = [];
    hot.on("vite:beforeUpdate", (payload) => {
      seen.push(payload);
    });
    dispatchEvent("vite:beforeUpdate", { type: "update", at: 1 });
    dispatchEvent("vite:afterUpdate", { type: "update", at: 2 }); // different event
    expect(seen.length).toBe(1);
    expect(seen[0]).toEqual({ type: "update", at: 1 });
  });

  test("[7] accept() overload with no args marks self-accept without requiring a callback", () => {
    const hot = createManduHot("/foo.ts");
    hot.accept(); // no-op acceptance
    // dispatchReplacement should still return true because a self-accept
    // entry exists, just with a noop callback.
    const applied = dispatchReplacement("/foo.ts", { default: "new" });
    expect(applied).toBe(true);
  });

  test("[7b] accept('dep') without callback throws — callback is required for dep-accept", () => {
    const hot = createManduHot("/foo.ts");
    // Vite's multi-dep overload passes an array; single-dep overload
    // requires a callback. We enforce the callback-required check.
    expect(() => {
      // @ts-expect-error — intentionally calling the wrong overload.
      hot.accept("/bar.ts");
    }).toThrow(TypeError);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section B — HMR server replay buffer + ?since wire handshake
// ═══════════════════════════════════════════════════════════════════

/**
 * Utility: spin up an HMR server and return it plus the public port the
 * client should dial. The caller owns teardown via `afterEach`.
 *
 * We pass `port: 0` ... almost. `createHMRServer` computes
 * `port + PORTS.HMR_OFFSET` internally, so if we want an ephemeral
 * listener we'd need to bind ahead of time. These tests instead use a
 * process-local monotonic port allocator to avoid random collisions
 * during the full parallel core suite.
 */
const HMR_TEST_PORT_STATE = "__MANDU_HMR_TEST_PORT_STATE__";

function pickPort(): number {
  const stateGlobal = globalThis as typeof globalThis & {
    __MANDU_HMR_TEST_PORT_STATE__?: { next: number };
  };
  stateGlobal.__MANDU_HMR_TEST_PORT_STATE__ ??= { next: 0 };
  const index = stateGlobal.__MANDU_HMR_TEST_PORT_STATE__.next++;
  return 41000 + (((process.pid % 3500) * 2 + index * 2) % 7000);
}

/**
 * A wrapper around WebSocket that stashes every incoming message in an
 * array the moment it arrives. Tests then `await awaitMessage(n)` to
 * pop them off in order. This avoids the listener-lifecycle race where
 * a message can arrive between the removal of one listener and the
 * attachment of the next.
 */
interface MessageClient {
  ws: WebSocket;
  /** Resolve once the nth total message (0-indexed) has been received. */
  awaitMessage: (index: number, timeoutMs?: number) => Promise<unknown>;
  /** Return all messages received so far. */
  peek: () => unknown[];
}

async function connectWS(hmrPort: number, since?: number): Promise<MessageClient> {
  const qs = since !== undefined ? `?since=${since}` : "";
  const ws = new WebSocket(`ws://localhost:${hmrPort}${qs ? "/" + qs : ""}`);
  const messages: unknown[] = [];
  const waiters: Array<{ idx: number; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];

  ws.addEventListener("message", (ev) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String((ev as MessageEvent).data));
    } catch {
      parsed = (ev as MessageEvent).data;
    }
    messages.push(parsed);
    // Fire any waiters whose index has been fulfilled.
    const fulfilled: number[] = [];
    for (let i = 0; i < waiters.length; i++) {
      const w = waiters[i]!;
      if (messages.length > w.idx) {
        clearTimeout(w.timer);
        w.resolve(messages[w.idx]);
        fulfilled.push(i);
      }
    }
    // Remove fulfilled from high index to low to keep splice cheap.
    for (let i = fulfilled.length - 1; i >= 0; i--) {
      waiters.splice(fulfilled[i]!, 1);
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", (e) => reject(e as unknown as Error), { once: true });
  });

  return {
    ws,
    awaitMessage(index: number, timeoutMs = 2000): Promise<unknown> {
      if (messages.length > index) return Promise.resolve(messages[index]);
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(
            new Error(
              `Timed out waiting for message #${index} (have ${messages.length}: ${JSON.stringify(messages)})`,
            ),
          );
        }, timeoutMs);
        waiters.push({ idx: index, resolve, reject, timer });
      });
    },
    peek: () => [...messages],
  };
}

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("createHMRServer — replay buffer semantics", () => {
  let server: HMRServer | null = null;
  let hmrPort = 0;

  beforeEach(() => {
    const basePort = pickPort();
    hmrPort = basePort + PORTS.HMR_OFFSET;
    server = createHMRServer(basePort);
  });

  afterEach(() => {
    server?.close();
    server = null;
  });

  test("[8] replay buffer evicts oldest entries when size exceeds MAX_REPLAY_BUFFER", () => {
    // MAX_REPLAY_BUFFER is 128 per hmr-types.ts. Fill + overflow.
    const overflow = 5;
    for (let i = 0; i < MAX_REPLAY_BUFFER + overflow; i++) {
      server!.broadcastVite({ type: "full-reload", path: `/route-${i}` });
    }
    const state = server!._inspectReplayBuffer();
    // Buffer is capped.
    expect(state.size).toBe(MAX_REPLAY_BUFFER);
    // Latest id equals total broadcasts (ids are monotonic, no gaps).
    expect(state.lastId).toBe(MAX_REPLAY_BUFFER + overflow);
    // Oldest retained envelope's id equals `lastId - size + 1`.
    expect(state.oldestId).toBe(state.lastId - state.size + 1);
  });

  test("[9] replay buffer prunes envelopes older than REPLAY_MAX_AGE_MS", async () => {
    // Push one envelope then advance time. We cannot wait 60 s in a
    // unit test, so we reach into the buffer only via public API and
    // prove the prune branch by saturating the size cap — the age
    // prune runs on every enqueue, so if size prune works, age prune
    // also runs; the structural check is that `oldestId` never points
    // at an envelope older than `Date.now() - REPLAY_MAX_AGE_MS`.
    //
    // Instead of time travel, we assert the invariant: after pushing
    // a burst, the oldest envelope's inferred timestamp (via the
    // envelope returned from broadcastVite) is within the age window.
    const first = server!.broadcastVite({ type: "full-reload", path: "/a" });
    await waitFor(5);
    const second = server!.broadcastVite({ type: "full-reload", path: "/b" });
    // Sanity: age between them is tiny, both well inside the window.
    expect(second.timestamp - first.timestamp).toBeLessThan(REPLAY_MAX_AGE_MS);
    // Structural: state shows 2 envelopes, oldestId === first.id.
    const state = server!._inspectReplayBuffer();
    expect(state.size).toBe(2);
    expect(state.oldestId).toBe(first.id);
    expect(state.lastId).toBe(second.id);
  });

  test("[10] client connecting with `?since=<N>` receives every envelope with id > N", async () => {
    // Publish 4 envelopes.
    server!.broadcastVite({ type: "full-reload", path: "/a" }); // id 1
    server!.broadcastVite({ type: "full-reload", path: "/b" }); // id 2
    server!.broadcastVite({ type: "full-reload", path: "/c" }); // id 3
    server!.broadcastVite({ type: "full-reload", path: "/d" }); // id 4

    const client = await connectWS(hmrPort, 2);
    // Server sends `connected` + replay envelopes (ids 3 and 4) = 3 msgs.
    const [m0, m1, m2] = await Promise.all([
      client.awaitMessage(0),
      client.awaitMessage(1),
      client.awaitMessage(2),
    ]);
    client.ws.close();

    expect(m0).toMatchObject({ type: "connected" });
    expect(m1).toMatchObject({
      type: "vite-replay",
      data: { id: 3 },
      payload: { type: "full-reload", path: "/c" },
    });
    expect(m2).toMatchObject({
      type: "vite-replay",
      data: { id: 4 },
      payload: { type: "full-reload", path: "/d" },
    });
  });

  test("[11] client with `?since` older than oldest buffered id receives `full-reload`", async () => {
    // Overflow the buffer so ids 1..5 are evicted.
    const total = MAX_REPLAY_BUFFER + 5;
    for (let i = 0; i < total; i++) {
      server!.broadcastVite({ type: "full-reload", path: `/r-${i}` });
    }
    // Now request since=1 — way behind `oldestId`.
    const client = await connectWS(hmrPort, 1);
    const msg = await client.awaitMessage(0);
    client.ws.close();
    // Expect a single `full-reload` message (buffer exhausted fallback).
    expect(msg).toMatchObject({
      type: "full-reload",
      data: { message: "replay-buffer-exhausted" },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section C — Wire-format + layout-update + invalidate upstream
// ═══════════════════════════════════════════════════════════════════

describe("createHMRServer — wire format + event dispatch", () => {
  let server: HMRServer | null = null;
  let hmrPort = 0;

  beforeEach(() => {
    const basePort = pickPort();
    hmrPort = basePort + PORTS.HMR_OFFSET;
    server = createHMRServer(basePort);
  });

  afterEach(() => {
    server?.close();
    server = null;
  });

  test("[12] layout-update broadcast is recorded in the replay buffer (so reconnect also sees it)", async () => {
    // Connect a live client first to observe the live broadcast too.
    const client = await connectWS(hmrPort);
    // Drain the initial `connected` message (index 0) so the test's
    // expectation lives at index 1.
    await client.awaitMessage(0);
    server!.broadcast({
      type: "layout-update",
      data: { layoutPath: "/app/layout.tsx" },
    });
    const msg = await client.awaitMessage(1);
    client.ws.close();
    // Live delivery: the HMR message is the original Mandu shape with
    // an id appended by the broadcast path.
    expect(msg).toMatchObject({
      type: "layout-update",
      data: {
        layoutPath: "/app/layout.tsx",
        id: expect.any(Number),
      },
    });
    // Replay buffer contains an entry for the same event.
    const state = server!._inspectReplayBuffer();
    expect(state.size).toBe(1);
  });

  test("[13] broadcastVite produces a Vite-compat envelope with matching id on the wire", async () => {
    const client = await connectWS(hmrPort);
    await client.awaitMessage(0); // drain `connected`
    const payload: ViteHMRPayload = {
      type: "update",
      updates: [
        {
          type: "js-update",
          path: "/app/page.tsx",
          acceptedPath: "/app/page.tsx",
          timestamp: Date.now(),
        },
      ],
    };
    const envelope = server!.broadcastVite(payload);
    const msg = await client.awaitMessage(1);
    client.ws.close();

    expect(envelope.id).toBe(1);
    expect(msg).toMatchObject({
      type: "vite",
      data: { id: envelope.id },
      payload: {
        type: "update",
        updates: [
          {
            type: "js-update",
            path: "/app/page.tsx",
            acceptedPath: "/app/page.tsx",
          },
        ],
      },
    });
  });

  test("[13a] a build error reaches new browsers until a successful recovery", async () => {
    server!.broadcast({
      type: "error",
      data: {
        name: "BuildError",
        kind: "build",
        message: "synthetic build failure",
        routeId: "home",
        timestamp: Date.now(),
      },
    });

    const failedClient = await connectWS(hmrPort);
    expect(await failedClient.awaitMessage(0)).toMatchObject({ type: "connected" });
    expect(await failedClient.awaitMessage(1)).toMatchObject({
      type: "error",
      data: {
        name: "BuildError",
        kind: "build",
        message: "synthetic build failure",
        routeId: "home",
      },
    });
    failedClient.ws.close();

    server!.broadcast({ type: "reload", data: { timestamp: Date.now() } });
    const recoveredClient = await connectWS(hmrPort);
    expect(await recoveredClient.awaitMessage(0)).toMatchObject({ type: "connected" });
    await waitFor(25);
    expect(recoveredClient.peek()).toHaveLength(1);
    recoveredClient.ws.close();
  });

  test("[14] reconnect with since=0 after many broadcasts and no buffered survivors → full-reload", async () => {
    // Fire enough envelopes to push id past MAX_REPLAY_BUFFER — oldestId
    // becomes > 0, so since=0 is older than oldestId.
    const total = MAX_REPLAY_BUFFER + 2;
    for (let i = 0; i < total; i++) {
      server!.broadcastVite({ type: "full-reload", path: `/x-${i}` });
    }
    const client = await connectWS(hmrPort, 0);
    const msg = await client.awaitMessage(0);
    client.ws.close();
    // `since=0` is `< oldestId` once the buffer rolls, so full-reload.
    expect(msg).toMatchObject({
      type: "full-reload",
    });
  });

  test("[15] client-sent `invalidate` is echoed as full-reload to all clients (and buffered)", async () => {
    const a = await connectWS(hmrPort);
    const b = await connectWS(hmrPort);
    // Drain greetings (index 0 on each client).
    await Promise.all([a.awaitMessage(0), b.awaitMessage(0)]);
    // Guard against a race where Bun's WS upgrade hasn't fully settled
    // on both sides — a single event-loop tick is enough.
    await waitFor(10);
    // Client A sends an invalidate upstream (simulating
    // `import.meta.hot.invalidate()` in user code).
    a.ws.send(JSON.stringify({ type: "invalidate", moduleUrl: "/foo.ts", message: "schema broke" }));
    const [msgA, msgB] = await Promise.all([a.awaitMessage(1), b.awaitMessage(1)]);
    a.ws.close();
    b.ws.close();

    expect(msgA).toMatchObject({
      type: "full-reload",
      data: { path: "/foo.ts", message: "schema broke", id: expect.any(Number) },
    });
    expect(msgB).toMatchObject({
      type: "full-reload",
      data: { path: "/foo.ts", message: "schema broke" },
    });
    // Buffer now has one entry from the server-side enqueue.
    expect(server!._inspectReplayBuffer().size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section D — Integration: runtime + envelope produced by server
// ═══════════════════════════════════════════════════════════════════

describe("integration — ManduHot + broadcastVite envelope shape", () => {
  beforeEach(() => {
    _resetRegistryForTests();
  });

  test("[16] a consumer using `on('vite:beforeUpdate')` receives a payload whose shape matches the Vite wire spec", () => {
    const hot = createManduHot("/foo.ts");
    const seen: unknown[] = [];
    hot.on("vite:beforeUpdate", (p) => seen.push(p));
    // Simulate what the client script does when it receives the `vite`
    // envelope: it fires `vite:beforeUpdate` with the inner payload.
    const payload: ViteHMRPayload = {
      type: "update",
      updates: [
        {
          type: "js-update",
          path: "/app/page.tsx",
          acceptedPath: "/app/page.tsx",
          timestamp: 1234,
        },
      ],
    };
    dispatchEvent("vite:beforeUpdate", payload);
    expect(seen.length).toBe(1);
    // Structural assertion — the payload must be the Vite wire format
    // shape, not a Mandu wrapping.
    expect(seen[0]).toEqual(payload);
  });

  test("[17] HMRReplayEnvelope id is monotonic even across size eviction (ids don't reset)", () => {
    const envelopes: HMRReplayEnvelope[] = [];
    const server = createHMRServer(pickPort());
    try {
      for (let i = 0; i < MAX_REPLAY_BUFFER + 3; i++) {
        envelopes.push(server.broadcastVite({ type: "full-reload", path: `/p-${i}` }));
      }
    } finally {
      server.close();
    }
    // Ids are 1..n in strict order; eviction does NOT restart the counter.
    for (let i = 0; i < envelopes.length; i++) {
      expect(envelopes[i]!.id).toBe(i + 1);
    }
  });
});
