import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { eventBus } from "../../src/observability/event-bus";
import {
  startSqliteStore,
  stopSqliteStore,
  queryEvents,
  queryStats,
  exportJsonl,
  exportOtlp,
  getDb,
} from "../../src/observability/sqlite-store";

const describeCoreIsolated = describe.skipIf(
  process.env.MANDU_SKIP_CORE_ISOLATED_TESTS === "1",
);

describeCoreIsolated("Phase 6: SQLite Observability Store", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "mandu-sqlite-"));
    await startSqliteStore(tmpRoot);
  });

  afterEach(() => {
    stopSqliteStore();
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  });

  it("startSqliteStore initializes db", () => {
    expect(getDb()).not.toBeNull();
  });

  it("captures eventBus events", async () => {
    eventBus.emit({
      type: "http",
      severity: "info",
      source: "server",
      message: "GET /test 200",
      duration: 42,
      data: { method: "GET", path: "/test", status: 200 },
    });

    // Allow microtask to flush
    await new Promise((r) => setTimeout(r, 10));

    const events = queryEvents({ type: "http" });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("http");
    expect(events[0].message).toContain("GET /test");
  });

  it("queryEvents filters by severity", async () => {
    eventBus.emit({ type: "http", severity: "info", source: "server", message: "ok" });
    eventBus.emit({ type: "http", severity: "error", source: "server", message: "fail" });
    await new Promise((r) => setTimeout(r, 10));

    const errors = queryEvents({ type: "http", severity: "error" });
    expect(errors.every((e) => e.severity === "error")).toBe(true);
  });

  it("queryEvents filters by correlationId", async () => {
    const cid = "test-correlation-123";
    eventBus.emit({ type: "http", severity: "info", source: "server", message: "req", correlationId: cid });
    eventBus.emit({ type: "http", severity: "info", source: "server", message: "other" });
    await new Promise((r) => setTimeout(r, 10));

    const matched = queryEvents({ correlationId: cid });
    expect(matched.length).toBe(1);
    expect(matched[0].correlationId).toBe(cid);
  });

  it("queryStats aggregates by type", async () => {
    eventBus.emit({ type: "http", severity: "info", source: "server", message: "req1", duration: 10 });
    eventBus.emit({ type: "http", severity: "error", source: "server", message: "req2", duration: 20 });
    eventBus.emit({ type: "mcp", severity: "info", source: "mcp", message: "tool", duration: 5 });
    await new Promise((r) => setTimeout(r, 10));

    const stats = queryStats(60_000);
    expect(stats.http.count).toBeGreaterThanOrEqual(2);
    expect(stats.http.errors).toBeGreaterThanOrEqual(1);
    expect(stats.mcp.count).toBeGreaterThanOrEqual(1);
  });

  it("exportJsonl produces valid JSONL", async () => {
    eventBus.emit({ type: "http", severity: "info", source: "server", message: "test" });
    await new Promise((r) => setTimeout(r, 10));

    const jsonl = exportJsonl();
    const lines = jsonl.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("exportOtlp produces valid OpenTelemetry JSON", async () => {
    eventBus.emit({
      type: "http",
      severity: "info",
      source: "server",
      message: "GET /api 200",
      duration: 100,
      correlationId: "trace-123",
    });
    await new Promise((r) => setTimeout(r, 10));

    const otlp = exportOtlp();
    const parsed = JSON.parse(otlp);
    expect(parsed.resourceSpans).toBeInstanceOf(Array);
    expect(parsed.resourceSpans[0].scopeSpans[0].spans.length).toBeGreaterThan(0);
    const span = parsed.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.traceId).toBeDefined();
    expect(span.spanId).toBeDefined();
  });
});
