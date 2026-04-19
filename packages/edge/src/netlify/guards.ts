/**
 * Edge-compatibility guards for the Netlify Edge adapter.
 *
 * Netlify Edge Functions run on Deno Deploy, so the shape of guarded
 * APIs matches the Deno adapter closely. Runtime signals differ —
 * Netlify injects `NETLIFY=true` and `CONTEXT=production|deploy-preview`
 * into the environment.
 */

import type { RoutesManifest } from "@mandujs/core";

export interface AssertOptions {
  allowBunOnlyApis?: boolean;
}

export function assertEdgeCompatibleManifest(
  manifest: RoutesManifest,
  _options: AssertOptions = {}
): void {
  if (!manifest || typeof manifest !== "object") {
    throw new Error(
      "[@mandujs/edge/netlify] Invalid manifest: expected an object. " +
        "Import your generated `.mandu/routes.manifest.json`."
    );
  }

  if (!Array.isArray(manifest.routes)) {
    throw new Error("[@mandujs/edge/netlify] manifest.routes must be an array.");
  }
}

/**
 * Detect "production" mode from common Netlify signals.
 *
 * Netlify injects:
 *   - `NETLIFY=true` — always on Netlify deploys
 *   - `CONTEXT=production|deploy-preview|branch-deploy` — the deploy context
 *   - `NODE_ENV=production` — present on prod deploys
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

    const ctx =
      typeof process !== "undefined" && process.env
        ? process.env.CONTEXT
        : undefined;
    if (ctx === "production") return true;
  } catch {
    /* ignore */
  }

  if (env && typeof env === "object") {
    const binding = (env as { ENVIRONMENT?: unknown }).ENVIRONMENT;
    if (binding === "production") return true;
    const netlifyCtx = (env as { CONTEXT?: unknown }).CONTEXT;
    if (netlifyCtx === "production") return true;
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

  const isBunOnlyApi = rawMessage.includes("[@mandujs/edge/netlify] Bun.");
  const production = isProductionEnvironment(env);
  const correlationId = generateCorrelationId();

  if (isBunOnlyApi) {
    const payload = production
      ? {
          error: "BunApiUnsupportedOnEdge",
          message: "A Bun-only API was called at runtime; this deployment cannot service it.",
          hint:
            "This Bun-native API does not exist on Netlify Edge. " +
            "See the Phase 15 migration guide for HTTP-based alternatives " +
            "(Netlify Blobs / deno-postgres / aws4fetch / Netlify scheduled functions).",
          runtime: "netlify-edge",
          correlationId,
        }
      : {
          error: "BunApiUnsupportedOnEdge",
          message: rawMessage,
          hint:
            "This Bun-native API does not exist on Netlify Edge. " +
            "See the Phase 15 migration guide for HTTP-based alternatives " +
            "(Netlify Blobs / deno-postgres / aws4fetch / Netlify scheduled functions).",
          runtime: "netlify-edge",
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
        runtime: "netlify-edge",
        correlationId,
      }
    : {
        error: "InternalServerError",
        message: rawMessage,
        runtime: "netlify-edge",
        correlationId,
      };
  return Response.json(payload, { status: 500 });
}

function logFullError(error: unknown, correlationId: string): void {
  try {
    if (error instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(
        `[@mandujs/edge/netlify] correlationId=${correlationId} ${error.name}: ${error.message}`,
        error.stack ?? "(no stack)"
      );
    } else {
      // eslint-disable-next-line no-console
      console.error(
        `[@mandujs/edge/netlify] correlationId=${correlationId} non-Error thrown:`,
        error
      );
    }
  } catch {
    /* logging must never throw */
  }
}
