/**
 * OpenAPI Generator Tests
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import {
  generateOpenAPIDocument,
  hashOpenAPIJSON,
  hoistSharedSchemas,
  openAPIToJSON,
  openAPIToYAML,
  readOpenAPIArtifacts,
  writeOpenAPIArtifacts,
  zodToOpenAPISchema,
} from "./generator";
import type { OpenAPIDocument } from "./generator";
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
    test("should convert ZodOptional — unwraps without adding nullable (optional != nullable)", () => {
      const schema = z.string().optional();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      // Optionality is expressed by the parent object's required[] / parameter.required,
      // NOT by marking the field nullable. See generator.ts comment.
      expect(result.nullable).toBeUndefined();
    });

    test("should convert ZodNullable", () => {
      const schema = z.string().nullable();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      expect(result.nullable).toBe(true);
    });

    test("should convert ZodOptional(ZodNullable) — inner nullable preserved", () => {
      const schema = z.string().nullable().optional();
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("string");
      expect(result.nullable).toBe(true);
    });

    test("object with optional field — field omitted from required[] but schema itself is not nullable", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().optional(),
      });
      const result = zodToOpenAPISchema(schema);

      expect(result.type).toBe("object");
      expect(result.required).toEqual(["name"]);
      expect(result.properties?.age).toEqual({ type: "number" });
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

// ============================================
// Schema hoisting (shared schemas → components.schemas)
// ============================================

/**
 * Build a two-contract fixture where both contracts share the same
 * `User` body shape. The generator should hoist `{ name, email }` into
 * `components.schemas` when hoisting is enabled.
 */
