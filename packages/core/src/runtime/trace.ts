/**
 * Mandu Trace 🧭
 * Lifecycle 단계별 추적 (옵션)
 */

import type { ManduContext } from "../filling/context";

export type TraceEvent =
  | "request"
  | "parse"
  | "transform"
  | "beforeHandle"
  | "handle"
  | "afterHandle"
  | "mapResponse"
  | "afterResponse"
  | "error";

export type TracePhase = "begin" | "end" | "error";

export interface TraceEntry {
  event: TraceEvent;
  phase: TracePhase;
  time: number;
  name?: string;
  error?: string;
}

export interface TraceCollector {
  records: TraceEntry[];
}

export interface TraceReportEntry {
  event: TraceEvent;
  name?: string;
  start: number;
  end: number;
  duration: number;
}

export interface TraceReport {
  entries: TraceReportEntry[];
  errors: TraceEntry[];
}

export const TRACE_KEY = "__mandu_trace";

const now = (): number => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

export function enableTrace(ctx: ManduContext): TraceCollector {
  const existing = ctx.get<TraceCollector>(TRACE_KEY);
  if (existing) return existing;
  const collector: TraceCollector = { records: [] };
  ctx.set(TRACE_KEY, collector);
  return collector;
}

export function getTrace(ctx: ManduContext): TraceCollector | undefined {
  return ctx.get<TraceCollector>(TRACE_KEY);
}

/**
 * Build a normalized trace report with durations
 */
export function buildTraceReport(collector: TraceCollector): TraceReport {
  const entries: TraceReportEntry[] = [];
  const errors: TraceEntry[] = [];
  const stacks = new Map<string, TraceEntry[]>();

  for (const record of collector.records) {
    if (record.phase === "error") {
      errors.push(record);
      continue;
    }

    const key = `${record.event}:${record.name ?? ""}`;
    if (record.phase === "begin") {
      const stack = stacks.get(key) ?? [];
      stack.push(record);
      stacks.set(key, stack);
      continue;
    }

    if (record.phase === "end") {
      const stack = stacks.get(key);
      const begin = stack?.pop();
      if (!begin) continue;
      entries.push({
        event: record.event,
        name: record.name,
        start: begin.time,
        end: record.time,
        duration: record.time - begin.time,
      });
    }
  }

  return { entries, errors };
}

/**
 * Convert trace report to JSON string
 */
export function formatTraceReport(report: TraceReport): string {
  return JSON.stringify(report, null, 2);
}

export interface Tracer {
  enabled: boolean;
  begin: (event: TraceEvent, name?: string) => () => void;
  error: (event: TraceEvent, err: unknown, name?: string) => void;
}

const NOOP_TRACER: Tracer = {
  enabled: false,
  begin: () => () => {},
  error: () => {},
};

export function createTracer(ctx: ManduContext, enabled?: boolean): Tracer {
  const shouldEnable = Boolean(enabled) || ctx.has(TRACE_KEY);
  if (!shouldEnable) return NOOP_TRACER;

  const collector = enableTrace(ctx);

  return {
    enabled: true,
    begin: (event, name) => {
      collector.records.push({ event, phase: "begin", time: now(), name });
      return () => {
        collector.records.push({ event, phase: "end", time: now(), name });
      };
    },
    error: (event, err, name) => {
      const message = err instanceof Error ? err.message : String(err);
      collector.records.push({ event, phase: "error", time: now(), name, error: message });
    },
  };
}
