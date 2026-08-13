/**
 * `mandu db` — database handle resolution.
 *
 * Reads connection config from (in priority order):
 *
 *   1. `DATABASE_URL` environment variable — the universal CI pattern
 *      (Heroku / Railway / Supabase / Fly all export this).
 *   2. `mandu.config.{ts,js,json}` exporting a top-level `db: { url, provider, max }`
 *      object. Surface-compatible with the `DbConfig` shape that
 *      {@link createDb} accepts.
 *
 * There is **no implicit SQLite fallback** — explicit configuration is
 * better than silent defaulting, especially for production pipelines.
 * When neither source is present, this module throws a typed error with
 * a copy-paste-friendly remediation string.
 *
 * ## Why env wins over config
 *
 * The twelve-factor app principle (config-in-env) is the norm across
 * CI/CD, container orchestration, and managed hosts. Writing the URL
 * into `mandu.config.ts` is convenient for local development; the
 * `DATABASE_URL` environment variable is the idiomatic override in
 * every other context. The priority order above reflects that: env
 * *always* wins, so `DATABASE_URL=postgres://… bun mandu db apply`
 * does what an operator expects without editing source.
 *
 * @module cli/commands/db/resolve-db
 */

import path from "node:path";
import { createDb, detectProvider, type Db, type DbConfig, type SqlProvider } from "@mandujs/core/compat/db/index";

/**
 * Narrow, resolve-db-local DB section shape.
 *
 * We re-declare this (rather than augmenting `ManduConfig`) because the
 * `db` block isn't a first-class typed field of the existing config
 * today. Agent E treats it as an additive, opt-in record.
 */
export interface ResolvedDbSection {
  url: string;
  provider?: SqlProvider;
  max?: number;
}

export interface ResolveDbOptions {
  /** Project root — where `mandu.config.{ts,js,json}` lives. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override for tests — default reads `process.env.DATABASE_URL`. */
  envUrl?: string | undefined;
}

export interface ResolveDbResult {
  db: Db;
  source: "env" | "config";
  config: DbConfig;
}

/**
 * Produce a live {@link Db} handle + provenance tag.
 *
 * Never throws when one of the two sources is valid. Throws a typed
 * Error (`DbResolutionError`) otherwise — callers should catch and map
 * to CLI exit code 1 with a helpful message.
 *
 * @example
 * ```ts
 * const { db, source } = await resolveDb({ cwd: process.cwd() });
 * console.log(`Connected (${source}): ${db.provider}`);
 * ```
 */
export async function resolveDb(options: ResolveDbOptions = {}): Promise<ResolveDbResult> {
  const cwd = options.cwd ?? process.cwd();
  const envUrl =
    options.envUrl !== undefined ? options.envUrl : process.env.DATABASE_URL;

  // 1) Env takes precedence.
  if (typeof envUrl === "string" && envUrl.length > 0) {
    const provider = safeDetectProvider(envUrl);
    const config: DbConfig = { url: envUrl, provider };
    const db = createDb(config);
    return { db, source: "env", config };
  }

  // 2) Fall through to mandu.config's `db` block.
  const section = await readDbSectionFromConfig(cwd);
  if (section && typeof section.url === "string" && section.url.length > 0) {
    const provider = section.provider ?? safeDetectProvider(section.url);
    const config: DbConfig = {
      url: section.url,
      provider,
      ...(typeof section.max === "number" ? { max: section.max } : {}),
    };
    const db = createDb(config);
    return { db, source: "config", config };
  }

  throw new DbResolutionError(
    "No database URL configured.\n" +
      "  Fix: export DATABASE_URL=postgres://... (or sqlite::memory: for local dev)\n" +
      "  Or:  add `export default { db: { url: 'sqlite:./app.db' } }` to mandu.config.ts",
  );
}

/** Thrown when neither `DATABASE_URL` nor `mandu.config.db.url` is set. */
export class DbResolutionError extends Error {
  readonly name = "DbResolutionError";
}

// =====================================================================
// Internals
// =====================================================================

function safeDetectProvider(url: string): SqlProvider | undefined {
  try {
    return detectProvider(url);
  } catch {
    // Ambiguous URL — leave undefined; createDb will throw with the
    // same message if truly malformed. This keeps `resolveDb` forgiving
    // when the user supplies `provider` explicitly alongside a
    // nonstandard URL (e.g. a secrets-manager placeholder).
    return undefined;
  }
}

/**
 * Dynamic-import `mandu.config.{ts,js,json}` and pluck its `db` block.
 * We intentionally do NOT reuse `loadManduConfig` from core because that
 * loader strips fields it doesn't know (it calls `coerceConfig` which
 * passes through unrecognised keys — but the typed `ManduConfig` shape
 * has no `db` slot). Read directly here.
 */
async function readDbSectionFromConfig(cwd: string): Promise<ResolvedDbSection | null> {
  const candidates = [
    path.join(cwd, "mandu.config.ts"),
    path.join(cwd, "mandu.config.js"),
    path.join(cwd, "mandu.config.json"),
  ];
  for (const filePath of candidates) {
    if (!(await fileExists(filePath))) continue;
    try {
      if (filePath.endsWith(".json")) {
        const raw = await Bun.file(filePath).text();
        const parsed: unknown = JSON.parse(raw);
        return coerceDbSection(parsed);
      }
      const mod: unknown = await import(filePath);
      const raw = (mod as { default?: unknown })?.default ?? mod;
      return coerceDbSection(raw);
    } catch {
      // Swallow config read errors here — `resolveDb` will throw a
      // clearer error if no DB is found. Logging happens in the caller.
      continue;
    }
  }
  return null;
}

function coerceDbSection(raw: unknown): ResolvedDbSection | null {
  if (!raw || typeof raw !== "object") return null;
  const section = (raw as { db?: unknown }).db;
  if (!section || typeof section !== "object") return null;
  const { url, provider, max } = section as {
    url?: unknown;
    provider?: unknown;
    max?: unknown;
  };
  if (typeof url !== "string" || url.length === 0) return null;
  const out: ResolvedDbSection = { url };
  if (provider === "postgres" || provider === "mysql" || provider === "sqlite") {
    out.provider = provider;
  }
  if (typeof max === "number" && Number.isFinite(max)) {
    out.max = max;
  }
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return await Bun.file(p).exists();
  } catch {
    return false;
  }
}
