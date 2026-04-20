/**
 * Phase 18.μ — defineI18n() regression tests.
 */
import { describe, it, expect } from "bun:test";
import { defineI18n, isI18nDefinition, VALID_STRATEGIES, DEFAULT_I18N_COOKIE } from "../../src/i18n";

describe("defineI18n", () => {
  it("accepts a minimal path-prefix config and brands the result", () => {
    const cfg = defineI18n({
      locales: ["en", "ko"],
      defaultLocale: "en",
      strategy: "path-prefix",
    });
    expect(cfg.locales).toEqual(["en", "ko"]);
    expect(cfg.defaultLocale).toBe("en");
    expect(cfg.strategy).toBe("path-prefix");
    expect(cfg.cookieName).toBe(DEFAULT_I18N_COOKIE);
    expect(isI18nDefinition(cfg)).toBe(true);
  });

  it("freezes the returned object to prevent accidental mutation", () => {
    const cfg = defineI18n({
      locales: ["en"],
      defaultLocale: "en",
      strategy: "header",
    });
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.locales)).toBe(true);
  });

  it("rejects empty locales", () => {
    expect(() =>
      defineI18n({ locales: [], defaultLocale: "en", strategy: "header" })
    ).toThrow(/non-empty array/);
  });

  it("rejects duplicate locales", () => {
    expect(() =>
      defineI18n({
        locales: ["en", "ko", "en"],
        defaultLocale: "en",
        strategy: "header",
      })
    ).toThrow(/duplicates/);
  });

  it("rejects defaultLocale not in locales", () => {
    expect(() =>
      defineI18n({
        locales: ["en", "ko"],
        defaultLocale: "ja",
        strategy: "header",
      })
    ).toThrow(/defaultLocale/);
  });

  it("rejects fallback not in locales", () => {
    expect(() =>
      defineI18n({
        locales: ["en", "ko"],
        defaultLocale: "en",
        fallback: "fr",
        strategy: "header",
      })
    ).toThrow(/fallback/);
  });

  it("rejects unknown strategy", () => {
    expect(() =>
      defineI18n({
        locales: ["en"],
        defaultLocale: "en",
        // @ts-expect-error invalid strategy
        strategy: "bogus",
      })
    ).toThrow(/strategy/);
  });

  it("requires domains when strategy is 'domain'", () => {
    expect(() =>
      defineI18n({
        locales: ["en", "ko"],
        defaultLocale: "en",
        strategy: "domain",
      })
    ).toThrow(/domains/);
  });

  it("rejects domain map values not in locales", () => {
    expect(() =>
      defineI18n({
        locales: ["en", "ko"],
        defaultLocale: "en",
        strategy: "domain",
        domains: { "en.example.com": "en", "fr.example.com": "fr" },
      })
    ).toThrow(/is not in locales/);
  });

  it("accepts a valid domain config", () => {
    const cfg = defineI18n({
      locales: ["en", "ko"],
      defaultLocale: "en",
      strategy: "domain",
      domains: { "en.example.com": "en", "ko.example.com": "ko" },
    });
    expect(cfg.domains).toEqual({ "en.example.com": "en", "ko.example.com": "ko" });
  });

  it("honours custom cookieName override", () => {
    const cfg = defineI18n({
      locales: ["en", "ko"],
      defaultLocale: "en",
      strategy: "cookie",
      cookieName: "locale_preference",
    });
    expect(cfg.cookieName).toBe("locale_preference");
  });

  it("exposes VALID_STRATEGIES as a frozen whitelist", () => {
    expect(VALID_STRATEGIES).toEqual(["path-prefix", "domain", "header", "cookie"]);
  });

  it("rejects non-object arguments", () => {
    // @ts-expect-error invalid arg
    expect(() => defineI18n(null)).toThrow(/config object/);
  });

  it("rejects non-string locale entries", () => {
    expect(() =>
      defineI18n({
        // @ts-expect-error invalid arg
        locales: ["en", 42],
        defaultLocale: "en",
        strategy: "header",
      })
    ).toThrow(/non-empty string/);
  });

  it("isI18nDefinition type guard only accepts branded objects", () => {
    expect(isI18nDefinition({ locales: ["en"], defaultLocale: "en" })).toBe(false);
    const cfg = defineI18n({ locales: ["en"], defaultLocale: "en", strategy: "header" });
    expect(isI18nDefinition(cfg)).toBe(true);
  });
});
