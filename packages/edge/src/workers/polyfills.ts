/**
 * Runtime polyfills for Cloudflare Workers.
 *
 * Mandu core is already 90% Web Fetch compliant. The only Bun-native APIs
 * that leak into runtime paths (not build tooling) are:
 *
 *   - `Bun.CookieMap` — runtime-neutral `LegacyCookieCodec` already fallback
 *   - `Bun.CSRF`      — WebCrypto HMAC fallback already in csrf.ts
 *   - `Bun.password`  — runtime-throw + Phase 15.2 @noble/hashes/argon2
 *   - `Bun.sql`       — runtime-throw (adapters in Phase 15.2+)
 *   - `Bun.s3`        — runtime-throw (aws4fetch adapter in Phase 15.2+)
 *   - `Bun.cron`      — build-time config via wrangler.toml (Phase 15.2+)
 *
 * The codec and CSRF paths self-select the fallback at module load via
 * `typeof globalThis.Bun`. No action needed for those. For the unsupported
 * APIs we install a throwing shim on `globalThis.Bun` **only if the host is
 * Workers** — this gives users a clear error instead of a cryptic
 * `ReferenceError: Bun is not defined`.
 *
 * Implementation note: Bun's `globalThis.Bun` is marked non-configurable in
 * the actual Bun runtime, so we can never delete or overwrite it there. The
 * `installWorkersPolyfills()` function returns early on Bun and only
 * installs the shim when running inside Workers (which exposes no `Bun`
 * global).
 */

/** Tracks whether `installWorkersPolyfills` has already executed. */
let installed = false;

/** Reference to the shim object we installed, for test-only teardown. */
let installedShim: Record<string, unknown> | null = null;

const UNSUPPORTED_API_MESSAGE = (name: string): string =>
  `[@mandujs/edge/workers] Bun.${name} is not available on Cloudflare Workers. ` +
  `See https://mandujs.dev/docs/edge#bun-api-compat for the Phase 15.2+ replacement ` +
  `(Neon/aws4fetch/Workers Cron).`;

/**
 * Install Workers-specific shims on `globalThis.Bun` for Bun-only APIs that
 * leak into user code paths. Idempotent — safe to call on every request,
 * but the hot path should cache the result.
 *
 * Does not overwrite an existing `Bun` global (e.g. during Bun-based tests
 * of the Workers handler).
 */
export function installWorkersPolyfills(): void {
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
    // Crypto helpers — delegate to the global WebCrypto.
    password: {
      hash: unsupported("password.hash"),
      verify: unsupported("password.verify"),
    },
    // Databases & storage — provider adapters come in Phase 15.2+.
    sql: unsupported("sql"),
    SQL: unsupported("SQL"),
    s3: unsupported("s3"),
    S3Client: unsupported("S3Client"),
    // Scheduler — use Workers Cron Triggers instead.
    cron: unsupported("cron"),
    // File I/O — build-time inlining only.
    file: unsupported("file"),
    write: unsupported("write"),
    // Spawn — never available on any edge runtime.
    spawn: unsupported("spawn"),
  };

  try {
    // Use defineProperty for consistency with the runtime's own descriptor.
    Object.defineProperty(globals, "Bun", {
      value: shim,
      writable: true,
      configurable: true,
      enumerable: false,
    });
    installedShim = shim;
  } catch {
    // Defensive: if the host has already locked the slot, bail silently.
    // The caller will see the original `Bun is not defined` error on use.
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
export function _createWorkersPolyfillShim(): Record<string, unknown> {
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
 * `installWorkersPolyfills()` call will execute again.
 *
 * @internal
 */
export function _resetPolyfillsForTesting(): void {
  installed = false;
  installedShim = null;
}
