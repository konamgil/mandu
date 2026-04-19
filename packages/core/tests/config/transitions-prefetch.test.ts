/**
 * Issue #192 — `transitions` and `prefetch` config fields.
 *
 * Covers: Zod default-on behaviour, explicit opt-out (`false`), type
 * rejection (`truthy_string`, `1`), and strict-mode coexistence with
 * the rest of the schema (typos still get flagged).
 */
import { describe, it, expect } from "bun:test";
import { ManduConfigSchema } from "../../src/config/validate";

describe("transitions / prefetch — defaults", () => {
  it("both fields default to true when the whole config is empty", () => {
    const cfg = ManduConfigSchema.parse({});
    expect(cfg.transitions).toBe(true);
    expect(cfg.prefetch).toBe(true);
  });

  it("both fields default to true when only other blocks are set", () => {
    const cfg = ManduConfigSchema.parse({
      server: { port: 4000 },
      guard: { preset: "clean" },
    });
    expect(cfg.transitions).toBe(true);
    expect(cfg.prefetch).toBe(true);
  });
});

describe("transitions / prefetch — explicit values", () => {
  it("accepts `transitions: false` and preserves the value", () => {
    const cfg = ManduConfigSchema.parse({ transitions: false });
    expect(cfg.transitions).toBe(false);
    // prefetch should still default to true
    expect(cfg.prefetch).toBe(true);
  });

  it("accepts `prefetch: false` and preserves the value", () => {
    const cfg = ManduConfigSchema.parse({ prefetch: false });
    expect(cfg.prefetch).toBe(false);
    expect(cfg.transitions).toBe(true);
  });

  it("accepts both set to false simultaneously", () => {
    const cfg = ManduConfigSchema.parse({
      transitions: false,
      prefetch: false,
    });
    expect(cfg.transitions).toBe(false);
    expect(cfg.prefetch).toBe(false);
  });

  it("accepts both set to true explicitly (no-op vs default)", () => {
    const cfg = ManduConfigSchema.parse({
      transitions: true,
      prefetch: true,
    });
    expect(cfg.transitions).toBe(true);
    expect(cfg.prefetch).toBe(true);
  });
});

describe("transitions / prefetch — type safety", () => {
  it("rejects a string value for `transitions`", () => {
    const result = ManduConfigSchema.safeParse({ transitions: "true" });
    expect(result.success).toBe(false);
  });

  it("rejects a numeric value for `prefetch`", () => {
    const result = ManduConfigSchema.safeParse({ prefetch: 1 });
    expect(result.success).toBe(false);
  });

  it("rejects an object value for `transitions`", () => {
    const result = ManduConfigSchema.safeParse({
      transitions: { auto: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a null value for `prefetch`", () => {
    const result = ManduConfigSchema.safeParse({ prefetch: null });
    expect(result.success).toBe(false);
  });
});

describe("transitions / prefetch — strict-mode coexistence", () => {
  it("still flags unknown top-level keys when transitions/prefetch are set", () => {
    const result = ManduConfigSchema.safeParse({
      transitions: false,
      prefetch: false,
      typoField: 42,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Should mention the unknown key
      const messages = result.error.errors.map((e) => e.message).join(" ");
      expect(messages).toContain("typoField");
    }
  });

  it("accepts combination with server, guard, seo blocks", () => {
    const cfg = ManduConfigSchema.parse({
      transitions: true,
      prefetch: false,
      server: { port: 8080, streaming: true },
      seo: { defaultTitle: "My App" },
    });
    expect(cfg.transitions).toBe(true);
    expect(cfg.prefetch).toBe(false);
    expect(cfg.server.port).toBe(8080);
    expect(cfg.seo.defaultTitle).toBe("My App");
  });
});
