/**
 * Resource Performance Tests
 *
 * QA Engineer: Performance benchmarks for resource generation
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { generateResourceArtifacts } from "../generator";
import type { ParsedResource } from "../parser";
import path from "path";
import fs from "fs/promises";
import os from "os";

// Test utilities
let testDir: string;

beforeAll(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-perf-test-"));
});

afterAll(async () => {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup errors
  }
});

/**
 * Create a test parsed resource
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
 * Measure execution time
 */
async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

describe("Performance - Resource Generation", () => {
  test("should generate single resource in < 500ms", async () => {
    const parsed = createTestParsedResource("user", {
      name: "user",
      fields: {
        id: { type: "uuid", required: true },
        email: { type: "email", required: true },
        name: { type: "string", required: true },
        createdAt: { type: "date", required: true },
      },
    });

    const { result, duration } = await measureTime(() =>
      generateResourceArtifacts(parsed, { rootDir: testDir, force: false })
    );

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(500);
    console.log(`  ⚡ Single resource generation: ${duration.toFixed(2)}ms`);
  });

  test("should handle resource with 50 fields in < 1000ms", async () => {
    const fields: Record<string, any> = {};
    for (let i = 0; i < 50; i++) {
      fields[`field${i}`] = {
        type: i % 5 === 0 ? "number" : "string",
        required: i % 2 === 0,
        default: i % 3 === 0 ? `value${i}` : undefined,
      };
    }

    const parsed = createTestParsedResource("largescale", {
      name: "largescale",
      fields,
      options: {
        description: "Resource with 50 fields",
        tags: Array.from({ length: 10 }, (_, i) => `tag${i}`),
      },
    });

    const { result, duration } = await measureTime(() =>
      generateResourceArtifacts(parsed, { rootDir: testDir, force: false })
    );

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(1000);
    console.log(`  ⚡ 50-field resource generation: ${duration.toFixed(2)}ms`);
  });

  test("should generate 10 resources sequentially in < 3000ms", async () => {
    const resources: ParsedResource[] = [];
    for (let i = 0; i < 10; i++) {
      resources.push(
        createTestParsedResource(`resource${i}`, {
          name: `resource${i}`,
          fields: {
            id: { type: "uuid", required: true },
            name: { type: "string", required: true },
            count: { type: "number", required: false, default: 0 },
            isActive: { type: "boolean", required: false, default: true },
          },
        })
      );
    }

    const { duration } = await measureTime(async () => {
      for (const parsed of resources) {
        await generateResourceArtifacts(parsed, { rootDir: testDir, force: false });
      }
    });

    expect(duration).toBeLessThan(3000);
    console.log(`  ⚡ 10 resources sequential: ${duration.toFixed(2)}ms`);
  });

  test("should regenerate existing resource (with slot preservation) in < 200ms", async () => {
    const parsed = createTestParsedResource("existingresource", {
      name: "existingresource",
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
      },
    });

    // First generation
    await generateResourceArtifacts(parsed, { rootDir: testDir, force: false });

    // Second generation (with slot preservation)
    const { result, duration } = await measureTime(() =>
      generateResourceArtifacts(parsed, { rootDir: testDir, force: false })
    );

    expect(result.success).toBe(true);
    expect(duration).toBeLessThan(200);
    console.log(`  ⚡ Regeneration with slot preservation: ${duration.toFixed(2)}ms`);
  });
});

describe("Performance - Schema Validation", () => {
  test("should validate simple schema in < 10ms", async () => {
    const { validateResourceDefinition } = await import("../schema");

    const definition = {
      name: "simple",
      fields: {
        id: { type: "uuid" as const, required: true },
        name: { type: "string" as const, required: true },
      },
    };

    const { duration } = await measureTime(async () => {
      validateResourceDefinition(definition);
    });

    expect(duration).toBeLessThan(10);
    console.log(`  ⚡ Simple schema validation: ${duration.toFixed(2)}ms`);
  });

  test("should validate complex schema (50 fields) in < 50ms", async () => {
    const { validateResourceDefinition } = await import("../schema");

    const fields: Record<string, any> = {};
    for (let i = 0; i < 50; i++) {
      fields[`field${i}`] = {
        type: (["string", "number", "boolean", "date", "email"] as const)[i % 5],
        required: i % 2 === 0,
      };
    }

    const definition = {
      name: "complex",
      fields,
      options: {
        description: "Complex schema with 50 fields",
        tags: Array.from({ length: 20 }, (_, i) => `tag${i}`),
      },
    };

    const { duration } = await measureTime(async () => {
      validateResourceDefinition(definition);
    });

    expect(duration).toBeLessThan(50);
    console.log(`  ⚡ Complex schema (50 fields) validation: ${duration.toFixed(2)}ms`);
  });
});