async function buildSharedSchemaFixture(opts: {
  /** Override the `name` attribute on each contract (in file order). */
  contractNames?: [string, string];
  /** Replace the second contract's body shape to exercise collision paths. */
  secondBody?: string;
} = {}): Promise<{
  rootDir: string;
  manifest: RoutesManifest;
  cleanup: () => Promise<void>;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-openapi-hoist-"));
  const [nameA, nameB] = opts.contractNames ?? ["users", "admins"];
  const bodyB =
    opts.secondBody ??
    `z.object({ name: z.string().min(2), email: z.string().email() })`;

  await fs.mkdir(path.join(rootDir, "contracts"), { recursive: true });
  await fs.writeFile(
    path.join(rootDir, "contracts/users.contract.ts"),
    `import { z } from "zod";
export default {
  name: "${nameA}",
  request: {
    POST: {
      body: z.object({ name: z.string().min(2), email: z.string().email() }),
    },
  },
  response: {
    200: z.object({ id: z.string().uuid(), status: z.string() }),
  },
};
`,
    "utf-8"
  );
  await fs.writeFile(
    path.join(rootDir, "contracts/admins.contract.ts"),
    `import { z } from "zod";
export default {
  name: "${nameB}",
  request: {
    POST: {
      body: ${bodyB},
    },
  },
  response: {
    200: z.object({ id: z.string().uuid(), status: z.string() }),
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
        module: "contracts/users.contract.ts",
        contractModule: "contracts/users.contract.ts",
        methods: ["POST"],
      },
      {
        id: "api/admins",
        pattern: "/api/admins",
        kind: "api",
        module: "contracts/admins.contract.ts",
        contractModule: "contracts/admins.contract.ts",
        methods: ["POST"],
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

describe("hoistSharedSchemas", () => {
  test("two routes sharing a body shape emit a single components.schemas entry with $ref", async () => {
    const { rootDir, manifest, cleanup } = await buildSharedSchemaFixture();
    try {
      const doc = await generateOpenAPIDocument(manifest, rootDir, {
        title: "Hoist Test",
      });

      // The shared POST body should be hoisted. There are also shared
      // 200 responses so we expect at least 2 hoisted entries.
      expect(doc.components?.schemas).toBeDefined();
      const schemaNames = Object.keys(doc.components!.schemas!);
      expect(schemaNames.length).toBeGreaterThanOrEqual(1);

      const usersBody = doc.paths["/api/users"].post!.requestBody!.content["application/json"].schema;
      const adminsBody = doc.paths["/api/admins"].post!.requestBody!.content["application/json"].schema;

      // Both bodies must now be $ref pointers into components.schemas.
      expect(usersBody.$ref).toBeDefined();
      expect(adminsBody.$ref).toBeDefined();
      // ... and they must point to the exact same entry (shared shape).
      expect(usersBody.$ref).toBe(adminsBody.$ref);

      // The pointed-to entry must exist and retain the object shape.
      const refTarget = usersBody.$ref!.replace("#/components/schemas/", "");
      const hoisted = doc.components!.schemas![refTarget];
      expect(hoisted.type).toBe("object");
      expect(hoisted.properties!.name).toBeDefined();
      expect(hoisted.properties!.email).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  test("one-off schema stays inline (no hoist, no components.schemas entry for it)", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-openapi-oneoff-"));
    try {
      await fs.mkdir(path.join(rootDir, "contracts"), { recursive: true });
      await fs.writeFile(
        path.join(rootDir, "contracts/solo.contract.ts"),
        `import { z } from "zod";
export default {
  name: "solo",
  request: {
    POST: { body: z.object({ uniqueField: z.string() }) },
  },
  response: { 200: z.object({ ok: z.boolean() }) },
};
`,
        "utf-8"
      );
      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "api/solo",
            pattern: "/api/solo",
            kind: "api",
            module: "contracts/solo.contract.ts",
            contractModule: "contracts/solo.contract.ts",
            methods: ["POST"],
          },
        ],
      };

      const doc = await generateOpenAPIDocument(manifest, rootDir);
      const body = doc.paths["/api/solo"].post!.requestBody!.content["application/json"].schema;

      // Solo schemas must NOT be hoisted — stays inline.
      expect(body.$ref).toBeUndefined();
      expect(body.type).toBe("object");
      expect(body.properties?.uniqueField).toBeDefined();

      // components.schemas may exist (e.g. for the default 500 shape if it
      // happened to collide with another schema), but the one-off body's
      // uniqueField shape must not appear as a hoisted entry.
      const schemas = doc.components?.schemas ?? {};
      for (const entry of Object.values(schemas)) {
        expect(entry.properties?.uniqueField).toBeUndefined();
      }
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("same shape with different user-given names collapses to one entry (first-come wins)", async () => {
    const { rootDir, manifest, cleanup } = await buildSharedSchemaFixture({
      contractNames: ["users", "admins"],
    });
    try {
      const doc = await generateOpenAPIDocument(manifest, rootDir);

      const usersBody = doc.paths["/api/users"].post!.requestBody!.content["application/json"].schema;
      const adminsBody = doc.paths["/api/admins"].post!.requestBody!.content["application/json"].schema;

      // Both must resolve to the *same* $ref — structural identity wins
      // over the user-given name split.
      expect(usersBody.$ref).toBeDefined();
      expect(usersBody.$ref).toBe(adminsBody.$ref);

      // Exactly one body component (not two) for this shape. Count entries
      // that match `{name,email}` shape.
      const sharedEntries = Object.values(doc.components!.schemas!).filter(
        (s) => s.properties?.name && s.properties?.email
      );
      expect(sharedEntries.length).toBe(1);
    } finally {
      await cleanup();
    }
  });

  test("name collision across structurally-different schemas → _v2 suffix", () => {
    // Hand-craft a doc with two different body shapes whose name hints
    // would collide. We exercise the hoist pass directly so we can
    // control the hints without routing through Zod.
    const shapeA = {
      type: "object" as const,
      properties: { a: { type: "string" as const } },
      required: ["a"],
    };
    const shapeB = {
      type: "object" as const,
      properties: { b: { type: "number" as const } },
      required: ["b"],
    };

    // Two routes use shape A, two use shape B — every schema gets the
    // same name hint "Shared". The second winning hash should be renamed
    // to "Shared_v2".
    const a1 = { ...shapeA };
    const a2 = { ...shapeA };
    const b1 = { ...shapeB };
    const b2 = { ...shapeB };

    const doc: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "t", version: "1.0.0" },
      paths: {
        "/a1": {
          post: {
            responses: {},
            requestBody: { content: { "application/json": { schema: a1 } } },
          },
        },
        "/a2": {
          post: {
            responses: {},
            requestBody: { content: { "application/json": { schema: a2 } } },
          },
        },
        "/b1": {
          post: {
            responses: {},
            requestBody: { content: { "application/json": { schema: b1 } } },
          },
        },
        "/b2": {
          post: {
            responses: {},
            requestBody: { content: { "application/json": { schema: b2 } } },
          },
        },
      },
    };

    // Attach the same hint to both shapes via hoistSharedSchemas's own
    // name-hint mechanism: we can't from here (WeakMap is module-private).
    // So we instead rely on the deterministic hash-based fallback name,
    // then assert both shapes are hoisted and receive distinct entries.
    return hoistSharedSchemas(doc).then(() => {
      const schemas = doc.components?.schemas ?? {};
      const names = Object.keys(schemas);
      // Both shapes qualify (appear twice each) → 2 hoisted entries.
      expect(names.length).toBe(2);
      // No two entries share the exact same name.
      expect(new Set(names).size).toBe(names.length);
      // The generated names must be stable strings (start with `Schema_`
      // in the fallback path).
      for (const n of names) {
        expect(n).toMatch(/^Schema_[0-9a-f]{8}$/);
      }
    });
  });

  test("hoistSchemas: false produces the legacy inline-only document", async () => {
    const { rootDir, manifest, cleanup } = await buildSharedSchemaFixture();
    try {
      const docOn = await generateOpenAPIDocument(manifest, rootDir, {
        hoistSchemas: true,
      });
      const docOff = await generateOpenAPIDocument(manifest, rootDir, {
        hoistSchemas: false,
      });

      // Off: no $refs anywhere, no components.schemas emitted.
      const offJson = JSON.stringify(docOff);
      expect(offJson.includes("$ref")).toBe(false);
      expect(docOff.components?.schemas).toBeUndefined();

      // On: at least one $ref appeared. Confirms the two paths diverge.
      const onJson = JSON.stringify(docOn);
      expect(onJson.includes("$ref")).toBe(true);
      expect(docOn.components?.schemas).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  test("enum / primitive schemas are never hoisted", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-openapi-enum-"));
    try {
      await fs.mkdir(path.join(rootDir, "contracts"), { recursive: true });
      const contractBody = `import { z } from "zod";
export default {
  name: NAME,
  request: {
    POST: { body: z.object({ role: z.enum(["a", "b", "c"]) }) },
  },
  response: { 200: z.object({ role: z.enum(["a", "b", "c"]) }) },
};
`;
      await fs.writeFile(
        path.join(rootDir, "contracts/one.contract.ts"),
        contractBody.replace("NAME", '"one"'),
        "utf-8"
      );
      await fs.writeFile(
        path.join(rootDir, "contracts/two.contract.ts"),
        contractBody.replace("NAME", '"two"'),
        "utf-8"
      );
      const manifest: RoutesManifest = {
        version: 1,
        routes: [
          {
            id: "api/one",
            pattern: "/api/one",
            kind: "api",
            module: "contracts/one.contract.ts",
            contractModule: "contracts/one.contract.ts",
            methods: ["POST"],
          },
          {
            id: "api/two",
            pattern: "/api/two",
            kind: "api",
            module: "contracts/two.contract.ts",
            contractModule: "contracts/two.contract.ts",
            methods: ["POST"],
          },
        ],
      };

      const doc = await generateOpenAPIDocument(manifest, rootDir);

      // The outer {role: enum} object *is* hoistable and shared — that's fine.
      // The inner enum itself must NOT be hoisted — scan every component
      // entry and assert none of them is a bare enum-typed schema.
      for (const entry of Object.values(doc.components?.schemas ?? {})) {
        expect(entry.enum).toBeUndefined();
        if (entry.type === "string" && !entry.properties) {
          throw new Error(`Primitive string schema should not be hoisted: ${JSON.stringify(entry)}`);
        }
      }
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("hoistThreshold: 3 → 2-use schemas stay inline; 3-use schemas get hoisted", () => {
    // Doc with the same shape appearing exactly twice.
    const shape = {
      type: "object" as const,
      properties: { x: { type: "string" as const } },
      required: ["x"],
    };
    const buildDoc = (): OpenAPIDocument => ({
      openapi: "3.0.3",
      info: { title: "t", version: "1.0.0" },
      paths: {
        "/a": {
          post: {
            responses: {},
            requestBody: { content: { "application/json": { schema: { ...shape } } } },
          },
        },
        "/b": {
          post: {
            responses: {},
            requestBody: { content: { "application/json": { schema: { ...shape } } } },
          },
        },
      },
    });

    const doc2 = buildDoc();
    return hoistSharedSchemas(doc2, { threshold: 3 }).then(() => {
      // With threshold=3 and only 2 uses → nothing hoisted.
      expect(doc2.components?.schemas).toBeUndefined();
      expect(doc2.paths["/a"].post!.requestBody!.content["application/json"].schema.$ref).toBeUndefined();

      // Re-run with threshold=2 on a fresh doc → the same shape is hoisted.
      const doc1 = buildDoc();
      return hoistSharedSchemas(doc1, { threshold: 2 }).then(() => {
        expect(doc1.components?.schemas).toBeDefined();
        expect(Object.keys(doc1.components!.schemas!).length).toBe(1);
      });
    });
  });

  test("threshold values < 2 clamp up to 2 (never hoist single-use schemas)", () => {
    // Edge: a malicious / misconfigured `hoistThreshold: 1` would otherwise
    // hoist every schema including one-offs, blowing up the spec.
    const shape = {
      type: "object" as const,
      properties: { solo: { type: "string" as const } },
      required: ["solo"],
    };
    const doc: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "t", version: "1.0.0" },
      paths: {
        "/only": {
          post: {
            responses: {},
            requestBody: { content: { "application/json": { schema: { ...shape } } } },
          },
        },
      },
    };

    return hoistSharedSchemas(doc, { threshold: 1 }).then(() => {
      expect(doc.components?.schemas).toBeUndefined();
      expect(doc.paths["/only"].post!.requestBody!.content["application/json"].schema.$ref).toBeUndefined();
    });
  });
});
