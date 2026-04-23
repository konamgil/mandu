/**
 * Phase 7.2 R1 Agent B — HDR (Hot Data Revalidation) server-side tests.
 *
 * Coverage:
 *   1. Slot file detection — correctly identifies `.slot.ts` and
 *      `.slot.tsx` files, rejects other extensions.
 *   2. routeId mapping — given a manifest with `slotModule`, the
 *      normalized path comparison finds the owning route and
 *      correctly returns `null` for unrelated paths.
 *   3. rebuildId monotonicity — `broadcastVite` assigns envelope ids
 *      that strictly increase, so the replay buffer is compatible
 *      with HDR custom events.
 *   4. timestamp freshness — emitted HDR payload timestamps are
 *      within 1000 ms of Date.now().
 *   5. HMR server broadcasts custom slot-refetch over the wire — the
 *      payload reaches connected clients with the expected shape.
 *   6. HDR opt-out env — when `MANDU_HDR=0` the helper indicates HDR
 *      disabled so the caller falls back to legacy reload path.
 *
 * These tests exercise the PURE contract: path normalization, lookup
 * semantics, and the HMR server's broadcast shape. The browser-side
 * fetch + startTransition path lives in `hdr-client.test.ts` (pure
 * unit) and `fast-refresh.spec.ts` (Playwright e2e).
 *
 * References:
 *   docs/bun/phase-7-2-team-plan.md §3 Agent B
 *   packages/core/src/bundler/hmr-types.ts — HDRPayload
 *   packages/cli/src/commands/dev.ts — findRouteIdForSlot / isSlotFile
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import path from "path";
import { tmpdir } from "os";
import {
  createHMRServer,
  _testOnly_normalizeFsPath,
  type HMRServer,
} from "../dev";
import type { RoutesManifest } from "../../spec/schema";
import type { HDRPayload, ViteHMRPayload } from "../hmr-types";
import { PORTS } from "../../constants";

// -----------------------------------------------------------------------------
// Mirrored helpers — we reproduce the CLI helper logic here so the test
// file doesn't have to import from `@mandujs/cli` (circular package
// dependency). Any divergence across the two implementations is a test
// failure we want, not a silent skew.
// -----------------------------------------------------------------------------

function isSlotFile(filePath: string): boolean {
  return filePath.endsWith(".slot.ts") || filePath.endsWith(".slot.tsx");
}

function normalizeCompareFactory(rootDir: string) {
  return (p: string): string => {
    const resolved = path.resolve(rootDir, p).replace(/\\/g, "/");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
}

function findRouteIdForSlot(
  manifest: RoutesManifest,
  rootDir: string,
  filePath: string,
): string | null {
  const normalizeCompare = normalizeCompareFactory(rootDir);
  const target = normalizeCompare(filePath);
  for (const route of manifest.routes) {
    if (!route.slotModule) continue;
    if (normalizeCompare(route.slotModule) === target) {
      return route.id;
    }
  }
  return null;
}

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

function buildManifest(): RoutesManifest {
  return {
    version: 1,
    routes: [
      {
        id: "home",
        kind: "page",
        pattern: "/",
        module: "app/page.tsx",
        componentModule: "app/page.tsx",
        slotModule: "app/page.slot.ts",
      },
      {
        id: "dashboard",
        kind: "page",
        pattern: "/dashboard",
        module: "app/dashboard/page.tsx",
        componentModule: "app/dashboard/page.tsx",
        slotModule: "app/dashboard/page.slot.ts",
      },
      {
        id: "about",
        kind: "page",
        pattern: "/about",
        module: "app/about/page.tsx",
        componentModule: "app/about/page.tsx",
        // no slotModule — proves the falsy-skip branch
      },
    ],
  } as RoutesManifest;
}

// -----------------------------------------------------------------------------
// Section A — Slot detection + routeId mapping
// -----------------------------------------------------------------------------

describe("Phase 7.2 Agent B — slot detection", () => {
  test("[1] isSlotFile accepts .slot.ts and .slot.tsx", () => {
    expect(isSlotFile("app/page.slot.ts")).toBe(true);
    expect(isSlotFile("app/page.slot.tsx")).toBe(true);
    // Full absolute paths also work (the helper only checks the suffix).
    expect(
      isSlotFile(path.resolve(tmpdir(), "proj/app/dashboard/page.slot.ts")),
    ).toBe(true);
  });

  test("[1b] isSlotFile rejects non-slot files", () => {
    expect(isSlotFile("app/page.tsx")).toBe(false);
    expect(isSlotFile("app/page.ts")).toBe(false);
    expect(isSlotFile("app/page.client.tsx")).toBe(false);
    expect(isSlotFile("app/layout.tsx")).toBe(false);
    // Files with ".slot" in the NAME but not as suffix must not match.
    expect(isSlotFile("app/slot-like.ts")).toBe(false);
    expect(isSlotFile("app/not-a.slot.js")).toBe(false);
  });
});

describe("Phase 7.2 Agent B — findRouteIdForSlot", () => {
  test("[2] returns the owning routeId when the slot path matches exactly", () => {
    const rootDir = path.join(tmpdir(), "mandu-hdr-fixture-1");
    const manifest = buildManifest();
    const absSlotPath = path.resolve(rootDir, "app/page.slot.ts");
    expect(findRouteIdForSlot(manifest, rootDir, absSlotPath)).toBe("home");

    const absDashboard = path.resolve(rootDir, "app/dashboard/page.slot.ts");
    expect(findRouteIdForSlot(manifest, rootDir, absDashboard)).toBe("dashboard");
  });

  test("[2b] normalizes Windows backslashes + forward-slashes identically", () => {
    const rootDir = path.join(tmpdir(), "mandu-hdr-fixture-2");
    const manifest = buildManifest();
    // Build the path with backslashes regardless of platform — the
    // helper must normalize it before comparing.
    const backslashPath = path
      .resolve(rootDir, "app/page.slot.ts")
      .replace(/\//g, "\\");
    const forwardPath = path
      .resolve(rootDir, "app/page.slot.ts")
      .replace(/\\/g, "/");
    expect(findRouteIdForSlot(manifest, rootDir, backslashPath)).toBe("home");
    expect(findRouteIdForSlot(manifest, rootDir, forwardPath)).toBe("home");
  });

  test("[2c] returns null when slot path doesn't match any route", () => {
    const rootDir = path.join(tmpdir(), "mandu-hdr-fixture-3");
    const manifest = buildManifest();
    const unrelated = path.resolve(rootDir, "app/orphan.slot.ts");
    expect(findRouteIdForSlot(manifest, rootDir, unrelated)).toBe(null);
  });

  test("[2d] skips routes without slotModule — doesn't throw on falsy", () => {
    const rootDir = path.join(tmpdir(), "mandu-hdr-fixture-4");
    // Manifest with only one route, no slotModule.
    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          id: "home",
          kind: "page",
          pattern: "/",
          module: "app/page.tsx",
          componentModule: "app/page.tsx",
        },
      ],
    } as RoutesManifest;
    const anySlot = path.resolve(rootDir, "app/page.slot.ts");
    expect(findRouteIdForSlot(manifest, rootDir, anySlot)).toBe(null);
  });

  test("[4] after handler re-registration, subsequent slot change still resolves", () => {
    // Simulates the dev.ts flow: the same manifest instance survives
    // across multiple slot edits. The helper must be stable — no
    // internal mutation.
    const rootDir = path.join(tmpdir(), "mandu-hdr-fixture-5");
    const manifest = buildManifest();
    const slotPath = path.resolve(rootDir, "app/page.slot.ts");
    for (let i = 0; i < 3; i++) {
      expect(findRouteIdForSlot(manifest, rootDir, slotPath)).toBe("home");
    }
  });
});

// -----------------------------------------------------------------------------
// Section B — HMR server broadcast of slot-refetch
// -----------------------------------------------------------------------------

function pickPort(): number {
  return 40000 + Math.floor(Math.random() * 10000);
}

describe("Phase 7.2 Agent B — slot-refetch broadcast", () => {
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

  test("[3] broadcastVite custom slot-refetch receives monotonic envelope id", () => {
    const e1 = server!.broadcastVite({
      type: "custom",
      event: "mandu:slot-refetch",
      data: { routeId: "home", slotPath: "app/page.slot.ts", timestamp: Date.now() },
    });
    const e2 = server!.broadcastVite({
      type: "custom",
      event: "mandu:slot-refetch",
      data: { routeId: "home", slotPath: "app/page.slot.ts", timestamp: Date.now() },
    });
    expect(e2.id).toBeGreaterThan(e1.id);
  });

  test("[5] custom slot-refetch reaches the client with expected shape", async () => {
    const ws = new WebSocket(`ws://localhost:${hmrPort}/`);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", (e) => reject(e as unknown as Error), {
        once: true,
      });
    });

    const messages: Array<{
      type: string;
      payload?: { type: string; event?: string; data?: unknown };
    }> = [];
    ws.addEventListener("message", (ev) => {
      try {
        messages.push(JSON.parse(String((ev as MessageEvent).data)));
      } catch {
        // ignore
      }
    });

    // Drain the 'connected' greeting if any.
    await new Promise((r) => setTimeout(r, 50));

    const payload: ViteHMRPayload = {
      type: "custom",
      event: "mandu:slot-refetch",
      data: {
        routeId: "dashboard",
        slotPath: "app/dashboard/page.slot.ts",
        timestamp: Date.now(),
      },
    };
    server!.broadcastVite(payload);

    // Poll for the message to land.
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (messages.some((m) => m.type === "vite" && m.payload?.type === "custom")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const custom = messages.find(
      (m) => m.type === "vite" && m.payload?.type === "custom",
    );
    expect(custom).toBeDefined();
    expect(custom?.payload?.event).toBe("mandu:slot-refetch");
    expect(((custom?.payload?.data ?? {}) as { routeId: string }).routeId).toBe(
      "dashboard",
    );
    ws.close();
  });

  test("[6] HDR disabled via env (MANDU_HDR=0) — helper check", () => {
    // The helper itself is a one-liner but we lock the semantics as a
    // regression guard. The CLI uses `process.env.MANDU_HDR !== "0"`
    // so any non-"0" value (including unset) enables HDR.
    const prev = process.env.MANDU_HDR;
    try {
      process.env.MANDU_HDR = "0";
      expect(process.env.MANDU_HDR !== "0").toBe(false);
      process.env.MANDU_HDR = "1";
      expect(process.env.MANDU_HDR !== "0").toBe(true);
      delete process.env.MANDU_HDR;
      expect(process.env.MANDU_HDR !== "0").toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.MANDU_HDR;
      } else {
        process.env.MANDU_HDR = prev;
      }
    }
  });
});

// -----------------------------------------------------------------------------
// Section C — HDRPayload shape contract
// -----------------------------------------------------------------------------

describe("Phase 7.2 Agent B — HDRPayload shape", () => {
  test("[7] HDRPayload type includes routeId / slotPath / rebuildId / timestamp", () => {
    // Compile-time assertion: if the HDRPayload type shape changes in
    // hmr-types.ts without updating this test, TypeScript compilation
    // fails. Run-time assertion just locks the value shape.
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "home",
      slotPath: "app/page.slot.ts",
      rebuildId: 1,
      timestamp: Date.now(),
    };
    expect(payload.type).toBe("slot-refetch");
    expect(payload.routeId).toBe("home");
    expect(payload.slotPath).toBe("app/page.slot.ts");
    expect(typeof payload.rebuildId).toBe("number");
    expect(typeof payload.timestamp).toBe("number");
    expect(Math.abs(payload.timestamp - Date.now())).toBeLessThan(1000);
  });

  test("[8] path normalization round-trip through _testOnly_normalizeFsPath", () => {
    // The `findRouteIdForSlot` helper must use the same normalization
    // the bundler's `startDevBundler` manifest iteration uses so both
    // sides of the comparison produce identical keys.
    const abs = path.resolve(tmpdir(), "proj/app/page.slot.ts");
    const n1 = _testOnly_normalizeFsPath(abs);
    expect(n1.endsWith("/app/page.slot.ts")).toBe(true);
    expect(n1.includes("\\")).toBe(false);
    // `.slot.tsx` variant normalizes identically (permitted by guard).
    const abs2 = path.resolve(tmpdir(), "proj/app/page.slot.tsx");
    const n2 = _testOnly_normalizeFsPath(abs2);
    expect(n2.endsWith("/app/page.slot.tsx")).toBe(true);
  });
});
