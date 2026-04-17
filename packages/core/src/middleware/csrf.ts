/**
 * CSRF Middleware Plugin
 *
 * Double-submit cookie pattern (stateless, no session required).
 *
 *   cookie:  __csrf=<token>
 *   header:  x-csrf-token: <token>   (or form field _csrf)
 *
 * Both values MUST match AND the token's HMAC signature MUST verify.
 *
 * Internally delegates to `Bun.CSRF.generate` / `Bun.CSRF.verify` when
 * available (Bun ≥ 1.3). Verified present and stable in Bun 1.3.10:
 *   Bun.CSRF.generate(secret, { maxAge? }) → URL-safe base64 token
 *   Bun.CSRF.verify(token, { secret, maxAge? }) → boolean
 *
 * A pure `crypto.subtle` + `crypto.getRandomValues` fallback is provided for
 * compatibility. The exported `csrf()` API is identical either way.
 *
 * @example
 * ```ts
 * import { csrf } from "@mandujs/core/middleware";
 *
 * export default Mandu.filling()
 *   .use(csrf({ secret: process.env.CSRF_SECRET! }))
 *   .post((ctx) => ctx.ok({ ok: true }));
 * ```
 */
import type { ManduContext, CookieOptions } from "../filling/context";

// ========== Types ==========

export interface CsrfMiddlewareOptions {
  /** Required. Used to HMAC-sign CSRF tokens. */
  secret: string;
  /** Cookie name. Default: "__csrf". */
  cookieName?: string;
  /** Header name checked on unsafe methods. Default: "x-csrf-token". */
  headerName?: string;
  /** Form field name checked as fallback. Default: "_csrf". */
  fieldName?: string;
  /** Methods that skip validation. Default: ["GET","HEAD","OPTIONS"]. */
  safeMethods?: string[];
  /** Cookie attribute overrides (merged with sensible defaults). */
  cookieOptions?: {
    /** Default: false — client JS needs to read the token to submit it in a header. */
    httpOnly?: boolean;
    /** Default: NODE_ENV === "production". */
    secure?: boolean;
    /** Default: "lax". */
    sameSite?: "strict" | "lax" | "none";
    /** Default: "/". */
    path?: string;
    /** Default: 86400 (1 day). */
    maxAge?: number;
    /** Optional cookie domain. */
    domain?: string;
  };
}

/** Middleware signature matching `jwt.ts`. */
type Middleware = (ctx: ManduContext) => Promise<Response | void>;

// ========== Implementation ==========

const DEFAULT_COOKIE_NAME = "__csrf";
const DEFAULT_HEADER_NAME = "x-csrf-token";
const DEFAULT_FIELD_NAME = "_csrf";
const DEFAULT_SAFE_METHODS: readonly string[] = ["GET", "HEAD", "OPTIONS"];
const DEFAULT_MAX_AGE = 86400; // 1 day
/** Guard against memory-exhaustion attacks via oversized tokens. */
const MAX_TOKEN_LENGTH = 512;

/**
 * CSRF protection middleware (double-submit cookie pattern).
 *
 * Behavior:
 *  1. Ensures a signed CSRF token cookie is present. Issues a fresh one if
 *     the existing cookie is missing or its signature fails to verify.
 *  2. For safe methods (GET/HEAD/OPTIONS): continues without further checks.
 *  3. For unsafe methods: reads the submitted token from the configured
 *     header (preferred) or form field (fallback for form content types),
 *     then confirms:
 *       (a) submitted token === cookie token (constant-time equality)
 *       (b) the token's HMAC signature still verifies with `secret`
 *     Any failure returns 403 without leaking which check failed.
 */
export function csrf(options: CsrfMiddlewareOptions): Middleware {
  if (!options.secret || typeof options.secret !== "string") {
    throw new Error("[Mandu CSRF] `secret` is required and must be a non-empty string");
  }

  const {
    secret,
    cookieName = DEFAULT_COOKIE_NAME,
    headerName = DEFAULT_HEADER_NAME,
    fieldName = DEFAULT_FIELD_NAME,
    safeMethods = DEFAULT_SAFE_METHODS,
  } = options;

  const normalizedSafeMethods = new Set(safeMethods.map((m) => m.toUpperCase()));
  const cookieOptions = resolveCookieOptions(options.cookieOptions);
  const maxAgeSec = cookieOptions.maxAge ?? DEFAULT_MAX_AGE;

  return async (ctx: ManduContext): Promise<Response | void> => {
    const method = ctx.request.method.toUpperCase();

    // 1. Ensure a valid CSRF cookie is present for the next unsafe request.
    const existing = ctx.cookies.get(cookieName);
    let activeCookieToken: string | null = null;

    if (typeof existing === "string" && isAcceptableToken(existing)) {
      const valid = await verifyToken(existing, secret, maxAgeSec);
      if (valid) {
        // Keep existing token (no unnecessary rotation).
        activeCookieToken = existing;
      }
    }

    if (activeCookieToken === null) {
      activeCookieToken = await generateToken(secret, maxAgeSec);
      ctx.cookies.set(cookieName, activeCookieToken, cookieOptions);
    }

    // 2. Safe methods pass through.
    if (normalizedSafeMethods.has(method)) {
      return;
    }

    // 3. Unsafe methods: read + validate submitted token.
    const submitted = await extractSubmittedToken(ctx, headerName, fieldName);

    if (!submitted || !isAcceptableToken(submitted)) {
      return ctx.forbidden("CSRF token missing or invalid");
    }

    // Constant-time equality between submitted token and cookie token.
    if (!safeEqual(submitted, activeCookieToken)) {
      return ctx.forbidden("CSRF token missing or invalid");
    }

    // HMAC verification on the submitted token (prevents forged cookies from
    // sibling subdomains since they cannot sign with our secret).
    const verified = await verifyToken(submitted, secret, maxAgeSec);
    if (!verified) {
      return ctx.forbidden("CSRF token missing or invalid");
    }

    // Valid — continue.
  };
}

