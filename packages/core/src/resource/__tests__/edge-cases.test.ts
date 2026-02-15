/**
 * Resource Edge Cases & Robustness Tests
 *
 * QA Engineer: Additional edge case coverage for resource architecture
 */

import { describe, test, expect } from "bun:test";
import {
  defineResource,
  validateResourceDefinition,
  FieldTypes,
  type ResourceDefinition,
} from "../schema";

describe("Edge Cases - Resource Names", () => {
  test("should handle single character names", () => {
    const definition: ResourceDefinition = {
      name: "a",
      fields: {
        id: { type: "uuid", required: true },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should reject empty string name", () => {
    const definition = {
      name: "",
      fields: {
        id: { type: "uuid", required: true },
      },
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(/Resource name is required/);
  });

  test("should reject names with spaces", () => {
    const definition = {
      name: "user profile",
      fields: {
        id: { type: "uuid", required: true },
      },
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(/Invalid resource name/);
  });

  test("should reject names with special characters", () => {
    const definition = {
      name: "user@profile",
      fields: {
        id: { type: "uuid", required: true },
      },
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(/Invalid resource name/);
  });

  test("should reject names starting with numbers", () => {
    const definition = {
      name: "1user",
      fields: {
        id: { type: "uuid", required: true },
      },
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(/Invalid resource name/);
  });

  test("should accept names with underscores", () => {
    const definition: ResourceDefinition = {
      name: "user_profile",
      fields: {
        id: { type: "uuid", required: true },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should accept names with numbers (not starting)", () => {
    const definition: ResourceDefinition = {
      name: "user2",
      fields: {
        id: { type: "uuid", required: true },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should accept camelCase names", () => {
    const definition: ResourceDefinition = {
      name: "userProfile",
      fields: {
        id: { type: "uuid", required: true },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });
});

describe("Edge Cases - Field Names", () => {
  test("should handle very long field names", () => {
    const longName = "a".repeat(100);
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        [longName]: { type: "string", required: true },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should reject field names starting with underscore", () => {
    const definition = {
      name: "test",
      fields: {
        _privateField: { type: "string", required: true },
      },
    } as any;

    // Field names must start with a letter (not underscore)
    expect(() => validateResourceDefinition(definition)).toThrow(/Invalid field name/);
  });

  test("should reject field names starting with numbers", () => {
    const definition = {
      name: "test",
      fields: {
        "1field": { type: "string", required: true },
      },
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(/Invalid field name/);
  });

  test("should handle field names with underscores (not starting)", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        field_name_1: { type: "string", required: true },
        field123: { type: "boolean", required: false },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle camelCase field names", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        firstName: { type: "string", required: true },
        lastName: { type: "string", required: true },
        emailAddress: { type: "email", required: true },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });
});

describe("Edge Cases - Field Types", () => {
  test("should handle all supported field types", () => {
    const allTypesDefinition: ResourceDefinition = {
      name: "alltypes",
      fields: {
        stringField: { type: "string", required: true },
        numberField: { type: "number", required: true },
        booleanField: { type: "boolean", required: true },
        dateField: { type: "date", required: true },
        uuidField: { type: "uuid", required: true },
        emailField: { type: "email", required: true },
        urlField: { type: "url", required: true },
        jsonField: { type: "json", required: true },
        arrayField: { type: "array", items: "string", required: true },
        objectField: { type: "object", required: true },
      },
    };

    expect(() => validateResourceDefinition(allTypesDefinition)).not.toThrow();
  });

  test("should verify FieldTypes constant completeness", () => {
    // Ensure FieldTypes constant matches expected types
    expect(FieldTypes).toContain("string");
    expect(FieldTypes).toContain("number");
    expect(FieldTypes).toContain("boolean");
    expect(FieldTypes).toContain("date");
    expect(FieldTypes).toContain("uuid");
    expect(FieldTypes).toContain("email");
    expect(FieldTypes).toContain("url");
    expect(FieldTypes).toContain("json");
    expect(FieldTypes).toContain("array");
    expect(FieldTypes).toContain("object");
    expect(FieldTypes.length).toBe(10);
  });

  test("should reject unsupported field type", () => {
    const definition = {
      name: "test",
      fields: {
        id: { type: "unsupported_type", required: true },
      },
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(/Invalid field type/);
  });

  test("should handle nested arrays", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        tags: { type: "array", items: "string", required: true },
        numbers: { type: "array", items: "number", required: false },
        objects: { type: "array", items: "object", required: false },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should reject array without items specification", () => {
    const definition = {
      name: "test",
      fields: {
        tags: { type: "array", required: true },
      },
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(/missing "items" property/);
  });
});

describe("Edge Cases - Field Defaults", () => {
  test("should handle string defaults", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        status: { type: "string", default: "active", required: false },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle number defaults", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        count: { type: "number", default: 0, required: false },
        score: { type: "number", default: 100, required: false },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle boolean defaults", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        isActive: { type: "boolean", default: true, required: false },
        isDeleted: { type: "boolean", default: false, required: false },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle array defaults", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        tags: { type: "array", items: "string", default: [], required: false },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle object defaults", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        metadata: { type: "object", default: {}, required: false },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });
});

describe("Edge Cases - Resource Options", () => {
  test("should handle empty options", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
      },
      options: {},
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle no options", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle all endpoints disabled", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
      },
      options: {
        endpoints: {
          list: false,
          get: false,
          create: false,
          update: false,
          delete: false,
        },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle partial endpoint configuration", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
      },
      options: {
        endpoints: {
          list: true,
          get: true,
          // create, update, delete will use defaults
        },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle custom pagination limits", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
      },
      options: {
        pagination: {
          defaultLimit: 50,
          maxLimit: 500,
        },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle very long description", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
      },
      options: {
        description: "A".repeat(1000),
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle many tags", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
      },
      options: {
        tags: Array.from({ length: 50 }, (_, i) => `tag${i}`),
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle auth option", () => {
    const definition: ResourceDefinition = {
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
      },
      options: {
        auth: true,
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle custom plural name", () => {
    const definition: ResourceDefinition = {
      name: "person",
      fields: {
        id: { type: "uuid", required: true },
      },
      options: {
        pluralName: "people",
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });
});

describe("Edge Cases - Large Schemas", () => {
  test("should handle resource with many fields (50 fields)", () => {
    const fields: Record<string, any> = {};
    for (let i = 0; i < 50; i++) {
      fields[`field${i}`] = { type: "string", required: i % 2 === 0 };
    }

    const definition: ResourceDefinition = {
      name: "largescale",
      fields,
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle resource with minimal fields (1 field)", () => {
    const definition: ResourceDefinition = {
      name: "minimal",
      fields: {
        id: { type: "uuid", required: true },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });

  test("should handle resource with mixed field types", () => {
    const definition: ResourceDefinition = {
      name: "mixed",
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
        age: { type: "number", required: false },
        isActive: { type: "boolean", default: true },
        createdAt: { type: "date", required: true },
        email: { type: "email", required: true },
        website: { type: "url", required: false },
        config: { type: "json", required: false },
        tags: { type: "array", items: "string", default: [] },
        metadata: { type: "object", default: {} },
      },
    };

    expect(() => validateResourceDefinition(definition)).not.toThrow();
  });
});

describe("Edge Cases - Boundary Conditions", () => {
  test("should reject resource without fields", () => {
    const definition = {
      name: "test",
      fields: {},
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(
      /must have at least one field/
    );
  });

  test("should reject resource with null fields", () => {
    const definition = {
      name: "test",
      fields: null,
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(
      /must have at least one field/
    );
  });

  test("should reject resource with undefined fields", () => {
    const definition = {
      name: "test",
      fields: undefined,
    } as any;

    expect(() => validateResourceDefinition(definition)).toThrow(
      /must have at least one field/
    );
  });
});
