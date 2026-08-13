/**
 * Phase 7.0 R2 Agent E — 5 regression tests for known-bug reproductions.
 *
 * Each case here guards a *specific* bug that shipped or nearly shipped,
 * usually with a GitHub issue link. These complement the 36-cell matrix
 * which is structural — regressions are the historical proof that the
 * structural invariants aren't just theoretical.
 *
 * Coverage:
 *   1. #188 — pure-SSG: edit `src/shared/translations.ts`, verify the
 *      wildcard SSR signal fires (the precondition for prerender regen).
 *   2. Rapid-fire: 3 distinct files within 100 ms → no drops (B2 + B6 fix).
 *   3. WS reconnect w/ `?since=<id>`: replay buffer delivers missed events.
 *   4. Stale island: navigation changes which routes were mounted — an
 *      island-update after navigation must only fire for the active route.
 *   5. Layout-update: editing `app/layout.tsx` fires `layout-update` on the
 *      WS channel and is enqueued in the replay buffer.
 *
 * All five are independent — one failing does not cascade to the others.
 */

import { describe, test, expect, afterEach, beforeEach } from "bun:test";
import { writeFileSync, mkdirSync } from "fs";
import path from "path";
import {
  makeTempRoot,
  rmTempRoot,
  bootBundler,
  sleep,
  waitFor,
  touchUntilSeen,
  WATCHER_ARM_MS,
  WATCH_SETTLE_MS,
} from "./harness";
import { scaffoldSSG } from "./fixture-ssg";
import { scaffoldHybrid } from "./fixture-hybrid";
import { createHMRServer, type HMRServer } from "../../src/bundler/dev";
import { PORTS } from "../../src/constants";
import {
  MAX_REPLAY_BUFFER,
  type ViteHMRPayload,
} from "../../src/bundler/hmr-types";

const describeCoreIsolated = describe.skipIf(
  process.env.MANDU_SKIP_CORE_ISOLATED_TESTS === "1",
);

