/**
 * Background jobs for the auth-starter demo.
 *
 * Phase 3.1 shipped `@mandujs/core/scheduler` which wraps `Bun.cron`
 * (Bun 1.3.12+). This module defines ONE job — a periodic "session GC" —
 * then wires `.start()` so the scheduler registers it at boot.
 *
 * Why a try/catch around `.start()`:
 *   - `Bun.cron` was added in Bun 1.3.12. On 1.3.10 and 1.3.11 it is `undefined`
 *     and `defineCron({...}).start()` throws from `getBunCron()` the moment it
 *     probes the runtime.
 *   - The demo must boot on older Bun — missing cron is a graceful degradation
 *     (no scheduled GC, but login / upload / etc still work).
 *   - We log loudly so operators notice without crashing the process.
 *
 * Why the handler looks like a no-op for cookie sessions:
 *   - The demo uses `createCookieSessionStorage` — sessions live in the signed
 *     cookie on the client, so the server has nothing to sweep. We still want
 *     to exercise the scheduler end-to-end (one cron firing, one observable
 *     side effect), so the handler logs a structured line and bumps a counter.
 *   - A production app with server-side sessions would swap the body for
 *     `await storage.deleteExpired()` — identical shape, real work inside.
 *
 * Export `registerBackgroundJobs()` so callers can opt in from a boot hook;
 * we also invoke it on module load so side-effect imports work (the demo
 * imports this module from `src/lib/auth.ts`, which every page/API route
 * transitively pulls in).
 */
import { defineCron } from "@mandujs/core/scheduler";

// Module-level so the cron handler accumulates observable state across ticks.
let gcRunCount = 0;

/**
 * Build the cron registration. Exported (not just invoked) so tests could, in
 * principle, introspect — the demo itself does not call `.status()` anywhere.
 */
function buildJobs() {
  return defineCron({
    "session-gc": {
      // Every hour on the hour. "@hourly" shorthand is not accepted by all
      // cron parsers — the explicit 5-field expression is safer across
      // Bun.cron versions.
      schedule: "0 * * * *",
      run: async ({ scheduledAt }) => {
        gcRunCount += 1;
        // Structured single-line output so it's grep-able in logs. A real GC
        // would `await sessionStorage.deleteExpiredRecords()` here; our cookie
        // sessions have nothing to sweep, so we just record the heartbeat.
        console.log(
          `[auth-starter] session-gc tick #${gcRunCount} scheduledAt=${scheduledAt.toISOString()}`,
        );
      },
      // Dev skip is tempting, but the demo WANT to show the cron ran at least
      // once in an E2E run; leave it enabled in all envs and rely on the
      // "every hour" cadence so it doesn't spam test output.
    },
  });
}

// Lazy singleton — `buildJobs()` is cheap but we only need one registration
// per process. `registerBackgroundJobs()` is idempotent.
let registration: ReturnType<typeof buildJobs> | null = null;

/**
 * Idempotent: the first call registers + starts the cron, subsequent calls are
 * no-ops. Safe to invoke from multiple entry points (side-effect import, boot
 * hook, explicit call in a script) without double-scheduling.
 *
 * When `SESSION_STORE=sqlite`, the SQLite session storage registers its own
 * `mandu_sessions:gc` cron internally — this heartbeat becomes redundant, so
 * we skip it and log a breadcrumb instead of double-scheduling.
 */
export function registerBackgroundJobs(): void {
  if (registration !== null) return;
  if (process.env.SESSION_STORE === "sqlite") {
    console.log(
      "[auth-starter] SESSION_STORE=sqlite — SQLite session store manages its own GC cron, skipping local session-gc heartbeat.",
    );
    return;
  }
  try {
    registration = buildJobs();
    registration.start();
    console.log("[auth-starter] background jobs registered (session-gc @ 0 * * * *)");
  } catch (error) {
    // Clear so a future call on a Bun that upgraded mid-process can retry.
    registration = null;
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(
      `[auth-starter] background jobs disabled (requires Bun 1.3.12+). Reason: ${msg}`,
    );
  }
}

// Fire once per process. Importing this module is the registration signal —
// `src/lib/auth.ts` re-exports nothing from here but imports it for the effect.
registerBackgroundJobs();
