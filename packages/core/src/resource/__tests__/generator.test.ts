/**
 * Resource Generator Tests
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { generateResourceArtifacts } from "../generator";
import type { ParsedResource } from "../parser";
import { resolveGeneratedPaths } from "../../paths";
import path from "path";
import fs from "fs/promises";
import os from "os";

// Test utilities
let testDir: string;

beforeAll(async () => {
  // Create temporary test directory
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-resource-test-"));
});

afterAll(async () => {
  // Clean up test directory
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
});

/**
 * Create a test parsed resource (no file import needed)
 */
function createTestParsedResource(resourceName: string, definition: any): ParsedResource {
  return {
    definition,
    filePath: path.join(testDir, "spec", "resources", `${resourceName}.resource.ts`),
    fileName: resourceName,
    resourceName: definition.name,
  };
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("generateResourceArtifacts", () => {
  test("should generate all artifacts for a resource", async () => {
    // Create test resource definition
    const parsed = createTestParsedResource("user", {
      name: "user",
      fields: {
        id: { type: "uuid", required: true },
        email: { type: "email", required: true },
        name: { type: "string", required: true },
        createdAt: { type: "date", required: true },
      },
      options: {
        description: "User management API",
        tags: ["users"],
      },
    });

    // Generate artifacts
    const result = await generateResourceArtifacts(parsed, {
      rootDir: testDir,
      force: false,
    });

    // Verify result
    expect(result.success).toBe(true);
    expect(result.errors.length).toBe(0);
    expect(result.created.length).toBeGreaterThan(0);

    // Verify files were created
    const paths = resolveGeneratedPaths(testDir);

    const contractPath = path.join(paths.resourceContractsDir, "user.contract.ts");
    const typesPath = path.join(paths.resourceTypesDir, "user.types.ts");
    const slotPath = path.join(paths.resourceSlotsDir, "user.slot.ts");
    const clientPath = path.join(paths.resourceClientDir, "user.client.ts");

    expect(await fileExists(contractPath)).toBe(true);
    expect(await fileExists(typesPath)).toBe(true);
    expect(await fileExists(slotPath)).toBe(true);
    expect(await fileExists(clientPath)).toBe(true);

    // Verify created list includes all files
    expect(result.created).toContain(contractPath);
    expect(result.created).toContain(typesPath);
    expect(result.created).toContain(slotPath);
    expect(result.created).toContain(clientPath);
  });

  test("should preserve existing slot without --force", async () => {
    // Create test resource
    const parsed = createTestParsedResource("post", {
      name: "post",
      fields: {
        id: { type: "uuid", required: true },
        title: { type: "string", required: true },
      },
    });

    // First generation
    const result1 = await generateResourceArtifacts(parsed, {
      rootDir: testDir,
      force: false,
    });

    expect(result1.success).toBe(true);

    const paths = resolveGeneratedPaths(testDir);
    const slotPath = path.join(paths.resourceSlotsDir, "post.slot.ts");

    // Read original slot content
    const originalContent = await fs.readFile(slotPath, "utf-8");

    // Modify slot file
    const modifiedContent = `${originalContent}\n// Custom modification`;
    await fs.writeFile(slotPath, modifiedContent);

    // Second generation (should preserve slot)
    const result2 = await generateResourceArtifacts(parsed, {
      rootDir: testDir,
      force: false,
    });

    expect(result2.success).toBe(true);
    expect(result2.skipped).toContain(slotPath);
    expect(result2.created).not.toContain(slotPath);

    // Verify slot was preserved
    const currentContent = await fs.readFile(slotPath, "utf-8");
    expect(currentContent).toBe(modifiedContent);
  });

  test("should overwrite slot with --force", async () => {
    // Create test resource
    const parsed = createTestParsedResource("product", {
      name: "product",
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
      },
    });

    // First generation
    await generateResourceArtifacts(parsed, {
      rootDir: testDir,
      force: false,
    });

    const paths = resolveGeneratedPaths(testDir);
    const slotPath = path.join(paths.resourceSlotsDir, "product.slot.ts");

    // Modify slot file
    await fs.writeFile(slotPath, "// Custom content");

    // Second generation with --force
    const result = await generateResourceArtifacts(parsed, {
      rootDir: testDir,
      force: true,
    });

    expect(result.success).toBe(true);
    expect(result.created).toContain(slotPath);
    expect(result.skipped).not.toContain(slotPath);

    // Verify slot was overwritten
    const currentContent = await fs.readFile(slotPath, "utf-8");
    expect(currentContent).not.toBe("// Custom content");
    expect(currentContent).toContain("Mandu Filling");
  });

  test("should regenerate contract, types, and client on every run", async () => {
    // Create test resource
    const parsed = createTestParsedResource("item", {
      name: "item",
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
      },
    });

    const paths = resolveGeneratedPaths(testDir);

    // First generation
    await generateResourceArtifacts(parsed, {
      rootDir: testDir,
      force: false,
    });

    const contractPath = path.join(paths.resourceContractsDir, "item.contract.ts");
    const typesPath = path.join(paths.resourceTypesDir, "item.types.ts");
    const clientPath = path.join(paths.resourceClientDir, "item.client.ts");

    // Modify generated files
    await fs.writeFile(contractPath, "// Modified contract");
    await fs.writeFile(typesPath, "// Modified types");
    await fs.writeFile(clientPath, "// Modified client");

    // Second generation
    const result = await generateResourceArtifacts(parsed, {
      rootDir: testDir,
      force: false,
    });

    expect(result.success).toBe(true);

    // Verify files were regenerated
    const contractContent = await fs.readFile(contractPath, "utf-8");
    const typesContent = await fs.readFile(typesPath, "utf-8");
    const clientContent = await fs.readFile(clientPath, "utf-8");

    expect(contractContent).not.toBe("// Modified contract");
    expect(typesContent).not.toBe("// Modified types");
    expect(clientContent).not.toBe("// Modified client");

    expect(contractContent).toContain("Mandu.contract");
    expect(typesContent).toContain("InferContract");
    expect(clientContent).toContain("Client");
  });

  test("should support 'only' option to generate specific files", async () => {
    // Create test resource
    const parsed = createTestParsedResource("category", {
      name: "category",
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
      },
    });

    // Generate only contract and types
    const result = await generateResourceArtifacts(parsed, {
      rootDir: testDir,
      force: false,
      only: ["contract", "types"],
    });

    expect(result.success).toBe(true);

    const paths = resolveGeneratedPaths(testDir);

    const contractPath = path.join(paths.resourceContractsDir, "category.contract.ts");
    const typesPath = path.join(paths.resourceTypesDir, "category.types.ts");
    const slotPath = path.join(paths.resourceSlotsDir, "category.slot.ts");
    const clientPath = path.join(paths.resourceClientDir, "category.client.ts");

    // Only contract and types should exist
    expect(await fileExists(contractPath)).toBe(true);
    expect(await fileExists(typesPath)).toBe(true);
    expect(await fileExists(slotPath)).toBe(false);
    expect(await fileExists(clientPath)).toBe(false);
  });
});

