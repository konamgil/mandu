/**
 * `mandu_ate_run` — Phase A.2 agent-facing spec runner.
 *
 * Wraps `@mandujs/ate`'s `runSpec` behind the MCP tool surface.
 *
 * Semantics: execute a single spec file (Playwright or bun:test,
 * auto-detected from the path), then return the failure.v1-shaped
 * JSON — `{ status: "pass", ... }` on green, full failure envelope
 * on red. Shard argument is forwarded transparently.
 *
 * The handler validates the returned shape against the failure.v1
 * Zod schema on failure (cheap, catches translator regressions).
 * On pass we return the pass envelope as-is.
 *
 * Issue #238 wiring:
 *   - Subscribes to `eventBus.on("ate", ...)` for the duration of the
 *     run and forwards every `spec_done` as an MCP
 *     `notifications/progress`. Progress total is captured from the
 *     `run_start` event, progressToken defaults to the runId when the
 *     caller didn't supply a client token (graceful no-op in that
 *     case — the notification is still emitted through the server but
 *     without an actionable token).
 *   - On timeout / exec failure, writes a partial results.json under
 *     `.mandu/reports/run-<runId>/` so `mandu.ate.heal` stays reachable
 *     even when the 10-min watchdog killed the runner.
 *
 * Snake_case naming per §11 decision 4.
 */
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  runSpec,
  failureV1Schema,
  type RunResult,
  type AteMonitorEvent,
  type FailureV1,
} from "@mandujs/ate";
import { eventBus } from "@mandujs/core/observability";

export const ateRunToolDefinitions: Tool[] = [
  {
    name: "mandu_ate_run",
    annotations: {
      readOnlyHint: false,
    },
    description:
      "Phase A.2 agent-native spec runner. Executes ONE spec file " +
      "(Playwright if the path matches tests/e2e/** or *.e2e.ts, otherwise bun:test) " +
      "and returns structured JSON. On pass: { status: 'pass', durationMs, assertions, graphVersion, runId }. " +
      "On fail: a failure.v1 envelope with discriminated `kind` (one of: selector_drift, " +
      "contract_mismatch, redirect_unexpected, hydration_timeout, rate_limit_exceeded, " +
      "csrf_invalid, fixture_missing, semantic_divergence), kind-specific `detail`, " +
      "`healing.auto[]` (deterministic replacements when confidence >= threshold), " +
      "`healing.requires_llm` (true for shape-level failures), `flakeScore`, `lastPassedAt`, " +
      "`graphVersion` (agent cache invalidation key), and trace/screenshot/dom artifacts " +
      "staged under .mandu/ate-artifacts/<runId>/. Use `shard: { current, total }` to " +
      "distribute across CI workers. Emits notifications/progress per spec_done event. " +
      "On timeout / cancel, writes .mandu/reports/run-<runId>/results.json with partial state.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: {
          type: "string",
          description: "Absolute path to the Mandu project root",
        },
        spec: {
          oneOf: [
            { type: "string" },
            {
              type: "object",
              properties: {
                path: { type: "string" },
              },
              required: ["path"],
            },
          ],
          description:
            "Spec file — either a path string (relative to repoRoot) or { path }. " +
            "Runner is auto-detected from the path (Playwright vs bun:test).",
        },
        headed: {
          type: "boolean",
          description: "Playwright only — run headed. Default: false (headless).",
        },
        trace: {
          type: "boolean",
          description: "Playwright only — capture trace. Default: true.",
        },
        shard: {
          type: "object",
          properties: {
            current: { type: "number", minimum: 1 },
            total: { type: "number", minimum: 1 },
          },
          required: ["current", "total"],
          description:
            "CI sharding — `current` is 1-based. Playwright receives --shard=current/total; " +
            "bun:test falls back to hash-based partitioning.",
        },
        progressToken: {
          type: ["string", "number"],
          description:
            "Optional MCP progress token to associate with emitted notifications/progress. " +
            "When omitted the runId is used as a fallback so progress events still correlate.",
        },
      },
      required: ["repoRoot", "spec"],
    },
  },
];