// ========== Helpers ==========

/**
 * Resolve cookie options with production-safe defaults.
 *
 * `httpOnly: false` by default: a CSRF token cookie needs to be readable by
 * client-side JS so the app can echo it back in the header. Callers who set
 * the token from the server (e.g. via a hidden form field) may opt into
 * `httpOnly: true`.
 */
function resolveCookieOptions(overrides?: CsrfMiddlewareOptions["cookieOptions"]): CookieOptions {
  const isProd = typeof process !== "undefined" && process.env?.NODE_ENV === "production";
  return {
    httpOnly: overrides?.httpOnly ?? false,
    secure: overrides?.secure ?? isProd,
    sameSite: overrides?.sameSite ?? "lax",
    path: overrides?.path ?? "/",
    maxAge: overrides?.maxAge ?? DEFAULT_MAX_AGE,
    domain: overrides?.domain,
  };
}

/** Read submitted token from header, falling back to form field if applicable. */
async function extractSubmittedToken(
  ctx: ManduContext,
  headerName: string,
  fieldName: string
): Promise<string | null> {
  // Header wins when present (cheap, safe, no body consumption).
  const headerVal = ctx.headers.get(headerName);
  if (typeof headerVal === "string" && headerVal.length > 0) {
    return headerVal;
  }

  // Form fallback: only when the request advertises a form-like content type.
  // JSON bodies are NOT scanned — header submission is the canonical path.
  const contentType = (ctx.headers.get("content-type") ?? "").toLowerCase();
  const isForm =
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
  if (!isForm) return null;

  try {
    // Clone so downstream handlers can still read the body.
    const form = await ctx.request.clone().formData();
    const fieldVal = form.get(fieldName);
    return typeof fieldVal === "string" ? fieldVal : null;
  } catch {
    return null;
  }
}

/** Validate token shape before running expensive crypto. */
function isAcceptableToken(token: string): boolean {
  return (
    typeof token === "string" &&
    token.length > 0 &&
    token.length <= MAX_TOKEN_LENGTH
  );
}

/**
 * Constant-time string comparison to avoid timing-oracle attacks.
 * Returns `false` immediately on length mismatch (lengths themselves are not
 * secret for our fixed-format tokens), then XORs character codes over the
 * full length before folding into a single diff bit.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// ========== Token crypto (Bun.CSRF preferred, fallback to crypto.subtle) ==========

/**
 * Runtime capability probe for `Bun.CSRF`. Done once at module load — avoids
 * re-checking on every request and allows non-Bun runtimes to use the
 * fallback implementation.
 */
const bunCsrf = resolveBunCsrf();

function resolveBunCsrf():
  | {
      generate: (secret: string, options?: { maxAge?: number }) => string;
      verify: (token: string, options: { secret: string; maxAge?: number }) => boolean;
    }
  | null {
  if (typeof globalThis === "undefined") return null;
  const bun = (globalThis as { Bun?: { CSRF?: unknown } }).Bun;
  if (!bun || typeof bun !== "object" || bun === null) return null;
  const csrfApi = (bun as { CSRF?: unknown }).CSRF;
  if (!csrfApi || typeof csrfApi !== "object") return null;
  const api = csrfApi as {
    generate?: unknown;
    verify?: unknown;
  };
  if (typeof api.generate !== "function" || typeof api.verify !== "function") {
    return null;
  }
  return api as {
    generate: (secret: string, options?: { maxAge?: number }) => string;
    verify: (token: string, options: { secret: string; maxAge?: number }) => boolean;
  };
}

async function generateToken(secret: string, maxAgeSec: number): Promise<string> {
  if (bunCsrf) {
    // Bun.CSRF handles timestamp + random + HMAC in native code.
    return bunCsrf.generate(secret, { maxAge: maxAgeSec });
  }
  return fallbackGenerate(secret);
}

async function verifyToken(token: string, secret: string, maxAgeSec: number): Promise<boolean> {
  if (bunCsrf) {
    try {
      return bunCsrf.verify(token, { secret, maxAge: maxAgeSec });
    } catch {
      return false;
    }
  }
  return fallbackVerify(token, secret);
}

// ----- Fallback (no Bun.CSRF available) -----

/**
 * Token format: `<random-b64url>.<hmac-b64url>`
 *   - random: 32 bytes via `crypto.getRandomValues`
 *   - hmac:   HMAC-SHA256(random, secret)
 *
 * Same pattern as `packages/core/src/filling/session.ts` (`hmacSign`,
 * line 216-227) so we don't introduce a second crypto code path.
 */
async function fallbackGenerate(secret: string): Promise<string> {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const randomPart = base64UrlEncode(random);
  const sig = await hmacSignB64Url(randomPart, secret);
  return `${randomPart}.${sig}`;
}

async function fallbackVerify(token: string, secret: string): Promise<boolean> {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx <= 0 || dotIdx === token.length - 1) return false;
  const randomPart = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  if (!randomPart || !signature) return false;
  const expected = await hmacSignB64Url(randomPart, secret);
  // Constant-time comparison on signatures.
  return safeEqual(signature, expected);
}

async function hmacSignB64Url(data: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
