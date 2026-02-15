/**
 * Backward Compatibility Tests
 *
 * QA Engineer: Ensure resource architecture doesn't break existing functionality
 */

import { describe, test, expect } from "bun:test";
import path from "path";

describe("Backward Compatibility - Path Structure", () => {
  test("should have properly defined resource paths", async () => {
    const { resolveGeneratedPaths } = await import("../../paths");
    const paths = resolveGeneratedPaths(process.cwd());

    // Resource-specific paths should be defined
    expect(paths.resourceContractsDir).toBeDefined();
    expect(paths.resourceTypesDir).toBeDefined();
    expect(paths.resourceSlotsDir).toBeDefined();
    expect(paths.resourceClientDir).toBeDefined();
    expect(paths.resourceSchemasDir).toBeDefined();

    // Verify path structure (normalize path separators)
    expect(path.normalize(paths.resourceContractsDir)).toContain(
      path.normalize(".mandu/generated/server/contracts")
    );
    expect(path.normalize(paths.resourceTypesDir)).toContain(
      path.normalize(".mandu/generated/server/types")
    );
    expect(path.normalize(paths.resourceSlotsDir)).toContain(path.normalize("spec/slots"));
    expect(path.normalize(paths.resourceClientDir)).toContain(
      path.normalize(".mandu/generated/client")
    );
    expect(path.normalize(paths.resourceSchemasDir)).toContain(path.normalize("spec/resources"));
  });

  test("should maintain existing path structure", async () => {
    const { resolveGeneratedPaths } = await import("../../paths");
    const paths = resolveGeneratedPaths(process.cwd());

    // Existing paths should still exist
    expect(paths.serverRoutesDir).toBeDefined();
    expect(paths.webRoutesDir).toBeDefined();
    expect(paths.typesDir).toBeDefined();
    expect(paths.mapDir).toBeDefined();
    expect(paths.manifestPath).toBeDefined();
    expect(paths.lockPath).toBeDefined();
  });

  test("should not conflict with existing generated directories", async () => {
    const { resolveGeneratedPaths } = await import("../../paths");
    const paths = resolveGeneratedPaths(process.cwd());

    // Resource contracts and types use shared directories
    // This is intentional - they coexist in the same location
    expect(path.normalize(paths.resourceContractsDir)).toContain(
      path.normalize("server/contracts")
    );
    expect(path.normalize(paths.resourceTypesDir)).toContain(path.normalize("server/types"));

    // Slots are in the same spec/slots directory (intentional sharing)
    expect(paths.resourceSlotsDir).toBeDefined();
  });
});

describe("Backward Compatibility - Existing Systems", () => {
  test("should maintain existing exports from core", async () => {
    const core = await import("../../index");

    // Core exports should still be available
    expect(core.Mandu).toBeDefined();
    expect(core.createContract).toBeDefined();
  });

  test("should not affect existing contract system", async () => {
    const { createContract } = await import("../../contract/index");
    const { z } = await import("zod");

    // Existing contract creation should still work
    const contract = createContract({
      description: "Test backward compatibility",
      request: {
        GET: {
          query: z.object({
            id: z.string(),
          }),
        },
      },
      response: {
        200: z.object({
          data: z.string(),
        }),
      },
    });

    expect(contract).toBeDefined();
    expect(contract.description).toBe("Test backward compatibility");
    expect(contract.request.GET).toBeDefined();
  });

  test("should not affect existing guard system", async () => {
    const { detectCategory } = await import("../../guard/negotiation");

    // Existing guard functionality should work
    const category = detectCategory("사용자 인증");
    expect(category).toBeDefined();
    expect(typeof category).toBe("string");
  });
});

describe("Backward Compatibility - Type Safety", () => {
  test("resource types should not conflict with existing types", async () => {
    const resourceModule = await import("../index");
    const contractModule = await import("../../contract/index");

    // Both should export their own types without conflicts
    expect(typeof resourceModule.defineResource).toBe("function");
    expect(typeof resourceModule.generateResourceArtifacts).toBe("function");
    expect(typeof contractModule.createContract).toBe("function");
  });

  test("FieldTypes should be properly namespaced", async () => {
    const { FieldTypes } = await import("../schema");

    // Verify FieldTypes doesn't pollute global namespace
    expect(Array.isArray(FieldTypes)).toBe(true);
    expect(FieldTypes.length).toBe(10);

    // Verify it contains expected types
    expect(FieldTypes).toContain("string");
    expect(FieldTypes).toContain("number");
    expect(FieldTypes).toContain("uuid");
  });
});

