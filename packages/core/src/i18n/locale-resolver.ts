/**
 * Phase 18.μ — locale resolution.
 *
 * Given a request + i18n config, return the active {@link ResolvedLocale}.
 * Resolution order depends on `config.strategy`:
 *
 *   path-prefix → URL path segment → cookie → Accept-Language → default
 *   domain      → Host header      → cookie → Accept-Language → default
 *   header      → Accept-Language  → cookie → default
 *   cookie      → Cookie           → Accept-Language → default
 *
 * In every mode, an invalid locale signal (e.g. `/fr/docs` when `fr`
 * isn't configured) falls through to the next signal — invalid inputs
 * never short-circuit to an error. The final tier is always the
 * configured `defaultLocale` or `fallback`.
 *
 * This module is pure; it never touches the server registry or
 * `ctx.cookies`. Callers assemble the result and bolt it onto the
 * request via `ManduContext` — see `runtime/server.ts` μ dispatch
 * section.
 */

import type { I18nDefinition, LocaleCode, ResolvedLocale } from "./types";
import { DEFAULT_I18N_COOKIE } from "./define";

/**
 * Remove a locale prefix from a URL pathname. Returns `{ locale, rest }`
 * when the pathname starts with `/<locale>(/...)?` for a known locale;
 * otherwise `{ locale: undefined, rest: pathname }`.
 *
 * Handles trailing + empty slashes so `/en`, `/en/`, `/en/docs` all
 * match `locale="en"` with the rest normalized to `"/"`, `"/"`, `"/docs"`.
 */
export function stripLocalePrefix(
  pathname: string,
  locales: readonly LocaleCode[]
): { locale: LocaleCode | undefined; rest: string } {
  if (!pathname.startsWith("/")) {
    return { locale: undefined, rest: pathname };
  }
  // Fast path: root.
  if (pathname === "/") return { locale: undefined, rest: "/" };
  const slashIdx = pathname.indexOf("/", 1);
  const first = slashIdx === -1 ? pathname.slice(1) : pathname.slice(1, slashIdx);
  if (!locales.includes(first)) {
    return { locale: undefined, rest: pathname };
  }
  const rest = slashIdx === -1 ? "/" : pathname.slice(slashIdx);
  return { locale: first, rest };
}

/**
 * Parse the `Accept-Language` header and pick the best supported
 * locale. Honours q-weights; falls back to undefined when nothing
 * matches.
 *
 * Comparison is case-insensitive, and we accept exact-match only
 * (no Accept-Language `en-US` → `en` widening — userland can list
 * both in `config.locales` when they want fallback behaviour).
 */
export function parseAcceptLanguage(
  header: string | null | undefined,
  locales: readonly LocaleCode[]
): LocaleCode | undefined {
  if (!header) return undefined;
  const want = new Map<string, number>();
  for (const piece of header.split(",")) {
    const [tagRaw, ...params] = piece.trim().split(";");
    if (!tagRaw) continue;
    const tag = tagRaw.trim().toLowerCase();
    if (!tag || tag === "*") continue;
    let q = 1.0;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p);
      if (m) q = parseFloat(m[1]!);
    }
    if (Number.isFinite(q) && q > 0 && !want.has(tag)) {
      want.set(tag, q);
    }
  }
  // Highest-q first; stable within equal weights.
  const sorted = [...want.entries()].sort((a, b) => b[1] - a[1]);
  const lowerLocales = locales.map((l) => ({ raw: l, lower: l.toLowerCase() }));
  for (const [tag] of sorted) {
    for (const { raw, lower } of lowerLocales) {
      if (lower === tag) return raw;
    }
  }
  // Widening fallback: `zh-TW` → try `zh` if only `zh` is configured.
  for (const [tag] of sorted) {
    const short = tag.split("-")[0]!;
    for (const { raw, lower } of lowerLocales) {
      if (lower === short) return raw;
    }
  }
  return undefined;
}

/**
 * Read the locale cookie from the raw `Cookie` header. A nano-parser
 * so the resolver stays dependency-free (the `CookieManager` in
 * `filling/context.ts` lives on the request-wrapping side, not here).
 */