/**
 * Partial-result envelope written to disk when a run is killed mid-way.
 * Mirrors the shape heal/report consumers already know how to parse,
 * plus the extra status/killedAt fields so downstream tooling can spot
 * incomplete records without probing `mtime`.
 */
export interface PartialRunResults {
  runId: string;
  status: "timed_out" | "cancelled" | "error";
  graphVersion: string;
  completedSpecs: Array<{
    specPath: string;
    status: "pass" | "fail" | "skip";
    durationMs: number;
  }>;
  inProgressSpec: string | null;
  failures: FailureV1[];
  startedAt: string;
  killedAt: string;
  error?: string;
}

/**
 * Write the partial-results record under `.mandu/reports/run-<runId>/`.
 * Never throws — a write failure is logged via a noop since the caller
 * has already decided the run is over.
 */
export function writePartialResults(
  repoRoot: string,
  partial: PartialRunResults,
): string | null {
  try {
    const dir = join(repoRoot, ".mandu", "reports", `run-${partial.runId}`);
    mkdirSync(dir, { recursive: true });
    const target = join(dir, "results.json");
    writeFileSync(target, JSON.stringify(partial, null, 2), "utf8");
    return target;
  } catch {
    return null;
  }
}

/**
 * Stateful accumulator + progress-notification pipe. Exposed as a
 * factory so unit tests can drive the event handling path without
 * depending on the timing of a live runSpec call.
 *
 * Subscribe by calling `handle()` for each incoming AteMonitorEvent;
 * the corresponding progress notification fires synchronously via
 * `sendProgress`. Snapshot the run state via `snapshot()` after kill
 * to build a PartialRunResults.
 */
export interface AteProgressTracker {
  handle: (data: AteMonitorEvent) => void;
  snapshot: () => {
    runId: string | null;
    graphVersion: string;
    completedSpecs: PartialRunResults["completedSpecs"];
    inProgressSpec: string | null;
    failures: FailureV1[];
  };
}

export function createAteProgressTracker(options: {
  progressToken?: string | number;
  sendProgress: (progress: number, total: number, message: string) => void | Promise<void>;
}): AteProgressTracker {
  let runId: string | null = null;
  let graphVersion = "";
  let specTotal = 1;
  let completedCount = 0;
  let inProgressSpec: string | null = null;
  const completedSpecs: PartialRunResults["completedSpecs"] = [];
  const failures: FailureV1[] = [];

  const fire = (progress: number, total: number, message: string) => {
    try {
      const res = options.sendProgress(progress, total, message);
      if (res && typeof (res as Promise<void>).then === "function") {
        (res as Promise<void>).catch(() => {
          /* swallow */
        });
      }
    } catch {
      /* swallow */
    }
  };

  return {
    handle(data: AteMonitorEvent) {
      try {
        if (data.kind === "run_start") {
          runId = data.runId;
          graphVersion = data.graphVersion;
          specTotal = Math.max(1, data.specPaths.length);
          return;
        }
        if (data.kind === "spec_progress" && data.phase === "executing") {
          inProgressSpec = data.specPath;
          return;
        }
        if (data.kind === "failure_captured") {
          failures.push(data.failure);
          return;
        }
        if (data.kind === "spec_done") {
          completedCount += 1;
          inProgressSpec = null;
          completedSpecs.push({
            specPath: data.specPath,
            status: data.status,
            durationMs: data.durationMs,
          });
          const basename = data.specPath.split(/[\\/]/).pop() ?? data.specPath;
          fire(
            completedCount,
            specTotal,
            `[${completedCount}/${specTotal}] ${basename} ${data.status}`,
          );
          return;
        }
        if (data.kind === "run_end") {
          fire(
            specTotal,
            specTotal,
            `done — ${data.passed} pass, ${data.failed} fail, ${data.skipped} skip`,
          );
          return;
        }
      } catch {
        /* swallow */
      }
    },
    snapshot() {
      return {
        runId,
        graphVersion,
        completedSpecs,
        inProgressSpec,
        failures,
      };
    },
  };
}