describe("Backward Compatibility - API Exports", () => {
  test("all resource exports should be properly namespaced", async () => {
    const resourceExports = await import("../index");

    // Schema API
    expect(resourceExports.defineResource).toBeDefined();
    expect(resourceExports.validateResourceDefinition).toBeDefined();
    expect(resourceExports.FieldTypes).toBeDefined();

    // Parser API
    expect(resourceExports.parseResourceSchema).toBeDefined();
    expect(resourceExports.parseResourceSchemas).toBeDefined();

    // Generator API
    expect(resourceExports.generateResourceArtifacts).toBeDefined();
    expect(resourceExports.generateResourcesArtifacts).toBeDefined();

    // Individual generators
    expect(resourceExports.generateResourceContract).toBeDefined();
    expect(resourceExports.generateResourceTypes).toBeDefined();
    expect(resourceExports.generateResourceSlot).toBeDefined();
    expect(resourceExports.generateResourceClient).toBeDefined();
  });

  test("resource types should be properly exported", async () => {
    const module = await import("../index");

    // Functions should be defined
    expect(typeof module.defineResource).toBe("function");
    expect(typeof module.parseResourceSchema).toBe("function");
    expect(typeof module.generateResourceArtifacts).toBe("function");

    // Verify function signatures work
    const definition = module.defineResource({
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
      },
    });

    expect(definition.name).toBe("test");
  });
});

describe("Backward Compatibility - No Breaking Changes", () => {
  test("no pollution of global scope", () => {
    const globalKeys = Object.keys(globalThis);

    // These should NOT exist in global scope
    expect(globalKeys).not.toContain("defineResource");
    expect(globalKeys).not.toContain("ResourceDefinition");
    expect(globalKeys).not.toContain("FieldTypes");
    expect(globalKeys).not.toContain("generateResourceArtifacts");
  });

  test("existing test infrastructure still works", () => {
    // Meta-test: if this runs, the test framework is working
    expect(true).toBe(true);
    expect(1 + 1).toBe(2);
  });
});

describe("Backward Compatibility - Coexistence", () => {
  test("can use both manifest and resource systems together", async () => {
    const { createContract } = await import("../../contract/index");
    const { defineResource } = await import("../schema");
    const { z } = await import("zod");

    // Create a traditional manifest-based contract
    const manifestContract = createContract({
      description: "Manifest-based API",
      request: {
        GET: {
          query: z.object({ id: z.string() }),
        },
      },
      response: {
        200: z.object({ data: z.string() }),
      },
    });

    // Create a resource-based definition
    const resourceDef = defineResource({
      name: "user",
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
      },
    });

    // Both should coexist without conflicts
    expect(manifestContract).toBeDefined();
    expect(manifestContract.description).toBe("Manifest-based API");

    expect(resourceDef).toBeDefined();
    expect(resourceDef.name).toBe("user");
    expect(resourceDef.fields.id.type).toBe("uuid");
  });

  test("resource and contract validators can coexist", async () => {
    const { ContractValidator } = await import("../../contract/validator");
    const { validateResourceDefinition } = await import("../schema");
    const { createContract } = await import("../../contract/index");
    const { z } = await import("zod");

    // Use contract validator
    const contract = createContract({
      request: { GET: { query: z.object({ id: z.string() }) } },
      response: { 200: z.object({ data: z.string() }) },
    });
    const validator = new ContractValidator(contract);
    expect(validator).toBeDefined();

    // Use resource validator
    const resourceDef = {
      name: "test",
      fields: { id: { type: "uuid" as const, required: true } },
    };
    expect(() => validateResourceDefinition(resourceDef)).not.toThrow();
  });

  test("path constants are properly defined", () => {
    const { GENERATED_RELATIVE_PATHS } = require("../../paths");

    // Verify all expected paths exist
    expect(GENERATED_RELATIVE_PATHS.contracts).toBeDefined();
    expect(GENERATED_RELATIVE_PATHS.slots).toBeDefined();
    expect(GENERATED_RELATIVE_PATHS.client).toBeDefined();
    expect(GENERATED_RELATIVE_PATHS.resourceSchemas).toBeDefined();

    // Verify structure (normalize separators)
    expect(path.normalize(GENERATED_RELATIVE_PATHS.contracts)).toContain("contracts");
    expect(path.normalize(GENERATED_RELATIVE_PATHS.slots)).toContain("slots");
    expect(path.normalize(GENERATED_RELATIVE_PATHS.resourceSchemas)).toContain("resources");
  });
});

describe("Backward Compatibility - Error Handling", () => {
  test("resource validation errors should be clear and helpful", async () => {
    const { validateResourceDefinition } = await import("../schema");

    try {
      validateResourceDefinition({
        name: "",
        fields: {},
      } as any);
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
      expect((error as Error).message).toContain("Resource name is required");
    }
  });

  test("should handle missing fields gracefully", async () => {
    const { validateResourceDefinition } = await import("../schema");

    try {
      validateResourceDefinition({
        name: "test",
        fields: {},
      } as any);
      expect(false).toBe(true); // Should not reach here
    } catch (error) {
      expect(error).toBeDefined();
      expect((error as Error).message).toContain("must have at least one field");
    }
  });
});
