/**
 * Resource Schema Parser
 * Parse and validate resource schema files
 */

import type { ResourceDefinition } from "./schema";
import { validateResourceDefinition } from "./schema";
import path from "path";

// ============================================
// Parser Result
// ============================================

export interface ParsedResource {
  /** 원본 정의 */
  definition: ResourceDefinition;
  /** 파일 경로 */
  filePath: string;
  /** 파일명 (확장자 제외) */
  fileName: string;
  /** 리소스 이름 */
  resourceName: string;
}

// ============================================
// Parse Resource Schema
// ============================================

/**
 * Parse resource schema from file
 *
 * @param filePath - Absolute path to resource schema file
 * @returns Parsed resource with metadata
 *
 * @example
 * ```typescript
 * const parsed = await parseResourceSchema("/path/to/spec/resources/user.resource.ts");
 * console.log(parsed.resourceName); // "user"
 * console.log(parsed.definition.fields); // { id: {...}, email: {...}, ... }
 * ```
 */
export async function parseResourceSchema(filePath: string): Promise<ParsedResource> {
  // Validate file path
  if (!filePath.endsWith(".resource.ts")) {
    throw new Error(
      `Invalid resource schema file: "${filePath}". Must end with ".resource.ts"`
    );
  }

  // Extract file name
  const fileName = path.basename(filePath, ".resource.ts");

  // Import the resource definition
  let definition: ResourceDefinition;
  try {
    const module = await import(filePath);
    definition = module.default;

    if (!definition) {
      throw new Error(
        `Resource schema file "${filePath}" must export a default ResourceDefinition`
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to import resource schema "${filePath}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Validate definition
  try {
    validateResourceDefinition(definition);
  } catch (error) {
    throw new Error(
      `Invalid resource schema in "${filePath}": ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return {
    definition,
    filePath,
    fileName,
    resourceName: definition.name,
  };
}

/**
 * Parse multiple resource schemas
 *
 * @param filePaths - Array of absolute paths to resource schema files
 * @returns Array of parsed resources
 */
export async function parseResourceSchemas(filePaths: string[]): Promise<ParsedResource[]> {
  const results = await Promise.allSettled(filePaths.map(parseResourceSchema));

  const errors: string[] = [];
  const parsed: ParsedResource[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      parsed.push(result.value);
    } else {
      errors.push(`${filePaths[i]}: ${result.reason}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to parse resource schemas:\n${errors.join("\n")}`);
  }

  return parsed;
}

/**
 * Validate resource name uniqueness
 */
export function validateResourceUniqueness(resources: ParsedResource[]): void {
  const names = new Set<string>();
  const duplicates: string[] = [];

  for (const resource of resources) {
    const name = resource.resourceName;
    if (names.has(name)) {
      duplicates.push(name);
    }
    names.add(name);
  }

  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate resource names found: ${duplicates.join(", ")}. Resource names must be unique.`
    );
  }
}
