/**
 * Phase 7.2 R1 Agent B — HDR client-side runtime tests.
 *
 * Coverage (pure unit — no DOM, no real WebSocket):
 *   1. dispatchSlotRefetch returns false when no transport is
 *      installed (the default "no-router" fallback).
 *   2. setHDRTransport + dispatchSlotRefetch returns the transport's
 *      `ok` flag so the caller can decide fallback vs. done.
 *   3. A throwing transport never propagates; dispatchSlotRefetch
 *      swallows + returns false so the HMR client stays alive.
 *   4. Transport is isolated per test via _resetRegistryForTests().
 *   5. HDRPayload shape round-trips through the transport (routeId,
 *      slotPath, rebuildId, timestamp all preserved — no field is
 *      silently dropped).
 *
 * References:
 *   docs/bun/phase-7-2-team-plan.md §3 Agent B
 *   packages/core/src/runtime/hmr-client.ts — setHDRTransport,
 *     dispatchSlotRefetch, _resetRegistryForTests
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  setHDRTransport,
  dispatchSlotRefetch,
  _resetRegistryForTests,
} from "../hmr-client";
import type { HDRPayload } from "../../bundler/hmr-types";

describe("Phase 7.2 Agent B — dispatchSlotRefetch", () => {
  beforeEach(() => {
    _resetRegistryForTests();
  });

  test("[1] returns false when no transport is installed (default fallback)", async () => {
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "home",
      slotPath: "app/page.slot.ts",
      rebuildId: 1,
      timestamp: Date.now(),
    };
    const ok = await dispatchSlotRefetch(payload);
    expect(ok).toBe(false);
  });

  test("[2] returns true when the installed transport resolves ok:true", async () => {
    const received: HDRPayload[] = [];
    setHDRTransport(async (p) => {
      received.push(p);
      return { ok: true };
    });
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "dashboard",
      slotPath: "app/dashboard/page.slot.ts",
      rebuildId: 7,
      timestamp: 1234567890,
    };
    const ok = await dispatchSlotRefetch(payload);
    expect(ok).toBe(true);
    // Full payload passed through unchanged.
    expect(received.length).toBe(1);
    expect(received[0]).toEqual(payload);
  });

  test("[3] transport that throws does NOT propagate — dispatchSlotRefetch returns false", async () => {
    setHDRTransport(async () => {
      throw new Error("transport kaboom");
    });
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "home",
      slotPath: "app/page.slot.ts",
      rebuildId: 1,
      timestamp: Date.now(),
    };
    // Must NOT reject. A thrown error in the transport is logged and
    // the caller sees `false` so it can fall back to a full reload.
    const ok = await dispatchSlotRefetch(payload);
    expect(ok).toBe(false);
  });

  test("[4] transport resolves ok:false with reason — dispatch returns false", async () => {
    setHDRTransport(async () => ({ ok: false, reason: "no-route" as const }));
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "home",
      slotPath: "app/page.slot.ts",
      rebuildId: 1,
      timestamp: Date.now(),
    };
    const ok = await dispatchSlotRefetch(payload);
    expect(ok).toBe(false);
  });

  test("[5] _resetRegistryForTests restores default (no-transport) behavior", async () => {
    setHDRTransport(async () => ({ ok: true }));
    _resetRegistryForTests();
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "home",
      slotPath: "app/page.slot.ts",
      rebuildId: 1,
      timestamp: Date.now(),
    };
    const ok = await dispatchSlotRefetch(payload);
    // After reset the default "no-router" transport is back.
    expect(ok).toBe(false);
  });

  test("[6] two sequential dispatches with different payloads deliver each to transport", async () => {
    const received: HDRPayload[] = [];
    setHDRTransport(async (p) => {
      received.push(p);
      return { ok: true };
    });
    const a: HDRPayload = {
      type: "slot-refetch",
      routeId: "home",
      slotPath: "app/page.slot.ts",
      rebuildId: 1,
      timestamp: 100,
    };
    const b: HDRPayload = {
      type: "slot-refetch",
      routeId: "dashboard",
      slotPath: "app/dashboard/page.slot.ts",
      rebuildId: 2,
      timestamp: 200,
    };
    await dispatchSlotRefetch(a);
    await dispatchSlotRefetch(b);
    expect(received.length).toBe(2);
    expect(received[0]!.routeId).toBe("home");
    expect(received[1]!.routeId).toBe("dashboard");
    expect(received[1]!.rebuildId).toBe(2);
  });

  test("[7] transport may observe the full HDRPayload — no fields lost", async () => {
    const captured: HDRPayload[] = [];
    setHDRTransport(async (p) => {
      captured.push(p);
      return { ok: true };
    });
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "nested-route-abc123",
      slotPath: "app/deeply/nested/page.slot.ts",
      rebuildId: 9999,
      timestamp: 1_700_000_000_000,
    };
    await dispatchSlotRefetch(payload);
    expect(captured.length).toBe(1);
    const first = captured[0]!;
    expect(first.type).toBe("slot-refetch");
    expect(first.routeId).toBe(payload.routeId);
    expect(first.slotPath).toBe(payload.slotPath);
    expect(first.rebuildId).toBe(payload.rebuildId);
    expect(first.timestamp).toBe(payload.timestamp);
  });

  test("[8] latest setHDRTransport wins (idempotent setter semantics)", async () => {
    let firstCalled = 0;
    let secondCalled = 0;
    setHDRTransport(async () => {
      firstCalled++;
      return { ok: false, reason: "disabled" as const };
    });
    setHDRTransport(async () => {
      secondCalled++;
      return { ok: true };
    });
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "home",
      slotPath: "app/page.slot.ts",
      rebuildId: 1,
      timestamp: Date.now(),
    };
    const ok = await dispatchSlotRefetch(payload);
    expect(firstCalled).toBe(0);
    expect(secondCalled).toBe(1);
    expect(ok).toBe(true);
  });

  test("[9] transport that resolves with 'fetch-failed' reason — dispatch returns false", async () => {
    setHDRTransport(async () => ({
      ok: false,
      reason: "fetch-failed" as const,
    }));
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "home",
      slotPath: "app/page.slot.ts",
      rebuildId: 1,
      timestamp: Date.now(),
    };
    const ok = await dispatchSlotRefetch(payload);
    expect(ok).toBe(false);
  });

  test("[10] HDRPayload slotPath with Windows backslashes is preserved verbatim", async () => {
    // The helper does no normalization on the browser side — the
    // server ships whatever string it put in the payload. Lock that
    // contract so future changes don't introduce silent mutation.
    const captured: HDRPayload[] = [];
    setHDRTransport(async (p) => {
      captured.push(p);
      return { ok: true };
    });
    const payload: HDRPayload = {
      type: "slot-refetch",
      routeId: "home",
      slotPath: "C:\\proj\\app\\page.slot.ts",
      rebuildId: 1,
      timestamp: Date.now(),
    };
    await dispatchSlotRefetch(payload);
    expect(captured.length).toBe(1);
    expect(captured[0]!.slotPath).toBe("C:\\proj\\app\\page.slot.ts");
  });
});
