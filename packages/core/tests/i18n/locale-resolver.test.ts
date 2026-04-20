/**
 * Phase 18.μ — locale resolver regression tests.
 */
import { describe, it, expect } from "bun:test";
import {
  defineI18n,
  resolveLocale,
  stripLocalePrefix,
  parseAcceptLanguage,
  readLocaleCookie,
} from "../../src/i18n";

describe("stripLocalePrefix", () => {
  it("detects a known locale prefix", () => {
    expect(stripLocalePrefix("/en/docs", ["en", "ko"])).toEqual({
      locale: "en",
      rest: "/docs",
    });
  });

  it("handles trailing-slash-only paths", () => {
    expect(stripLocalePrefix("/ko/", ["en", "ko"])).toEqual({
      locale: "ko",
      rest: "/",
    });
  });

  it("handles bare locale paths", () => {
    expect(stripLocalePrefix("/ko", ["en", "ko"])).toEqual({
      locale: "ko",
      rest: "/",
    });
  });

  it("returns undefined locale when path does not match", () => {
    expect(stripLocalePrefix("/docs", ["en", "ko"])).toEqual({
      locale: undefined,
      rest: "/docs",
    });
  });

  it("returns undefined locale for root", () => {
    expect(stripLocalePrefix("/", ["en", "ko"])).toEqual({
      locale: undefined,
      rest: "/",
    });
  });
});

describe("parseAcceptLanguage", () => {
  it("returns exact match", () => {
    expect(parseAcceptLanguage("ko,en;q=0.5", ["en", "ko"])).toBe("ko");
  });

  it("respects q-weights", () => {
    expect(parseAcceptLanguage("en;q=0.5,ko;q=0.9", ["en", "ko"])).toBe("ko");
  });

  it("falls back to widened language tag when no exact match exists", () => {
    // When 'en' isn't configured, 'ko-KR' should widen to 'ko'.
    // Exact matches always win over widening, so the test must omit 'en'.
    expect(parseAcceptLanguage("ko-KR,fr", ["ko"])).toBe("ko");
  });

  it("ignores unsupported locales", () => {
    expect(parseAcceptLanguage("fr,de", ["en", "ko"])).toBeUndefined();
  });

  it("handles null header", () => {
    expect(parseAcceptLanguage(null, ["en", "ko"])).toBeUndefined();
  });
});

describe("readLocaleCookie", () => {
  it("reads a locale cookie with the default name", () => {
    expect(readLocaleCookie("mandu_locale=ko", "mandu_locale", ["en", "ko"])).toBe("ko");
  });

  it("ignores cookies whose value is not in locales", () => {
    expect(readLocaleCookie("mandu_locale=fr", "mandu_locale", ["en", "ko"])).toBeUndefined();
  });

  it("supports multiple cookies", () => {
    expect(
      readLocaleCookie("session=abc; mandu_locale=en", "mandu_locale", ["en", "ko"])
    ).toBe("en");
  });

  it("handles null header", () => {
    expect(readLocaleCookie(null, "mandu_locale", ["en", "ko"])).toBeUndefined();
  });
});

