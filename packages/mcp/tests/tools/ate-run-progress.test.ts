/**
 * mandu_ate_run — progress + partial-results wiring (#238).
 *
 * Two scenarios under test:
 *   1. A passing run produces notifications/progress per spec_done +
 *      one final notification at run_end.
 *   2. A run killed mid-way (synthetic partial) writes a partial
 *      results.json with the specs that did complete + the failure
 *      list captured so far.
 *
 * Uses `createAteProgressTracker` for deterministic event-handling
 * tests (no race with real runSpec calls).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ateRunTools,
  writePartialResults,
  createAteProgressTracker,
} from "../../src/tools/ate-run";
import type { PartialRunResults } from "../../src/tools/ate-run";
import type { AteMonitorEvent } from "@mandujs/ate";

interface CapturedProgress {
  progress: number;
  total: number;
  message: string;
  progressToken?: string | number;
}

describe("mandu_ate_run — progress + partial results (#238)", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "ate-progress-"));
  });

  afterEach(() => {
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("writePartialResults persists under .mandu/reports/run-<runId>/", () => {
    const partial: PartialRunResults = {
      runId: "partial-xyz",
      status: "timed_out",
      graphVersion: "gv1:t",
      completedSpecs: [
        { specPath: "tests/unit/a.test.ts", status: "pass", durationMs: 100 },
        { specPath: "tests/unit/b.test.ts", status: "fail", durationMs: 250 },
      ],
      inProgressSpec: "tests/unit/c.test.ts",
      failures: [],
      startedAt: "2026-04-22T00:00:00.000Z",
      killedAt: "2026-04-22T00:10:00.000Z",
      error: "runSpec: runner timed out after 10 minutes",
    };
    const path = writePartialResults(repoRoot, partial);
    expect(path).toBeTruthy();
    expect(existsSync(path!)).toBe(true);
    const parsed = JSON.parse(readFileSync(path!, "utf8")) as PartialRunResults;
    expect(parsed.runId).toBe("partial-xyz");
    expect(parsed.status).toBe("timed_out");
    expect(parsed.completedSpecs.length).toBe(2);
    expect(parsed.inProgressSpec).toBe("tests/unit/c.test.ts");
  });

  test("progress tracker fires per spec_done + one final at run_end", () => {
    const captured: CapturedProgress[] = [];
    const tracker = createAteProgressTracker({
      progressToken: "tok-abc",
      sendProgress: (progress, total, message) => {
        captured.push({ progress, total, message, progressToken: "tok-abc" });
      },
    });

    const runId = "run-123";
    const specs = [
      "tests/e2e/one.spec.ts",
      "tests/e2e/two.spec.ts",
      "tests/e2e/three.spec.ts",
    ];

    // Drive the tracker with a realistic event sequence.
    tracker.handle({ kind: "run_start", runId, specPaths: specs, graphVersion: "gv1:p" });
    for (let i = 0; i < specs.length; i++) {
      tracker.handle({
        kind: "spec_done",
        runId,
        specPath: specs[i],
        status: "pass",
        durationMs: 100 * (i + 1),
      });
    }
    tracker.handle({
      kind: "run_end",
      runId,
      passed: 3,
      failed: 0,
      skipped: 0,
      durationMs: 600,
      graphVersion: "gv1:p",
    });

    // 3 per-spec + 1 final = 4 total.
    expect(captured.length).toBe(4);

    // Per-spec rows (0..2).
    for (let i = 0; i < 3; i++) {
      expect(captured[i].progress).toBe(i + 1);
      expect(captured[i].total).toBe(3);
      expect(captured[i].message).toMatch(new RegExp(`^\\[${i + 1}/3\\]`));
    }
    // Final.
    expect(captured[3].progress).toBe(3);
    expect(captured[3].total).toBe(3);
    expect(captured[3].message).toMatch(/done/);
  });

  test("tracker captures partial state across specs + failures on kill", () => {
    const tracker = createAteProgressTracker({
      sendProgress: () => undefined,
    });

    const runId = "kill-run-xyz";
    const specs = [
      "tests/e2e/x.spec.ts",
      "tests/e2e/y.spec.ts",
      "tests/e2e/z.spec.ts",
    ];

    tracker.handle({ kind: "run_start", runId, specPaths: specs, graphVersion: "gv1:k" });

    // Spec 1: pass.
    tracker.handle({ kind: "spec_progress", runId, specPath: specs[0], phase: "executing" });
    tracker.handle({
      kind: "spec_done",
      runId,
      specPath: specs[0],
      status: "pass",
      durationMs: 200,
    });

    // Spec 2: fail with a failure_captured preceding spec_done.
    tracker.handle({ kind: "spec_progress", runId, specPath: specs[1], phase: "executing" });
    tracker.handle({
      kind: "failure_captured",
      runId,
      specPath: specs[1],
      failure: {
        status: "fail",
        kind: "selector_drift",
        detail: { old: "#submit", domCandidates: [] },
        healing: { auto: [], requires_llm: false },
        flakeScore: 0,
        lastPassedAt: null,
        graphVersion: "gv1:k",
        trace: {},
      } as unknown as Extract<AteMonitorEvent, { kind: "failure_captured" }>["failure"],
    });
    tracker.handle({
      kind: "spec_done",
      runId,
      specPath: specs[1],
      status: "fail",
      durationMs: 300,
    });

    // Spec 3: in-progress when killed.
    tracker.handle({ kind: "spec_progress", runId, specPath: specs[2], phase: "executing" });

    // No spec_done / run_end — simulating a watchdog kill.
    const snap = tracker.snapshot();
    expect(snap.runId).toBe(runId);
    expect(snap.graphVersion).toBe("gv1:k");
    expect(snap.completedSpecs.length).toBe(2);
    expect(snap.completedSpecs[0].status).toBe("pass");
    expect(snap.completedSpecs[1].status).toBe("fail");
    expect(snap.inProgressSpec).toBe(specs[2]);
    expect(snap.failures.length).toBe(1);
    expect(snap.failures[0].kind).toBe("selector_drift");
  });

  test("snapshot + writePartialResults round-trip from a killed tracker", () => {
    const tracker = createAteProgressTracker({
      sendProgress: () => undefined,
    });
    const runId = "partial-flow-run";
    tracker.handle({
      kind: "run_start",
      runId,
      specPaths: ["a.spec.ts", "b.spec.ts"],
      graphVersion: "gv1:rt",
    });
    tracker.handle({
      kind: "spec_done",
      runId,
      specPath: "a.spec.ts",
      status: "pass",
      durationMs: 100,
    });
    tracker.handle({
      kind: "spec_progress",
      runId,
      specPath: "b.spec.ts",
      phase: "executing",
    });

    const snap = tracker.snapshot();
    const partial: PartialRunResults = {
      runId: snap.runId!,
      status: "timed_out",
      graphVersion: snap.graphVersion,
      completedSpecs: snap.completedSpecs,
      inProgressSpec: snap.inProgressSpec,
      failures: snap.failures,
      startedAt: new Date().toISOString(),
      killedAt: new Date().toISOString(),
      error: "watchdog timeout",
    };
    const resultsPath = writePartialResults(repoRoot, partial);
    expect(resultsPath).toBeTruthy();
    const parsed = JSON.parse(readFileSync(resultsPath!, "utf8")) as PartialRunResults;
    expect(parsed.runId).toBe(runId);
    expect(parsed.completedSpecs.length).toBe(1);
    expect(parsed.inProgressSpec).toBe("b.spec.ts");
    expect(parsed.status).toBe("timed_out");
  });

  test("without a server, progress notifications are silently no-oped", async () => {
    // No server → sendProgress returns early, tool call proceeds normally.
    const handlers = ateRunTools(repoRoot);
    const result = await handlers.mandu_ate_run({
      repoRoot,
      spec: "__nonexistent__.test.ts",
    });
    // Either ok:true (runner happened to succeed) or ok:false (runner
    // failed); what matters is no crash from the missing server.
    expect(typeof (result as { ok: boolean }).ok).toBe("boolean");
  });
});
