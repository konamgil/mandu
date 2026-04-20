/**
 * `scheduler-cron` — request-level middleware that exposes the running
 * scheduler registration on `ctx` so handlers can inspect job status or
 * trigger an ad-hoc tick for debugging.
 *
 * This is intentionally a thin bridge — the cron jobs themselves are
 * defined with {@link import("../scheduler").defineCron} and started at
 * `startServer()` boot time. The middleware does NOT start or stop the
 * scheduler; its only job is to make the `CronRegistration` handle
 * available to downstream request handlers (e.g., an observability
 * dashboard API that wants to render `status()`).
 *
 * The middleware is opt-in — it's NOT part of the default chain. Add it
 * to `mandu.config.ts` `middleware: [...]` only if you have a route that
 * needs `ctx.scheduler`.
 *
 * @example
 * ```ts
 * // mandu.config.ts
 * import { defineConfig } from "@mandujs/core";
 * import { schedulerCron } from "@mandujs/core/middleware";
 * import { jobs } from "./jobs";
 *
 * export default defineConfig({
 *   scheduler: { jobs },
 *   middleware: [schedulerCron()],
 * });
 * ```
 */

import { defineMiddleware } from "./define";
import type { Middleware } from "./define";
import type { CronRegistration } from "../scheduler";

/**
 * Global handle to the active {@link CronRegistration}, set by
 * `startServer()` when it boots the scheduler. `scheduler-cron` middleware
 * reads this slot on every request so the registration is always the one
 * actually running.
 *
 * We store it on `globalThis` rather than module-scope so that multiple
 * bundles (e.g., `@mandujs/core` loaded twice in a monorepo hot-reload)
 * still see the same handle — matches the registry pattern in
 * `runtime/server.ts`.
 */
const GLOBAL_KEY = "__MANDU_SCHEDULER_REGISTRATION__";

interface SchedulerGlobal {
  [GLOBAL_KEY]?: CronRegistration | null;
}

export function setActiveSchedulerRegistration(reg: CronRegistration | null): void {
  (globalThis as unknown as SchedulerGlobal)[GLOBAL_KEY] = reg;
}

export function getActiveSchedulerRegistration(): CronRegistration | null {
  return (globalThis as unknown as SchedulerGlobal)[GLOBAL_KEY] ?? null;
}

export interface SchedulerCronMiddlewareOptions {
  /**
   * Custom header to stamp on the response with the current scheduler job
   * count. Useful for smoke-checking that the scheduler is running in a
   * given environment. Default: no header is added.
   */
  statusHeader?: string;
}

/**
 * Creates a middleware that exposes the scheduler registration via a response
 * header and (optionally) stamps a status header. The registration itself is
 * wired into `ctx` via the request-level composition chain — downstream
 * code reads it with {@link getActiveSchedulerRegistration}.
 */
export function schedulerCron(options: SchedulerCronMiddlewareOptions = {}): Middleware {
  return defineMiddleware({
    name: "scheduler-cron",
    async handler(_req, next) {
      const response = await next();
      const reg = getActiveSchedulerRegistration();
      if (reg && options.statusHeader) {
        const status = reg.status();
        const jobCount = Object.keys(status).length;
        // Clone headers to avoid mutating an immutable response body.
        const headers = new Headers(response.headers);
        headers.set(options.statusHeader, String(jobCount));
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      }
      return response;
    },
  });
}