describe("resolveLocale", () => {
  const cfgPathPrefix = defineI18n({
    locales: ["en", "ko"],
    defaultLocale: "en",
    strategy: "path-prefix",
  });

  it("prefers URL over cookie + header in path-prefix mode", () => {
    const req = new Request("https://x.test/ko/docs", {
      headers: {
        cookie: "mandu_locale=en",
        "accept-language": "en",
      },
    });
    const res = resolveLocale(req, cfgPathPrefix);
    expect(res.code).toBe("ko");
    expect(res.strategy).toBe("path-prefix");
    expect(res.isDefault).toBe(false);
  });

  it("falls back to cookie when URL has no locale prefix", () => {
    const req = new Request("https://x.test/docs", {
      headers: { cookie: "mandu_locale=ko" },
    });
    const res = resolveLocale(req, cfgPathPrefix);
    expect(res.code).toBe("ko");
    expect(res.strategy).toBe("cookie");
  });

  it("falls back to Accept-Language when no URL + cookie signal", () => {
    const req = new Request("https://x.test/", {
      headers: { "accept-language": "ko,en;q=0.1" },
    });
    const res = resolveLocale(req, cfgPathPrefix);
    expect(res.code).toBe("ko");
    expect(res.strategy).toBe("header");
  });

  it("returns defaultLocale when no signal matches", () => {
    const req = new Request("https://x.test/", {
      headers: { "accept-language": "fr" },
    });
    const res = resolveLocale(req, cfgPathPrefix);
    expect(res.code).toBe("en");
    expect(res.strategy).toBe("default");
    expect(res.isDefault).toBe(true);
  });

  it("honours domain strategy via Host header", () => {
    const cfg = defineI18n({
      locales: ["en", "ko"],
      defaultLocale: "en",
      strategy: "domain",
      domains: { "en.example.com": "en", "ko.example.com": "ko" },
    });
    const req = new Request("https://ko.example.com/docs");
    const res = resolveLocale(req, cfg);
    expect(res.code).toBe("ko");
    expect(res.strategy).toBe("domain");
  });

  it("domain strategy falls through to cookie when host unmapped", () => {
    const cfg = defineI18n({
      locales: ["en", "ko"],
      defaultLocale: "en",
      strategy: "domain",
      domains: { "en.example.com": "en" },
    });
    const req = new Request("https://unknown.test/", {
      headers: { cookie: "mandu_locale=ko" },
    });
    const res = resolveLocale(req, cfg);
    expect(res.code).toBe("ko");
    expect(res.strategy).toBe("cookie");
  });

  it("cookie strategy prefers cookie over header", () => {
    const cfg = defineI18n({
      locales: ["en", "ko"],
      defaultLocale: "en",
      strategy: "cookie",
    });
    const req = new Request("https://x.test/docs", {
      headers: {
        cookie: "mandu_locale=ko",
        "accept-language": "en",
      },
    });
    const res = resolveLocale(req, cfg);
    expect(res.code).toBe("ko");
    expect(res.strategy).toBe("cookie");
  });

  it("header strategy prefers Accept-Language", () => {
    const cfg = defineI18n({
      locales: ["en", "ko"],
      defaultLocale: "en",
      strategy: "header",
    });
    const req = new Request("https://x.test/", {
      headers: {
        cookie: "mandu_locale=en",
        "accept-language": "ko",
      },
    });
    const res = resolveLocale(req, cfg);
    expect(res.code).toBe("ko");
    expect(res.strategy).toBe("header");
  });

  it("returns fallback locale when configured and no signal matches", () => {
    const cfg = defineI18n({
      locales: ["en", "ko", "en-US"],
      defaultLocale: "en",
      fallback: "en-US",
      strategy: "header",
    });
    const req = new Request("https://x.test/", {
      headers: { "accept-language": "fr" },
    });
    const res = resolveLocale(req, cfg);
    // fallback !== defaultLocale → use fallback
    expect(res.code).toBe("en-US");
    expect(res.strategy).toBe("fallback");
  });

  it("ignores invalid locale cookie values", () => {
    const cfg = defineI18n({
      locales: ["en", "ko"],
      defaultLocale: "en",
      strategy: "cookie",
    });
    const req = new Request("https://x.test/", {
      headers: { cookie: "mandu_locale=fr", "accept-language": "ko" },
    });
    const res = resolveLocale(req, cfg);
    // invalid cookie → header wins
    expect(res.code).toBe("ko");
    expect(res.strategy).toBe("header");
  });

  it("ignores invalid URL locale prefix in path-prefix mode", () => {
    const req = new Request("https://x.test/fr/docs", {
      headers: { "accept-language": "ko" },
    });
    const res = resolveLocale(req, cfgPathPrefix);
    // 'fr' not configured → falls through to header → 'ko'
    expect(res.code).toBe("ko");
    expect(res.strategy).toBe("header");
  });
});
