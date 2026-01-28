/**
 * Contract System Integration Tests
 * End-to-end testing of the Contract-first API workflow
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { createContract } from "./index";
import { ContractValidator } from "./validator";
import { zodToOpenAPISchema } from "../openapi/generator";
import { generateContractTemplate, generateContractTypeGlue } from "../generator/contract-glue";
import type { RouteSpec } from "../spec/schema";

describe("Contract System Integration", () => {
  // Define a realistic User schema
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

  const CreateUserInput = UserSchema.omit({ id: true, createdAt: true, metadata: true });

  const UserListQuery = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
    role: z.enum(["admin", "user", "guest"]).optional(),
    search: z.string().optional(),
  });

  // Create the contract
  const usersContract = createContract({
    description: "User Management API",
    tags: ["users", "admin"],

    request: {
      GET: {
        query: UserListQuery,
      },
      POST: {
        body: CreateUserInput,
      },
      PUT: {
        params: z.object({ id: z.string().uuid() }),
        body: CreateUserInput.partial(),
      },
      DELETE: {
        params: z.object({ id: z.string().uuid() }),
      },
    },

    response: {
      200: z.object({
        data: z.union([UserSchema, z.array(UserSchema)]),
        pagination: z
          .object({
            page: z.number(),
            limit: z.number(),
            total: z.number(),
          })
          .optional(),
      }),
      201: z.object({ data: UserSchema }),
      204: z.void(),
      400: z.object({
        error: z.string(),
        details: z
          .array(
            z.object({
              type: z.string(),
              issues: z.array(z.object({ path: z.string(), message: z.string() })),
            })
          )
          .optional(),
      }),
      404: z.object({ error: z.string() }),
    },
  });

  describe("Contract Creation", () => {
    test("should create contract with all properties", () => {
      expect(usersContract.description).toBe("User Management API");
      expect(usersContract.tags).toEqual(["users", "admin"]);
      expect(usersContract.request.GET).toBeDefined();
      expect(usersContract.request.POST).toBeDefined();
      expect(usersContract.request.PUT).toBeDefined();
      expect(usersContract.request.DELETE).toBeDefined();
      expect(usersContract.response[200]).toBeDefined();
      expect(usersContract.response[201]).toBeDefined();
      expect(usersContract.response[204]).toBeDefined();
      expect(usersContract.response[400]).toBeDefined();
      expect(usersContract.response[404]).toBeDefined();
    });
  });

  describe("Request Validation Flow", () => {
    const validator = new ContractValidator(usersContract);

    test("should validate successful GET request", async () => {
      const req = new Request("http://localhost/api/users?page=2&limit=20&role=admin");
      const result = await validator.validateRequest(req, "GET");

      expect(result.success).toBe(true);
    });

    test("should validate successful POST request", async () => {
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "newuser@example.com",
          name: "New User",
          role: "user",
        }),
      });
      const result = await validator.validateRequest(req, "POST");

      expect(result.success).toBe(true);
    });

    test("should fail POST with invalid email", async () => {
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "invalid-email",
          name: "Test User",
          role: "user",
        }),
      });
      const result = await validator.validateRequest(req, "POST");

      expect(result.success).toBe(false);
      expect(result.errors![0].type).toBe("body");
      expect(result.errors![0].issues.some((i) => i.path.includes("email"))).toBe(true);
    });

    test("should fail POST with invalid role", async () => {
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          name: "Test User",
          role: "superadmin", // Invalid
        }),
      });
      const result = await validator.validateRequest(req, "POST");

      expect(result.success).toBe(false);
    });

    test("should validate PUT with params and body", async () => {
      const req = new Request("http://localhost/api/users/550e8400-e29b-41d4-a716-446655440000", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
        }),
      });
      const result = await validator.validateRequest(req, "PUT", {
        id: "550e8400-e29b-41d4-a716-446655440000",
      });

      expect(result.success).toBe(true);
    });

    test("should fail PUT with invalid UUID param", async () => {
      const req = new Request("http://localhost/api/users/invalid-id", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Name",
        }),
      });
      const result = await validator.validateRequest(req, "PUT", {
        id: "invalid-id",
      });

      expect(result.success).toBe(false);
      expect(result.errors![0].type).toBe("params");
    });
  });

  describe("Response Validation Flow", () => {
    const validator = new ContractValidator(usersContract);

    test("should validate 200 response with user list", () => {
      const response = {
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440000",
            email: "user@example.com",
            name: "Test User",
            role: "user",
            createdAt: "2024-01-15T10:30:00Z",
          },
        ],
        pagination: {
          page: 1,
          limit: 10,
          total: 100,
        },
      };
      const result = validator.validateResponse(response, 200);

      expect(result.success).toBe(true);
    });

    test("should validate 201 response with created user", () => {
      const response = {
        data: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          email: "newuser@example.com",
          name: "New User",
          role: "user",
          createdAt: "2024-01-15T10:30:00Z",
        },
      };
      const result = validator.validateResponse(response, 201);

      expect(result.success).toBe(true);
    });

    test("should validate 400 response with validation errors", () => {
      const response = {
        error: "Validation Error",
        details: [
          {
            type: "body",
            issues: [
              { path: "email", message: "Invalid email format" },
              { path: "name", message: "Name is required" },
            ],
          },
        ],
      };
      const result = validator.validateResponse(response, 400);

      expect(result.success).toBe(true);
    });

    test("should fail 200 response with invalid data", () => {
      const response = {
        data: [
          {
            id: "not-a-uuid",
            email: "invalid",
            name: "X", // Too short
            role: "unknown", // Invalid
            createdAt: "not-a-date",
          },
        ],
      };
      const result = validator.validateResponse(response, 200);

      expect(result.success).toBe(false);
    });
  });

  describe("OpenAPI Schema Generation", () => {
    test("should convert UserSchema to OpenAPI", () => {
      const openApiSchema = zodToOpenAPISchema(UserSchema);

      expect(openApiSchema.type).toBe("object");
      expect(openApiSchema.properties!.id.format).toBe("uuid");
      expect(openApiSchema.properties!.email.format).toBe("email");
      expect(openApiSchema.properties!.name.minLength).toBe(2);
      expect(openApiSchema.properties!.name.maxLength).toBe(100);
      expect(openApiSchema.properties!.role.enum).toEqual(["admin", "user", "guest"]);
      expect(openApiSchema.required).toContain("id");
      expect(openApiSchema.required).toContain("email");
      expect(openApiSchema.required).toContain("name");
      expect(openApiSchema.required).not.toContain("metadata");
    });

    test("should convert UserListQuery to OpenAPI", () => {
      const openApiSchema = zodToOpenAPISchema(UserListQuery);

      expect(openApiSchema.type).toBe("object");
      expect(openApiSchema.properties!.page.type).toBe("integer");
      expect(openApiSchema.properties!.page.default).toBe(1);
      expect(openApiSchema.properties!.limit.maximum).toBe(100);
    });
  });

  describe("Contract Template Generation", () => {
    test("should generate complete contract template", () => {
      const route: RouteSpec = {
        id: "users",
        pattern: "/api/users",
        kind: "api",
        module: "generated/routes/api/users.ts",
        methods: ["GET", "POST", "PUT", "DELETE"],
      };

      const template = generateContractTemplate(route);

      // Should include all methods
      expect(template).toContain("GET: {");
      expect(template).toContain("POST: {");
      expect(template).toContain("PUT: {");
      expect(template).toContain("DELETE: {");

      // Should be valid TypeScript syntax (basic check)
      expect(template).toContain('import { z } from "zod"');
      expect(template).toContain("export default Mandu.contract({");
      expect(template).toContain("});");
    });
  });

  describe("Type Glue Generation", () => {
    test("should generate type glue for route", () => {
      const route: RouteSpec = {
        id: "users",
        pattern: "/api/users",
        kind: "api",
        module: "generated/routes/api/users.ts",
        contractModule: "spec/contracts/users.contract.ts",
        slotModule: "spec/slots/users.slot.ts",
      };

      const glue = generateContractTypeGlue(route);

      expect(glue).toContain("import type { InferContract");
      expect(glue).toContain("export type UsersContract");
      expect(glue).toContain("export type UsersGetQuery");
      expect(glue).toContain("export type UsersPostBody");
      expect(glue).toContain("export type UsersResponse200");
    });
  });

  describe("Full Workflow Simulation", () => {
    test("should complete full contract-first workflow", async () => {
      // Step 1: Create contract
      const contract = createContract({
        description: "Test API",
        request: {
          POST: {
            body: z.object({
              title: z.string().min(1),
              content: z.string(),
            }),
          },
        },
        response: {
          201: z.object({ id: z.number(), title: z.string() }),
          400: z.object({ error: z.string() }),
        },
      });

      expect(contract).toBeDefined();

      // Step 2: Create validator
      const validator = new ContractValidator(contract);

      // Step 3: Validate valid request
      const validReq = new Request("http://localhost/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Hello", content: "World" }),
      });
      const validResult = await validator.validateRequest(validReq, "POST");
      expect(validResult.success).toBe(true);

      // Step 4: Validate invalid request
      const invalidReq = new Request("http://localhost/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", content: "World" }),
      });
      const invalidResult = await validator.validateRequest(invalidReq, "POST");
      expect(invalidResult.success).toBe(false);

      // Step 5: Validate response
      const response = { id: 1, title: "Hello" };
      const responseResult = validator.validateResponse(response, 201);
      expect(responseResult.success).toBe(true);

      // Step 6: Generate OpenAPI schema
      const openApiSchema = zodToOpenAPISchema(contract.response[201]);
      expect(openApiSchema.type).toBe("object");
      expect(openApiSchema.properties!.id.type).toBe("number");
    });
  });
});
