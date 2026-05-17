/**
 * CLI Integration Tests - generate-resource command
 *
 * QA Engineer: Integration testing for CLI resource generation
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { parseFieldsFlag, parseMethodsFlag, formatSchemaFile } from "../generate-resource";
import type { ResourceDefinition } from "@mandujs/core";

describe("CLI - Field Parsing", () => {
  test("should parse simple fields string", () => {
    const result = parseFieldsFlag("name:string,email:email,age:number");

    expect(result.name).toBeDefined();
    expect(result.name.type).toBe("string");
    expect(result.email.type).toBe("email");
    expect(result.age.type).toBe("number");
  });

  test("should handle optional fields with ?", () => {
    const result = parseFieldsFlag("name:string,bio:string?");

    expect(result.name.required).toBe(true);
    expect(result.bio.required).toBe(false);
  });

  test("should handle required fields with !", () => {
    const result = parseFieldsFlag("email:email!");

    expect(result.email.required).toBe(true);
  });

  test("should handle all field types", () => {
    const fields = parseFieldsFlag(
      "str:string,num:number,bool:boolean,dt:date,id:uuid,mail:email,link:url,data:json"
    );

    expect(fields.str.type).toBe("string");
    expect(fields.num.type).toBe("number");
    expect(fields.bool.type).toBe("boolean");
    expect(fields.dt.type).toBe("date");
    expect(fields.id.type).toBe("uuid");
    expect(fields.mail.type).toBe("email");
    expect(fields.link.type).toBe("url");
    expect(fields.data.type).toBe("json");
  });

  test("should throw on invalid field format", () => {
    expect(() => parseFieldsFlag("invalid")).toThrow(/Invalid field format/);
    expect(() => parseFieldsFlag("name:")).toThrow(/Invalid field format/);
    expect(() => parseFieldsFlag(":string")).toThrow(/Invalid field format/);
  });

  test("should throw on invalid field type", () => {
    expect(() => parseFieldsFlag("field:invalidtype")).toThrow(/Invalid field type/);
  });

  test("should handle whitespace gracefully", () => {
    const result = parseFieldsFlag("  name:string  ,  email:email  ");

    expect(result.name).toBeDefined();
    expect(result.email).toBeDefined();
  });
});

describe("CLI - Methods Parsing", () => {
  test("should parse GET,POST,PUT,DELETE", () => {
    const endpoints = parseMethodsFlag("GET,POST,PUT,DELETE");

    expect(endpoints.list).toBe(true);
    expect(endpoints.get).toBe(true);
    expect(endpoints.create).toBe(true);
    expect(endpoints.update).toBe(true);
    expect(endpoints.delete).toBe(true);
  });

  test("should parse partial methods", () => {
    const endpoints = parseMethodsFlag("GET,POST");

    expect(endpoints.list).toBe(true);
    expect(endpoints.get).toBe(true);
    expect(endpoints.create).toBe(true);
    expect(endpoints.update).toBe(false);
    expect(endpoints.delete).toBe(false);
  });

  test("should handle lowercase methods", () => {
    const endpoints = parseMethodsFlag("get,post");

    expect(endpoints.list).toBe(true);
    expect(endpoints.create).toBe(true);
  });

  test("should handle single method", () => {
    const endpoints = parseMethodsFlag("GET");

    expect(endpoints.list).toBe(true);
    expect(endpoints.get).toBe(true);
    expect(endpoints.create).toBe(false);
  });

  test("should handle whitespace", () => {
    const endpoints = parseMethodsFlag("  GET  ,  POST  ");

    expect(endpoints.list).toBe(true);
    expect(endpoints.create).toBe(true);
  });
});

describe("CLI - Schema File Formatting", () => {
  test("should generate valid TypeScript schema file", () => {
    const definition: ResourceDefinition = {
      name: "user",
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
        email: { type: "email", required: true },
        age: { type: "number", required: false },
      },
      options: {
        description: "User management API",
        tags: ["user"],
        endpoints: {
          list: true,
          get: true,
          create: true,
          update: true,
          delete: true,
        },
      },
    };

    const schemaFile = formatSchemaFile(definition);

    // Verify structure
    expect(schemaFile).toContain('import { defineResource } from "@mandujs/core"');
    // Issue #265 — must be `export default`, parser reads `module.default`.
    expect(schemaFile).toContain("export default defineResource({");
    expect(schemaFile).toContain('name: "user"');
    // Issue #266 — generator must emit persistence so db plan picks it up.
    expect(schemaFile).toContain("persistence:");
    expect(schemaFile).toContain('primaryKey: "id"');

    // Verify fields
    expect(schemaFile).toContain('id: { type: "uuid", required: true }');
    expect(schemaFile).toContain('name: { type: "string", required: true }');
    expect(schemaFile).toContain('email: { type: "email", required: true }');
    expect(schemaFile).toContain('age: { type: "number", required: false }');

    // Verify options
    expect(schemaFile).toContain('description: "User management API"');
    expect(schemaFile).toContain('tags: ["user"]');
    expect(schemaFile).toContain("list: true");
    expect(schemaFile).toContain("get: true");
    expect(schemaFile).toContain("create: true");
  });

  test("should handle minimal definition", () => {
    const definition: ResourceDefinition = {
      name: "item",
      fields: {
        id: { type: "uuid", required: true },
      },
    };

    const schemaFile = formatSchemaFile(definition);

    expect(schemaFile).toContain('name: "item"');
    expect(schemaFile).toContain('id: { type: "uuid", required: true }');
  });

  test("should emit JSDoc with capitalized resource name", () => {
    const definition: ResourceDefinition = {
      name: "product",
      fields: {
        id: { type: "uuid", required: true },
      },
    };

    const schemaFile = formatSchemaFile(definition);

    expect(schemaFile).toContain("export default defineResource({");
    expect(schemaFile).toContain("* Product Resource");
    expect(schemaFile).toContain('name: "product"');
  });
});

// =====================================================================
// Generator ↔ Parser round-trip (#263/#265/#266 regression guard)
//
// Issues #263/#265 broke this contract: the generator's output (file path,
// filename, export shape, fields) must satisfy parseResourceSchema's input
// assumptions. Function-unit tests above pass even when round-trip fails
// because they stop at the string level. This block writes the generator
// output to a temp dir and feeds it BACK through the real parser so any
// future divergence between the two modules fails CI immediately.
// =====================================================================

describe("CLI - Generator/Parser round-trip", () => {
  let tmpDir: string;

  beforeAll(async () => {
    const { mkdtemp } = await import("node:fs/promises");
    const { join, resolve } = await import("node:path");
    // Stay INSIDE the workspace so `import { defineResource } from "@mandujs/core"`
    // can resolve via the workspace's node_modules. A /tmp/... dir would have no
    // way to find @mandujs/core. The dir is created under packages/cli so it
    // inherits the project's resolver root.
    const workspaceFixtures = resolve(import.meta.dir, "__fixtures-roundtrip");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(workspaceFixtures, { recursive: true });
    tmpDir = await mkdtemp(join(workspaceFixtures, "mandu-roundtrip-"));
  });

  afterAll(async () => {
    if (tmpDir) {
      const { rm } = await import("node:fs/promises");
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("formatSchemaFile output must parse via parseResourceSchema", async () => {
    const { join } = await import("node:path");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { parseResourceSchema } = await import("@mandujs/core/resource");

    const definition: ResourceDefinition = {
      name: "roundtripuser",
      fields: {
        id: { type: "uuid", required: true },
        email: { type: "email", required: true },
        nickname: { type: "string", required: false },
      },
      options: {
        endpoints: { list: true, get: true, create: true, update: true, delete: true },
      },
    };

    // Mirror the exact directory shape the CLI writes to.
    const resourcesDir = join(tmpDir, "spec", "resources");
    await mkdir(resourcesDir, { recursive: true });
    const filePath = join(resourcesDir, `${definition.name}.resource.ts`);
    await writeFile(filePath, formatSchemaFile(definition), "utf-8");

    // Parser must accept the output without throwing (#263: filename,
    // #265: default export, #266: persistence presence are all checked
    // inside parseResourceSchema / snapshotFromResources downstream).
    const parsed = await parseResourceSchema(filePath);
    expect(parsed.resourceName).toBe("roundtripuser");
    expect(parsed.definition.fields.id?.type).toBe("uuid");
    expect(parsed.definition.fields.email?.type).toBe("email");

    // #266 — persistence must be present so snapshotFromResources doesn't
    // silently drop the resource. Read it via the same `unknown` cast the
    // DDL layer uses.
    const persistence = (parsed.definition.options as Record<string, unknown> | undefined)?.persistence;
    expect(persistence).toBeDefined();
  });
});

describe("CLI - Error Messages", () => {
  test("should provide helpful error for invalid field format", () => {
    try {
      parseFieldsFlag("name-string");
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Invalid field format");
      expect((error as Error).message).toContain("name-string");
      expect((error as Error).message).toContain("Expected format: fieldName:fieldType");
    }
  });

  test("should provide helpful error for invalid type", () => {
    try {
      parseFieldsFlag("name:text");
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Invalid field type");
      expect((error as Error).message).toContain("text");
      expect((error as Error).message).toContain("Valid types:");
    }
  });
});

describe("CLI - Edge Cases", () => {
  test("should handle empty string gracefully", () => {
    const result = parseFieldsFlag("");
    expect(Object.keys(result).length).toBe(0);
  });

  test("should skip empty segments", () => {
    const result = parseFieldsFlag("name:string,,email:email");
    expect(Object.keys(result).length).toBe(2);
  });

  test("should handle very long field names", () => {
    const longName = "a".repeat(50);
    const result = parseFieldsFlag(`${longName}:string`);
    expect(result[longName]).toBeDefined();
  });

  test("should handle camelCase and snake_case", () => {
    const result = parseFieldsFlag("firstName:string,last_name:string");
    expect(result.firstName).toBeDefined();
    expect(result.last_name).toBeDefined();
  });
});
