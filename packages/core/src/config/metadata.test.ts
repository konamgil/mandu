/**
 * Symbol 메타데이터 패턴 테스트
 *
 * @see docs/plans/08_ont-run_adoption_plan.md - 섹션 3.2
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  withMetadata,
  withMetadataMultiple,
  getMetadata,
  hasMetadata,
  getAllMetadata,
  removeMetadata,
  clearAllMetadata,
  copyMetadata,
  schemaWithMeta,
  hasAnyMetadata,
  serializeMetadata,
} from "./metadata.js";
import {
  SENSITIVE_FIELD,
  PROTECTED_FIELD,
  FIELD_SOURCE,
  SCHEMA_REFERENCE,
  VALIDATION_CONTEXT,
  MCP_SERVER_STATUS,
} from "./symbols.js";
import {
  mcpServerRef,
  sensitiveToken,
  envValue,
  protectedField,
  runtimeInjected,
  isMcpServerRef,
  getMcpServerName,
  isSensitiveField,
  isProtectedField,
  isEnvBasedField,
  createMcpServerSchema,
} from "./mcp-ref.js";

describe("withMetadata / getMetadata", () => {
  it("should attach and retrieve metadata", () => {
    const schema = withMetadata(z.string(), SENSITIVE_FIELD, {
      redactIn: ["log", "diff"],
    });

    const meta = getMetadata(schema, SENSITIVE_FIELD);

    expect(meta).toBeDefined();
    expect(meta?.redactIn).toContain("log");
    expect(meta?.redactIn).toContain("diff");
  });

  it("should return undefined for missing metadata", () => {
    const schema = z.string();
    const meta = getMetadata(schema, SENSITIVE_FIELD);

    expect(meta).toBeUndefined();
  });

  it("should not affect schema validation", () => {
    const schema = withMetadata(z.string().min(3), SENSITIVE_FIELD, {
      redactIn: ["log"],
    });

    expect(schema.safeParse("ab").success).toBe(false);
    expect(schema.safeParse("abc").success).toBe(true);
  });
});

describe("withMetadataMultiple", () => {
  it("should attach multiple metadata at once", () => {
    const schema = withMetadataMultiple(z.string(), [
      [SENSITIVE_FIELD, { redactIn: ["log"] }],
      [PROTECTED_FIELD, { reason: "Security" }],
    ]);

    expect(getMetadata(schema, SENSITIVE_FIELD)).toBeDefined();
    expect(getMetadata(schema, PROTECTED_FIELD)).toBeDefined();
  });
});

describe("hasMetadata", () => {
  it("should return true when metadata exists", () => {
    const schema = withMetadata(z.string(), SENSITIVE_FIELD, {
      redactIn: ["log"],
    });

    expect(hasMetadata(schema, SENSITIVE_FIELD)).toBe(true);
    expect(hasMetadata(schema, PROTECTED_FIELD)).toBe(false);
  });
});

describe("getAllMetadata", () => {
  it("should return all mandu metadata", () => {
    const schema = withMetadataMultiple(z.string(), [
      [SENSITIVE_FIELD, { redactIn: ["log"] }],
      [FIELD_SOURCE, { source: "env", key: "API_KEY" }],
    ]);

    const all = getAllMetadata(schema);

    // Symbol 키는 Object.keys()에 포함되지 않으므로 Object.getOwnPropertySymbols() 사용
    const symbolKeys = Object.getOwnPropertySymbols(all);
    expect(symbolKeys.length).toBeGreaterThanOrEqual(2);
  });
});

describe("removeMetadata / clearAllMetadata", () => {
  it("should remove specific metadata", () => {
    const schema = withMetadata(z.string(), SENSITIVE_FIELD, {
      redactIn: ["log"],
    });

    removeMetadata(schema, SENSITIVE_FIELD);

    expect(hasMetadata(schema, SENSITIVE_FIELD)).toBe(false);
  });

  it("should clear all mandu metadata", () => {
    const schema = withMetadataMultiple(z.string(), [
      [SENSITIVE_FIELD, { redactIn: ["log"] }],
      [PROTECTED_FIELD, { reason: "Test" }],
    ]);

    clearAllMetadata(schema);

    expect(hasAnyMetadata(schema)).toBe(false);
  });
});

describe("copyMetadata", () => {
  it("should copy metadata between schemas", () => {
    const source = withMetadata(z.string(), SENSITIVE_FIELD, {
      redactIn: ["log"],
    });

    const target = z.number();
    copyMetadata(source, target);

    expect(getMetadata(target, SENSITIVE_FIELD)).toBeDefined();
  });
});

describe("schemaWithMeta builder", () => {
  it("should chain metadata additions", () => {
    const schema = schemaWithMeta(z.string())
      .sensitive({ redactIn: ["log", "diff"] })
      .protected({ reason: "Security config" })
      .build();

    expect(getMetadata(schema, SENSITIVE_FIELD)).toBeDefined();
    expect(getMetadata(schema, PROTECTED_FIELD)).toBeDefined();
  });

  it("should support source metadata", () => {
    const schema = schemaWithMeta(z.string())
      .source({ source: "env", key: "MY_VAR" })
      .build();

    const meta = getMetadata(schema, FIELD_SOURCE);
    expect(meta?.source).toBe("env");
    expect(meta?.key).toBe("MY_VAR");
  });
});

describe("mcpServerRef", () => {
  it("should create MCP server reference schema", () => {
    const schema = mcpServerRef("sequential-thinking");

    expect(isMcpServerRef(schema)).toBe(true);
    expect(getMcpServerName(schema)).toBe("sequential-thinking");
  });

  it("should support optional flag", () => {
    const schema = mcpServerRef("optional-server", true);
    const meta = getMetadata(schema, SCHEMA_REFERENCE);

    expect(meta?.optional).toBe(true);
  });
});

describe("sensitiveToken", () => {
  it("should mark field as sensitive", () => {
    const schema = sensitiveToken();

    expect(isSensitiveField(schema)).toBe(true);
  });

  it("should also mark as protected", () => {
    const schema = sensitiveToken("API key");

    expect(isProtectedField(schema)).toBe(true);
  });
});

describe("envValue", () => {
  it("should mark field as env-based", () => {
    const schema = envValue("MY_ENV_VAR");

    expect(isEnvBasedField(schema)).toBe(true);
  });

  it("should store default value", () => {
    const schema = envValue("PORT", "3000");
    const meta = getMetadata(schema, FIELD_SOURCE);

    expect(meta?.fallback).toBe("3000");
  });
});

describe("protectedField", () => {
  it("should mark field as protected", () => {
    const schema = protectedField("Security configuration");

    expect(isProtectedField(schema)).toBe(true);

    const meta = getMetadata(schema, PROTECTED_FIELD);
    expect(meta?.reason).toBe("Security configuration");
  });
});

describe("runtimeInjected", () => {
  it("should mark field as runtime injected", () => {
    const schema = runtimeInjected(z.string());
    const { RUNTIME_INJECTED } = require("./symbols.js");

    expect((schema as any)[RUNTIME_INJECTED]).toBe(true);
  });
});

describe("createMcpServerSchema", () => {
  it("should create valid MCP server schema", () => {
    const schema = createMcpServerSchema();

    const valid = schema.safeParse({
      command: "npx",
      args: ["-y", "@mcp/server"],
    });

    expect(valid.success).toBe(true);
  });

  it("should require command field", () => {
    const schema = createMcpServerSchema();

    const invalid = schema.safeParse({
      args: ["-y", "@mcp/server"],
    });

    expect(invalid.success).toBe(false);
  });
});

describe("serializeMetadata", () => {
  it("should serialize metadata to plain object", () => {
    const schema = withMetadataMultiple(z.string(), [
      [SENSITIVE_FIELD, { redactIn: ["log"] }],
      [PROTECTED_FIELD, { reason: "Test" }],
    ]);

    const serialized = serializeMetadata(schema);

    expect(Object.keys(serialized).length).toBeGreaterThan(0);
    expect(typeof Object.keys(serialized)[0]).toBe("string");
  });
});

describe("real-world scenarios", () => {
  it("should handle MCP config with mixed metadata", () => {
    const mcpConfigSchema = z.object({
      servers: z.object({
        sequential: mcpServerRef("sequential-thinking"),
        context7: mcpServerRef("context7", true),
      }),
      apiKey: sensitiveToken("API key"),
      baseUrl: envValue("API_BASE_URL", "http://localhost:3000"),
      debugMode: protectedField("Debug mode setting"),
    });

    // 유효한 설정
    const result = mcpConfigSchema.safeParse({
      servers: {
        sequential: "sequential",
        context7: "context7",
      },
      apiKey: "secret-key",
      baseUrl: "http://api.example.com",
      debugMode: "enabled",
    });

    expect(result.success).toBe(true);

    // 메타데이터 확인
    const apiKeySchema = mcpConfigSchema.shape.apiKey;
    expect(isSensitiveField(apiKeySchema)).toBe(true);
    expect(isProtectedField(apiKeySchema)).toBe(true);

    const baseUrlSchema = mcpConfigSchema.shape.baseUrl;
    expect(isEnvBasedField(baseUrlSchema)).toBe(true);

    const seqSchema = mcpConfigSchema.shape.servers.shape.sequential;
    expect(isMcpServerRef(seqSchema)).toBe(true);
  });
});
