/**
 * Cookie codec abstraction.
 *
 * Two interchangeable implementations of the parse/serialize I/O layer used by
 * `CookieManager`:
 *
 * - {@link LegacyCookieCodec}: pure-JS, runtime-neutral (works anywhere that
 *   has `Request`/`Response`/`encodeURIComponent`).
 * - {@link BunCookieMapCodec}: delegates to `Bun.CookieMap` (Bun >= 1.3).
 *
 * The public `CookieManager` API is codec-agnostic. The codec only owns the
 * translation between a wire-format `Cookie:` header string and in-memory
 * entries, and between `(name, value, options)` and a `Set-Cookie:` string.
 *
 * Design notes:
 * - Signed cookies (HMAC-SHA256) and `getParsed` live on `CookieManager` and do
 *   not go through the codec. Their format (`encodeURIComponent(value).sig`)
 *   must stay stable regardless of codec.
 * - `Bun.CookieMap` auto-injects `SameSite=Lax` when `sameSite` is omitted and
 *   reorders attributes relative to the legacy serializer. The Bun codec
 *   post-processes output to strip the implicit `SameSite=Lax` so behavior
 *   matches the legacy codec exactly. Attribute order differs between codecs
 *   but is semantically identical (RFC 6265 treats attributes as an unordered
 *   set).
 */

import type { CookieOptions } from "./context";

// ========== Interface ==========

/**
 * Low-level cookie wire-format codec.
 *
 * Implementations translate between `Cookie:` / `Set-Cookie:` string forms and
 * in-memory values. They carry no state beyond the call and must be safe to
 * share across concurrent requests.
 */
export interface CookieCodec {
  /** Human-readable codec name for diagnostics and tests. */
  readonly name: string;
  /**
   * Parse a raw `Cookie:` request header (RFC 6265) into a name→value map.
   * Returns an empty map when `header` is null, empty, or unparseable.
   *
   * Values are URL-decoded. On decode failure the raw value is retained
   * (matches legacy behavior so existing cookies in the wild keep working).
   *
   * For duplicate names the **first** occurrence wins; this matches RFC 6265
   * §5.4's "the user agent SHOULD serve... the first match" guidance.
   */
  parseRequestHeader(header: string | null): Map<string, string>;
  /**
   * Serialize a single cookie into a `Set-Cookie:` header value.
   *
   * The returned string must not contain a leading `Set-Cookie:` prefix. Both
   * name and value are URL-encoded to survive the header transport layer.
   */
  serializeSetCookie(name: string, value: string, options: CookieOptions): string;
}

// ========== Legacy (pure-JS) implementation ==========

/**
 * Runtime-neutral codec. Used when `Bun.CookieMap` is unavailable (Node.js,
 * Deno, browsers, edge runtimes without Bun).
 */
export const LegacyCookieCodec: CookieCodec = {
  name: "legacy",

  parseRequestHeader(header: string | null): Map<string, string> {
    const cookies = new Map<string, string>();
    if (!header) return cookies;

    const pairs = header.split(";");
    for (const pair of pairs) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const eqIdx = trimmed.indexOf("=");
      // RFC 6265 §4.2.1 requires cookie-pair = cookie-name "=" cookie-value.
      // Bareword tokens (no '=') are not valid cookies; skip them.
      if (eqIdx === -1) continue;
      const rawName = trimmed.slice(0, eqIdx);
      const rawValue = trimmed.slice(eqIdx + 1);
      if (!rawName) continue;
      const name = safeDecode(rawName);
      // RFC 6265: first cookie wins on duplicate name.
      if (cookies.has(name)) continue;
      cookies.set(name, safeDecode(rawValue));
    }
    return cookies;
  },

  serializeSetCookie(name: string, value: string, options: CookieOptions): string {
    const parts: string[] = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];

    if (options.maxAge !== undefined) {
      parts.push(`Max-Age=${options.maxAge}`);
    }

    if (options.expires) {
      const expires =
        options.expires instanceof Date
          ? options.expires.toUTCString()
          : options.expires;
      parts.push(`Expires=${expires}`);
    }

    if (options.domain) {
      parts.push(`Domain=${options.domain}`);
    }

    // Default path matches legacy behavior and most browser defaults.
    parts.push(options.path ? `Path=${options.path}` : "Path=/");

    if (options.secure) parts.push("Secure");
    if (options.httpOnly) parts.push("HttpOnly");

    if (options.sameSite) {
      parts.push(`SameSite=${capitalize(options.sameSite)}`);
    }

    if (options.partitioned) parts.push("Partitioned");

    return parts.join("; ");
  },
};

// ========== Bun.CookieMap-backed implementation ==========

interface BunCookieInit {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number | Date;
  secure?: boolean;
  httpOnly?: boolean;
  partitioned?: boolean;
  sameSite?: "strict" | "lax" | "none" | "Strict" | "Lax" | "None";
  maxAge?: number;
}

interface BunCookieMapCtor {
  new (init?: string): {
    get(name: string): string | null;
    entries(): IterableIterator<[string, string]>;
    set(init: BunCookieInit): void;
    toSetCookieHeaders(): string[];
  };
}

