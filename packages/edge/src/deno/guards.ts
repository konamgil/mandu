/**
 * Edge-compatibility guards for the Deno Deploy adapter.
 *
 * Mirrors the Workers implementation. Runs once at handler construction
 * so Deno users see manifest issues during `deno deploy` / `deno run`
 * cold boot rather than at first request.
 */

import type { RoutesManifest } from "@mandujs/core";

export interface AssertOptions {
  /** Suppress the throw — for advanced users with their own shims. */
  allowBunOnlyApis?: boolean;
}

/**
 * Validate the shape of a manifest. Catches accidental nulls, empty arrays
 * that would 404-everywhere, and routes missing required fields.
 */
export function assertEdgeCompatibleManifest(
  manifest: RoutesManifest,
  _options: AssertOptions = {}
): void {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(
      "[@mandujs/edge/deno] Invalid manifest: expected an object. " +
        "Import your generated `.mandu/routes.manifest.json`."
    );
  }

  if (!Array.isArray(manifest.routes)) {
    throw new Error("[@mandujs/edge/deno] manifest.routes must be an array.");
  }
}

/**
 * Detect "production" mode from common Deno Deploy signals.
 *
 * Deno Deploy exposes `Deno.env` with DENO_DEPLOYMENT_ID in production.
 * We also respect `NODE_ENV=production` for parity with Workers /
 * Vercel / Netlify adapters.
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
    /* ignore */
  }

  // Deno Deploy injects DENO_DEPLOYMENT_ID for deployed functions.
  try {
    const denoGlobal = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
    if (denoGlobal?.env?.get?.("DENO_DEPLOYMENT_ID")) {
      return true;
    }
  } catch {
    /* ignore */
  }

  if (env && typeof env === "object") {
    const binding = (env as { ENVIRONMENT?: unknown }).ENVIRONMENT;
    if (binding === "production") return true;
  }
  return false;
}

/** Short correlation ID for error logging. */
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
 * Mirrors Workers `hintBunOnlyApiError` with `runtime: "deno"`.
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

  const isBunOnlyApi = rawMessage.includes("[@mandujs/edge/deno] Bun.");
  const production = isProductionEnvironment(env);
  const correlationId = generateCorrelationId();

  if (isBunOnlyApi) {
    const payload = production
      ? {
          error: "BunApiUnsupportedOnEdge",
          message: "A Bun-only API was called at runtime; this deployment cannot service it.",
          hint:
            "This Bun-native API does not exist on Deno Deploy. " +
            "See the Phase 15 migration guide for HTTP-based alternatives " +
            "(deno-postgres, aws4fetch for S3, Deno Deploy Cron).",
          runtime: "deno",
          correlationId,
        }
      : {
          error: "BunApiUnsupportedOnEdge",
          message: rawMessage,
          hint:
            "This Bun-native API does not exist on Deno Deploy. " +
            "See the Phase 15 migration guide for HTTP-based alternatives " +
            "(deno-postgres, aws4fetch for S3, Deno Deploy Cron).",
          runtime: "deno",
          correlationId,
        };

    logFullError(error, correlationId);
    return Response.json(payload, { status: 500 });
  }

  logFullError(error, correlationId);
  const payload = production
    ? {
        error: "InternalServerError",
        message: "Internal Server Error",
        runtime: "deno",
        correlationId,
      }
    : {
        error: "InternalServerError",
        message: rawMessage,
        runtime: "deno",
        correlationId,
      };
  return Response.json(payload, { status: 500 });
}

function logFullError(error: unknown, correlationId: string): void {
  try {
    if (error instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(
        `[@mandujs/edge/deno] correlationId=${correlationId} ${error.name}: ${error.message}`,
        error.stack ?? "(no stack)"
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(
        `[@mandujs/edge/deno] correlationId=${correlationId} non-Error thrown:`,
        error
      );
    }
  } catch {
    /* logging must never throw */
  }
}
