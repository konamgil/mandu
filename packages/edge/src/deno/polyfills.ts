/**
 * Runtime polyfills for Deno Deploy.
 *
 * Deno Deploy ships with Web Fetch + WebCrypto + Streams natively, so most
 * Mandu-core runtime paths work without modification. The only Bun-native
 * APIs that can leak into runtime paths are the same set as Workers:
 *
 *   - `Bun.CookieMap` — runtime-neutral `LegacyCookieCodec` already selected
 *     at module load when `globalThis.Bun` is missing.
 *   - `Bun.CSRF`      — WebCrypto HMAC-SHA256 fallback already in csrf.ts.
 *   - `Bun.password`  — runtime-throw (optional peer `@noble/hashes/argon2`)
 *   - `Bun.sql`       — runtime-throw (use Deno-native Postgres driver)
 *   - `Bun.s3`        — runtime-throw (use `aws4fetch`)
 *   - `Bun.cron`      — build-time config via Deno Deploy cron trigger
 *   - `Bun.file`      — runtime-throw (use `Deno.readFile` at build time)
 *
 * Implementation note: we install a throwing shim on `globalThis.Bun`
 * **only if the host is Deno** — Bun's `globalThis.Bun` is non-configurable
 * and the shim must not clobber it when tests run in Bun.
 */

/** Tracks whether `installDenoPolyfills` has already executed. */
let installed = false;

/** Reference to the shim object we installed, for test-only teardown. */
let installedShim: Record<string, unknown> | null = null;

const UNSUPPORTED_API_MESSAGE = (name: string): string =>
  `[@mandujs/edge/deno] Bun.${name} is not available on Deno Deploy. ` +
  `See https://mandujs.dev/docs/edge#bun-api-compat for the Deno-native replacement ` +
  `(deno-postgres/aws4fetch/Deno Deploy Cron).`;

/**
 * Install Deno-specific shims on `globalThis.Bun` for Bun-only APIs that
 * leak into user code paths. Idempotent — safe to call on every request,
 * but the hot path should cache the result.
 *
 * Does not overwrite an existing `Bun` global (e.g. during Bun-based tests
 * of the Deno handler).
 */
export function installDenoPolyfills(): void {
  if (installed) return;
  installed = true;

  const globals = globalThis as { Bun?: Record<string, unknown> };

  // Running inside actual Bun — nothing to install. Bun makes the `Bun`
  // global non-configurable anyway, so we must not try.
  if (typeof globals.Bun !== "undefined") {
    return;
  }

  const unsupported = (name: string) => () => {
    throw new Error(UNSUPPORTED_API_MESSAGE(name));
  };

  const shim: Record<string, unknown> = {
    password: {
      hash: unsupported("password.hash"),
      verify: unsupported("password.verify"),
    },
    sql: unsupported("sql"),
    SQL: unsupported("SQL"),
    s3: unsupported("s3"),
    S3Client: unsupported("S3Client"),
    cron: unsupported("cron"),
    file: unsupported("file"),
    write: unsupported("write"),
    spawn: unsupported("spawn"),
  };

  try {
    Object.defineProperty(globals, "Bun", {
      value: shim,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    installedShim = shim;
  } catch {
    installed = false;
  }
}

/**
 * Create a detached Bun-like shim object without touching `globalThis`.
 * Useful in Bun-hosted tests where `globalThis.Bun` is non-configurable
 * but we still want to verify the shim surface.
 *
 * @internal
 */
export function _createDenoPolyfillShim(): Record<string, unknown> {
  const unsupported = (name: string) => () => {
    throw new Error(UNSUPPORTED_API_MESSAGE(name));
  };

  return {
    password: {
      hash: unsupported("password.hash"),
      verify: unsupported("password.verify"),
    },
    sql: unsupported("sql"),
    SQL: unsupported("SQL"),
    s3: unsupported("s3"),
    S3Client: unsupported("S3Client"),
    cron: unsupported("cron"),
    file: unsupported("file"),
    write: unsupported("write"),
    spawn: unsupported("spawn"),
  };
}

/**
 * Reset the install guard. **Test-only escape hatch** — do not call from
 * production code. Restores the non-Bun host state so the next
 * `installDenoPolyfills()` call will execute again.
 *
 * @internal
 */
export function _resetPolyfillsForTesting(): void {
  installed = false;
  installedShim = null;
}