/**
 * Attempt to resolve `Bun.CookieMap` from the ambient runtime. Returns the
 * constructor when available, or `null` on non-Bun runtimes or older Bun
 * builds that lack the API.
 */
function resolveBunCookieMap(): BunCookieMapCtor | null {
  // `Bun` is only present in Bun's runtime. Access via `globalThis` to avoid
  // ReferenceError under other runtimes while still allowing bundlers to
  // tree-shake based on the dynamic lookup.
  const bun = (globalThis as unknown as { Bun?: { CookieMap?: unknown } }).Bun;
  const Ctor = bun?.CookieMap;
  if (typeof Ctor !== "function") return null;
  return Ctor as BunCookieMapCtor;
}

/**
 * Factory for the Bun-native codec. Returns `null` if `Bun.CookieMap` is not
 * available, allowing callers to fall back to the legacy codec.
 */
export function createBunCookieMapCodec(): CookieCodec | null {
  const CookieMap = resolveBunCookieMap();
  if (!CookieMap) return null;

  return {
    name: "bun-cookiemap",

    parseRequestHeader(header: string | null): Map<string, string> {
      const cookies = new Map<string, string>();
      if (!header) return cookies;
      // Bun.CookieMap handles URL-decoding and whitespace, and iterates
      // entries in insertion order.
      const map = new CookieMap(header);
      for (const [name, value] of map.entries()) {
        if (!name) continue;
        // First-wins semantics to match LegacyCookieCodec and RFC 6265.
        if (!cookies.has(name)) cookies.set(name, value);
      }
      return cookies;
    },

    serializeSetCookie(name: string, value: string, options: CookieOptions): string {
      const map = new CookieMap();
      const init: BunCookieInit = { name, value };

      if (options.maxAge !== undefined) init.maxAge = options.maxAge;
      // NOTE: we deliberately omit `expires` from the Bun.CookieMap init and
      // append our own Expires attribute below. Bun 1.3.10's CookieMap emits
      // `Expires` in a non-standard form (e.g. `Tue, 15 Jun 2026 ... -0000`
      // for a Monday — day-of-week mismatch) that breaks byte-parity with the
      // legacy codec and is technically not RFC 7231 IMF-fixdate. Using
      // `Date.toUTCString()` matches the legacy impl exactly.
      if (options.domain) init.domain = options.domain;
      init.path = options.path ?? "/";
      if (options.secure) init.secure = true;
      if (options.httpOnly) init.httpOnly = true;
      if (options.partitioned) init.partitioned = true;
      if (options.sameSite) init.sameSite = options.sameSite;

      map.set(init);
      const headers = map.toSetCookieHeaders();
      if (headers.length === 0) {
        // Defensive: Bun.CookieMap should always yield one header after set().
        return LegacyCookieCodec.serializeSetCookie(name, value, options);
      }
      let header = headers[0];

      // Bun.CookieMap auto-injects `SameSite=Lax` when sameSite is unspecified.
      // The legacy codec omits SameSite in that case; preserve that behavior.
      if (!options.sameSite) {
        header = stripDefaultSameSite(header);
      }

      // Append RFC 7231-compliant Expires after Bun's other attributes.
      if (options.expires !== undefined) {
        const expiresValue =
          options.expires instanceof Date
            ? options.expires.toUTCString()
            : options.expires;
        header += `; Expires=${expiresValue}`;
      }

      return header;
    },
  };
}

/**
 * Remove the trailing `; SameSite=Lax` that Bun injects when sameSite is not
 * specified. Only strips an **exact, isolated** attribute so explicit
 * `SameSite=Lax` from the caller survives (caller would have set
 * `options.sameSite='lax'` and this function is skipped anyway).
 */
function stripDefaultSameSite(header: string): string {
  // Prefer trailing position (Bun's current emit order).
  if (header.endsWith("; SameSite=Lax")) {
    return header.slice(0, -"; SameSite=Lax".length);
  }
  // Defensive: handle middle-position insertion if Bun reorders attributes.
  const middle = header.indexOf("; SameSite=Lax;");
  if (middle !== -1) {
    return header.slice(0, middle) + header.slice(middle + "; SameSite=Lax".length);
  }
  return header;
}

// ========== Codec selection ==========

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * URL-decode a cookie token, preserving the raw value if the encoding is
 * malformed. Matches the forgiving behavior of most cookie parsers (browsers,
 * `cookie` npm package, Bun.CookieMap) so malformed cookies from clients do
 * not crash server-side code.
 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

let activeCodec: CookieCodec = resolveDefaultCodec();

function resolveDefaultCodec(): CookieCodec {
  return createBunCookieMapCodec() ?? LegacyCookieCodec;
}

/**
 * Return the active codec. Resolved once at module load and overridable via
 * {@link _setCodecForTesting}.
 */
export function getCookieCodec(): CookieCodec {
  return activeCodec;
}

/**
 * Test-only escape hatch for forcing a specific codec. Pass a codec to
 * override, or omit to restore the runtime-detected default.
 *
 * @internal
 */
export function _setCodecForTesting(codec?: CookieCodec): void {
  activeCodec = codec ?? resolveDefaultCodec();
}
