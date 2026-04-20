/**
 * Phase 18.μ — `defineI18n()` contract.
 *
 * Thin factory with strict validation so misconfiguration surfaces
 * at boot time (not at first request). Returns a frozen object
 * branded as {@link I18nDefinition} to discourage callers from
 * mutating the config after handing it to the runtime.
 */

import type { I18nConfig, I18nDefinition, I18nStrategy, LocaleCode } from "./types";

export const VALID_STRATEGIES: readonly I18nStrategy[] = [
  "path-prefix",
  "domain",
  "header",
  "cookie",
] as const;

/** Default cookie name when none is specified. Matches Next.js `NEXT_LOCALE`. */
export const DEFAULT_I18N_COOKIE = "mandu_locale";

/**
 * Validate + brand an i18n configuration.
 *
 * @throws Error when:
 *   - `locales` is empty
 *   - `defaultLocale` is not in `locales`
 *   - `fallback` is supplied but not in `locales`
 *   - `strategy` is unknown
 *   - `strategy === "domain"` without a non-empty `domains` map
 *   - any `domains[...]` value is not in `locales`
 *
 * @example
 * ```ts
 * export const i18n = defineI18n({
 *   locales: ['en', 'ko', 'ja'],
 *   defaultLocale: 'en',
 *   strategy: 'path-prefix',
 * });
 * ```
 */
export function defineI18n(config: I18nConfig): I18nDefinition {
  if (!config || typeof config !== "object") {
    throw new Error("[mandu/i18n] defineI18n() requires a config object");
  }

  const { locales, defaultLocale, fallback, strategy, cookieName, domains } = config;

  if (!Array.isArray(locales) || locales.length === 0) {
    throw new Error("[mandu/i18n] `locales` must be a non-empty array");
  }

  for (const l of locales) {
    if (typeof l !== "string" || l.length === 0) {
      throw new Error(
        "[mandu/i18n] every entry in `locales` must be a non-empty string"
      );
    }
  }

  const dedup = new Set(locales);
  if (dedup.size !== locales.length) {
    throw new Error("[mandu/i18n] `locales` must not contain duplicates");
  }

  if (typeof defaultLocale !== "string" || !dedup.has(defaultLocale)) {
    throw new Error(
      `[mandu/i18n] defaultLocale "${defaultLocale}" must be one of locales [${locales.join(", ")}]`
    );
  }

  if (fallback !== undefined) {
    if (typeof fallback !== "string" || !dedup.has(fallback)) {
      throw new Error(
        `[mandu/i18n] fallback "${fallback}" must be one of locales [${locales.join(", ")}]`
      );
    }
  }

  if (!VALID_STRATEGIES.includes(strategy)) {
    throw new Error(
      `[mandu/i18n] strategy "${strategy}" is invalid. Expected one of: ${VALID_STRATEGIES.join(", ")}`
    );
  }

  if (strategy === "domain") {
    if (!domains || typeof domains !== "object" || Object.keys(domains).length === 0) {
      throw new Error(
        "[mandu/i18n] strategy 'domain' requires a non-empty `domains` map"
      );
    }
    for (const [host, locale] of Object.entries(domains)) {
      if (typeof host !== "string" || host.length === 0) {
        throw new Error("[mandu/i18n] domain keys must be non-empty strings");
      }
      if (!dedup.has(locale)) {
        throw new Error(
          `[mandu/i18n] domains["${host}"] = "${locale}" is not in locales`
        );
      }
    }
  }

  const frozen: I18nDefinition = Object.freeze({
    locales: Object.freeze([...locales]) as readonly LocaleCode[],
    defaultLocale,
    fallback,
    strategy,
    cookieName: cookieName ?? DEFAULT_I18N_COOKIE,
    domains: domains ? Object.freeze({ ...domains }) : undefined,
    __manduI18n: true,
  });
  return frozen;
}

/**
 * Type guard for {@link I18nDefinition}. Use in adapter/runtime code
 * that receives `unknown` from user config.
 */
export function isI18nDefinition(value: unknown): value is I18nDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __manduI18n?: unknown }).__manduI18n === true
  );
}