describe("Generated Content Validation", () => {
  test("contract should contain Mandu.contract definition", async () => {
    const parsed = createTestParsedResource("test", {
      name: "test",
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
      },
    });

    await generateResourceArtifacts(parsed, {
      rootDir: testDir,
      force: false,
    });

    const paths = resolveGeneratedPaths(testDir);
    const contractPath = path.join(paths.resourceContractsDir, "test.contract.ts");
    const contractContent = await fs.readFile(contractPath, "utf-8");

    expect(contractContent).toContain("Mandu.contract");
    expect(contractContent).toContain("z.object");
    expect(contractContent).toContain("TestSchema");
  });

  test("types should export TypeScript types", async () => {
    const paths = resolveGeneratedPaths(testDir);
    const typesPath = path.join(paths.resourceTypesDir, "test.types.ts");
    const typesContent = await fs.readFile(typesPath, "utf-8");

    expect(typesContent).toContain("InferContract");
    expect(typesContent).toContain("InferQuery");
    expect(typesContent).toContain("InferBody");
    expect(typesContent).toContain("export type");
  });

  test("slot should contain Mandu.filling definition", async () => {
    const paths = resolveGeneratedPaths(testDir);
    const slotPath = path.join(paths.resourceSlotsDir, "test.slot.ts");
    const slotContent = await fs.readFile(slotPath, "utf-8");

    expect(slotContent).toContain("Mandu.filling()");
    expect(slotContent).toContain(".get(");
    expect(slotContent).toContain(".post(");
    expect(slotContent).toContain("ctx.input");
    expect(slotContent).toContain("ctx.output");
  });

  test("client should export Client class", async () => {
    const paths = resolveGeneratedPaths(testDir);
    const clientPath = path.join(paths.resourceClientDir, "test.client.ts");
    const clientContent = await fs.readFile(clientPath, "utf-8");

    expect(clientContent).toContain("export class");
    expect(clientContent).toContain("Client");
    expect(clientContent).toContain("async list(");
    expect(clientContent).toContain("async get(");
    expect(clientContent).toContain("async create(");
  });
});
