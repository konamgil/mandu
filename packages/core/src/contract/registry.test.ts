import { describe, it, expect } from "vitest";
import { diffContractRegistry, type ContractRegistry } from "./registry";

describe("Contract registry diff", () => {
  it("should mark added optional fields as minor", () => {
    const prev: ContractRegistry = {
      version: 1,
      generatedAt: "",
      contracts: [
        {
          id: "users",
          routeId: "users",
          file: "spec/contracts/users.contract.ts",
          methods: ["POST"],
          request: {
            POST: { query: false, body: true, params: false, headers: false },
          },
          response: [201],
          hash: null,
          schemas: {
            request: {
              POST: {
                body: {
                  type: "object",
                  keys: ["name"],
                  required: ["name"],
                },
              },
            },
            response: {
              201: {
                type: "object",
                keys: ["id"],
                required: ["id"],
              },
            },
          },
        },
      ],
    };

    const next: ContractRegistry = {
      version: 1,
      generatedAt: "",
      contracts: [
        {
          id: "users",
          routeId: "users",
          file: "spec/contracts/users.contract.ts",
          methods: ["POST"],
          request: {
            POST: { query: false, body: true, params: false, headers: false },
          },
          response: [201],
          hash: null,
          schemas: {
            request: {
              POST: {
                body: {
                  type: "object",
                  keys: ["age", "name"],
                  required: ["name"],
                },
              },
            },
            response: {
              201: {
                type: "object",
                keys: ["id"],
                required: ["id"],
              },
            },
          },
        },
      ],
    };

    const diff = diffContractRegistry(prev, next);
    expect(diff.summary.major).toBe(0);
    expect(diff.summary.minor).toBeGreaterThan(0);
  });

  it("should mark required field addition as major", () => {
    const prev: ContractRegistry = {
      version: 1,
      generatedAt: "",
      contracts: [
        {
          id: "users",
          routeId: "users",
          file: "spec/contracts/users.contract.ts",
          methods: ["POST"],
          request: {
            POST: { query: false, body: true, params: false, headers: false },
          },
          response: [201],
          hash: null,
          schemas: {
            request: {
              POST: {
                body: {
                  type: "object",
                  keys: ["name", "age"],
                  required: ["name"],
                },
              },
            },
          },
        },
      ],
    };

    const next: ContractRegistry = {
      version: 1,
      generatedAt: "",
      contracts: [
        {
          id: "users",
          routeId: "users",
          file: "spec/contracts/users.contract.ts",
          methods: ["POST"],
          request: {
            POST: { query: false, body: true, params: false, headers: false },
          },
          response: [201],
          hash: null,
          schemas: {
            request: {
              POST: {
                body: {
                  type: "object",
                  keys: ["name", "age"],
                  required: ["name", "age"],
                },
              },
            },
          },
        },
      ],
    };

    const diff = diffContractRegistry(prev, next);
    expect(diff.summary.major).toBeGreaterThan(0);
  });

  it("should mark enum value removal as major", () => {
    const prev: ContractRegistry = {
      version: 1,
      generatedAt: "",
      contracts: [
        {
          id: "users",
          routeId: "users",
          file: "spec/contracts/users.contract.ts",
          methods: ["GET"],
          request: {
            GET: { query: true, body: false, params: false, headers: false },
          },
          response: [200],
          hash: null,
          schemas: {
            request: {
              GET: {
                query: {
                  type: "enum",
                  values: ["active", "inactive"],
                },
              },
            },
          },
        },
      ],
    };

    const next: ContractRegistry = {
      version: 1,
      generatedAt: "",
      contracts: [
        {
          id: "users",
          routeId: "users",
          file: "spec/contracts/users.contract.ts",
          methods: ["GET"],
          request: {
            GET: { query: true, body: false, params: false, headers: false },
          },
          response: [200],
          hash: null,
          schemas: {
            request: {
              GET: {
                query: {
                  type: "enum",
                  values: ["active"],
                },
              },
            },
          },
        },
      ],
    };

    const diff = diffContractRegistry(prev, next);
    expect(diff.summary.major).toBeGreaterThan(0);
  });
});
