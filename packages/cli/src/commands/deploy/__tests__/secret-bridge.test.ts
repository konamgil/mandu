/**
 * Secret bridge — OS-keychain + fallback-file semantics (Phase 13.1).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  __resetFallbackWarningForTests,
  createSecretBridge,
  maskSecret,
  parseSecretPair,
  SecretFormatError,
} from "../secret-bridge";

async function tmpProject(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `mandu-secret-${prefix}-`));
}

describe("parseSecretPair", () => {
  it("parses KEY=VALUE", () => {
    expect(parseSecretPair("FLY_API_TOKEN=abc123")).toEqual({
      name: "FLY_API_TOKEN",
      value: "abc123",
    });
  });

  it("allows = inside value", () => {
    expect(parseSecretPair("TOKEN=base64==value")).toEqual({
      name: "TOKEN",
      value: "base64==value",
    });
  });

  it("strips one layer of wrapping quotes", () => {
    expect(parseSecretPair(`TOKEN="secret value"`)).toEqual({
      name: "TOKEN",
      value: "secret value",
    });
    expect(parseSecretPair(`TOKEN='hello world'`)).toEqual({
      name: "TOKEN",
      value: "hello world",
    });
  });

  it("rejects missing =", () => {
    expect(() => parseSecretPair("TOKEN_ONLY")).toThrow(SecretFormatError);
  });

  it("rejects invalid key syntax", () => {
    expect(() => parseSecretPair("lowercase=val")).toThrow(SecretFormatError);
    expect(() => parseSecretPair("1LEADING_DIGIT=x")).toThrow(SecretFormatError);
    expect(() => parseSecretPair("DASHES-BAD=x")).toThrow(SecretFormatError);
  });

  it("rejects values with line terminators", () => {
    expect(() => parseSecretPair("KEY=line1\nline2")).toThrow(SecretFormatError);
  });

  it("rejects empty/whitespace input", () => {
    expect(() => parseSecretPair("")).toThrow(SecretFormatError);
    expect(() => parseSecretPair("   ")).toThrow(SecretFormatError);
  });
});

describe("maskSecret", () => {
  it("returns the same masked string regardless of input", () => {
    expect(maskSecret("abcdef")).toBe("****");
    expect(maskSecret("")).toBe("****");
    expect(maskSecret(null)).toBe("****");
    expect(maskSecret(undefined)).toBe("****");
  });
});

describe("createSecretBridge — fallback file backend", () => {
  let rootDir: string;

  beforeAll(async () => {
    __resetFallbackWarningForTests();
    rootDir = await tmpProject("fallback");
  });

  afterAll(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("selects fallback backend when forced", () => {
    __resetFallbackWarningForTests();
    const warnings: string[] = [];
    const bridge = createSecretBridge({
      target: "vercel",
      rootDir,
      forceFallback: true,
      onWarning: (m) => warnings.push(m),
    });
    expect(bridge.backend).toBe("fallback-file");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/Bun\.secrets unavailable/);
  });

  it("emits the plaintext warning only once per process", async () => {
    __resetFallbackWarningForTests();
    const warnings1: string[] = [];
    const warnings2: string[] = [];
    createSecretBridge({
      target: "vercel",
      rootDir,
      forceFallback: true,
      onWarning: (m) => warnings1.push(m),
    });
    createSecretBridge({
      target: "fly",
      rootDir,
      forceFallback: true,
      onWarning: (m) => warnings2.push(m),
    });
    expect(warnings1.length).toBe(1);
    expect(warnings2.length).toBe(0);
  });

  it("round-trips set → get → delete", async () => {
    __resetFallbackWarningForTests();
    const bridge = createSecretBridge({
      target: "fly",
      rootDir,
      forceFallback: true,
      onWarning: () => {},
    });
    await bridge.set("FLY_API_TOKEN", "abc-123");
    expect(await bridge.get("FLY_API_TOKEN")).toBe("abc-123");
    expect(await bridge.listStoredNames()).toEqual(["FLY_API_TOKEN"]);
    await bridge.delete("FLY_API_TOKEN");
    expect(await bridge.get("FLY_API_TOKEN")).toBeNull();
    expect(await bridge.listStoredNames()).toEqual([]);
  });

  it("isolates secrets by target", async () => {
    __resetFallbackWarningForTests();
    const vercel = createSecretBridge({
      target: "vercel",
      rootDir,
      forceFallback: true,
      onWarning: () => {},
    });
    const fly = createSecretBridge({
      target: "fly",
      rootDir,
      forceFallback: true,
      onWarning: () => {},
    });
    await vercel.set("VERCEL_TOKEN", "v-secret");
    await fly.set("FLY_API_TOKEN", "f-secret");
    expect(await vercel.get("FLY_API_TOKEN")).toBeNull();
    expect(await fly.get("VERCEL_TOKEN")).toBeNull();
    expect(await vercel.listStoredNames()).toContain("VERCEL_TOKEN");
    expect(await fly.listStoredNames()).toContain("FLY_API_TOKEN");
  });

  it("writes the fallback file at .mandu/secrets.json", async () => {
    __resetFallbackWarningForTests();
    const freshRoot = await tmpProject("fresh");
    const bridge = createSecretBridge({
      target: "docker",
      rootDir: freshRoot,
      forceFallback: true,
      onWarning: () => {},
    });
    await bridge.set("MY_VAR", "value-123");
    const file = path.join(freshRoot, ".mandu", "secrets.json");
    const content = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe(1);
    expect(parsed.secrets.docker.MY_VAR).toBe("value-123");
    await fs.rm(freshRoot, { recursive: true, force: true });
  });
});
