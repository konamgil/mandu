/**
 * Runtime polyfills for Netlify Edge.
 *
 * Netlify Edge Functions run on Deno Deploy, so this file mirrors the
 * Deno adapter's polyfills but with Netlify-specific error branding.
 * The shim message points users at Netlify-native replacements (Netlify
 * Blobs, Scheduled Functions).
 */

let installed = false;
let installedShim: Record<string, unknown> | null = null;

const UNSUPPORTED_API_MESSAGE = (name: string): string =>
  `[@mandujs/edge/netlify] Bun.${name} is not available on Netlify Edge. ` +
  `See https://mandujs.dev/docs/edge#bun-api-compat for the Netlify-native replacement ` +
  `(Netlify Blobs / deno-postgres / aws4fetch / Netlify scheduled functions).`;

export function installNetlifyEdgePolyfills(): void {
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
export function _createNetlifyEdgePolyfillShim(): Record<string, unknown> {
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
