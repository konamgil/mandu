/**
 * 결정론적 해싱 테스트
 *
 * @see docs/plans/08_ont-run_adoption_plan.md - 섹션 7.1
 */

import { describe, expect, it } from "bun:test";
import {
  computeConfigHash,
  verifyConfigIntegrity,
  compareConfigHashes,
  normalizeForHash,
  isHashable,
} from "./hasher.js";

describe("computeConfigHash", () => {
  it("should produce same hash regardless of key order", () => {
    const config1 = { a: 1, b: 2, c: 3 };
    const config2 = { c: 3, a: 1, b: 2 };
    const config3 = { b: 2, c: 3, a: 1 };

    const hash1 = computeConfigHash(config1);
    const hash2 = computeConfigHash(config2);
    const hash3 = computeConfigHash(config3);

    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it("should produce different hash for different values", () => {
    const config1 = { a: 1 };
    const config2 = { a: 2 };

    expect(computeConfigHash(config1)).not.toBe(computeConfigHash(config2));
  });

  it("should handle nested objects with deterministic ordering", () => {
    const config1 = {
      server: { port: 3000, host: "localhost" },
      database: { url: "postgres://...", pool: 10 },
    };
    const config2 = {
      database: { pool: 10, url: "postgres://..." },
      server: { host: "localhost", port: 3000 },
    };

    expect(computeConfigHash(config1)).toBe(computeConfigHash(config2));
  });

  it("should handle arrays (order matters)", () => {
    const config1 = { items: [1, 2, 3] };
    const config2 = { items: [1, 2, 3] };
    const config3 = { items: [3, 2, 1] };

    expect(computeConfigHash(config1)).toBe(computeConfigHash(config2));
    expect(computeConfigHash(config1)).not.toBe(computeConfigHash(config3));
  });

  it("should exclude specified keys", () => {
    const config1 = { a: 1, secret: "abc123" };
    const config2 = { a: 1, secret: "xyz789" };

    const hash1 = computeConfigHash(config1, { exclude: ["secret"] });
    const hash2 = computeConfigHash(config2, { exclude: ["secret"] });

    expect(hash1).toBe(hash2);
  });

  it("should produce hash of specified length", () => {
    const config = { test: "value" };

    expect(computeConfigHash(config, { length: 8 })).toHaveLength(8);
    expect(computeConfigHash(config, { length: 16 })).toHaveLength(16);
    expect(computeConfigHash(config, { length: 32 })).toHaveLength(32);
  });

  it("should handle empty objects", () => {
    expect(() => computeConfigHash({})).not.toThrow();
    expect(computeConfigHash({})).toHaveLength(16);
  });

  it("should handle null and undefined", () => {
    expect(() => computeConfigHash(null)).not.toThrow();
    expect(() => computeConfigHash(undefined)).not.toThrow();
  });
});

describe("normalizeForHash", () => {
  it("should convert Date to ISO string", () => {
    const date = new Date("2025-01-28T00:00:00.000Z");
    const normalized = normalizeForHash({ date });

    expect(normalized).toEqual({ date: "2025-01-28T00:00:00.000Z" });
  });

  it("should convert BigInt to string with n suffix", () => {
    const normalized = normalizeForHash({ big: BigInt(12345) });

    expect(normalized).toEqual({ big: "12345n" });
  });

  it("should convert URL to href string", () => {
    const url = new URL("https://example.com/path?query=1");
    const normalized = normalizeForHash({ url });

    expect(normalized).toEqual({ url: "https://example.com/path?query=1" });
  });

  it("should convert RegExp to string", () => {
    const normalized = normalizeForHash({ pattern: /test/gi });

    expect(normalized).toEqual({ pattern: "/test/gi" });
  });

  it("should remove functions by default", () => {
    const normalized = normalizeForHash({
      a: 1,
      fn: () => console.log("test"),
    });

    expect(normalized).toEqual({ a: 1 });
  });

  it("should remove Symbol by default", () => {
    const normalized = normalizeForHash({
      a: 1,
      sym: Symbol("test"),
    });

    expect(normalized).toEqual({ a: 1 });
  });

  it("should remove undefined values (like JSON.stringify)", () => {
    const normalized = normalizeForHash({
      a: 1,
      b: undefined,
      c: 3,
    });

    expect(normalized).toEqual({ a: 1, c: 3 });
  });

  it("should handle Map as sorted entries", () => {
    const map = new Map([
      ["z", 1],
      ["a", 2],
      ["m", 3],
    ]);
    const normalized = normalizeForHash({ data: map }) as any;

    expect(normalized.data.__type__).toBe("Map");
    expect(normalized.data.entries[0][0]).toBe("a"); // 정렬됨
  });

  it("should handle Set as sorted array", () => {
    const set = new Set([3, 1, 2]);
    const normalized = normalizeForHash({ data: set }) as any;

    expect(normalized.data.__type__).toBe("Set");
    expect(normalized.data.items).toEqual([1, 2, 3]); // 정렬됨
  });

  it("should detect circular references", () => {
    const obj: any = { a: 1 };
    obj.self = obj;

    const normalized = normalizeForHash(obj) as any;
    expect(normalized.self).toBe("__circular__");
  });

  it("should handle NaN, Infinity, -Infinity", () => {
    const normalized = normalizeForHash({
      nan: NaN,
      inf: Infinity,
      negInf: -Infinity,
    });

    expect(normalized).toEqual({
      nan: "__NaN__",
      inf: "__Infinity__",
      negInf: "__-Infinity__",
    });
  });

  it("should normalize Error objects", () => {
    const error = new TypeError("test error");
    const normalized = normalizeForHash({ error }) as any;

    expect(normalized.error.__type__).toBe("Error");
    expect(normalized.error.name).toBe("TypeError");
    expect(normalized.error.message).toBe("test error");
  });
});

describe("verifyConfigIntegrity", () => {
  it("should return true for matching config and hash", () => {
    const config = { server: { port: 3000 }, debug: true };
    const hash = computeConfigHash(config);

    expect(verifyConfigIntegrity(config, hash)).toBe(true);
  });

  it("should return false for modified config", () => {
    const config = { server: { port: 3000 }, debug: true };
    const hash = computeConfigHash(config);

    const modifiedConfig = { server: { port: 3001 }, debug: true };

    expect(verifyConfigIntegrity(modifiedConfig, hash)).toBe(false);
  });

  it("should work with exclude option", () => {
    const config = { a: 1, timestamp: Date.now() };
    const hash = computeConfigHash(config, { exclude: ["timestamp"] });

    // timestamp가 달라도 해시는 같아야 함
    const laterConfig = { a: 1, timestamp: Date.now() + 1000 };

    expect(verifyConfigIntegrity(laterConfig, hash, { exclude: ["timestamp"] })).toBe(true);
  });
});

describe("compareConfigHashes", () => {
  it("should compare two configs", () => {
    const config1 = { a: 1, b: 2 };
    const config2 = { b: 2, a: 1 };
    const config3 = { a: 1, b: 3 };

    const result1 = compareConfigHashes(config1, config2);
    const result2 = compareConfigHashes(config1, config3);

    expect(result1.equal).toBe(true);
    expect(result2.equal).toBe(false);
  });
});

describe("isHashable", () => {
  it("should return true for hashable values", () => {
    expect(isHashable({ a: 1 })).toBe(true);
    expect(isHashable([1, 2, 3])).toBe(true);
    expect(isHashable("string")).toBe(true);
    expect(isHashable(123)).toBe(true);
    expect(isHashable(null)).toBe(true);
    expect(isHashable(new Date())).toBe(true);
  });

  it("should return false for unhashable values", () => {
    expect(isHashable(undefined)).toBe(false);
    expect(isHashable(() => {})).toBe(false);
    expect(isHashable(Symbol("test"))).toBe(false);
  });
});

describe("real-world scenarios", () => {
  it("should handle mandu config-like structure", () => {
    const manduConfig = {
      name: "my-project",
      port: 3000,
      mcpServers: {
        sequential: {
          command: "npx",
          args: ["-y", "@anthropic/sequential-mcp"],
        },
        context7: {
          command: "npx",
          args: ["-y", "@context7/mcp"],
        },
      },
      features: {
        islands: true,
        ssr: true,
      },
    };

    const hash = computeConfigHash(manduConfig);
    expect(hash).toHaveLength(16);

    // 키 순서가 다른 동일한 설정
    const sameConfigDifferentOrder = {
      features: {
        ssr: true,
        islands: true,
      },
      mcpServers: {
        context7: {
          args: ["-y", "@context7/mcp"],
          command: "npx",
        },
        sequential: {
          args: ["-y", "@anthropic/sequential-mcp"],
          command: "npx",
        },
      },
      port: 3000,
      name: "my-project",
    };

    expect(computeConfigHash(sameConfigDifferentOrder)).toBe(hash);
  });

  it("should handle MCP config with sensitive data exclusion", () => {
    const mcpConfig1 = {
      servers: {
        api: {
          url: "https://api.example.com",
          token: "secret-token-123",
        },
      },
    };

    const mcpConfig2 = {
      servers: {
        api: {
          url: "https://api.example.com",
          token: "different-token-456",
        },
      },
    };

    // token을 제외하면 동일한 해시
    const hash1 = computeConfigHash(mcpConfig1, { exclude: ["token"] });
    const hash2 = computeConfigHash(mcpConfig2, { exclude: ["token"] });

    expect(hash1).toBe(hash2);
  });
});
