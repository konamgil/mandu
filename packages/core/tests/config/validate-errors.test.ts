/**
 * Config Validation Error Tests
 *
 * Covers ManduConfigSchema validation: missing config, invalid ports,
 * invalid guard presets, unknown keys (strict mode), and the
 * validateConfig function's file-level error handling.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  ManduConfigSchema,
  validateConfig,
  assertValidConfig,
} from "../../src/config/validate";

// ---------------------------------------------------------------------------
// 1. Schema-level validation (ManduConfigSchema.safeParse)
// ---------------------------------------------------------------------------

describe("ManduConfigSchema — valid configs", () => {
  it("accepts empty config (all defaults)", () => {
    const result = ManduConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts minimal server config", () => {
    const result = ManduConfigSchema.safeParse({
      server: { port: 8080 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.server.port).toBe(8080);
    }
  });

  it("fills in defaults for omitted sections", () => {
    const result = ManduConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.server.port).toBe(3000);
      // Default changed from "localhost" → "0.0.0.0" in #190 so that IPv4
      // `localhost` resolution (Windows default) reaches the server.
      expect(result.data.server.hostname).toBe("0.0.0.0");
      expect(result.data.guard.preset).toBe("mandu");
      expect(result.data.build.outDir).toBe(".mandu");
      expect(result.data.build.minify).toBe(true);
      expect(result.data.dev.hmr).toBe(true);
      expect(result.data.fsRoutes.routesDir).toBe("app");
    }
  });
});

describe("ManduConfigSchema — invalid port", () => {
  it("rejects negative port", () => {
    const result = ManduConfigSchema.safeParse({
      server: { port: -1 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const portError = result.error.errors.find(
        (e) => e.path.includes("port")
      );
      expect(portError).toBeDefined();
    }
  });

  it("rejects port 0", () => {
    const result = ManduConfigSchema.safeParse({
      server: { port: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects port above 65535", () => {
    const result = ManduConfigSchema.safeParse({
      server: { port: 70000 },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-numeric port", () => {
    const result = ManduConfigSchema.safeParse({
      server: { port: "not-a-port" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid boundary ports", () => {
    expect(ManduConfigSchema.safeParse({ server: { port: 1 } }).success).toBe(true);
    expect(ManduConfigSchema.safeParse({ server: { port: 65535 } }).success).toBe(true);
    expect(ManduConfigSchema.safeParse({ server: { port: 3000 } }).success).toBe(true);
  });
});

describe("ManduConfigSchema — invalid guard preset", () => {
  it("rejects unknown guard preset", () => {
    const result = ManduConfigSchema.safeParse({
      guard: { preset: "invalid-preset" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const presetError = result.error.errors.find(
        (e) => e.path.includes("preset")
      );
      expect(presetError).toBeDefined();
      // The error message should indicate valid values
      expect(presetError!.message).toBeTruthy();
    }
  });

  it("accepts all valid guard presets", () => {
    const validPresets = ["mandu", "fsd", "clean", "hexagonal", "atomic", "cqrs"];
    for (const preset of validPresets) {
      const result = ManduConfigSchema.safeParse({ guard: { preset } });
      expect(result.success).toBe(true);
    }
  });
});

describe("ManduConfigSchema — strict mode (unknown keys)", () => {
  it("rejects unknown top-level keys", () => {
    const result = ManduConfigSchema.safeParse({
      unknownKey: "value",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const unknownKeyError = result.error.errors.find(
        (e) => e.code === "unrecognized_keys"
      );
      expect(unknownKeyError).toBeDefined();
    }
  });

  it("rejects unknown keys in server section", () => {
    const result = ManduConfigSchema.safeParse({
      server: { port: 3000, unknownServerKey: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys in guard section", () => {
    const result = ManduConfigSchema.safeParse({
      guard: { preset: "mandu", unknownGuardKey: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys in build section", () => {
    const result = ManduConfigSchema.safeParse({
      build: { outDir: ".mandu", compression: true },
    });
    expect(result.success).toBe(false);
  });
});

describe("ManduConfigSchema — guard rule severity", () => {
  it("accepts valid severity levels", () => {
    const result = ManduConfigSchema.safeParse({
      guard: {
        rules: {
          "no-circular": "error",
          "layer-order": "warn",
          "index-only": "warning",
          "deprecated": "off",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid severity level", () => {
    const result = ManduConfigSchema.safeParse({
      guard: {
        rules: {
          "no-circular": "fatal", // invalid
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("ManduConfigSchema — cors and rateLimit", () => {
  it("accepts boolean cors", () => {
    const result = ManduConfigSchema.safeParse({ server: { cors: true } });
    expect(result.success).toBe(true);
  });

  it("accepts object cors with origin and methods", () => {
    const result = ManduConfigSchema.safeParse({
      server: {
        cors: {
          origin: ["http://localhost:3000"],
          methods: ["GET", "POST"],
          credentials: true,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts boolean rateLimit", () => {
    const result = ManduConfigSchema.safeParse({
      server: { rateLimit: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts object rateLimit", () => {
    const result = ManduConfigSchema.safeParse({
      server: {
        rateLimit: {
          windowMs: 60000,
          max: 100,
          message: "Too many requests",
          statusCode: 429,
          headers: true,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid rateLimit statusCode (below 400)", () => {
    const result = ManduConfigSchema.safeParse({
      server: {
        rateLimit: {
          statusCode: 200,
        },
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. assertValidConfig
// ---------------------------------------------------------------------------

describe("assertValidConfig", () => {
  it("does not throw for a valid config", () => {
    expect(() =>
      assertValidConfig({ server: { port: 3000 } })
    ).not.toThrow();
  });

  it("throws for an invalid config with descriptive message", () => {
    expect(() =>
      assertValidConfig({ server: { port: -1 } })
    ).toThrow(/Invalid ManduConfig/);
  });

  it("includes path in error message", () => {
    try {
      assertValidConfig({ guard: { preset: "bogus" } });
      // Should not reach here
      expect(true).toBe(false);
    } catch (e) {
      expect((e as Error).message).toContain("guard");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. validateConfig — file-level error handling
// ---------------------------------------------------------------------------

describe("validateConfig — file-level", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mandu-config-test-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns valid result with defaults when no config file exists", async () => {
    const result = await validateConfig(tmpDir);
    expect(result.valid).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.config!.server.port).toBe(3000);
  });

  it("returns validation errors for invalid JSON config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mandu-config-json-"));
    writeFileSync(
      join(dir, "mandu.config.json"),
      JSON.stringify({ server: { port: -999 } })
    );

    try {
      const result = await validateConfig(dir);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      // Should mention the file path
      const allMessages = result.errors!.map((e) => e.message).join(" ");
      expect(allMessages).toContain("mandu.config.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns syntax error for malformed JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mandu-config-syntax-"));
    writeFileSync(
      join(dir, "mandu.config.json"),
      "{ invalid json content"
    );

    try {
      const result = await validateConfig(dir);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      const allMessages = result.errors!.map((e) => e.message).join(" ");
      // Should indicate a parse/syntax issue
      expect(
        allMessages.includes("Syntax") || allMessages.includes("parse") || allMessages.includes("Failed")
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates config from .mandu/guard.json (guard-only)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mandu-config-guard-"));
    mkdirSync(join(dir, ".mandu"), { recursive: true });
    writeFileSync(
      join(dir, ".mandu", "guard.json"),
      JSON.stringify({ preset: "fsd", srcDir: "src" })
    );

    try {
      const result = await validateConfig(dir);
      expect(result.valid).toBe(true);
      expect(result.config!.guard.preset).toBe("fsd");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns error for valid JSON but invalid config values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mandu-config-invalid-"));
    writeFileSync(
      join(dir, "mandu.config.json"),
      JSON.stringify({
        guard: { preset: "nonexistent" },
      })
    );

    try {
      const result = await validateConfig(dir);
      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
