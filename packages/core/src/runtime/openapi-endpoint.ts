/**
 * Runtime OpenAPI endpoint.
 *
 * Serves the build-time `.mandu/openapi.json` / `.mandu/openapi.yaml`
 * artifacts at a stable URL (default `/__mandu/openapi.json` and
 * `.yaml`) so API consumers (Postman, codegen, Swagger UI proxies) can
 * fetch a canonical spec without reaching into the framework's dev
 * Kitchen dashboard.
 *
 * Contract:
 *   - Disabled by default — the server dispatcher gates this handler
 *     behind `ManduConfig.openapi.enabled` or the
 *     `MANDU_OPENAPI_ENABLED=1` env var.
 *   - Lazy-load artifacts on first request; in-memory cache survives
 *     for the lifetime of the server instance. Re-deploy to invalidate.
 *   - If artifacts are missing on disk, fall back to live generation
 *     from the registered manifest so `mandu dev` users still get a
 *     valid response without running `mandu build` first.
 *   - ETag = SHA-256 of the JSON body. Supports `If-None-Match` 304
 *     short-circuiting so downstream caches (CDN, reverse proxy) behave
 *     correctly.
 */

import type { RoutesManifest } from "../spec/schema";
import {
  generateOpenAPIDocument,
  hashOpenAPIJSON,
  openAPIToJSON,
  openAPIToYAML,
  readOpenAPIArtifacts,
} from "../openapi/generator";

export const DEFAULT_OPENAPI_BASE_PATH = "/__mandu/openapi";
const DEFAULT_ARTIFACT_DIR = ".mandu";
const CACHE_CONTROL = "public, max-age=0, must-revalidate";

/**
 * Runtime-resolved OpenAPI endpoint configuration. Mirrors the shape
 * the server threads through `ServerRegistrySettings` so the hot-path
 * dispatch can stay allocation-free.
 */
export interface OpenAPIEndpointSettings {
  /** Base path without the trailing `.json`/`.yaml`. Default `/__mandu/openapi`. */
  basePath: string;
  /** Absolute directory containing `openapi.json` / `openapi.yaml` artifacts. */
  artifactDir: string;
}

interface CacheEntry {
  json: string;
  yaml: string;
  hash: string;
  etag: string;
}

/** Module-scoped cache — invalidated by `invalidateOpenAPIEndpointCache()`. */
let cache: CacheEntry | null = null;
let pending: Promise<CacheEntry | null> | null = null;

/** Test / HMR hook: drop the cached spec so the next request recomputes. */
export function invalidateOpenAPIEndpointCache(): void {
  cache = null;
  pending = null;
}

/**
 * Resolve the OpenAPI body, either from disk artifacts (preferred) or
 * by generating live from the manifest. Concurrent callers share one
 * in-flight load so we never rebuild the spec twice on a thundering
 * herd.
 */
async function loadSpec(
  manifest: RoutesManifest,
  rootDir: string,
  settings: OpenAPIEndpointSettings
): Promise<CacheEntry | null> {
  if (cache) return cache;
  if (pending) return pending;

  pending = (async (): Promise<CacheEntry | null> => {
    try {
      // 1. Prefer on-disk artifacts (produced by `mandu build`). Keeps
      //    request-time cost at a single file read instead of walking
      //    every contract module again.
      const fromDisk = await readOpenAPIArtifacts(settings.artifactDir, rootDir);
      if (fromDisk) {
        const entry: CacheEntry = {
          json: fromDisk.json,
          yaml: fromDisk.yaml,
          hash: fromDisk.hash,
          etag: `"${fromDisk.hash}"`,
        };
        cache = entry;
        return entry;
      }

      // 2. Fallback: generate live. Useful in `mandu dev` before the
      //    user has run `mandu build`, or in test harnesses that boot a
      //    server directly from a manifest fixture.
      const doc = await generateOpenAPIDocument(manifest, rootDir);
      const json = openAPIToJSON(doc);
      const yaml = openAPIToYAML(doc);
      const hash = await hashOpenAPIJSON(json);
      const entry: CacheEntry = {
        json,
        yaml,
        hash,
        etag: `"${hash}"`,
      };
      cache = entry;
      return entry;
    } catch {
      // Swallow the error — a 500 here would be worse DX than a 404.
      // Invalidate so the next request retries.
      cache = null;
      return null;
    } finally {
      pending = null;
    }
  })();

  return pending;
}

