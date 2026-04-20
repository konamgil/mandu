/**
 * Phase 18.μ — i18n types.
 *
 * Public type surface for Mandu's first-class i18n. Separated from
 * runtime so `import type` callers pay zero bundle cost.
 */

/**
 * A locale code. The string is opaque to the framework — we never
 * parse it beyond "equality vs the configured allow-list", so
 * `"en"`, `"en-US"`, `"zh-Hant"`, `"ko-KR"`, `"pt-BR"` are all valid
 * and treated as distinct locales. Match case-sensitively to the
 * entries of `I18nConfig.locales`.
 */
export type LocaleCode = string;

/**
 * How the active locale is resolved from an incoming request.
 *
 * - `"path-prefix"` — Next.js default. `/en/docs` → `en`, `/ko/docs`
 *   → `ko`. Routes without a locale prefix fall through to
 *   `defaultLocale`. Path-prefix synthesis happens at manifest
 *   build time (see `router/fs-scanner.ts`).
 * - `"domain"` — locale-per-subdomain. `en.example.com` → `en`.
 *   The mapping is supplied via {@link I18nConfig.domains}.
 * - `"header"` — pure `Accept-Language` negotiation. Useful for
 *   APIs where URLs should stay locale-less.
 * - `"cookie"` — explicit user choice is stored in a cookie
 *   (default name: `mandu_locale`). Server-side persistence
 *   across navigations without URL mutation.
 */
export type I18nStrategy = "path-prefix" | "domain" | "header" | "cookie";

/**
 * Resolved locale state, attached to `ctx.locale` by the runtime
 * dispatcher. Carries the canonical `code`, the `strategy` that
 * produced it (for `Vary:` bookkeeping), and the raw `source` so
 * debuggers can see whether the URL won over the cookie.
 */
export interface ResolvedLocale {
  /** The resolved locale code (always one of `I18nConfig.locales`). */
  code: LocaleCode;
  /** Whether this request used the default locale (no explicit signal). */
  isDefault: boolean;
  /** Which strategy ultimately produced the locale. */
  strategy: I18nStrategy | "default" | "fallback";
  /** Raw input that produced the match, for debugging. */
  source?: string;
}

/**
 * A map of translation strings keyed by locale. Typically declared
 * `as const` so keys are inferred literally and the `t()` helper can
 * reject typos at compile time.
 */
export type MessageBundle<TKeys extends string = string> = {
  [locale: string]: Record<TKeys, string>;
};

/**
 * Configuration for `defineI18n()`. Kept shallow so it round-trips
 * through JSON config files without loss.
 */
export interface I18nConfig {
  /**
   * Non-empty allow-list of supported locales. First entry is NOT
   * automatically the default — `defaultLocale` is explicit.
   */
  locales: readonly LocaleCode[];
  /** Fallback when no resolver returns a known locale. MUST be in `locales`. */
  defaultLocale: LocaleCode;
  /**
   * Optional fallback chain. When `t(key)` misses in the active
   * locale, we look up `fallback` before `defaultLocale` before
   * returning the raw key. Typical use: `{ defaultLocale: 'en',
   * fallback: 'en-US' }` so `zh-Hant` falls through `en-US` to `en`.
   */
  fallback?: LocaleCode;
  /** Locale detection strategy. See {@link I18nStrategy}. */
  strategy: I18nStrategy;
  /**
   * Cookie name for `strategy: 'cookie'` OR a cookie override for
   * any other strategy (useful for "user explicitly picked a
   * locale" persistence). Default: `"mandu_locale"`.
   */
  cookieName?: string;
  /**
   * Domain → locale map for `strategy: 'domain'`. Required when
   * `strategy === "domain"`; ignored otherwise.
   */
  domains?: Record<string, LocaleCode>;
}

/**
 * Result of `defineI18n()`. A frozen config object that downstream
 * resolver + registry use. The brand field prevents accidental
 * coercion from plain literals.
 */
export interface I18nDefinition extends I18nConfig {
  readonly __manduI18n: true;
}

/**
 * Strongly-typed translator. Given a registry whose entries
 * declared `as const`, `t()` rejects typos in `key`, and
 * `vars` accepts any `{{name}}` placeholders present in the
 * template.
 */
export type Translator<TKeys extends string = string> = (
  key: TKeys,
  vars?: Record<string, string | number>
) => string;
