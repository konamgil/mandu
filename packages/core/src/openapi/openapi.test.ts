/**
 * OpenAPI Generator Tests
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import {
  generateOpenAPIDocument,
  hashOpenAPIJSON,
  openAPIToJSON,
  openAPIToYAML,
  readOpenAPIArtifacts,
  writeOpenAPIArtifacts,
  zodToOpenAPISchema,
} from "./generator";
import type { RoutesManifest } from "../spec/schema";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("zodToOpenAPISchema", () => {
  describe("primitive types", () => {
    test("should convert ZodString", () => {
      const schema = z.string();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
    });

    test("should convert ZodString with email format", () => {
      const schema = z.string().email();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      expect(result.format).toBe("email");
    });

    test("should convert ZodString with uuid format", () => {
      const schema = z.string().uuid();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      expect(result.format).toBe("uuid");
    });

    test("should convert ZodString with datetime format", () => {
      const schema = z.string().datetime();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      expect(result.format).toBe("date-time");
    });

    test("should convert ZodString with min/max length", () => {
      const schema = z.string().min(2).max(100);
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      expect(result.minLength).toBe(2);
      expect(result.maxLength).toBe(100);
    });

    test("should convert ZodNumber", () => {
      const schema = z.number();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("number");
    });

    test("should convert ZodNumber with int", () => {
      const schema = z.number().int();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("integer");
    });

    test("should convert ZodNumber with min/max", () => {
      const schema = z.number().min(1).max(100);
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("number");
      expect(result.minimum).toBe(1);
      expect(result.maximum).toBe(100);
    });

    test("should convert ZodBoolean", () => {
      const schema = z.boolean();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("boolean");
    });
  });

  describe("complex types", () => {
    test("should convert ZodArray", () => {
      const schema = z.array(z.string());
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("array");
      expect(result.items).toEqual({ type: "string" });
    });

    test("should convert ZodObject", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("object");
      expect(result.properties).toBeDefined();
      expect(result.properties!.name).toEqual({ type: "string" });
      expect(result.properties!.age).toEqual({ type: "number" });
      expect(result.required).toContain("name");
      expect(result.required).toContain("age");
    });

    test("should convert ZodObject with optional fields", () => {
      const schema = z.object({
        name: z.string(),
        nickname: z.string().optional(),
      });
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("object");
      expect(result.required).toContain("name");
      expect(result.required).not.toContain("nickname");
    });

    test("should convert ZodEnum", () => {
      const schema = z.enum(["admin", "user", "guest"]);
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      expect(result.enum).toEqual(["admin", "user", "guest"]);
    });

    test("should convert ZodUnion", () => {
      const schema = z.union([z.string(), z.number()]);
      const result = zodToOpenAPISchema(schema);

      expect(result.oneOf).toBeDefined();
      expect(result.oneOf!.length).toBe(2);
      expect(result.oneOf![0]).toEqual({ type: "string" });
      expect(result.oneOf![1]).toEqual({ type: "number" });
    });
  });

  describe("modifiers", () => {
    test("should convert ZodOptional", () => {
      const schema = z.string().optional();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      expect(result.nullable).toBe(true);
    });

    test("should convert ZodNullable", () => {
      const schema = z.string().nullable();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      expect(result.nullable).toBe(true);
    });

    test("should convert ZodDefault", () => {
      const schema = z.number().default(10);
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("number");
      expect(result.default).toBe(10);
    });

    test("should handle coerce", () => {
      const schema = z.coerce.number();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("number");
    });
  });

  describe("nested schemas", () => {
    test("should convert nested object", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
        posts: z.array(
          z.object({
            id: z.number(),
            title: z.string(),
          })
        ),
      });
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("object");
      expect(result.properties!.user.type).toBe("object");
      expect(result.properties!.user.properties!.name.type).toBe("string");
      expect(result.properties!.user.properties!.email.format).toBe("email");
      expect(result.properties!.posts.type).toBe("array");
      expect(result.properties!.posts.items!.type).toBe("object");
    });
  });
});

describe("openAPIToJSON", () => {
  test("should convert OpenAPI document to JSON", () => {
    const doc = {
      openapi: "3.0.3" as const,
      info: {
        title: "Test API",
        version: "1.0.0",
      },
      paths: {
        "/users": {
          get: {
            summary: "List users",
            responses: {
              "200": {
                description: "OK",
              },
            },
          },
        },
      },
    };

    const json = openAPIToJSON(doc);
    const parsed = JSON.parse(json);

    expect(parsed.openapi).toBe("3.0.3");
    expect(parsed.info.title).toBe("Test API");
    expect(parsed.paths["/users"].get.summary).toBe("List users");
  });
});

describe("Real-world contract conversion", () => {
  test("should convert complex user contract", () => {
    const UserSchema = z.object({
      id: z.string().uuid(),
      email: z.string().email(),
      name: z.string().min(2).max(100),
      role: z.enum(["admin", "user", "guest"]),
      createdAt: z.string().datetime(),
      metadata: z
        .object({
          lastLogin: z.string().datetime().optional(),
          loginCount: z.number().int().min(0).default(0),
        })
        .optional(),
    });

    const result = zodToOpenAPISchema(UserSchema);

    expect(result.type).toBe("object");
    expect(result.properties!.id.format).toBe("uuid");
    expect(result.properties!.email.format).toBe("email");
    expect(result.properties!.name.minLength).toBe(2);
    expect(result.properties!.name.maxLength).toBe(100);
    expect(result.properties!.role.enum).toEqual(["admin", "user", "guest"]);
    expect(result.properties!.createdAt.format).toBe("date-time");
    expect(result.required).toContain("id");
    expect(result.required).toContain("email");
    expect(result.required).not.toContain("metadata");
  });

  test("should convert paginated response schema", () => {
    const PaginatedSchema = z.object({
      data: z.array(z.object({ id: z.number(), name: z.string() })),
      pagination: z.object({
        page: z.number().int().min(1),
        limit: z.number().int().min(1).max(100),
        total: z.number().int(),
        totalPages: z.number().int(),
      }),
    });

    const result = zodToOpenAPISchema(PaginatedSchema);

    expect(result.type).toBe("object");
    expect(result.properties!.data.type).toBe("array");
    expect(result.properties!.data.items!.type).toBe("object");
    expect(result.properties!.pagination.type).toBe("object");
    expect(result.properties!.pagination.properties!.page.type).toBe("integer");
    expect(result.properties!.pagination.properties!.page.minimum).toBe(1);
  });
});

// ============================================
// End-to-end: manifest → OpenAPI → disk artifacts
// ============================================

/**
 * Create a scratch project on disk with one API contract so we can
 * exercise the full build pipeline (generate + write + read) without
 * faking the dynamic import path.
 */