/**
 * Handle a GET request for the OpenAPI endpoint.
 *
 * Returns `null` when the pathname does not match — the dispatcher
 * should fall through to the normal route resolution pipeline. Returns
 * a `Response` for both hit (200 + spec) and miss (404 when the spec
 * cannot be materialized). Only `GET` and `HEAD` are accepted; every
 * other method gets a 405 with `Allow: GET, HEAD`.
 */
export async function handleOpenAPIRequest(
  req: Request,
  pathname: string,
  manifest: RoutesManifest,
  rootDir: string,
  settings: OpenAPIEndpointSettings
): Promise<Response | null> {
  const jsonPath = `${settings.basePath}.json`;
  const yamlPath = `${settings.basePath}.yaml`;

  let variant: "json" | "yaml";
  if (pathname === jsonPath) variant = "json";
  else if (pathname === yamlPath) variant = "yaml";
  else return null;

  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        Allow: "GET, HEAD",
        "Cache-Control": "no-store",
      },
    });
  }

  const entry = await loadSpec(manifest, rootDir, settings);
  if (!entry) {
    return new Response("Not Found", { status: 404 });
  }

  // Conditional-GET: honour `If-None-Match` for CDN / browser caches.
  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === entry.etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: entry.etag,
        "Cache-Control": CACHE_CONTROL,
      },
    });
  }

  const body = variant === "json" ? entry.json : entry.yaml;
  const contentType =
    variant === "json"
      ? "application/json; charset=utf-8"
      : "application/yaml; charset=utf-8";

  // HEAD responses carry the headers but drop the body.
  const responseBody = req.method === "HEAD" ? null : body;
  return new Response(responseBody, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": CACHE_CONTROL,
      ETag: entry.etag,
      // Expose ETag to browser JS so API explorer UIs can display the
      // deploy identifier without a round-trip.
      "Access-Control-Expose-Headers": "ETag",
    },
  });
}

/**
 * Resolve the effective endpoint settings for a server boot. Normalizes
 * the `path` option (users may pass with or without leading slash, and
 * with or without the `.json` suffix) and chooses the artifact
 * directory default.
 */
export function resolveOpenAPIEndpointSettings(
  rootDir: string,
  path?: string
): OpenAPIEndpointSettings {
  let basePath = path ?? DEFAULT_OPENAPI_BASE_PATH;
  if (!basePath.startsWith("/")) basePath = `/${basePath}`;
  // Strip trailing `.json` / `.yaml` / trailing slash so the handler can
  // append suffixes uniformly.
  basePath = basePath.replace(/\.(json|yaml|yml)$/i, "").replace(/\/+$/, "");
  if (basePath === "") basePath = DEFAULT_OPENAPI_BASE_PATH;

  // POSIX-style join — artifact paths are treated as absolute by
  // `readOpenAPIArtifacts`, which itself uses `node:path` for portability.
  const normalizedRoot = rootDir.replace(/[\\/]+$/, "");
  const separator = normalizedRoot.includes("\\") ? "\\" : "/";
  const artifactDir = `${normalizedRoot}${separator}${DEFAULT_ARTIFACT_DIR}`;
  return { basePath, artifactDir };
}

/**
 * Decide whether the OpenAPI endpoint should be active for this
 * server instance. The config flag wins; an explicit `false` still
 * disables the endpoint even when the env var is set (explicit > env).
 * Absent config + truthy env var (`MANDU_OPENAPI_ENABLED=1`) opts in.
 */
export function isOpenAPIEndpointEnabled(
  enabled: boolean | undefined,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  if (enabled === true) return true;
  if (enabled === false) return false;
  const raw = env.MANDU_OPENAPI_ENABLED;
  return raw === "1" || raw === "true";
}
