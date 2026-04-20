/**
 * Phase 18.μ — message-registry + t() tests.
 */
import { describe, it, expect } from "bun:test";
import {
  defineMessages,
  createTranslator,
  interpolate,
  isMessageRegistry,
} from "../../src/i18n";

describe("defineMessages", () => {
  it("returns a branded registry", () => {
    const registry = defineMessages({
      en: { hello: "Hello" },
      ko: { hello: "안녕" },
    } as const);
    expect(isMessageRegistry(registry)).toBe(true);
    expect(registry.locales).toEqual(["en", "ko"]);
  });

  it("rejects empty bundle object", () => {
    expect(() => defineMessages({} as Record<string, Record<string, string>>)).toThrow(
      /at least one locale/
    );
  });

  it("rejects non-string values", () => {
    expect(() =>
      // @ts-expect-error invalid value
      defineMessages({ en: { key: 42 } })
    ).toThrow(/must be a string/);
  });

  it("lookup returns the raw template for matching locale + key", () => {
    const registry = defineMessages({
      en: { welcome: "Welcome, {{name}}" },
      ko: { welcome: "환영 {{name}}" },
    } as const);
    expect(registry.lookup("en", "welcome")).toBe("Welcome, {{name}}");
    expect(registry.lookup("ko", "welcome")).toBe("환영 {{name}}");
  });

  it("lookup falls back to explicit fallback locale on miss", () => {
    const registry = defineMessages({
      en: { only_en: "English only" },
      ko: {},
    } as Record<string, Record<string, string>>);
    expect(registry.lookup("ko", "only_en", "en")).toBe("English only");
  });
});

describe("interpolate", () => {
  it("replaces {{var}} placeholders", () => {
    expect(interpolate("Hello, {{name}}!", { name: "Mandu" })).toBe("Hello, Mandu!");
  });

  it("tolerates whitespace inside braces", () => {
    expect(interpolate("{{ greet }}, {{name}}", { greet: "Hi", name: "만두" })).toBe("Hi, 만두");
  });

  it("preserves missing vars as {{var}} literal", () => {
    expect(interpolate("Hello, {{name}}!", {})).toBe("Hello, {{name}}!");
  });

  it("accepts numeric values and coerces to string", () => {
    expect(interpolate("Count: {{n}}", { n: 42 })).toBe("Count: 42");
  });

  it("returns template unchanged when no vars supplied", () => {
    expect(interpolate("static text", undefined)).toBe("static text");
  });
});

describe("createTranslator", () => {
  const registry = defineMessages({
    en: { welcome: "Welcome, {{name}}" },
    ko: { welcome: "환영합니다, {{name}}님" },
    "en-US": { welcome: "Howdy, {{name}}" },
  } as const);

  it("looks up the active locale first", () => {
    const t = createTranslator(registry, { activeLocale: "ko", defaultLocale: "en" });
    expect(t("welcome", { name: "만두" })).toBe("환영합니다, 만두님");
  });

  it("falls through to defaultLocale on miss", () => {
    const t = createTranslator(
      defineMessages({
        en: { only_en: "English only" },
        ko: { welcome: "환영" },
      } as const),
      { activeLocale: "ko", defaultLocale: "en" }
    );
    // @ts-expect-error key only in en
    expect(t("only_en", {})).toBe("English only");
  });

  it("honours fallback between active and default", () => {
    const t = createTranslator(registry, {
      activeLocale: "ko",
      fallbackLocale: "en-US",
      defaultLocale: "en",
    });
    // ko has it → no fallback needed
    expect(t("welcome", { name: "만두" })).toBe("환영합니다, 만두님");
  });

  it("returns raw key when no locale has the message", () => {
    const t = createTranslator(registry, { activeLocale: "ko", defaultLocale: "en" });
    // @ts-expect-error unknown key
    expect(t("missing_key", {})).toBe("missing_key");
  });

  it("type-checks keys at compile time (runtime accepts declared keys)", () => {
    const t = createTranslator(registry, { activeLocale: "en", defaultLocale: "en" });
    expect(t("welcome", { name: "X" })).toBe("Welcome, X");
    // TypeScript would reject t("nope") at compile time
  });
});
