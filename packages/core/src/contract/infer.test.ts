/**
 * Mandu Contract Type Inference Tests
 *
 * 이 테스트는 타입 추론이 올바르게 동작하는지 검증합니다.
 * - Contract → Handler 타입 추론
 * - TypedContext 타입 추론
 * - Response 타입 추론
 */

import { describe, it, expect } from "bun:test";
import { z } from "zod";
import { Mandu } from "../index";
import type { InferContract, InferQuery, InferBody, InferResponse } from "./index";

// === Test Schemas ===
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(2),
  createdAt: z.string().datetime(),
});

const CreateUserSchema = UserSchema.omit({ id: true, createdAt: true });

const PaginationSchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(10),
});

// === Test Contract ===
const userContract = Mandu.contract({
  description: "User Management API",
  tags: ["users"],
  request: {
    GET: {
      query: PaginationSchema,
    },
    POST: {
      body: CreateUserSchema,
    },
    PUT: {
      params: z.object({ id: z.string().uuid() }),
      body: CreateUserSchema.partial(),
    },
    DELETE: {
      params: z.object({ id: z.string().uuid() }),
    },
  },
  response: {
    200: z.object({
      data: z.array(UserSchema),
      total: z.number(),
    }),
    201: z.object({
      data: UserSchema,
    }),
    204: z.undefined(),
    400: z.object({
      error: z.string(),
      details: z.array(z.string()).optional(),
    }),
    404: z.object({
      error: z.string(),
    }),
  },
});

// === Type Inference Tests ===
describe("Contract Type Inference", () => {
  it("should infer contract types correctly", () => {
    // Type-level test: InferContract
    type ContractTypes = InferContract<typeof userContract>;

    // These are compile-time checks - if they compile, types are correct
    type _GetQuery = ContractTypes["request"]["GET"]["query"];
    type _PostBody = ContractTypes["request"]["POST"]["body"];

    // Runtime check
    expect(userContract.description).toBe("User Management API");
    expect(userContract.tags).toEqual(["users"]);
  });

  it("should infer query types for specific methods", () => {
    // Type-level test: InferQuery
    type GetQuery = InferQuery<typeof userContract, "GET">;

    // Verify at runtime that schema exists
    expect(userContract.request.GET?.query).toBeDefined();

    // Test schema validation
    const querySchema = userContract.request.GET?.query;
    if (querySchema) {
      const result = querySchema.safeParse({ page: "2", limit: "20" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(2);
        expect(result.data.limit).toBe(20);
      }
    }
  });

  it("should infer body types for specific methods", () => {
    // Type-level test: InferBody
    type PostBody = InferBody<typeof userContract, "POST">;

    // Verify at runtime that schema exists
    expect(userContract.request.POST?.body).toBeDefined();

    // Test schema validation
    const bodySchema = userContract.request.POST?.body;
    if (bodySchema) {
      const validData = {
        email: "test@example.com",
        name: "Test User",
      };
      const result = bodySchema.safeParse(validData);
      expect(result.success).toBe(true);
    }
  });

  it("should infer response types for specific status codes", () => {
    // Type-level test: InferResponse
    type Success200 = InferResponse<typeof userContract, 200>;
    type Created201 = InferResponse<typeof userContract, 201>;
    type Error400 = InferResponse<typeof userContract, 400>;

    // Verify at runtime that schemas exist
    expect(userContract.response[200]).toBeDefined();
    expect(userContract.response[201]).toBeDefined();
    expect(userContract.response[400]).toBeDefined();
  });
});

// === Handler Type Inference Tests ===
describe("Handler Type Inference", () => {
  it("should create typed handlers with correct context types", () => {
    const handlers = Mandu.handler(userContract, {
      GET: async (ctx) => {
        // ctx.query should be typed as { page: number, limit: number }
        const { page, limit } = ctx.query;
        expect(typeof page).toBe("undefined"); // Not parsed yet at this level

        // Return type should match response schema
        return {
          data: [],
          total: 0,
        };
      },
      POST: async (ctx) => {
        // ctx.body should be typed as { email: string, name: string }
        // Return type should match 201 response schema
        return {
          data: {
            id: "123e4567-e89b-12d3-a456-426614174000",
            email: "test@example.com",
            name: "Test",
            createdAt: new Date().toISOString(),
          },
        };
      },
    });

    expect(handlers.GET).toBeDefined();
    expect(handlers.POST).toBeDefined();
    expect(typeof handlers.GET).toBe("function");
    expect(typeof handlers.POST).toBe("function");
  });

  it("should allow partial handler implementation", () => {
    // Only implement some methods
    const partialHandlers = Mandu.handler(userContract, {
      GET: (ctx) => ({
        data: [],
        total: 0,
      }),
      // POST, PUT, DELETE not implemented - should be allowed
    });

    expect(partialHandlers.GET).toBeDefined();
    expect(partialHandlers.POST).toBeUndefined();
  });
});

// === Route Definition Tests ===
describe("Route Definition", () => {
  it("should define route with contract and handler", () => {
    const route = Mandu.route({
      contract: userContract,
      handler: {
        GET: (ctx) => ({
          data: [],
          total: 0,
        }),
        POST: (ctx) => ({
          data: {
            id: "123e4567-e89b-12d3-a456-426614174000",
            email: ctx.body.email,
            name: ctx.body.name,
            createdAt: new Date().toISOString(),
          },
        }),
      },
    });

    expect(route.contract).toBe(userContract);
    expect(route.handler.GET).toBeDefined();
    expect(route.handler.POST).toBeDefined();
  });

  it("should preserve contract metadata in route", () => {
    const route = Mandu.route({
      contract: {
        description: "Test Route",
        tags: ["test"],
        request: {
          GET: { query: z.object({ id: z.string() }) },
        },
        response: {
          200: z.object({ result: z.string() }),
        },
      },
      handler: {
        GET: (ctx) => ({ result: ctx.query.id }),
      },
    });

    expect(route.contract.description).toBe("Test Route");
    expect(route.contract.tags).toEqual(["test"]);
  });
});

// === Integration with Validator Tests ===
describe("Contract + Validator Integration", () => {
  it("should validate request against contract schema", async () => {
    const { ContractValidator } = await import("./validator");

    const validator = new ContractValidator(userContract);

    // Create a mock request
    const request = new Request("http://localhost/users?page=1&limit=10", {
      method: "GET",
    });

    const result = await validator.validateRequest(request, "GET");
    expect(result.success).toBe(true);
  });

  it("should reject invalid request", async () => {
    const { ContractValidator } = await import("./validator");

    const validator = new ContractValidator(userContract);

    // Create request with invalid body
    const request = new Request("http://localhost/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "invalid-email" }), // Missing name, invalid email
    });

    const result = await validator.validateRequest(request, "POST");
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
  });
});

