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
 * Detect "production" mode from common Workers-friendly signals.
 * Workers itself does not expose `process.env.NODE_ENV` natively (it
 * comes via `nodejs_compat`), and user bindings often set
 * `env.ENVIRONMENT = "production"` instead.
 *
 * We prefer `process.env.NODE_ENV === "production"` when available,
 * and fall back to `env.ENVIRONMENT === "production"` if a Workers
 * binding object is passed in.
 */
export function isProductionEnvironment(
  env?: Record<string, unknown>
): boolean {
  try {
    const nodeEnv =
      typeof process !== "undefined" && process.env
        ? process.env.NODE_ENV
        : undefined;
    if (nodeEnv === "production") return true;
  } catch {
    // Ignore — some Workers deployments don't expose `process` at all.
  }
  if (env && typeof env === "object") {
    const binding = (env as { ENVIRONMENT?: unknown }).ENVIRONMENT;
    if (binding === "production") return true;
  }
  return false;
}

/**
 * Generate a short correlation ID for error logging. Uses WebCrypto
 * if available (Workers does), otherwise falls back to Math.random.
 * Not cryptographically meaningful — only needs to be ~unique per
 * request so operators can grep logs.
 */
function generateCorrelationId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `req-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}

/**
 * Translate a Bun-only API runtime error into a structured 500 response.
 * Triggered when a user's handler reaches `globalThis.Bun.sql` etc.,
 * which our polyfill throws on.
 *
 * ## Wave R3 L-04 — body scrubbing in production
 *
 * The pre-Wave-R3 implementation echoed `error.message` verbatim into
 * the 500 payload. In edge deployments that surfaces file paths, stack
 * fragments, and internal module names to any caller. We now:
 *
 *   - In **development** (NODE_ENV !== "production" and env.ENVIRONMENT
 *     !== "production") keep the full message — useful for local debug.
 *   - In **production** return a generic `"Internal Server Error"`
 *     message + a correlation ID, and log the full error server-side
 *     via `console.error` so Cloudflare Logpush can ingest it.
 *
 * The `stack` / `cause` fields are NEVER serialized into the HTTP body
 * in either mode — they remain log-only.
 */
export function hintBunOnlyApiError(
  error: unknown,
  env?: Record<string, unknown>
): Response {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";

  const isBunOnlyApi = rawMessage.includes("[@mandujs/edge/workers] Bun.");
  const production = isProductionEnvironment(env);
  const correlationId = generateCorrelationId();

  if (isBunOnlyApi) {
    // Keep the Bun-API hint visible even in production — it's a
    // configuration-error signal, not a user-data leak surface.
    const payload = production
      ? {
          error: "BunApiUnsupportedOnEdge",
          message: "A Bun-only API was called at runtime; this deployment cannot service it.",
          hint:
            "This Bun-native API does not exist on Cloudflare Workers. " +
            "See the Phase 15 migration guide for HTTP-based alternatives " +
            "(Neon PG driver, aws4fetch for S3, Workers Cron Triggers).",
          runtime: "workers",
          correlationId,
        }
      : {
          error: "BunApiUnsupportedOnEdge",
          message: rawMessage,
          hint:
            "This Bun-native API does not exist on Cloudflare Workers. " +
            "See the Phase 15 migration guide for HTTP-based alternatives " +
            "(Neon PG driver, aws4fetch for S3, Workers Cron Triggers).",
          runtime: "workers",
          correlationId,
        };

    // Log full error (with stack if available) for operators regardless of mode.
    logFullError(error, correlationId);
    return Response.json(payload, { status: 500 });
  }

  // Generic 500 — scrub message in production.
  logFullError(error, correlationId);
  const payload = production
    ? {
        error: "InternalServerError",
        message: "Internal Server Error",
        runtime: "workers",
        correlationId,
      }
    : {
        error: "InternalServerError",
        message: rawMessage,
        runtime: "workers",
        correlationId,
      };
  return Response.json(payload, { status: 500 });
}

/** Log the full error (stack when present) via console.error. */
function logFullError(error: unknown, correlationId: string): void {
  try {
    if (error instanceof Error) {
      // Serialize Error with its stack for Cloudflare Logpush ingestion.
      // eslint-disable-next-line no-console
      console.error(
        `[@mandujs/edge/workers] correlationId=${correlationId} ${error.name}: ${error.message}`,
        error.stack ?? "(no stack)"
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(
        `[@mandujs/edge/workers] correlationId=${correlationId} non-Error thrown:`,
        error
      );
    }
  } catch {
    /* logging must never throw */
  }
}
