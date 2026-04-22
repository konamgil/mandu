/**
 * run-events — structured ATE event emitter.
 *
 * Thin wrapper around `@mandujs/core/observability`'s singleton
 * `eventBus` for the six canonical ATE monitor kinds. Every call is
 * wrapped in try/catch so a misbehaving subscriber can never fail a
 * spec run. Callers pass a typed `AteMonitorEvent` and we forward it
 * through `eventBus.emit({ type: "ate", data })`.
 *
 * Consumers should subscribe via:
 *
 *   import { eventBus } from "@mandujs/core/observability";
 *   eventBus.on("ate", (e) => {
 *     const payload = e.data as AteMonitorEvent;
 *     if (payload.kind === "spec_done") { ... }
 *   });
 */
import { eventBus } from "@mandujs/core/observability";
import type {
  AteMonitorEvent,
  AteRunStartEvent,
  AteSpecProgressEvent,
  AteSpecDoneEvent,
  AteFailureCapturedEvent,
  AteArtifactSavedEvent,
  AteRunEndEvent,
} from "./types";

type Severity = "info" | "warn" | "error";

function severityFor(event: AteMonitorEvent): Severity {
  if (event.kind === "failure_captured") return "error";
  if (event.kind === "spec_done" && event.status === "fail") return "error";
  return "info";
}

function messageFor(event: AteMonitorEvent): string {
  switch (event.kind) {
    case "run_start":
      return `ATE run ${event.runId} started (${event.specPaths.length} spec${event.specPaths.length === 1 ? "" : "s"})`;
    case "spec_progress":
      return `ATE ${event.specPath} ${event.phase}`;
    case "spec_done":
      return `ATE ${event.specPath} ${event.status} (${event.durationMs}ms)`;
    case "failure_captured":
      return `ATE ${event.specPath} failure.v1 kind=${event.failure.kind}`;
    case "artifact_saved":
      return `ATE artifact ${event.artifactKind} saved: ${event.path}`;
    case "run_end":
      return `ATE run ${event.runId} done — ${event.passed} pass, ${event.failed} fail, ${event.skipped} skip (${event.durationMs}ms)`;
  }
}

/**
 * Emit a single structured ATE monitor event. Never throws — a
 * misbehaving subscriber is swallowed silently so a spec run can
 * continue even when the bus is degraded.
 */
export function emitAteEvent(event: AteMonitorEvent): void {
  try {
    eventBus.emit({
      type: "ate",
      severity: severityFor(event),
      source: "ate",
      message: messageFor(event),
      data: event as unknown as Record<string, unknown>,
    });
  } catch {
    // Never propagate emit failures into the spec runner.
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Typed convenience wrappers — callers in run.ts / artifact-store.ts use
// these rather than constructing object literals, so a schema drift shows
// up as a compile error at the emit site.
// ────────────────────────────────────────────────────────────────────────────

export function emitRunStart(event: Omit<AteRunStartEvent, "kind">): void {
  emitAteEvent({ kind: "run_start", ...event });
}

export function emitSpecProgress(event: Omit<AteSpecProgressEvent, "kind">): void {
  emitAteEvent({ kind: "spec_progress", ...event });
}

export function emitSpecDone(event: Omit<AteSpecDoneEvent, "kind">): void {
  emitAteEvent({ kind: "spec_done", ...event });
}

export function emitFailureCaptured(event: Omit<AteFailureCapturedEvent, "kind">): void {
  emitAteEvent({ kind: "failure_captured", ...event });
}

export function emitArtifactSaved(event: Omit<AteArtifactSavedEvent, "kind">): void {
  emitAteEvent({ kind: "artifact_saved", ...event });
}

export function emitRunEnd(event: Omit<AteRunEndEvent, "kind">): void {
  emitAteEvent({ kind: "run_end", ...event });
}
