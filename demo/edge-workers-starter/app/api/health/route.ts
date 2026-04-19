import { Mandu } from "@mandujs/core";
import { getWorkersEnv } from "@mandujs/edge/workers";

/**
 * Health-check endpoint proving API routes work on Cloudflare Workers.
 *
 * Returns a JSON payload so probes can verify the deploy is live and
 * that `env` bindings are reachable from inside request handlers.
 */
export default Mandu.filling().get((ctx) => {
  const env = getWorkersEnv();
  return ctx.ok({
    runtime: "workers",
    status: "ok",
    timestamp: new Date().toISOString(),
    envKeys: env ? Object.keys(env).sort() : [],
  });
});
