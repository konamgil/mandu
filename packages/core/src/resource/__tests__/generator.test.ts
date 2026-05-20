/**
 * Resource Generator Tests
 *
 * Phase 4c additions (Agent D — refactoring-expert):
 *   - Appendix B TC-1~6 preservation guarantees (existing behaviour stays).
 *   - generator-repo.ts emission (shape, dialect, snake_case, header).
 *   - generator-schema.ts orchestration (diff → desired SQL → migration file).
 *   - writeSchemaArtifacts filename sequencing + immutability.
 *   - applied.json read-only contract (Agent C owns writes).
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { generateResourceArtifacts, generateSchemaArtifacts } from "../generator";
import { generateRepoSource, shouldEmitRepo } from "../generator-repo";
import {
  computeSchemaGeneration,
  writeSchemaArtifacts,
} from "../generator-schema";
import type { ParsedResource } from "../parser";
import type { ResourceDefinition } from "../schema";
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
function createTestParsedResource(resourceName: string, definition: ParsedResource["definition"]): ParsedResource {
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
  beforeAll(async () => {
    // Generate artifacts once for the whole describe block so tests are
    // order-independent (previously the first test generated for the others).
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
  });

  test("contract should contain Mandu.contract definition", async () => {
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

// ========================================================================
// Phase 4c — Agent D additions
// ========================================================================

/**
 * Build a persistent resource fixture with three commonly-appearing fields
 * (uuid PK, email-unique-like string, camelCase field that requires
 * snake_case conversion). Provider is postgres by default.
 */
function persistentResource(
  resourceName: string,
  provider: "postgres" | "mysql" | "sqlite" = "postgres",
  extraFields: Record<string, ResourceDefinition["fields"][string]> = {},
): ParsedResource {
  const fields: ResourceDefinition["fields"] = {
    // `primary: true` lives on the field (not public on ResourceField but
    // accepted via best-effort cast in snapshot.ts — same pattern here).
    id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
    email: { type: "email", required: true },
    passwordHash: { type: "string", required: true },
    ...extraFields,
  };
  return {
    definition: { name: resourceName, fields, options: { persistence: { provider } } as ResourceDefinition["options"] },
    filePath: `/virtual/${resourceName}.resource.ts`,
    fileName: resourceName,
    resourceName,
  };
}

