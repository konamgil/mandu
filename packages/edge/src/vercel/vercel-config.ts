/**
 * `vercel.json` generator for the Vercel Edge runtime.
 *
 * Emits a minimal Vercel config covering:
 *   - The Edge API Function that owns the Mandu fetch handler
 *     (via the `functions.*.runtime = "edge"` field)
 *   - A catch-all rewrite so all user requests hit the handler
 *   - Optional `regions` allow-list
 *   - Optional `crons` trigger array that maps to Vercel Cron Jobs
 *   - Optional `headers` block (e.g. security headers)
 *
 * The caller is responsible for writing the output to disk. The function
 * returns a JSON string (Vercel's `vercel.json` is strictly JSON — no
 * trailing commas, no comments, no $schema required).
 */

export interface VercelConfigOptions {
  /**
   * Project name — used only for the leading comment; Vercel reads the
   * name from the `project.json` linked to the deployment, not from
   * `vercel.json`. Must match the slug rules for filename safety.
   */
  projectName: string;
  /**
   * Relative path to the Edge Function entry. Defaults to `api/_mandu.ts`.
   * Must live under `api/` so Vercel's build detects it as a Serverless/
   * Edge Function.
   */
  functionPath?: string;
  /**
   * Deployment regions (e.g. `["iad1", "fra1"]`). Defaults to omitted
   * (Vercel uses `"all"` by default for the Edge runtime).
   */
  regions?: string[];
  /**
   * Vercel Cron Jobs — GET requests scheduled by Vercel. Each entry must
   * have a path that exists in your deployment (Mandu users will typically
   * point these at `/api/cron/*` handlers).
   */
  crons?: Array<{ path: string; schedule: string }>;
  /**
   * Extra rewrites. The catch-all rewrite `/(.*)` → functionPath is
   * always prepended to give user rewrites a chance to run first if
   * they are more specific.
   */
  rewrites?: Array<{ source: string; destination: string }>;
  /**
   * HTTP response headers to apply globally. Most users will use Mandu's
   * `middleware/security-headers` instead — this is for deployment-level
   * cases (CDN-only caching etc.).
   */
  headers?: Array<{
    source: string;
    headers: Array<{ key: string; value: string }>;
  }>;
}

const VERCEL_REGION_RE = /^[a-z]{3}[0-9]$/;

/**
 * Generate `vercel.json` contents as a JSON string.
 *
 * @example
 * ```ts
 * const json = generateVercelEdgeConfig({
 *   projectName: "my-mandu-app",
 *   regions: ["iad1"],
 * });
 * await Bun.write("./vercel.json", json);
 * ```
 */
export function generateVercelEdgeConfig(options: VercelConfigOptions): string {
  if (!options.projectName || typeof options.projectName !== "string") {
    throw new Error("generateVercelEdgeConfig: projectName is required");
  }
  if (!/^[a-z0-9-]+$/.test(options.projectName)) {
    throw new Error(
      `generateVercelEdgeConfig: projectName must match /^[a-z0-9-]+$/ ` +
        `(got: "${options.projectName}")`
    );
  }

  const functionPath = options.functionPath ?? "api/_mandu.ts";
  if (!functionPath.startsWith("api/")) {
    throw new Error(
      `generateVercelEdgeConfig: functionPath must live under api/ ` +
        `(got: "${functionPath}")`
    );
  }

  if (options.regions) {
    for (const region of options.regions) {
      if (!VERCEL_REGION_RE.test(region)) {
        throw new Error(
          `generateVercelEdgeConfig: region "${region}" is not a valid Vercel ` +
            `region code (expected 3 letters + digit, e.g. "iad1")`
        );
      }
    }
  }

  if (options.crons) {
    for (const cron of options.crons) {
      if (!cron.path || !cron.schedule) {
        throw new Error(
          `generateVercelEdgeConfig: each cron entry requires both 'path' and 'schedule'`
        );
      }
      if (!cron.path.startsWith("/")) {
        throw new Error(
          `generateVercelEdgeConfig: cron.path must start with "/" ` +
            `(got: "${cron.path}")`
        );
      }
    }
  }

  // Vercel matches on file path but user-supplied extensions should be
  // preserved. The function record key is the file path relative to the
  // project root.
  const functions: Record<string, { runtime: string }> = {
    [functionPath]: { runtime: "edge" },
  };

  const catchAll = { source: "/(.*)", destination: `/${functionPath.replace(/\.[jt]sx?$/, "")}` };
  const rewrites = [...(options.rewrites ?? []), catchAll];

  const config: Record<string, unknown> = {
    $schema: "https://openapi.vercel.sh/vercel.json",
    functions,
    rewrites,
  };

  if (options.regions && options.regions.length > 0) {
    config.regions = options.regions;
  }

  if (options.crons && options.crons.length > 0) {
    config.crons = options.crons;
  }

  if (options.headers && options.headers.length > 0) {
    config.headers = options.headers;
  }

  return JSON.stringify(config, null, 2) + "\n";
}