export function readLocaleCookie(
  header: string | null | undefined,
  cookieName: string,
  locales: readonly LocaleCode[]
): LocaleCode | undefined {
  if (!header) return undefined;
  const target = `${cookieName}=`;
  for (const piece of header.split(";")) {
    const trimmed = piece.trim();
    if (!trimmed.startsWith(target)) continue;
    const raw = trimmed.slice(target.length);
    try {
      const value = decodeURIComponent(raw);
      if (locales.includes(value)) return value;
    } catch {
      // fallthrough
    }
  }
  return undefined;
}

/**
 * Resolve the locale for this request.
 *
 * The returned {@link ResolvedLocale} is always valid w.r.t.
 * `config.locales` — when every signal misses, we fall back to
 * `fallback` then `defaultLocale` (in that order) and flag the
 * result with `strategy: "fallback"` / `"default"`.
 */
export function resolveLocale(
  request: Request,
  config: I18nDefinition
): ResolvedLocale {
  const url = new URL(request.url);
  const cookieName = config.cookieName ?? DEFAULT_I18N_COOKIE;
  const cookieHeader = request.headers.get("cookie");
  const acceptLanguage = request.headers.get("accept-language");

  switch (config.strategy) {
    case "path-prefix": {
      const { locale } = stripLocalePrefix(url.pathname, config.locales);
      if (locale) {
        return { code: locale, isDefault: false, strategy: "path-prefix", source: url.pathname };
      }
      const cookie = readLocaleCookie(cookieHeader, cookieName, config.locales);
      if (cookie) {
        return { code: cookie, isDefault: false, strategy: "cookie", source: cookieHeader ?? undefined };
      }
      const accept = parseAcceptLanguage(acceptLanguage, config.locales);
      if (accept) {
        return { code: accept, isDefault: false, strategy: "header", source: acceptLanguage ?? undefined };
      }
      return finalFallback(config);
    }

    case "domain": {
      const host = request.headers.get("host") || url.host;
      const mapped = config.domains?.[host];
      if (mapped) {
        return { code: mapped, isDefault: false, strategy: "domain", source: host };
      }
      const cookie = readLocaleCookie(cookieHeader, cookieName, config.locales);
      if (cookie) {
        return { code: cookie, isDefault: false, strategy: "cookie", source: cookieHeader ?? undefined };
      }
      const accept = parseAcceptLanguage(acceptLanguage, config.locales);
      if (accept) {
        return { code: accept, isDefault: false, strategy: "header", source: acceptLanguage ?? undefined };
      }
      return finalFallback(config);
    }

    case "cookie": {
      const cookie = readLocaleCookie(cookieHeader, cookieName, config.locales);
      if (cookie) {
        return { code: cookie, isDefault: false, strategy: "cookie", source: cookieHeader ?? undefined };
      }
      const accept = parseAcceptLanguage(acceptLanguage, config.locales);
      if (accept) {
        return { code: accept, isDefault: false, strategy: "header", source: acceptLanguage ?? undefined };
      }
      return finalFallback(config);
    }

    case "header": {
      const accept = parseAcceptLanguage(acceptLanguage, config.locales);
      if (accept) {
        return { code: accept, isDefault: false, strategy: "header", source: acceptLanguage ?? undefined };
      }
      const cookie = readLocaleCookie(cookieHeader, cookieName, config.locales);
      if (cookie) {
        return { code: cookie, isDefault: false, strategy: "cookie", source: cookieHeader ?? undefined };
      }
      return finalFallback(config);
    }
  }

  // Exhaustive check
  return finalFallback(config);
}

function finalFallback(config: I18nDefinition): ResolvedLocale {
  if (config.fallback && config.fallback !== config.defaultLocale) {
    return {
      code: config.fallback,
      isDefault: config.fallback === config.defaultLocale,
      strategy: "fallback",
    };
  }
  return { code: config.defaultLocale, isDefault: true, strategy: "default" };
}
