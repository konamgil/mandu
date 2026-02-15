/**
 * Resource Schema Tests
 */

import { describe, test, expect } from "bun:test";
import {
  defineResource,
  validateResourceDefinition,
  getPluralName,
  getEnabledEndpoints,
  isFieldRequired,
  getFieldDefault,
} from "../schema";
import {
  userResourceFixture,
  postResourceFixture,
  productResourceFixture,
  minimalResourceFixture,
  invalidResourceFixtures,
} from "./fixtures";

describe("defineResource", () => {
  test("should accept valid resource definition", () => {
    const result = defineResource(userResourceFixture);

    expect(result.name).toBe("user");
    expect(result.fields).toBeDefined();
    expect(result.options).toBeDefined();
  });

  test("should apply default options", () => {
    const result = defineResource(minimalResourceFixture);

    expect(result.options?.autoPlural).toBe(true);
    expect(result.options?.endpoints).toBeDefined();
    expect(result.options?.endpoints?.list).toBe(true);
    expect(result.options?.endpoints?.get).toBe(true);
    expect(result.options?.endpoints?.create).toBe(true);
    expect(result.options?.endpoints?.update).toBe(true);
    expect(result.options?.endpoints?.delete).toBe(true);
  });

  test("should merge custom options with defaults", () => {
    const result = defineResource(productResourceFixture);

    expect(result.options?.endpoints?.list).toBe(true);
    expect(result.options?.endpoints?.update).toBe(false);
    expect(result.options?.endpoints?.delete).toBe(false);
  });

  test("should apply default pagination settings", () => {
    const result = defineResource(minimalResourceFixture);

    expect(result.options?.pagination?.defaultLimit).toBe(10);
    expect(result.options?.pagination?.maxLimit).toBe(100);
  });

  test("should preserve custom pagination settings", () => {
    const result = defineResource(userResourceFixture);

    expect(result.options?.pagination?.defaultLimit).toBe(20);
    expect(result.options?.pagination?.maxLimit).toBe(100);
  });
});

describe("validateResourceDefinition", () => {
  test("should validate correct resource definition", () => {
    expect(() => {
      validateResourceDefinition(userResourceFixture);
    }).not.toThrow();
  });

  test("should throw on missing name", () => {
    expect(() => {
      validateResourceDefinition(invalidResourceFixtures.noName);
    }).toThrow("Resource name is required");
  });

  test("should throw on invalid name format", () => {
    expect(() => {
      validateResourceDefinition(invalidResourceFixtures.invalidName);
    }).toThrow(/Invalid resource name/);
  });

  test("should throw on empty fields", () => {
    expect(() => {
      validateResourceDefinition(invalidResourceFixtures.noFields);
    }).toThrow(/must have at least one field/);
  });

  test("should throw on invalid field name", () => {
    expect(() => {
      validateResourceDefinition(invalidResourceFixtures.invalidFieldName);
    }).toThrow(/Invalid field name/);
  });

  test("should throw on invalid field type", () => {
    expect(() => {
      validateResourceDefinition(invalidResourceFixtures.invalidFieldType);
    }).toThrow(/Invalid field type/);
  });

  test("should throw on array without items", () => {
    expect(() => {
      validateResourceDefinition(invalidResourceFixtures.arrayWithoutItems);
    }).toThrow(/missing "items" property/);
  });
});

describe("getPluralName", () => {
  test("should add 's' for simple pluralization", () => {
    const result = getPluralName(userResourceFixture);
    expect(result).toBe("users");
  });

  test("should use custom plural name if provided", () => {
    const result = getPluralName(productResourceFixture);
    expect(result).toBe("inventory");
  });

  test("should respect autoPlural: false", () => {
    const definition = {
      ...minimalResourceFixture,
      options: { autoPlural: false },
    };
    const result = getPluralName(definition);
    expect(result).toBe("item");
  });
});

describe("getEnabledEndpoints", () => {
  test("should return all enabled endpoints", () => {
    const result = getEnabledEndpoints(userResourceFixture);
    expect(result).toEqual(["list", "get", "create", "update", "delete"]);
  });

  test("should return only enabled endpoints", () => {
    const result = getEnabledEndpoints(productResourceFixture);
    expect(result).toEqual(["list", "get", "create"]);
    expect(result).not.toContain("update");
    expect(result).not.toContain("delete");
  });

  test("should return all endpoints by default", () => {
    const result = getEnabledEndpoints(minimalResourceFixture);
    expect(result).toEqual(["list", "get", "create", "update", "delete"]);
  });
});

describe("isFieldRequired", () => {
  test("should return true for required fields", () => {
    const field = userResourceFixture.fields.email;
    expect(isFieldRequired(field)).toBe(true);
  });

  test("should return false for optional fields", () => {
    const field = userResourceFixture.fields.age;
    expect(isFieldRequired(field)).toBe(false);
  });

  test("should return false by default", () => {
    const field = { type: "string" as const };
    expect(isFieldRequired(field)).toBe(false);
  });
});

describe("getFieldDefault", () => {
  test("should return default value if provided", () => {
    const field = userResourceFixture.fields.isActive;
    expect(getFieldDefault(field)).toBe(true);
  });

  test("should return undefined if no default", () => {
    const field = userResourceFixture.fields.email;
    expect(getFieldDefault(field)).toBeUndefined();
  });

  test("should handle array default", () => {
    const field = postResourceFixture.fields.tags;
    const defaultValue = getFieldDefault(field);
    expect(Array.isArray(defaultValue)).toBe(true);
    expect(defaultValue).toEqual([]);
  });
});
