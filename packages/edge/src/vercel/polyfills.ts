/**
 * Runtime polyfills for Vercel Edge.
 *
 * Vercel Edge Runtime is built on V8 isolates like Cloudflare Workers —
 * it ships Web Fetch / WebCrypto / Streams natively but does NOT expose
 * Node built-ins by default. Unlike Workers, Vercel does not offer a
 * `nodejs_compat` opt-in on the Edge runtime; Node APIs must be polyfilled
 * at the bundler layer or avoided entirely.
 *
 * Mandu's runtime paths already select Web-safe fallbacks when
 * `globalThis.Bun` is missing. This file installs a throwing shim for
 * Bun-only APIs (`sql`, `s3`, `cron`, `file`, `write`, `spawn`, `password`)
 * so user code fails with a clear error instead of a cryptic
 * `ReferenceError: Bun is not defined`.
 */

let installed = false;
let installedShim: Record<string, unknown> | null = null;

const UNSUPPORTED_API_MESSAGE = (name: string): string =>
  `[@mandujs/edge/vercel] Bun.${name} is not available on Vercel Edge. ` +
  `See https://mandujs.dev/docs/edge#bun-api-compat for the Vercel-native replacement ` +
  `(Vercel Postgres/aws4fetch/Vercel Cron).`;

export function installVercelEdgePolyfills(): void {
  if (installed) return;
  installed = true;

  const globals = globalThis as { Bun?: Record<string, unknown> };

  // Running inside actual Bun — nothing to install.
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
 * @internal test-only detached shim factory.
 */
export function _createVercelEdgePolyfillShim(): Record<string, unknown> {
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
 * @internal reset install guard — test only.
 */
export function _resetPolyfillsForTesting(): void {
  installed = false;
  installedShim = null;
}
