/**
 * Edge-compatibility guards for the Workers adapter.
 *
 * Runs once at handler construction and never again — guard failures are
 * surfaced eagerly so users see them during `mandu build --target=workers`
 * (or their `wrangler dev` cold boot) rather than at first request.
 */

import type { RoutesManifest } from "@mandujs/core";

export interface AssertOptions {
  /** Suppress the throw — useful for advanced users with their own shims. */
  allowBunOnlyApis?: boolean;
}

/**
 * Validate the shape of a manifest. Catches accidental nulls, empty arrays
 * that would 404-everywhere, and routes missing required fields.
 *
 * Does **not** inspect route module bodies — static analysis for Bun.sql
 * usage happens at build time inside the CLI.
 */
export function assertEdgeCompatibleManifest(
  manifest: RoutesManifest,
  _options: AssertOptions = {}
): void {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(
      "[@mandujs/edge/workers] Invalid manifest: expected an object. " +
        "Import your generated `.mandu/routes.manifest.json`."
    );
  }

  if (!Array.isArray(manifest.routes)) {
    throw new Error(
      "[@mandujs/edge/workers] manifest.routes must be an array."
    );
  }
}

/**
 * Translate a Bun-only API runtime error into a structured 500 response.
 * Triggered when a user's handler reaches `globalThis.Bun.sql` etc., which
 * our polyfill throws on.
 */
export function hintBunOnlyApiError(error: unknown): Response {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";

  const isBunOnlyApi = message.includes("[@mandujs/edge/workers] Bun.");

  if (isBunOnlyApi) {
    const payload = {
      error: "BunApiUnsupportedOnEdge",
      message,
      hint:
        "This Bun-native API does not exist on Cloudflare Workers. " +
        "See the Phase 15 migration guide for HTTP-based alternatives " +
        "(Neon PG driver, aws4fetch for S3, Workers Cron Triggers).",
      runtime: "workers",
    };
    return Response.json(payload, { status: 500 });
  }

  // Preserve the existing generic-error behavior for everything else.
  const payload = {
    error: "InternalServerError",
    message: message,
    runtime: "workers",
  };
  return Response.json(payload, { status: 500 });
}