describe("Performance - Memory Usage", () => {
  test("should handle 20 resources without memory issues", async () => {
    const initialMemory = process.memoryUsage().heapUsed;

    for (let i = 0; i < 20; i++) {
      const parsed = createTestParsedResource(`memtest${i}`, {
        name: `memtest${i}`,
        fields: {
          id: { type: "uuid", required: true },
          name: { type: "string", required: true },
          description: { type: "string", required: false },
          count: { type: "number", default: 0 },
          tags: { type: "array", items: "string", default: [] },
          metadata: { type: "object", default: {} },
        },
      });

      await generateResourceArtifacts(parsed, { rootDir: testDir, force: false });
    }

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

    console.log(`  💾 Memory increase for 20 resources: ${memoryIncrease.toFixed(2)}MB`);

    // Expect reasonable memory usage (< 50MB for 20 resources)
    expect(memoryIncrease).toBeLessThan(50);
  });
});

describe("Performance - File I/O", () => {
  test("should handle rapid file writes efficiently", async () => {
    const parsed = createTestParsedResource("iotest", {
      name: "iotest",
      fields: {
        id: { type: "uuid", required: true },
        data: { type: "string", required: true },
      },
    });

    // Generate 5 times in rapid succession
    const { duration } = await measureTime(async () => {
      for (let i = 0; i < 5; i++) {
        await generateResourceArtifacts(parsed, { rootDir: testDir, force: true });
      }
    });

    expect(duration).toBeLessThan(2000);
    console.log(`  ⚡ 5 rapid regenerations (--force): ${duration.toFixed(2)}ms`);
  });
});

describe("Performance - Comparison Benchmarks", () => {
  test("benchmark: minimal vs medium vs large resource", async () => {
    // Minimal resource
    const minimal = createTestParsedResource("minimal", {
      name: "minimal",
      fields: {
        id: { type: "uuid", required: true },
      },
    });

    const { duration: minimalTime } = await measureTime(() =>
      generateResourceArtifacts(minimal, { rootDir: testDir, force: false })
    );

    // Medium resource
    const medium = createTestParsedResource("medium", {
      name: "medium",
      fields: {
        id: { type: "uuid", required: true },
        name: { type: "string", required: true },
        email: { type: "email", required: true },
        age: { type: "number", required: false },
        isActive: { type: "boolean", default: true },
        tags: { type: "array", items: "string", default: [] },
        metadata: { type: "object", default: {} },
      },
    });

    const { duration: mediumTime } = await measureTime(() =>
      generateResourceArtifacts(medium, { rootDir: testDir, force: false })
    );

    // Large resource
    const largeFields: Record<string, any> = {};
    for (let i = 0; i < 30; i++) {
      largeFields[`field${i}`] = {
        type: (["string", "number", "boolean"] as const)[i % 3],
        required: i % 2 === 0,
      };
    }

    const large = createTestParsedResource("large", {
      name: "large",
      fields: largeFields,
    });

    const { duration: largeTime } = await measureTime(() =>
      generateResourceArtifacts(large, { rootDir: testDir, force: false })
    );

    console.log(`\n  📊 Benchmark Results:`);
    console.log(`    Minimal (1 field):  ${minimalTime.toFixed(2)}ms`);
    console.log(`    Medium (7 fields):  ${mediumTime.toFixed(2)}ms`);
    console.log(`    Large (30 fields):  ${largeTime.toFixed(2)}ms`);
    console.log(
      `    Scaling factor:     ${(largeTime / minimalTime).toFixed(2)}x (30x fields)`
    );

    // Ensure reasonable scaling (should not be exponential)
    expect(largeTime / minimalTime).toBeLessThan(10);
  });
});