/**
 * Build the handler factory. `server` is optional — tests that don't
 * instantiate an MCP server (e.g. unit-level invocations) can pass
 * `undefined` and progress notifications are silently no-oped.
 */
export function ateRunTools(_projectRoot: string, server?: Server) {
  return {
    mandu_ate_run: async (args: Record<string, unknown>) => {
      const { repoRoot, spec, headed, trace, shard, progressToken } = args as {
        repoRoot: string;
        spec: string | { path: string };
        headed?: boolean;
        trace?: boolean;
        shard?: { current: number; total: number };
        progressToken?: string | number;
      };
      if (!repoRoot || typeof repoRoot !== "string") {
        return { ok: false, error: "repoRoot is required" };
      }
      if (!spec) {
        return { ok: false, error: "spec is required" };
      }
      const specPath = typeof spec === "string" ? spec : spec?.path;
      if (!specPath || typeof specPath !== "string") {
        return { ok: false, error: "spec.path or spec string is required" };
      }
      if (shard) {
        if (
          typeof shard.current !== "number" ||
          typeof shard.total !== "number" ||
          shard.current < 1 ||
          shard.total < 1 ||
          shard.current > shard.total
        ) {
          return {
            ok: false,
            error: `invalid shard: ${JSON.stringify(shard)} (current must be 1..total)`,
          };
        }
      }

      // ── Event accumulator for progress + partial-results on timeout.
      const started = new Date().toISOString();

      const tracker = createAteProgressTracker({
        progressToken,
        sendProgress: async (progress, total, message) => {
          if (!server) return;
          const snap = tracker.snapshot();
          const token = progressToken ?? snap.runId;
          if (!token) return;
          try {
            await server.notification({
              method: "notifications/progress",
              params: { progressToken: token, progress, total, message },
            });
          } catch {
            // Transport may be offline — never fail the run.
          }
        },
      });

      const unsubscribe = eventBus.on("ate", (event) => {
        try {
          const data = event.data as unknown as AteMonitorEvent | undefined;
          if (!data || typeof data.kind !== "string") return;
          tracker.handle(data);
        } catch {
          // Listener errors must never propagate.
        }
      });

      let result: RunResult;
      try {
        result = await runSpec({
          repoRoot,
          spec: specPath,
          headed,
          trace,
          shard,
        });
      } catch (err) {
        // Runner timeout / exec error — persist partial state so heal
        // stays reachable.
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = /timed out/i.test(message);
        const snap = tracker.snapshot();
        const partial: PartialRunResults = {
          runId: snap.runId ?? `unknown-${Date.now()}`,
          status: isTimeout ? "timed_out" : "error",
          graphVersion: snap.graphVersion,
          completedSpecs: snap.completedSpecs,
          inProgressSpec: snap.inProgressSpec,
          failures: snap.failures,
          startedAt: started,
          killedAt: new Date().toISOString(),
          error: message,
        };
        const resultsPath = writePartialResults(repoRoot, partial);
        unsubscribe();
        return {
          ok: false,
          error: `runSpec failed: ${message}`,
          partial,
          resultsPath,
          runId: partial.runId,
        };
      } finally {
        // Runtime-safe even on success — idempotent unsubscribe.
        try {
          unsubscribe();
        } catch {
          /* no-op */
        }
      }

      // On failure, re-validate the shape against failure.v1. The
      // runSpec path already does this, but re-checking at the MCP
      // boundary means a buggy translator is caught before the
      // payload crosses the wire.
      if (result.status === "fail") {
        const parsed = failureV1Schema.safeParse(result);
        if (!parsed.success) {
          return {
            ok: false,
            error: `runSpec emitted invalid failure.v1: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
            result,
          };
        }
        return { ok: true, result: parsed.data };
      }
      return { ok: true, result };
    },
  };
}