// === Complex Type Scenarios ===
describe("Complex Type Scenarios", () => {
  it("should handle nested schemas", () => {
    const nestedContract = Mandu.contract({
      request: {
        POST: {
          body: z.object({
            user: z.object({
              profile: z.object({
                bio: z.string(),
                avatar: z.string().url().optional(),
              }),
            }),
          }),
        },
      },
      response: {
        200: z.object({ success: z.boolean() }),
      },
    });

    const handlers = Mandu.handler(nestedContract, {
      POST: (ctx) => {
        // Deep nested access should be typed
        const bio = ctx.body.user.profile.bio;
        return { success: true };
      },
    });

    expect(handlers.POST).toBeDefined();
  });

  it("should handle union types in response", () => {
    const unionContract = Mandu.contract({
      request: {
        GET: { query: z.object({ id: z.string() }) },
      },
      response: {
        200: z.object({ found: z.literal(true), data: z.string() }),
        404: z.object({ found: z.literal(false), message: z.string() }),
      },
    });

    const handlers = Mandu.handler(unionContract, {
      GET: (ctx) => {
        // Can return either 200 or 404 response shape
        if (ctx.query.id === "not-found") {
          return { found: false as const, message: "Not found" };
        }
        return { found: true as const, data: "Found!" };
      },
    });

    expect(handlers.GET).toBeDefined();
  });

  it("should handle optional fields correctly", () => {
    const optionalContract = Mandu.contract({
      request: {
        POST: {
          body: z.object({
            required: z.string(),
            optional: z.string().optional(),
            withDefault: z.string().default("default"),
          }),
        },
      },
      response: {
        200: z.object({ result: z.string() }),
      },
    });

    const handlers = Mandu.handler(optionalContract, {
      POST: (ctx) => {
        const { required, optional, withDefault } = ctx.body;
        return { result: required + (optional ?? "") + withDefault };
      },
    });

    expect(handlers.POST).toBeDefined();
  });
});
