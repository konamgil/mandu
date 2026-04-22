/**
 * ActivityMonitor — ATE event rendering.
 *
 * Feeds synthetic `ate` events through the singleton `eventBus`, then
 * reads the monitor's log file back to verify pretty/JSON rendering.
 *
 * Two render modes under test:
 *   - Pretty: exactly N rows per run (1 start + 1 per spec + 1 end),
 *     with artifact_saved accumulated into the run_end summary and
 *     spec_progress suppressed.
 *   - JSON (agent): one line per event, verbatim.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityMonitor } from "../src/activity-monitor";
import { eventBus } from "@mandujs/core/observability";
import type { AteMonitorEvent } from "@mandujs/ate";

/**
 * Helper: build a skeletal FailureV1-shaped object. The renderer only
 * touches `.kind`, so we don't need a full schema-valid envelope.
 */
function mkFailure(kind: string) {
  return {
    status: "fail" as const,
    kind,
    detail: {},
    healing: { auto: [], requires_llm: false },
    flakeScore: 0,
    lastPassedAt: null,
    graphVersion: "gv1:test",
    trace: {},
  } as unknown as Extract<AteMonitorEvent, { kind: "failure_captured" }>["failure"];
}

/**
 * Emit a synthetic ate event through the bus (same path production
 * uses). This exercises the monitor's subscription logic end-to-end.
 */
function emit(data: AteMonitorEvent): void {
  eventBus.emit({
    type: "ate",
    severity: "info",
    source: "ate-test",
    message: `test-${data.kind}`,
    data: data as unknown as Record<string, unknown>,
  });
}

function waitTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe("ActivityMonitor — ATE event rendering", () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "mon-ate-"));
  });

  afterEach(() => {
    try {
      rmSync(projectRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("pretty mode renders a 5-line run (1 start + 3 pass + 1 fail + 1 end)", async () => {
    process.env.MANDU_MONITOR_FORMAT = "pretty";
    const monitor = new ActivityMonitor(projectRoot);
    // Disable auto-open terminal + summary to keep the log surface clean.
    (monitor as unknown as { config: { openTerminal: boolean } }).config.openTerminal = false;
    (monitor as unknown as { config: { summaryIntervalMs: number } }).config.summaryIntervalMs = 0;
    monitor.start();

    const runId = "run-pretty-aaa12345";
    const specs = [
      "tests/e2e/a.spec.ts",
      "tests/e2e/b.spec.ts",
      "tests/e2e/c.spec.ts",
      "tests/e2e/d.spec.ts",
    ];

    emit({ kind: "run_start", runId, specPaths: specs, graphVersion: "gv1:x" });

    // 3 passes.
    for (const spec of specs.slice(0, 3)) {
      emit({ kind: "spec_progress", runId, specPath: spec, phase: "executing" });
      emit({
        kind: "spec_done",
        runId,
        specPath: spec,
        status: "pass",
        durationMs: 1200,
      });
    }

    // 1 fail (with a preceding failure_captured).
    const failSpec = specs[3];
    emit({
      kind: "failure_captured",
      runId,
      specPath: failSpec,
      failure: mkFailure("selector_drift"),
    });
    emit({
      kind: "artifact_saved",
      runId,
      specPath: failSpec,
      artifactKind: "dom",
      path: join(projectRoot, ".mandu", "ate-artifacts", runId, "dom.html"),
      sizeBytes: 512,
    });
    emit({
      kind: "spec_done",
      runId,
      specPath: failSpec,
      status: "fail",
      durationMs: 800,
    });

    emit({
      kind: "run_end",
      runId,
      passed: 3,
      failed: 1,
      skipped: 0,
      durationMs: 10300,
      graphVersion: "gv1:x",
    });

    await waitTick();
    monitor.stop();

    const logPath = join(projectRoot, ".mandu", "activity.log");
    expect(existsSync(logPath)).toBe(true);
    const body = readFileSync(logPath, "utf8");

    // Count renderable ATE rows — filter out the header banner lines.
    const ateLines = body
      .split("\n")
      .filter((l) => /\[ATE(-RUN)?\]/.test(l));

    // Expected: 1 (run_start) + 3 (pass) + 1 (fail) + 1 (run_end) = 6.
    expect(ateLines.length).toBe(6);

    // Shape checks.
    expect(ateLines[0]).toMatch(/\[ATE-RUN\] aaa12345 starting \(4 specs\)/);
    expect(ateLines[1]).toMatch(/\+ \[ATE\] a\.spec\.ts/);
    expect(ateLines[2]).toMatch(/\+ \[ATE\] b\.spec\.ts/);
    expect(ateLines[3]).toMatch(/\+ \[ATE\] c\.spec\.ts/);
    expect(ateLines[4]).toMatch(/x \[ATE\] d\.spec\.ts .* \[selector_drift\]/);
    expect(ateLines[5]).toMatch(/\[ATE-RUN\] aaa12345 done — 3 pass, 1 fail, 0 skip/);
    // run_end should include the artifact dir since artifact_saved fired.
    expect(ateLines[5]).toMatch(/artifacts:/);

    delete process.env.MANDU_MONITOR_FORMAT;
  });

  test("JSON mode emits one verbatim line per ate event", async () => {
    process.env.MANDU_MONITOR_FORMAT = "json";
    const monitor = new ActivityMonitor(projectRoot);
    (monitor as unknown as { config: { openTerminal: boolean } }).config.openTerminal = false;
    (monitor as unknown as { config: { summaryIntervalMs: number } }).config.summaryIntervalMs = 0;
    // Re-resolve the output format since the config was mutated.
    (monitor as unknown as { outputFormat: "json" }).outputFormat = "json";
    monitor.start();

    const runId = "run-json-xyz";
    const spec = "tests/unit/x.test.ts";

    const events: AteMonitorEvent[] = [
      { kind: "run_start", runId, specPaths: [spec], graphVersion: "gv1:j" },
      { kind: "spec_progress", runId, specPath: spec, phase: "loading" },
      { kind: "spec_progress", runId, specPath: spec, phase: "executing" },
      {
        kind: "spec_done",
        runId,
        specPath: spec,
        status: "pass",
        durationMs: 500,
        assertions: 2,
      },
      {
        kind: "artifact_saved",
        runId,
        specPath: spec,
        artifactKind: "dom",
        path: "/tmp/artifact.html",
        sizeBytes: 128,
      },
      {
        kind: "run_end",
        runId,
        passed: 1,
        failed: 0,
        skipped: 0,
        durationMs: 510,
        graphVersion: "gv1:j",
      },
    ];

    for (const ev of events) emit(ev);

    await waitTick();
    monitor.stop();

    const logPath = join(projectRoot, ".mandu", "activity.jsonl");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);

    // Filter to lines that came from our emits (type starts with "ate.").
    const ateLines = lines.filter((l) => {
      try {
        const parsed = JSON.parse(l);
        return typeof parsed.type === "string" && parsed.type.startsWith("ate.");
      } catch {
        return false;
      }
    });

    // Expect exactly 6 ate events, one per emit.
    expect(ateLines.length).toBe(6);

    // Round-trip the payloads — type must match, data.kind must match.
    const parsed = ateLines.map((l) => JSON.parse(l) as {
      type: string;
      data: AteMonitorEvent;
    });
    expect(parsed.map((p) => p.type)).toEqual([
      "ate.run_start",
      "ate.spec_progress",
      "ate.spec_progress",
      "ate.spec_done",
      "ate.artifact_saved",
      "ate.run_end",
    ]);
    expect(parsed.map((p) => p.data.kind)).toEqual([
      "run_start",
      "spec_progress",
      "spec_progress",
      "spec_done",
      "artifact_saved",
      "run_end",
    ]);

    // Run identity preserved.
    for (const p of parsed) {
      expect(p.data.runId).toBe(runId);
    }

    delete process.env.MANDU_MONITOR_FORMAT;
  });

  test("failure_captured alone renders nothing — but attaches kind to the next spec_done", async () => {
    process.env.MANDU_MONITOR_FORMAT = "pretty";
    const monitor = new ActivityMonitor(projectRoot);
    (monitor as unknown as { config: { openTerminal: boolean } }).config.openTerminal = false;
    (monitor as unknown as { config: { summaryIntervalMs: number } }).config.summaryIntervalMs = 0;
    monitor.start();

    const runId = "run-inline-1";
    const spec = "tests/e2e/login.spec.ts";

    emit({ kind: "run_start", runId, specPaths: [spec], graphVersion: "gv1:inline" });
    emit({
      kind: "failure_captured",
      runId,
      specPath: spec,
      failure: mkFailure("contract_mismatch"),
    });
    emit({
      kind: "spec_done",
      runId,
      specPath: spec,
      status: "fail",
      durationMs: 300,
    });
    emit({
      kind: "run_end",
      runId,
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs: 350,
      graphVersion: "gv1:inline",
    });

    await waitTick();
    monitor.stop();

    const logPath = join(projectRoot, ".mandu", "activity.log");
    const body = readFileSync(logPath, "utf8");
    const ateLines = body
      .split("\n")
      .filter((l) => /\[ATE(-RUN)?\]/.test(l));

    // 1 run_start + 1 spec_done(fail) + 1 run_end. failure_captured
    // does NOT produce its own line.
    expect(ateLines.length).toBe(3);
    expect(ateLines[1]).toMatch(/x \[ATE\] login\.spec\.ts .* \[contract_mismatch\]/);

    delete process.env.MANDU_MONITOR_FORMAT;
  });
});
