/**
 * Test Fixtures for Resource Tests
 */

import type { ResourceDefinition } from "../schema";

/**
 * Simple user resource fixture
 */
export const userResourceFixture: ResourceDefinition = {
  name: "user",
  fields: {
    id: {
      type: "uuid",
      required: true,
      description: "User ID",
    },
    email: {
      type: "email",
      required: true,
      description: "User email address",
    },
    name: {
      type: "string",
      required: true,
      description: "User full name",
    },
    age: {
      type: "number",
      required: false,
      description: "User age",
    },
    isActive: {
      type: "boolean",
      required: false,
      default: true,
      description: "Account status",
    },
    createdAt: {
      type: "date",
      required: true,
      description: "Account creation timestamp",
    },
    updatedAt: {
      type: "date",
      required: true,
      description: "Last update timestamp",
    },
  },
  options: {
    description: "User management API",
    tags: ["users", "auth"],
    endpoints: {
      list: true,
      get: true,
      create: true,
      update: true,
      delete: true,
    },
    pagination: {
      defaultLimit: 20,
      maxLimit: 100,
    },
  },
};

/**
 * Post resource with array field
 */
export const postResourceFixture: ResourceDefinition = {
  name: "post",
  fields: {
    id: {
      type: "uuid",
      required: true,
    },
    title: {
      type: "string",
      required: true,
    },
    content: {
      type: "string",
      required: true,
    },
    tags: {
      type: "array",
      items: "string",
      required: false,
      default: [],
    },
    metadata: {
      type: "json",
      required: false,
    },
    publishedAt: {
      type: "date",
      required: false,
    },
  },
  options: {
    description: "Blog posts API",
    tags: ["posts"],
    autoPlural: true,
  },
};

/**
 * Product resource with custom plural
 */
export const productResourceFixture: ResourceDefinition = {
  name: "product",
  fields: {
    id: {
      type: "uuid",
      required: true,
    },
    name: {
      type: "string",
      required: true,
    },
    price: {
      type: "number",
      required: true,
    },
    inStock: {
      type: "boolean",
      required: true,
      default: true,
    },
  },
  options: {
    description: "Product catalog API",
    pluralName: "inventory",
    endpoints: {
      list: true,
      get: true,
      create: true,
      update: false,
      delete: false,
    },
  },
};

/**
 * Minimal resource fixture
 */
export const minimalResourceFixture: ResourceDefinition = {
  name: "item",
  fields: {
    id: {
      type: "uuid",
      required: true,
    },
    name: {
      type: "string",
      required: true,
    },
  },
};

/**
 * Invalid resource fixtures for error testing
 */
export const invalidResourceFixtures = {
  noName: {
    fields: {
      id: { type: "uuid", required: true },
    },
  } as unknown as ResourceDefinition, // intentionally invalid: missing name

  invalidName: {
    name: "123-invalid",
    fields: {
      id: { type: "uuid", required: true },
    },
  } as ResourceDefinition,

  noFields: {
    name: "valid",
    fields: {},
  } as ResourceDefinition,

  invalidFieldName: {
    name: "valid",
    fields: {
      "invalid-field": { type: "string", required: true },
    },
  } as ResourceDefinition,

  invalidFieldType: {
    name: "valid",
    fields: {
      field: { type: "invalid" as unknown as "string", required: true }, // intentionally invalid type
    },
  } as ResourceDefinition,

  arrayWithoutItems: {
    name: "valid",
    fields: {
      tags: { type: "array", required: true },
    },
  } as ResourceDefinition,
};
