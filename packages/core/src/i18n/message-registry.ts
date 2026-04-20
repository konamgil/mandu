/**
 * Phase 18.μ — message registry + typed `t()` helper.
 *
 * `defineMessages()` creates a locale-keyed message bundle with its
 * keys inferred at compile time (via `as const`). `createTranslator()`
 * returns a `t(key, vars)` function bound to a specific active
 * locale — misses fall back to `fallbackLocale` then raw `key`.
 *
 * Placeholder syntax is Next.js / react-intl-lite compatible:
 * `"Hello, {{name}}!"` resolves `{ name: "Mandu" }` → `"Hello, Mandu!"`.
 * Missing vars are left as `{{name}}` so template errors are visible
 * in the rendered page instead of silently producing empty strings.
 */

import type { LocaleCode, MessageBundle, Translator } from "./types";

/**
 * Brand `defineMessages()` output so downstream helpers can verify
 * the caller actually went through the declared API. Runtime-only
 * field; TS infers it without the caller writing it.
 */
export interface MessageRegistry<TKeys extends string = string> {
  readonly __manduMessages: true;
  readonly bundles: MessageBundle<TKeys>;
  readonly locales: readonly LocaleCode[];
  /**
   * Look up a single message. Returns `undefined` when neither
   * the requested locale nor the registry's configured fallbacks
   * carry the key. The returned value is the raw template, NOT
   * interpolated — use `createTranslator()` for the full pipeline.
   */
  lookup(locale: LocaleCode, key: TKeys, fallback?: LocaleCode): string | undefined;
}

/**
 * Create a message registry. The generic `TBundle` is inferred from
 * the argument when passed `as const`, giving `t()` compile-time
 * key checks.
 *
 * @example
 * ```ts
 * const messages = defineMessages({
 *   en: { welcome: "Welcome, {{name}}!" },
 *   ko: { welcome: "환영합니다, {{name}}님!" },
 * } as const);
 * ```
 */
export function defineMessages<
  TBundle extends Record<string, Record<string, string>>,
>(bundles: TBundle): MessageRegistry<
  Extract<keyof TBundle[keyof TBundle], string>
> {
  if (!bundles || typeof bundles !== "object") {
    throw new Error("[mandu/i18n] defineMessages() requires an object");
  }
  const locales = Object.keys(bundles);
  if (locales.length === 0) {
    throw new Error("[mandu/i18n] defineMessages() requires at least one locale");
  }
  for (const [locale, bundle] of Object.entries(bundles)) {
    if (!bundle || typeof bundle !== "object") {
      throw new Error(
        `[mandu/i18n] defineMessages(): bundle for "${locale}" must be an object`
      );
    }
    for (const [key, value] of Object.entries(bundle)) {
      if (typeof value !== "string") {
        throw new Error(
          `[mandu/i18n] defineMessages(): "${locale}.${key}" must be a string`
        );
      }
    }
  }

  type TKey = Extract<keyof TBundle[keyof TBundle], string>;

  const registry: MessageRegistry<TKey> = {
    __manduMessages: true,
    bundles: bundles as unknown as MessageBundle<TKey>,
    locales,
    lookup(locale: LocaleCode, key: TKey, fallback?: LocaleCode): string | undefined {
      const primary = (bundles as Record<string, Record<string, string>>)[locale]?.[key];
      if (typeof primary === "string") return primary;
      if (fallback && fallback !== locale) {
        const alt = (bundles as Record<string, Record<string, string>>)[fallback]?.[key];
        if (typeof alt === "string") return alt;
      }
      return undefined;
    },
  };
  return registry;
}

/**
 * Replace `{{var}}` placeholders in `template` using `vars`. Missing
 * vars are preserved as `{{var}}` so templating bugs are visible in
 * the rendered output (not silently stripped). `vars[...]` values
 * that are numbers are coerced via `String(value)`.
 *
 * Whitespace inside braces is tolerated: `{{ name }}` and `{{name}}`
 * both resolve to `vars.name`.
 */
export function interpolate(
  template: string,
  vars: Record<string, string | number> | undefined
): string {
  if (!vars) return template;
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      const value = vars[key as keyof typeof vars];
      if (value === undefined || value === null) return match;
      return String(value);
    }
    return match;
  });
}

/**
 * Build a typed `t()` function bound to a specific active locale.
 * Misses walk `activeLocale → fallbackLocale → defaultLocale → key`
 * (skipping duplicates). The final fallback to raw `key` makes
 * missing-translation bugs highly visible during QA without
 * crashing the page.
 *
 * @example
 * ```ts
 * const messages = defineMessages({
 *   en: { greet: "Hi, {{name}}" },
 *   ko: { greet: "안녕, {{name}}" },
 * } as const);
 *
 * const t = createTranslator(messages, { activeLocale: "ko", defaultLocale: "en" });
 * t("greet", { name: "만두" }); // → "안녕, 만두"
 * ```
 */
export function createTranslator<TKeys extends string>(
  registry: MessageRegistry<TKeys>,
  opts: {
    activeLocale: LocaleCode;
    defaultLocale: LocaleCode;
    fallbackLocale?: LocaleCode;
  }
): Translator<TKeys> {
  const { activeLocale, defaultLocale, fallbackLocale } = opts;
  return function t(key, vars) {
    const candidates: LocaleCode[] = [activeLocale];
    if (fallbackLocale && !candidates.includes(fallbackLocale)) candidates.push(fallbackLocale);
    if (!candidates.includes(defaultLocale)) candidates.push(defaultLocale);

    for (const locale of candidates) {
      const value = registry.lookup(locale, key as TKeys);
      if (typeof value === "string") {
        return interpolate(value, vars);
      }
    }
    // Final fallback — raw key preserves "unresolved" signal instead
    // of a blank string. `vars` is intentionally ignored here because
    // the key itself isn't a template.
    return key as unknown as string;
  };
}

/**
 * Type guard for {@link MessageRegistry}. Useful when the runtime
 * receives `unknown` from user config (e.g. dynamic imports).
 */
export function isMessageRegistry(value: unknown): value is MessageRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __manduMessages?: unknown }).__manduMessages === true
  );
}
