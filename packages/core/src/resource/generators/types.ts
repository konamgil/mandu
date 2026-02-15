/**
 * Resource TypeScript Types Generator
 * Generate TypeScript type definitions from resource
 */

import type { ResourceDefinition } from "../schema";

/**
 * Generate TypeScript types for resource
 *
 * @returns Types file content
 */
export function generateResourceTypes(definition: ResourceDefinition): string {
  const pascalName = toPascalCase(definition.name);
  const contractPath = `../contracts/${definition.name}.contract`;

  return `// 🎯 Mandu Resource Types - ${definition.name}
// Auto-generated from resource definition
// DO NOT EDIT - Regenerated on every \`mandu generate\`

import type { InferContract, InferQuery, InferBody, InferParams, InferResponse } from "@mandujs/core";
import contract from "${contractPath}";

/**
 * Full contract type for ${definition.name}
 */
export type ${pascalName}Contract = InferContract<typeof contract>;

// ============================================
// Request Types
// ============================================

/** GET query parameters */
export type ${pascalName}GetQuery = InferQuery<typeof contract, "GET">;

/** POST request body */
export type ${pascalName}PostBody = InferBody<typeof contract, "POST">;

/** PUT request body */
export type ${pascalName}PutBody = InferBody<typeof contract, "PUT">;

/** PATCH request body */
export type ${pascalName}PatchBody = InferBody<typeof contract, "PATCH">;

/** DELETE query parameters */
export type ${pascalName}DeleteQuery = InferQuery<typeof contract, "DELETE">;

/** Path parameters (if any) */
export type ${pascalName}Params = InferParams<typeof contract, "GET">;

// ============================================
// Response Types
// ============================================

/** 200 OK response */
export type ${pascalName}Response200 = InferResponse<typeof contract, 200>;

/** 201 Created response */
export type ${pascalName}Response201 = InferResponse<typeof contract, 201>;

/** 204 No Content response */
export type ${pascalName}Response204 = InferResponse<typeof contract, 204>;

/** 400 Bad Request response */
export type ${pascalName}Response400 = InferResponse<typeof contract, 400>;

/** 404 Not Found response */
export type ${pascalName}Response404 = InferResponse<typeof contract, 404>;

// Re-export contract for runtime use
export { contract };
`;
}

/**
 * Convert string to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
