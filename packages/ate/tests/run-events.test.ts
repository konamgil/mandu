/**
 * runSpec event-bus instrumentation — verifies the six-event contract.
 *
 * Asserts:
 *   - pass path: run_start → spec_progress (loading) → spec_progress (executing)
 *                 → spec_done(pass) → run_end
 *   - fail path: run_start → spec_progress × 3 → failure_captured
 *                 → artifact_saved × 1+  → spec_done(fail) → run_end
 *   - runId stable across every event in a single run
 *   - graphVersion forwarded end-to-end
 *
 * The suite subscribes via the real singleton eventBus with a source
 * filter so prior tests' emissions do not leak in.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSpec } from "../src/run";
import type { RunnerExec } from "../src/run";
import { eventBus } from "@mandujs/core/observability";
import type { ObservabilityEvent } from "@mandujs/core/observability";
import type { AteMonitorEvent } from "../src/types";

function captureAteEvents(): {
  events: AteMonitorEvent[];
  stop: () => void;
} {
  const events: AteMonitorEvent[] = [];
  const unsub = eventBus.on("*", (e: ObservabilityEvent) => {
    if (e.type !== "ate") return;
    events.push(e.data as unknown as AteMonitorEvent);
  });
  return { events, stop: unsub };
}

function makeExec(result: { exitCode: number; stdout?: string; stderr?: string }): RunnerExec {
  return async () => ({
    exitCode: result.exitCode,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    durationMs: 42,
  });
}

describe("runSpec event-bus instrumentation (Phase A.2 extension)", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "ate-events-"));
  });

  afterEach(() => {
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("pass path emits run_start → spec_progress → spec_done → run_end", async () => {
    const cap = captureAteEvents();
    try {
      const result = await runSpec({
        repoRoot,
        spec: "tests/unit/handler.test.ts",
        runId: "pass-run-1",
        exec: makeExec({ exitCode: 0, stdout: "3 pass\n" }),
      });
      expect(result.status).toBe("pass");
    } finally {
      cap.stop();
    }

    const kinds = cap.events.map((e) => e.kind);
    expect(kinds[0]).toBe("run_start");
    expect(kinds).toContain("spec_progress");
    expect(kinds).toContain("spec_done");
    expect(kinds[kinds.length - 1]).toBe("run_end");

    const runStart = cap.events.find((e) => e.kind === "run_start");
    const specDone = cap.events.find((e) => e.kind === "spec_done");
    const runEnd = cap.events.find((e) => e.kind === "run_end");
    expect(runStart?.kind === "run_start" && runStart.specPaths).toEqual([
      "tests/unit/handler.test.ts",
    ]);
    expect(specDone?.kind === "spec_done" && specDone.status).toBe("pass");
    expect(specDone?.kind === "spec_done" && specDone.assertions).toBe(3);
    expect(runEnd?.kind === "run_end" && runEnd.passed).toBe(1);
    expect(runEnd?.kind === "run_end" && runEnd.failed).toBe(0);

    // failure_captured must NOT appear on the pass path.
    expect(cap.events.some((e) => e.kind === "failure_captured")).toBe(false);
  });

  test("fail path emits failure_captured + artifact_saved + spec_done(fail)", async () => {
    const cap = captureAteEvents();
    try {
      const result = await runSpec({
        repoRoot,
        spec: "tests/e2e/signup.spec.ts",
        runId: "fail-run-1",
        exec: makeExec({
          exitCode: 1,
          stderr: `Error: locator("[data-testid=submit]") not found`,
        }),
      });
      expect(result.status).toBe("fail");
    } finally {
      cap.stop();
    }

    const kinds = cap.events.map((e) => e.kind);
    expect(kinds[0]).toBe("run_start");
    expect(kinds).toContain("failure_captured");
    expect(kinds).toContain("artifact_saved");
    expect(kinds[kinds.length - 1]).toBe("run_end");

    // Ordering: failure_captured must precede the terminal spec_done
    // for the same spec, which must precede run_end.
    const idxFailure = cap.events.findIndex((e) => e.kind === "failure_captured");
    const idxSpecDone = cap.events.findIndex((e) => e.kind === "spec_done");
    const idxRunEnd = cap.events.findIndex((e) => e.kind === "run_end");
    const idxArtifact = cap.events.findIndex((e) => e.kind === "artifact_saved");
    expect(idxFailure).toBeGreaterThanOrEqual(0);
    expect(idxArtifact).toBeGreaterThanOrEqual(0);
    expect(idxFailure).toBeLessThan(idxSpecDone);
    expect(idxSpecDone).toBeLessThan(idxRunEnd);

    const failureEv = cap.events[idxFailure];
    if (failureEv.kind !== "failure_captured") throw new Error("unreachable");
    expect(failureEv.failure.kind).toBe("selector_drift");
    expect(failureEv.failure.status).toBe("fail");

    const artifactEv = cap.events[idxArtifact];
    if (artifactEv.kind !== "artifact_saved") throw new Error("unreachable");
    expect(["trace", "screenshot", "dom", "other"]).toContain(artifactEv.artifactKind);
    expect(artifactEv.path).toBeTruthy();

    const specDoneEv = cap.events[idxSpecDone];
    if (specDoneEv.kind !== "spec_done") throw new Error("unreachable");
    expect(specDoneEv.status).toBe("fail");

    const runEndEv = cap.events[idxRunEnd];
    if (runEndEv.kind !== "run_end") throw new Error("unreachable");
    expect(runEndEv.passed).toBe(0);
    expect(runEndEv.failed).toBe(1);
  });

  test("runId is stable across every event in a single run", async () => {
    const cap = captureAteEvents();
    try {
      await runSpec({
        repoRoot,
        spec: "tests/unit/handler.test.ts",
        runId: "stable-run-abc",
        exec: makeExec({ exitCode: 0, stdout: "1 pass\n" }),
      });
    } finally {
      cap.stop();
    }

    expect(cap.events.length).toBeGreaterThan(0);
    for (const ev of cap.events) {
      expect(ev.runId).toBe("stable-run-abc");
    }
  });

  test("graphVersion is forwarded on run_start and run_end", async () => {
    const cap = captureAteEvents();
    try {
      await runSpec({
        repoRoot,
        spec: "tests/unit/handler.test.ts",
        runId: "gv-run-1",
        exec: makeExec({ exitCode: 0, stdout: "1 pass\n" }),
      });
    } finally {
      cap.stop();
    }

    const runStart = cap.events.find((e) => e.kind === "run_start");
    const runEnd = cap.events.find((e) => e.kind === "run_end");
    if (runStart?.kind !== "run_start") throw new Error("unreachable");
    if (runEnd?.kind !== "run_end") throw new Error("unreachable");
    expect(runStart.graphVersion).toMatch(/^gv1:/);
    expect(runEnd.graphVersion).toBe(runStart.graphVersion);
  });

  test("emits never throw even when a subscriber misbehaves", async () => {
    // Install a deliberately-broken subscriber.
    const unsub = eventBus.on("ate", () => {
      throw new Error("subscriber explosion");
    });
    try {
      const result = await runSpec({
        repoRoot,
        spec: "tests/unit/handler.test.ts",
        runId: "resilient-run",
        exec: makeExec({ exitCode: 0, stdout: "1 pass\n" }),
      });
      expect(result.status).toBe("pass");
    } finally {
      unsub();
    }
  });
});
