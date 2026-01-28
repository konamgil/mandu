/**
 * Contract System Tests
 */

import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { createContract } from "./index";
import { ContractValidator, formatValidationErrors } from "./validator";
import type { ContractSchema } from "./schema";

// Test schemas
const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().min(2),
  createdAt: z.string().datetime(),
});

const CreateUserInput = UserSchema.omit({ id: true, createdAt: true });

const UserListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
});

describe("createContract", () => {
  test("should create a contract with definition", () => {
    const contract = createContract({
      description: "Users API",
      tags: ["users"],
      request: {
        GET: { query: UserListQuery },
        POST: { body: CreateUserInput },
      },
      response: {
        200: z.object({ data: z.array(UserSchema) }),
        201: z.object({ data: UserSchema }),
        400: z.object({ error: z.string() }),
      },
    });

    expect(contract.description).toBe("Users API");
    expect(contract.tags).toEqual(["users"]);
    expect(contract._validated).toBe(false);
  });

  test("should preserve request schemas", () => {
    const contract = createContract({
      request: {
        GET: { query: UserListQuery },
      },
      response: {},
    });

    expect(contract.request.GET).toBeDefined();
    expect(contract.request.GET!.query === UserListQuery).toBe(true);
  });
});

describe("ContractValidator", () => {
  const contractSchema: ContractSchema = {
    request: {
      GET: { query: UserListQuery },
      POST: { body: CreateUserInput },
    },
    response: {
      200: z.object({ data: z.array(UserSchema) }),
      201: z.object({ data: UserSchema }),
      400: z.object({ error: z.string() }),
    },
  };

  const validator = new ContractValidator(contractSchema);

  describe("validateRequest", () => {
    test("should validate GET request with valid query", async () => {
      const req = new Request("http://localhost/api/users?page=1&limit=10");
      const result = await validator.validateRequest(req, "GET");

      expect(result.success).toBe(true);
    });

    test("should validate GET request with default values", async () => {
      const req = new Request("http://localhost/api/users");
      const result = await validator.validateRequest(req, "GET");

      expect(result.success).toBe(true);
    });

    test("should fail GET request with invalid query", async () => {
      const req = new Request("http://localhost/api/users?page=-1&limit=200");
      const result = await validator.validateRequest(req, "GET");

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.errors![0].type).toBe("query");
    });

    test("should validate POST request with valid body", async () => {
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          name: "Test User",
        }),
      });
      const result = await validator.validateRequest(req, "POST");

      expect(result.success).toBe(true);
    });

    test("should fail POST request with invalid body", async () => {
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "invalid-email",
          name: "A", // Too short (min 2)
        }),
      });
      const result = await validator.validateRequest(req, "POST");

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].type).toBe("body");
    });

    test("should fail POST request with missing required fields", async () => {
      const req = new Request("http://localhost/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          // name is missing
        }),
      });
      const result = await validator.validateRequest(req, "POST");

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });

    test("should pass through undefined methods", async () => {
      const req = new Request("http://localhost/api/users", {
        method: "DELETE",
      });
      const result = await validator.validateRequest(req, "DELETE");

      expect(result.success).toBe(true);
    });
  });

  describe("validateResponse", () => {
    test("should validate 200 response with valid data", () => {
      const responseBody = {
        data: [
          {
            id: "550e8400-e29b-41d4-a716-446655440000",
            email: "test@example.com",
            name: "Test User",
            createdAt: "2024-01-15T10:30:00Z",
          },
        ],
      };
      const result = validator.validateResponse(responseBody, 200);

      expect(result.success).toBe(true);
    });

    test("should validate 201 response with valid user", () => {
      const responseBody = {
        data: {
          id: "550e8400-e29b-41d4-a716-446655440000",
          email: "test@example.com",
          name: "Test User",
          createdAt: "2024-01-15T10:30:00Z",
        },
      };
      const result = validator.validateResponse(responseBody, 201);

      expect(result.success).toBe(true);
    });

    test("should fail 200 response with invalid data", () => {
      const responseBody = {
        data: [
          {
            id: "not-a-uuid",
            email: "invalid",
            name: "T",
            createdAt: "not-a-date",
          },
        ],
      };
      const result = validator.validateResponse(responseBody, 200);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].type).toBe("response");
    });

    test("should pass through undefined status codes", () => {
      const responseBody = { anything: "works" };
      const result = validator.validateResponse(responseBody, 500);

      expect(result.success).toBe(true);
    });
  });

  describe("helper methods", () => {
    test("getMethods should return defined methods", () => {
      const methods = validator.getMethods();
      expect(methods).toContain("GET");
      expect(methods).toContain("POST");
      expect(methods).not.toContain("DELETE");
    });

    test("getStatusCodes should return defined status codes", () => {
      const codes = validator.getStatusCodes();
      expect(codes).toContain(200);
      expect(codes).toContain(201);
      expect(codes).toContain(400);
      expect(codes).not.toContain(500);
    });

    test("hasMethodSchema should check method existence", () => {
      expect(validator.hasMethodSchema("GET")).toBe(true);
      expect(validator.hasMethodSchema("POST")).toBe(true);
      expect(validator.hasMethodSchema("DELETE")).toBe(false);
    });

    test("hasResponseSchema should check status code existence", () => {
      expect(validator.hasResponseSchema(200)).toBe(true);
      expect(validator.hasResponseSchema(400)).toBe(true);
      expect(validator.hasResponseSchema(500)).toBe(false);
    });
  });
});