describe("Appendix B — Preservation TC-1~6 (Phase 4c non-negotiable)", () => {
  test("TC-1: slot untouched for non-persistent resource; repo NOT emitted", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-tc1-"));
    try {
      const parsed: ParsedResource = {
        definition: {
          name: "article",
          fields: { id: { type: "uuid", required: true }, body: { type: "string", required: true } },
        },
        filePath: "/virtual/article.resource.ts",
        fileName: "article",
        resourceName: "article",
      };
      await generateResourceArtifacts(parsed, { rootDir, force: false });
      const paths = resolveGeneratedPaths(rootDir);

      const slotPath = path.join(paths.resourceSlotsDir, "article.slot.ts");
      const userContent = "// user wrote this\n" + (await fs.readFile(slotPath, "utf8"));
      await fs.writeFile(slotPath, userContent);

      const result = await generateResourceArtifacts(parsed, { rootDir, force: false });
      expect(result.skipped).toContain(slotPath);
      const afterSlot = await fs.readFile(slotPath, "utf8");
      expect(afterSlot).toBe(userContent);

      // No repo file for a non-persistent resource.
      const repoPath = path.join(paths.resourceReposDir, "article.repo.ts");
      await expect(fs.access(repoPath)).rejects.toBeDefined();
      expect(result.repoEmitted).toBeUndefined();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("TC-2: user-edited slot preserved when persistence is added", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-tc2-"));
    try {
      // First generation — non-persistent.
      const nonPersistent: ParsedResource = {
        definition: {
          name: "comment",
          fields: { id: { type: "uuid", required: true }, text: { type: "string", required: true } },
        },
        filePath: "/virtual/comment.resource.ts",
        fileName: "comment",
        resourceName: "comment",
      };
      await generateResourceArtifacts(nonPersistent, { rootDir, force: false });
      const paths = resolveGeneratedPaths(rootDir);
      const slotPath = path.join(paths.resourceSlotsDir, "comment.slot.ts");
      const userEdit = "// MY EDIT\n" + (await fs.readFile(slotPath, "utf8"));
      await fs.writeFile(slotPath, userEdit);

      // Second generation — now with persistence.
      const persistent: ParsedResource = {
        definition: {
          name: "comment",
          fields: {
            id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
            text: { type: "string", required: true },
          },
          options: { persistence: { provider: "postgres" } } as ResourceDefinition["options"],
        },
        filePath: "/virtual/comment.resource.ts",
        fileName: "comment",
        resourceName: "comment",
      };
      const result = await generateResourceArtifacts(persistent, { rootDir, force: false });

      // Slot still preserved.
      const slotAfter = await fs.readFile(slotPath, "utf8");
      expect(slotAfter).toBe(userEdit);
      expect(result.skipped).toContain(slotPath);

      // Repo file emitted.
      const repoPath = path.join(paths.resourceReposDir, "comment.repo.ts");
      expect(result.repoEmitted).toBe(true);
      expect(result.created).toContain(repoPath);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("TC-3: contract regenerates freely (no preservation)", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-tc3-"));
    try {
      const parsed = persistentResource("widget");
      await generateResourceArtifacts(parsed, { rootDir, force: false });
      const paths = resolveGeneratedPaths(rootDir);
      const contractPath = path.join(paths.resourceContractsDir, "widget.contract.ts");
      await fs.writeFile(contractPath, "// CORRUPTED");
      await generateResourceArtifacts(parsed, { rootDir, force: false });
      const content = await fs.readFile(contractPath, "utf8");
      expect(content).not.toBe("// CORRUPTED");
      expect(content).toContain("Mandu.contract");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("TC-4: types regenerates freely (no preservation)", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-tc4-"));
    try {
      const parsed = persistentResource("gadget");
      await generateResourceArtifacts(parsed, { rootDir, force: false });
      const paths = resolveGeneratedPaths(rootDir);
      const typesPath = path.join(paths.resourceTypesDir, "gadget.types.ts");
      await fs.writeFile(typesPath, "// CORRUPTED");
      await generateResourceArtifacts(parsed, { rootDir, force: false });
      const content = await fs.readFile(typesPath, "utf8");
      expect(content).not.toBe("// CORRUPTED");
      expect(content).toContain("InferContract");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("TC-5: repo regenerates freely (derived, no preservation)", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-tc5-"));
    try {
      const parsed = persistentResource("token");
      await generateResourceArtifacts(parsed, { rootDir, force: false });
      const paths = resolveGeneratedPaths(rootDir);
      const repoPath = path.join(paths.resourceReposDir, "token.repo.ts");
      await fs.writeFile(repoPath, "// CORRUPTED");
      await generateResourceArtifacts(parsed, { rootDir, force: false });
      const content = await fs.readFile(repoPath, "utf8");
      expect(content).not.toBe("// CORRUPTED");
      expect(content).toContain("createTokensRepo");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("TC-6: schema snapshot SQL regenerates freely (derived, no preservation)", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-tc6-"));
    try {
      const parsed = persistentResource("ticket");
      await generateResourceArtifacts(parsed, { rootDir, force: false });
      // The app-level schema step is NOT called by per-resource
      // generateResourceArtifacts — verify generateSchemaArtifacts emits
      // the per-resource schema file and that it's overwritable.
      await generateSchemaArtifacts([parsed], { rootDir });
      const paths = resolveGeneratedPaths(rootDir);
      const schemaPath = path.join(paths.resourceSchemaOutDir, "tickets.sql");
      await fs.writeFile(schemaPath, "-- CORRUPTED");
      await generateSchemaArtifacts([parsed], { rootDir });
      const content = await fs.readFile(schemaPath, "utf8");
      expect(content).not.toBe("-- CORRUPTED");
      expect(content).toContain("CREATE TABLE");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("generateRepoSource — emission shape", () => {
  test("emits factory function, row interface, and five CRUD methods", () => {
    const parsed = persistentResource("user");
    const src = generateRepoSource(parsed)!;
    expect(src).toContain("@generated by Mandu");
    expect(src).toContain("export function createUsersRepo(db: Db)");
    expect(src).toContain("export interface User");
    expect(src).toContain("async findById(");
    expect(src).toContain("async findMany(");
    expect(src).toContain("async create(");
    expect(src).toContain("async update(");
    expect(src).toContain("async delete(");
  });

  test("imports Db type from @mandujs/core/db by default", () => {
    const parsed = persistentResource("user");
    const src = generateRepoSource(parsed)!;
    expect(src).toContain(`import type { Db } from "@mandujs/core/db"`);
  });

  test("honors custom dbImport", () => {
    const parsed = persistentResource("user");
    const src = generateRepoSource(parsed, { dbImport: "../../../db/handle" })!;
    expect(src).toContain(`import type { Db } from "../../../db/handle"`);
  });

  test("column names are snake_case in SQL", () => {
    const parsed = persistentResource("user");
    const src = generateRepoSource(parsed)!;
    // passwordHash field → password_hash column
    expect(src).toContain(`"password_hash"`);
    // email → email (no change)
    expect(src).toContain(`"email"`);
    // Camel aliased in SELECT: "password_hash" AS "passwordHash"
    expect(src).toMatch(/"password_hash"\s+AS\s+"passwordHash"/);
  });

  test("non-persistent resource throws by default, null with enable:false", () => {
    const nonPersistent: ParsedResource = {
      definition: { name: "note", fields: { id: { type: "uuid", required: true } } },
      filePath: "/virtual/note.resource.ts",
      fileName: "note",
      resourceName: "note",
    };
    expect(() => generateRepoSource(nonPersistent)).toThrow();
    expect(generateRepoSource(nonPersistent, { enable: false })).toBeNull();
  });

  test("postgres/sqlite emit INSERT ... RETURNING, mysql emits INSERT + primary-key re-select", () => {
    // Assert on SQL in the emitted code rather than on comments —
    // comments reference "RETURNING" as prose across all three providers.
    // The discriminator we check is the actual SQL keyword on an insert
    // statement (`INSERT INTO ... RETURNING`) vs MySQL's `LAST_INSERT_ID()`.
    const pg = generateRepoSource(persistentResource("user", "postgres"))!;
    expect(pg).toMatch(/INSERT INTO[\s\S]*?RETURNING/);

    const sqlite = generateRepoSource(persistentResource("user", "sqlite"))!;
    expect(sqlite).toMatch(/INSERT INTO[\s\S]*?RETURNING/);

    const mysql = generateRepoSource(persistentResource("user", "mysql"))!;
    expect(mysql).not.toMatch(/INSERT INTO[\s\S]*?RETURNING/);
    expect(mysql).toContain("WHERE \\`id\\` = ${input.id}");
    expect(mysql).not.toContain("WHERE \\`id\\` = LAST_INSERT_ID()");
  });

  test("mysql repo escapes backtick identifiers for generated template literals, postgres uses double quotes", () => {
    const mysql = generateRepoSource(persistentResource("user", "mysql"))!;
    expect(mysql).toContain("\\`users\\`");
    expect(mysql).not.toContain(`"users"`);

    const pg = generateRepoSource(persistentResource("user", "postgres"))!;
    expect(pg).toContain(`"users"`);
    expect(pg).not.toContain("\\`users\\`");
  });

  test("create input includes primary key unless the primary key has a DB default", () => {
    const callerSuppliedPk = generateRepoSource(persistentResource("user", "postgres"))!;
    expect(callerSuppliedPk).toContain("async create(input: User)");
    expect(callerSuppliedPk).toContain("${input.id}");
    expect(callerSuppliedPk).not.toContain('async create(input: Omit<User, "id">)');

    const dbGeneratedPk = persistentResource("token", "postgres");
    dbGeneratedPk.definition.fields.id = {
      ...dbGeneratedPk.definition.fields.id,
      default: "gen_random_uuid()",
    };
    const src = generateRepoSource(dbGeneratedPk)!;
    expect(src).toContain('async create(input: Omit<Token, "id">)');
    expect(src).not.toMatch(/INSERT INTO[\s\S]*"id"[\s\S]*VALUES/);
  });

  test("shouldEmitRepo returns true only when persistence is declared", () => {
    const persistent = persistentResource("user");
    const nonPersistent: ParsedResource = {
      definition: { name: "note", fields: { id: { type: "uuid", required: true } } },
      filePath: "/virtual/note.resource.ts",
      fileName: "note",
      resourceName: "note",
    };
    expect(shouldEmitRepo(persistent)).toBe(true);
    expect(shouldEmitRepo(nonPersistent)).toBe(false);
  });

  test("factory name uses table name (pluralized) not singular resource name", () => {
    const parsed = persistentResource("category"); // plural "categories"
    const src = generateRepoSource(parsed)!;
    expect(src).toContain("createCategoriesRepo");
    expect(src).not.toContain("createCategoryRepo");
  });

  test("row interface mirrors field types (string, number, boolean)", () => {
    const parsed: ParsedResource = {
      definition: {
        name: "item",
        fields: {
          id: { type: "uuid", required: true, primary: true } as ResourceDefinition["fields"][string],
          price: { type: "number", required: true },
          inStock: { type: "boolean", required: true },
          deletedAt: { type: "date" },
        },
        options: { persistence: { provider: "postgres" } } as ResourceDefinition["options"],
      },
      filePath: "/virtual/item.resource.ts",
      fileName: "item",
      resourceName: "item",
    };
    const src = generateRepoSource(parsed)!;
    expect(src).toMatch(/id:\s*string;/);
    expect(src).toMatch(/price:\s*number;/);
    expect(src).toMatch(/inStock:\s*boolean;/);
    expect(src).toMatch(/deletedAt\?:\s*string;/); // optional because required: undefined/false
  });
});

describe("generateSchemaArtifacts — diff + migration orchestration", () => {
  test("first run with two persistent resources emits two CREATE TABLE changes", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch1-"));
    try {
      const resources = [
        persistentResource("user"),
        persistentResource("product"),
      ];
      const result = await computeSchemaGeneration(resources, rootDir);
      expect(result.changes.length).toBe(2);
      expect(result.changes.every((c) => c.kind === "create-table")).toBe(true);
      expect(result.migrationFilename).not.toBeNull();
      expect(result.migrationSql).toContain("CREATE TABLE");
      expect(result.migrationSql).not.toMatch(/\bBEGIN\b/i);
      expect(result.migrationSql).not.toMatch(/\bCOMMIT\b/i);
      expect(result.desiredSchema).toContain("CREATE TABLE");
      expect(Object.keys(result.desiredSchemaByTable).sort()).toEqual(["products", "users"]);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("unchanged resources → empty changes, null migration filename", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch2-"));
    try {
      const resources = [persistentResource("user")];
      // Simulate an already-applied snapshot by writing applied.json as
      // Agent C would after `mandu db apply`.
      const first = await computeSchemaGeneration(resources, rootDir);
      const paths = resolveGeneratedPaths(rootDir);
      await fs.mkdir(paths.schemaStateDir, { recursive: true });
      await fs.writeFile(
        path.join(paths.schemaStateDir, "applied.json"),
        JSON.stringify(first.nextSnapshot),
        "utf8",
      );

      // Second compute with identical resources → zero changes.
      const second = await computeSchemaGeneration(resources, rootDir);
      expect(second.changes.length).toBe(0);
      expect(second.migrationFilename).toBeNull();
      expect(second.migrationSql).toBe("");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("adding a field produces add-column change with ALTER TABLE SQL", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch3-"));
    try {
      const original = [persistentResource("user")];
      const first = await computeSchemaGeneration(original, rootDir);
      const paths = resolveGeneratedPaths(rootDir);
      await fs.mkdir(paths.schemaStateDir, { recursive: true });
      await fs.writeFile(
        path.join(paths.schemaStateDir, "applied.json"),
        JSON.stringify(first.nextSnapshot),
        "utf8",
      );

      const extended = [
        persistentResource("user", "postgres", {
          age: { type: "number", required: false },
        }),
      ];
      const second = await computeSchemaGeneration(extended, rootDir);
      expect(second.changes.length).toBe(1);
      expect(second.changes[0]?.kind).toBe("add-column");
      expect(second.migrationSql).toContain("ALTER TABLE");
      expect(second.migrationSql).toContain("ADD COLUMN");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("writeSchemaArtifacts assigns NNNN+1 starting from 0001 on first run", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch4-"));
    try {
      const resources = [persistentResource("user")];
      const result = await generateSchemaArtifacts(resources, { rootDir });
      expect(result.write).not.toBeNull();
      expect(result.write!.migrationVersion).toBe("0001");
      expect(result.write!.migrationFilePath).toMatch(/0001_auto_[^/\\]+\.sql$/);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("writeSchemaArtifacts never overwrites existing numbered migrations", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch5-"));
    try {
      const paths = resolveGeneratedPaths(rootDir);
      // Pre-existing user-authored migration.
      await fs.mkdir(paths.migrationsDir, { recursive: true });
      const existingPath = path.join(paths.migrationsDir, "0001_user_init.sql");
      const userSql = "-- user-authored\nCREATE TABLE manual_bootstrap (id INTEGER PRIMARY KEY);";
      await fs.writeFile(existingPath, userSql);

      const resources = [persistentResource("user")];
      const result = await generateSchemaArtifacts(resources, { rootDir });

      // Assigned version must be 0002 (next after 0001).
      expect(result.write!.migrationVersion).toBe("0002");
      // Existing file untouched.
      const stillThere = await fs.readFile(existingPath, "utf8");
      expect(stillThere).toBe(userSql);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("applied.json is NEVER modified by generateSchemaArtifacts (Agent C owns it)", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch6-"));
    try {
      const resources = [persistentResource("user")];
      const paths = resolveGeneratedPaths(rootDir);

      // Write an intentionally-stale applied.json so we can verify it
      // doesn't get touched.
      await fs.mkdir(paths.schemaStateDir, { recursive: true });
      const appliedPath = path.join(paths.schemaStateDir, "applied.json");
      const stalePayload = JSON.stringify({
        version: 1,
        provider: "postgres",
        resources: [],
        generatedAt: "2000-01-01T00:00:00.000Z",
      });
      await fs.writeFile(appliedPath, stalePayload);
      const statBefore = await fs.stat(appliedPath);

      await generateSchemaArtifacts(resources, { rootDir });

      const statAfter = await fs.stat(appliedPath);
      const contentAfter = await fs.readFile(appliedPath, "utf8");
      // Content identical.
      expect(contentAfter).toBe(stalePayload);
      // mtime unchanged (within a generous tolerance for fs precision).
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("dryRun: true skips all file writes but returns the diff", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch7-"));
    try {
      const resources = [persistentResource("user")];
      const result = await generateSchemaArtifacts(resources, { rootDir, dryRun: true });
      expect(result.write).toBeNull();
      expect(result.generation.changes.length).toBe(1);
      // Verify no files written.
      const paths = resolveGeneratedPaths(rootDir);
      await expect(fs.access(paths.resourceSchemaOutDir)).rejects.toBeDefined();
      await expect(fs.access(paths.migrationsDir)).rejects.toBeDefined();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("writeSchemaArtifacts writes per-resource *.sql files with CREATE TABLE", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch8-"));
    try {
      const resources = [persistentResource("user"), persistentResource("product")];
      const result = await generateSchemaArtifacts(resources, { rootDir });
      expect(result.write!.schemaFilesWritten).toBe(2);
      const paths = resolveGeneratedPaths(rootDir);
      const userSql = await fs.readFile(
        path.join(paths.resourceSchemaOutDir, "users.sql"),
        "utf8",
      );
      const productSql = await fs.readFile(
        path.join(paths.resourceSchemaOutDir, "products.sql"),
        "utf8",
      );
      expect(userSql).toContain("CREATE TABLE");
      expect(userSql).toContain(`"users"`);
      expect(productSql).toContain("CREATE TABLE");
      expect(productSql).toContain(`"products"`);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("running twice with identical resources produces no duplicate migrations", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch9-"));
    try {
      const resources = [persistentResource("user")];
      const first = await generateSchemaArtifacts(resources, { rootDir });
      expect(first.write!.migrationVersion).toBe("0001");

      // Simulate Agent C applying the migration by writing applied.json.
      const paths = resolveGeneratedPaths(rootDir);
      await fs.mkdir(paths.schemaStateDir, { recursive: true });
      await fs.writeFile(
        path.join(paths.schemaStateDir, "applied.json"),
        JSON.stringify(first.generation.nextSnapshot),
      );

      // Second run — identical input → no new migration, no duplicate file.
      const second = await generateSchemaArtifacts(resources, { rootDir });
      expect(second.write!.migrationVersion).toBeNull();
      expect(second.write!.migrationFilePath).toBeNull();

      // Only one migration file on disk.
      const files = await fs.readdir(paths.migrationsDir);
      const migrationFiles = files.filter((f) => /^\d{4,}_.*\.sql$/.test(f));
      expect(migrationFiles.length).toBe(1);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("resources without persistence are silently dropped from snapshot", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-sch10-"));
    try {
      const resources: ParsedResource[] = [
        persistentResource("user"),
        {
          definition: {
            name: "article",
            fields: { id: { type: "uuid", required: true }, body: { type: "string", required: true } },
          },
          filePath: "/virtual/article.resource.ts",
          fileName: "article",
          resourceName: "article",
        },
      ];
      const result = await computeSchemaGeneration(resources, rootDir);
      // Only `user` made it into the snapshot.
      expect(result.nextSnapshot.resources.length).toBe(1);
      expect(result.nextSnapshot.resources[0]?.name).toBe("users");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("generateResourceArtifacts — Phase 4c repo integration", () => {
  test("repoEmitted flag true when persistence declared", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-repo-int-"));
    try {
      const parsed = persistentResource("session");
      const result = await generateResourceArtifacts(parsed, { rootDir, force: false });
      expect(result.repoEmitted).toBe(true);
      const paths = resolveGeneratedPaths(rootDir);
      const repoPath = path.join(paths.resourceReposDir, "session.repo.ts");
      await fs.access(repoPath);
      const content = await fs.readFile(repoPath, "utf8");
      expect(content).toContain("createSessionsRepo");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  test("only: ['repo'] regenerates repo without touching other artifacts", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-only-repo-"));
    try {
      const parsed = persistentResource("profile");
      await generateResourceArtifacts(parsed, { rootDir, force: false });
      const paths = resolveGeneratedPaths(rootDir);

      const contractPath = path.join(paths.resourceContractsDir, "profile.contract.ts");
      const beforeStat = await fs.stat(contractPath);
      // Wait >1ms so mtime granularity doesn't collide on fast filesystems.
      await new Promise((r) => setTimeout(r, 20));
      const result = await generateResourceArtifacts(parsed, {
        rootDir,
        force: false,
        only: ["repo"],
      });
      expect(result.repoEmitted).toBe(true);

      const repoPath = path.join(paths.resourceReposDir, "profile.repo.ts");
      expect(result.created).toContain(repoPath);
      // Contract not regenerated because `only` excluded it.
      const afterStat = await fs.stat(contractPath);
      expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
