/**
 * OpenAPI Generator Tests
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { zodToOpenAPISchema, openAPIToJSON } from "./generator";

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
