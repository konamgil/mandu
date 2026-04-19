/**
 * Edge-compatibility guards for the Vercel Edge adapter.
 *
 * Mirrors the Workers implementation. Runs once at handler construction
 * so Vercel users see manifest issues during `vercel build` cold boot
 * rather than at first request.
 */

import type { RoutesManifest } from "@mandujs/core";

export interface AssertOptions {
  /** Suppress the throw — for advanced users with their own shims. */
  allowBunOnlyApis?: boolean;
}

export function assertEdgeCompatibleManifest(
  manifest: RoutesManifest,
  _options: AssertOptions = {}
): void {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(
      "[@mandujs/edge/vercel] Invalid manifest: expected an object. " +
        "Import your generated `.mandu/routes.manifest.json`."
    );
  }

  if (!Array.isArray(manifest.routes)) {
    throw new Error("[@mandujs/edge/vercel] manifest.routes must be an array.");
  }
}

/**
 * Detect "production" mode from common Vercel Edge signals.
 *
 * Vercel injects `VERCEL_ENV=production|preview|development` and
 * `process.env.NODE_ENV=production` in deployments. We also accept an
 * explicit `env.ENVIRONMENT === "production"` override for parity with the
 * Workers adapter.
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

    const vercelEnv =
      typeof process !== "undefined" && process.env
        ? process.env.VERCEL_ENV
        : undefined;
    if (vercelEnv === "production") return true;
  } catch {
    /* ignore */
  }

  if (env && typeof env === "object") {
    const binding = (env as { ENVIRONMENT?: unknown }).ENVIRONMENT;
    if (binding === "production") return true;
    const vercelEnvBinding = (env as { VERCEL_ENV?: unknown }).VERCEL_ENV;
    if (vercelEnvBinding === "production") return true;
  }
  return false;
}

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

  const isBunOnlyApi = rawMessage.includes("[@mandujs/edge/vercel] Bun.");
  const production = isProductionEnvironment(env);
  const correlationId = generateCorrelationId();

  if (isBunOnlyApi) {
    const payload = production
      ? {
          error: "BunApiUnsupportedOnEdge",
          message: "A Bun-only API was called at runtime; this deployment cannot service it.",
          hint:
            "This Bun-native API does not exist on Vercel Edge. " +
            "See the Phase 15 migration guide for HTTP-based alternatives " +
            "(Vercel Postgres, aws4fetch for S3, Vercel Cron Jobs).",
          runtime: "vercel-edge",
          correlationId,
        }
      : {
          error: "BunApiUnsupportedOnEdge",
          message: rawMessage,
          hint:
            "This Bun-native API does not exist on Vercel Edge. " +
            "See the Phase 15 migration guide for HTTP-based alternatives " +
            "(Vercel Postgres, aws4fetch for S3, Vercel Cron Jobs).",
          runtime: "vercel-edge",
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
        runtime: "vercel-edge",
        correlationId,
      }
    : {
        error: "InternalServerError",
        message: rawMessage,
        runtime: "vercel-edge",
        correlationId,
      };
  return Response.json(payload, { status: 500 });
}

function logFullError(error: unknown, correlationId: string): void {
  try {
    if (error instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(
        `[@mandujs/edge/vercel] correlationId=${correlationId} ${error.name}: ${error.message}`,
        error.stack ?? "(no stack)"
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(
        `[@mandujs/edge/vercel] correlationId=${correlationId} non-Error thrown:`,
        error
      );
    }
  } catch {
    /* logging must never throw */
  }
}
