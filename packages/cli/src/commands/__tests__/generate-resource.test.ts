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
    expect(schemaFile).toContain("export const UserResource = defineResource({");
    expect(schemaFile).toContain('name: "user"');

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

  test("should capitalize resource name in export", () => {
    const definition: ResourceDefinition = {
      name: "product",
      fields: {
        id: { type: "uuid", required: true },
      },
    };

    const schemaFile = formatSchemaFile(definition);

    expect(schemaFile).toContain("export const ProductResource = defineResource({");
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