describe("formatValidationErrors", () => {
  test("should format validation errors for HTTP response", () => {
    const errors = [
      {
        type: "query" as const,
        issues: [
          { path: ["page"], message: "Number must be greater than 0", code: "too_small" },
        ],
      },
      {
        type: "body" as const,
        issues: [
          { path: ["email"], message: "Invalid email", code: "invalid_string" },
          { path: ["name"], message: "String must contain at least 2 character(s)", code: "too_small" },
        ],
      },
    ];

    const formatted = formatValidationErrors(errors);

    expect(formatted.error).toBe("Validation Error");
    expect(formatted.details).toHaveLength(2);
    expect(formatted.details[0].type).toBe("query");
    expect(formatted.details[0].issues[0].path).toBe("page");
    expect(formatted.details[1].type).toBe("body");
    expect(formatted.details[1].issues).toHaveLength(2);
  });

  test("should handle root path errors", () => {
    const errors = [
      {
        type: "body" as const,
        issues: [{ path: [], message: "Invalid JSON", code: "invalid_type" }],
      },
    ];

    const formatted = formatValidationErrors(errors);
    expect(formatted.details[0].issues[0].path).toBe("(root)");
  });
});

describe("Path Parameters Validation", () => {
  const contractWithParams: ContractSchema = {
    request: {
      GET: {
        params: z.object({
          id: z.string().uuid(),
        }),
      },
      PUT: {
        params: z.object({
          id: z.string().uuid(),
        }),
        body: CreateUserInput,
      },
    },
    response: {
      200: z.object({ data: UserSchema }),
    },
  };

  const validator = new ContractValidator(contractWithParams);

  test("should validate path parameters", async () => {
    const req = new Request("http://localhost/api/users/550e8400-e29b-41d4-a716-446655440000");
    const result = await validator.validateRequest(req, "GET", {
      id: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.success).toBe(true);
  });

  test("should fail invalid path parameters", async () => {
    const req = new Request("http://localhost/api/users/not-a-uuid");
    const result = await validator.validateRequest(req, "GET", {
      id: "not-a-uuid",
    });

    expect(result.success).toBe(false);
    expect(result.errors![0].type).toBe("params");
  });

  test("should validate both params and body", async () => {
    const req = new Request("http://localhost/api/users/550e8400-e29b-41d4-a716-446655440000", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "updated@example.com",
        name: "Updated User",
      }),
    });
    const result = await validator.validateRequest(req, "PUT", {
      id: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.success).toBe(true);
  });
});

describe("Headers Validation", () => {
  const contractWithHeaders: ContractSchema = {
    request: {
      GET: {
        headers: z.object({
          authorization: z.string().startsWith("Bearer "),
          "x-api-key": z.string().min(32),
        }),
      },
    },
    response: {},
  };

  const validator = new ContractValidator(contractWithHeaders);

  test("should validate headers", async () => {
    const req = new Request("http://localhost/api/protected", {
      headers: {
        Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        "X-API-Key": "12345678901234567890123456789012",
      },
    });
    const result = await validator.validateRequest(req, "GET");

    expect(result.success).toBe(true);
  });

  test("should fail invalid headers", async () => {
    const req = new Request("http://localhost/api/protected", {
      headers: {
        Authorization: "Invalid token",
        "X-API-Key": "short",
      },
    });
    const result = await validator.validateRequest(req, "GET");

    expect(result.success).toBe(false);
    expect(result.errors![0].type).toBe("headers");
  });
});
