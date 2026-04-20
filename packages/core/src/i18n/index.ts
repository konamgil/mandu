/**
 * Phase 18.μ — i18n barrel.
 *
 * Public surface for first-class internationalization in Mandu.
 *
 * ```ts
 * import { defineI18n, defineMessages, resolveLocale, createTranslator } from "@mandujs/core/i18n";
 *
 * export const i18n = defineI18n({
 *   locales: ["en", "ko"],
 *   defaultLocale: "en",
 *   strategy: "path-prefix",
 * });
 *
 * export const messages = defineMessages({
 *   en: { welcome: "Welcome, {{name}}" },
 *   ko: { welcome: "환영합니다, {{name}}님" },
 * } as const);
 * ```
 */

export type {
  LocaleCode,
  MessageBundle,
  I18nStrategy,
  I18nConfig,
  I18nDefinition,
  ResolvedLocale,
  Translator,
} from "./types";

export {
  defineI18n,
  isI18nDefinition,
  VALID_STRATEGIES,
  DEFAULT_I18N_COOKIE,
} from "./define";

export {
  resolveLocale,
  stripLocalePrefix,
  parseAcceptLanguage,
  readLocaleCookie,
} from "./locale-resolver";

export {
  defineMessages,
  createTranslator,
  interpolate,
  isMessageRegistry,
  type MessageRegistry,
} from "./message-registry";