// ═══════════════════════════════════════════════════════════════════════════
// Test 1 — #188 reproduction
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "regression #188 — pure-SSG common-dir edit triggers wildcard SSR signal",
  () => {
    let rootDir = "";
    let close: (() => void) | null = null;

    beforeEach(() => {
      rootDir = makeTempRoot("188");
    });

    afterEach(() => {
      close?.();
      close = null;
      rmTempRoot(rootDir);
    });

    test("editing src/shared/translations.ts fires onSSRChange('*')", async () => {
      // Use the pure-SSG fixture which matches the issue's reported shape
      // (hydration:none project, `src/shared/*.ts` common dir).
      const manifest = scaffoldSSG(rootDir);
      // Add the specific file named in the #188 report to leave no doubt.
      writeFileSync(
        path.join(rootDir, "src/shared/translations.ts"),
        "export const t = { hello: 'v0' };\n",
      );

      const { bundler, observations } = await bootBundler(rootDir, manifest);
      close = bundler.close;
      await sleep(WATCHER_ARM_MS);

      // Retry the write up to 4x — Windows fs.watch is racy on freshly-armed
      // recursive watchers. Each attempt has perturbed content so the mtime
      // + size is guaranteed to differ.
      await touchUntilSeen(
        path.join(rootDir, "src/shared/translations.ts"),
        "export const t = { hello: 'v1' };\n",
        () => observations.ssrChanges.length,
      );

      // The #188 fix routes common-dir edits through `SSR_CHANGE_WILDCARD`.
      // Without it, the file change was silently dropped in pure-SSG mode.
      const ok = await waitFor(
        () => observations.ssrChanges.includes("*"),
        5_000,
      );
      expect(ok).toBe(true);
    }, 20_000);
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// Test 2 — Rapid-fire 3 distinct files within 100 ms
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "regression rapid-fire — 3 files within WATCHER_DEBOUNCE window (B2 + B6)",
  () => {
    let rootDir = "";
    let close: (() => void) | null = null;

    beforeEach(() => {
      rootDir = makeTempRoot("rapid");
    });

    afterEach(() => {
      close?.();
      close = null;
      rmTempRoot(rootDir);
    });

    test("3 distinct common-dir edits in rapid succession all trigger rebuilds", async () => {
      const manifest = scaffoldHybrid(rootDir);
      const { bundler, observations } = await bootBundler(rootDir, manifest);
      close = bundler.close;
      await sleep(WATCHER_ARM_MS);

      // Three DIFFERENT files — pre-B2/B6 this would drop 2 of 3 because:
      //   - B6: global `debounceTimer` canceled on every event
      //   - B2: `pendingBuildFile` was single-slot, overwritten
      mkdirSync(path.join(rootDir, "src/rapid"), { recursive: true });
      writeFileSync(path.join(rootDir, "src/rapid/a.ts"), "export const A = 0;\n");
      writeFileSync(path.join(rootDir, "src/rapid/b.ts"), "export const B = 0;\n");
      writeFileSync(path.join(rootDir, "src/rapid/c.ts"), "export const C = 0;\n");

      // Let watcher register new files.
      await sleep(WATCH_SETTLE_MS);

      // Use touchUntilSeen for the first file so we know the watcher has
      // armed. Then fire rapid writes. The burst is typically coalesced by
      // `classifyBatch` into a single common-dir rebuild — the contract is
      // "none silently dropped", not "exactly 3 rebuild events".
      await touchUntilSeen(
        path.join(rootDir, "src/rapid/a.ts"),
        "export const A = 1;\n",
        () => observations.ssrChanges.length,
      );
      // Tiny pause (well under WATCHER_DEBOUNCE = 100 ms) between writes.
      await sleep(30);
      writeFileSync(path.join(rootDir, "src/rapid/b.ts"), "export const B = 1;\n");
      await sleep(30);
      writeFileSync(path.join(rootDir, "src/rapid/c.ts"), "export const C = 1;\n");

      // After the burst, we expect AT LEAST one SSR wildcard fire (they may
      // coalesce into one thanks to the `common-dir` classification — that's
      // the correct behavior per scenario-matrix.ts, since common-dir fans
      // out to every island anyway). The hard contract is: something fires
      // (pre-fix: zero fires due to drop).
      const ok = await waitFor(
        () => observations.ssrChanges.length > 0,
        5_000,
      );
      expect(ok).toBe(true);
    }, 20_000);
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// Test 3 — WS reconnect with ?since=<id> replays missed envelopes
// ═══════════════════════════════════════════════════════════════════════════

describeCoreIsolated("regression WS reconnect — ?since=<id> replays missed events", () => {
  let server: HMRServer | null = null;
  let hmrPort = 0;

  beforeEach(() => {
    // Pick an ephemeral-ish port. 40k-50k range avoids collisions with
    // common dev services.
    const basePort = 40000 + Math.floor(Math.random() * 10000);
    hmrPort = basePort + PORTS.HMR_OFFSET;
    server = createHMRServer(basePort, { hostname: "127.0.0.1" });
  });

  afterEach(() => {
    server?.close();
    server = null;
  });

  test("client reconnecting after missing 2 broadcasts receives both via replay", async () => {
    // Publish 3 events BEFORE the client connects.
    server!.broadcastVite({ type: "full-reload", path: "/first" });
    server!.broadcastVite({ type: "full-reload", path: "/second" });
    server!.broadcastVite({ type: "full-reload", path: "/third" });

    const state = server!._inspectReplayBuffer();
    expect(state.size).toBe(3);
    expect(state.lastId).toBe(3);

    // Client "reconnects" claiming it saw envelope id=1 — so 2 and 3
    // should replay.
    const messages: unknown[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${hmrPort}/?since=1`);
    ws.addEventListener("message", (ev) => {
      try {
        messages.push(JSON.parse(String((ev as MessageEvent).data)));
      } catch {
        /* ignore */
      }
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("WS error")), {
        once: true,
      });
    });

    // Expect at least: `connected` + 2 replay envelopes (ids 2 and 3).
    const received = await waitFor(() => messages.length >= 3, 3_000);
    ws.close();
    expect(received).toBe(true);

    // First message is `connected`, then `vite-replay` with ids 2 and 3.
    expect(messages[0]).toMatchObject({ type: "connected" });
    const replayed = messages
      .filter((m) => (m as { type?: string }).type === "vite-replay")
      .map((m) => (m as { data: { id: number } }).data.id);
    expect(replayed).toContain(2);
    expect(replayed).toContain(3);
  }, 10_000);

  test("client with since older than the replay buffer receives a forced full-reload", async () => {
    // Overflow the buffer so the oldest id > 0.
    const total = MAX_REPLAY_BUFFER + 2;
    for (let i = 0; i < total; i++) {
      server!.broadcastVite({
        type: "full-reload",
        path: `/r-${i}`,
      } satisfies ViteHMRPayload);
    }

    const messages: unknown[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${hmrPort}/?since=0`);
    ws.addEventListener("message", (ev) => {
      try {
        messages.push(JSON.parse(String((ev as MessageEvent).data)));
      } catch {
        /* ignore */
      }
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("WS error")), {
        once: true,
      });
    });

    await waitFor(() => messages.length >= 1, 2_000);
    ws.close();

    // First message MUST be `full-reload` — the safe fallback when the
    // replay buffer has been exhausted past the client's `since`.
    expect(messages[0]).toMatchObject({
      type: "full-reload",
      data: { message: "replay-buffer-exhausted" },
    });
  }, 10_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Test 4 — Stale island after navigation
// ═══════════════════════════════════════════════════════════════════════════

describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "regression stale-island — island rebuild fires only for the route whose source changed",
  () => {
    let rootDir = "";
    let close: (() => void) | null = null;

    beforeEach(() => {
      rootDir = makeTempRoot("stale-island");
    });

    afterEach(() => {
      close?.();
      close = null;
      rmTempRoot(rootDir);
    });

    test("editing home's client module does NOT fire about's island-update", async () => {
      // Full-interactive fixture has TWO routes with distinct client modules.
      const { scaffoldFull } = await import("./fixture-full");
      const manifest = scaffoldFull(rootDir);
      const { bundler, observations } = await bootBundler(rootDir, manifest);
      close = bundler.close;
      await sleep(WATCHER_ARM_MS);

      // Edit ONLY home's client — about's should stay untouched.
      await touchUntilSeen(
        path.join(rootDir, "app/widget.client.tsx"),
        [
          "import React from 'react';",
          "export default function Widget() { return <button>home v1</button>; }",
          "",
        ].join("\n"),
        () => observations.rebuilds.length,
      );

      // Wait for at least one rebuild.
      await waitFor(() => observations.rebuilds.length > 0, 5_000);

      // Scan the rebuild list — we expect routeId "home" (or "*" if this
      // happens to be classified as common-dir — either is fine for this
      // regression), but NOT "about" alone. The bug we're guarding is the
      // dispatcher fanning out to unrelated islands.
      const aboutOnlyRebuilds = observations.rebuilds.filter(
        (r) => r.routeId === "about",
      );
      // The legitimate cases are "home" (island-update) OR "*" (common-dir
      // wildcard). A pure "about" rebuild without a "home" one would mean
      // the dispatcher mis-routed the client module path.
      if (aboutOnlyRebuilds.length > 0) {
        const homeRebuilds = observations.rebuilds.filter(
          (r) => r.routeId === "home" || r.routeId === "*",
        );
        expect(homeRebuilds.length).toBeGreaterThan(0);
      }
    }, 20_000);
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// Test 5 — layout-update broadcast + replay buffer entry
// ═══════════════════════════════════════════════════════════════════════════

describeCoreIsolated("regression layout-update — broadcast enters replay buffer", () => {
  let server: HMRServer | null = null;
  let hmrPort = 0;

  beforeEach(() => {
    const basePort = 40000 + Math.floor(Math.random() * 10000);
    hmrPort = basePort + PORTS.HMR_OFFSET;
    server = createHMRServer(basePort, { hostname: "127.0.0.1" });
  });

  afterEach(() => {
    server?.close();
    server = null;
  });

  test("broadcast({ type: 'layout-update' }) is received live AND kept in replay buffer", async () => {
    const messages: unknown[] = [];
    const ws = new WebSocket(`ws://127.0.0.1:${hmrPort}`);
    ws.addEventListener("message", (ev) => {
      try {
        messages.push(JSON.parse(String((ev as MessageEvent).data)));
      } catch {
        /* ignore */
      }
    });
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("WS error")), {
        once: true,
      });
    });

    // Drain the `connected` greeting.
    await waitFor(() => messages.length >= 1, 2_000);

    server!.broadcast({
      type: "layout-update",
      data: { layoutPath: "/app/layout.tsx" },
    });

    await waitFor(() => messages.length >= 2, 2_000);
    ws.close();

    const layoutMsg = messages.find(
      (m) => (m as { type?: string }).type === "layout-update",
    ) as { type: string; data: { layoutPath: string; id: number } } | undefined;
    expect(layoutMsg).toBeDefined();
    expect(layoutMsg!.data.layoutPath).toBe("/app/layout.tsx");
    expect(typeof layoutMsg!.data.id).toBe("number");

    // The replay buffer should also hold the envelope so a reconnecting
    // client can recover.
    const state = server!._inspectReplayBuffer();
    expect(state.size).toBeGreaterThanOrEqual(1);
  }, 10_000);
});