async function buildFixture(): Promise<{ rootDir: string; manifest: RoutesManifest; cleanup: () => Promise<void> }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-openapi-"));
  const contractPath = "contracts/users.contract.ts";
  const contractAbs = path.join(rootDir, contractPath);
  await fs.mkdir(path.dirname(contractAbs), { recursive: true });
  await fs.writeFile(
    contractAbs,
    `import { z } from "zod";
export default {
  name: "users",
  description: "List / create users",
  tags: ["users"],
  request: {
    GET: {
      query: z.object({ limit: z.number().int().min(1).max(100).optional() }),
    },
    POST: {
      body: z.object({
        name: z.string().min(2),
        email: z.string().email(),
      }),
    },
  },
  response: {
    200: z.object({
      items: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
    }),
    201: z.object({ id: z.string().uuid() }),
    400: z.object({ error: z.string() }),
  },
};
`,
    "utf-8"
  );

  const manifest: RoutesManifest = {
    version: 1,
    routes: [
      {
        id: "api/users",
        pattern: "/api/users",
        kind: "api",
        module: contractPath,
        contractModule: contractPath,
        methods: ["GET", "POST"],
      },
    ],
  };

  return {
    rootDir,
    manifest,
    cleanup: async () => {
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

describe("generateOpenAPIDocument", () => {
  test("should produce a valid OpenAPI 3.0.3 document with paths + methods + schemas", async () => {
    const { rootDir, manifest, cleanup } = await buildFixture();
    try {
      const doc = await generateOpenAPIDocument(manifest, rootDir, {
        title: "Users API",
        version: "2.1.0",
      });

      expect(doc.openapi).toBe("3.0.3");
      expect(doc.info.title).toBe("Users API");
      expect(doc.info.version).toBe("2.1.0");

      // The `/api/users` path should carry both GET and POST operations.
      expect(doc.paths["/api/users"]).toBeDefined();
      expect(doc.paths["/api/users"].get).toBeDefined();
      expect(doc.paths["/api/users"].post).toBeDefined();

      // GET query param `limit` should be captured.
      const getParams = doc.paths["/api/users"].get!.parameters ?? [];
      const limitParam = getParams.find((p) => p.name === "limit");
      expect(limitParam).toBeDefined();
      expect(limitParam!.in).toBe("query");

      // POST body should be captured with JSON content.
      const postBody = doc.paths["/api/users"].post!.requestBody;
      expect(postBody).toBeDefined();
      expect(postBody!.content["application/json"]).toBeDefined();

      // Response schemas should be present.
      const okResponse = doc.paths["/api/users"].get!.responses["200"];
      expect(okResponse).toBeDefined();
      expect(okResponse.content!["application/json"]).toBeDefined();
    } finally {
      await cleanup();
    }
  });
});

describe("hashOpenAPIJSON", () => {
  test("should produce a deterministic 64-char hex digest", async () => {
    const sample = JSON.stringify({ hello: "world" });
    const hashA = await hashOpenAPIJSON(sample);
    const hashB = await hashOpenAPIJSON(sample);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  test("should change with input", async () => {
    const hashA = await hashOpenAPIJSON(JSON.stringify({ v: 1 }));
    const hashB = await hashOpenAPIJSON(JSON.stringify({ v: 2 }));
    expect(hashA).not.toBe(hashB);
  });
});

describe("openAPIToYAML", () => {
  test("should emit a parseable two-space-indented YAML subset", () => {
    const doc = {
      openapi: "3.0.3" as const,
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/api/users": {
          get: {
            summary: "List",
            responses: { "200": { description: "OK" } },
          },
        },
      },
    };

    const yaml = openAPIToYAML(doc);

    // Must NOT contain raw curly braces from the old naive converter.
    expect(yaml).toContain("openapi: 3.0.3");
    expect(yaml).toContain("info:");
    expect(yaml).toContain("  title: Test API");
    expect(yaml).toContain("  version: 1.0.0");
    expect(yaml).toContain("paths:");
    // Path key contains `/` and `:` suffix is handled as block mapping,
    // so the OpenAPI path appears as a block-mapping key — expect its
    // presence without assuming quoting.
    expect(yaml).toMatch(/\/api\/users:/);
    expect(yaml).toContain("      summary: List");
    expect(yaml).toMatch(/\n$/);
  });
});

describe("writeOpenAPIArtifacts + readOpenAPIArtifacts", () => {
  test("should write openapi.json and openapi.yaml then read them back with matching hash", async () => {
    const { rootDir, manifest, cleanup } = await buildFixture();
    try {
      const written = await writeOpenAPIArtifacts(manifest, rootDir, ".mandu", {
        title: "Artifact Test",
        version: "1.0.0",
      });

      expect(written.paths.json.endsWith("openapi.json")).toBe(true);
      expect(written.paths.yaml.endsWith("openapi.yaml")).toBe(true);
      expect(written.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(written.pathCount).toBeGreaterThan(0);

      // Both files should exist on disk.
      const jsonOnDisk = await fs.readFile(written.paths.json, "utf-8");
      const yamlOnDisk = await fs.readFile(written.paths.yaml, "utf-8");
      expect(jsonOnDisk).toBe(written.json);
      expect(yamlOnDisk).toBe(written.yaml);

      // JSON should parse.
      const parsed = JSON.parse(jsonOnDisk);
      expect(parsed.openapi).toBe("3.0.3");
      expect(parsed.info.title).toBe("Artifact Test");

      // readOpenAPIArtifacts should recover the same bodies and recompute
      // the same hash.
      const readBack = await readOpenAPIArtifacts(".mandu", rootDir);
      expect(readBack).not.toBeNull();
      expect(readBack!.hash).toBe(written.hash);
      expect(readBack!.json).toBe(written.json);
      expect(readBack!.yaml).toBe(written.yaml);
    } finally {
      await cleanup();
    }
  });

  test("readOpenAPIArtifacts returns null when artifacts are missing", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-openapi-miss-"));
    try {
      const result = await readOpenAPIArtifacts(".mandu", rootDir);
      expect(result).toBeNull();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
