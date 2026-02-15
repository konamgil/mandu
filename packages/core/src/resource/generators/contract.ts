/**
 * Resource Contract Generator
 * Generate Zod contract from resource definition
 */

import type { ResourceDefinition, ResourceField } from "../schema";
import { getPluralName, getEnabledEndpoints } from "../schema";

/**
 * Generate contract file for resource
 *
 * @returns Contract file content
 */
export function generateResourceContract(definition: ResourceDefinition): string {
  const resourceName = definition.name;
  const pascalName = toPascalCase(resourceName);
  const pluralName = getPluralName(definition);
  const endpoints = getEnabledEndpoints(definition);

  // Generate schema definitions
  const schemaDefinitions = generateSchemaDefinitions(definition);

  // Generate request schemas
  const requestSchemas = generateRequestSchemas(definition, endpoints);

  // Generate response schemas
  const responseSchemas = generateResponseSchemas(definition, pascalName);

  return `// 📜 Mandu Resource Contract - ${resourceName}
// Auto-generated from resource definition
// DO NOT EDIT - Regenerated on every \`mandu generate\`

import { z } from "zod";
import { Mandu } from "@mandujs/core";

// ============================================
// 🥟 Schema Definitions
// ============================================

${schemaDefinitions}

// ============================================
// 📜 Contract Definition
// ============================================

export default Mandu.contract({
  description: "${definition.options?.description || `${pascalName} API`}",
  tags: ${JSON.stringify(definition.options?.tags || [resourceName])},

  request: {
${requestSchemas}
  },

  response: {
${responseSchemas}
  },
});
`;
}

/**
 * Generate schema definitions for fields
 */
function generateSchemaDefinitions(definition: ResourceDefinition): string {
  const pascalName = toPascalCase(definition.name);
  const fields = Object.entries(definition.fields);

  // Generate individual field schemas
  const fieldSchemas = fields.map(([name, field]) => {
    const zodSchema = generateZodSchema(name, field);
    return `  ${name}: ${zodSchema},`;
  });

  return `/**
 * ${pascalName} Schema
 */
const ${pascalName}Schema = z.object({
${fieldSchemas.join("\n")}
});

/**
 * ${pascalName} Create Schema (exclude id, createdAt, updatedAt)
 */
const ${pascalName}CreateSchema = ${pascalName}Schema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * ${pascalName} Update Schema (all fields optional except id)
 */
const ${pascalName}UpdateSchema = ${pascalName}Schema.partial().required({ id: true });`;
}

/**
 * Generate Zod schema for a field
 */
function generateZodSchema(fieldName: string, field: ResourceField): string {
  // Use custom schema if provided
  if (field.schema) {
    return "z.unknown() /* Custom schema */";
  }

  let schema: string;

  switch (field.type) {
    case "string":
      schema = "z.string()";
      break;
    case "number":
      schema = "z.number()";
      break;
    case "boolean":
      schema = "z.boolean()";
      break;
    case "date":
      schema = "z.string().datetime()";
      break;
    case "uuid":
      schema = "z.string().uuid()";
      break;
    case "email":
      schema = "z.string().email()";
      break;
    case "url":
      schema = "z.string().url()";
      break;
    case "json":
      schema = "z.record(z.unknown())";
      break;
    case "array":
      const itemType = field.items || "unknown";
      schema = `z.array(${generateZodTypeFromFieldType(itemType)})`;
      break;
    case "object":
      schema = "z.record(z.unknown())";
      break;
    default:
      schema = "z.unknown()";
  }

  // Add optional/required
  if (!field.required) {
    schema += ".optional()";
  }

  // Add default
  if (field.default !== undefined) {
    const defaultValue = JSON.stringify(field.default);
    schema += `.default(${defaultValue})`;
  }

  // Add description
  if (field.description) {
    schema += `.describe("${field.description}")`;
  }

  return schema;
}

/**
 * Generate Zod type from FieldType
 */
function generateZodTypeFromFieldType(type: string): string {
  switch (type) {
    case "string":
      return "z.string()";
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "date":
      return "z.string().datetime()";
    case "uuid":
      return "z.string().uuid()";
    case "email":
      return "z.string().email()";
    case "url":
      return "z.string().url()";
    default:
      return "z.unknown()";
  }
}

/**
 * Generate request schemas based on enabled endpoints
 */
function generateRequestSchemas(definition: ResourceDefinition, endpoints: string[]): string {
  const pascalName = toPascalCase(definition.name);
  const schemas: string[] = [];

  if (endpoints.includes("list")) {
    const defaultLimit = definition.options?.pagination?.defaultLimit || 10;
    const maxLimit = definition.options?.pagination?.maxLimit || 100;

    schemas.push(`    GET: {
      query: z.object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(${maxLimit}).default(${defaultLimit}),
      }),
    }`);
  }

  if (endpoints.includes("create")) {
    schemas.push(`    POST: {
      body: ${pascalName}CreateSchema,
    }`);
  }

  if (endpoints.includes("update")) {
    schemas.push(`    PUT: {
      body: ${pascalName}UpdateSchema,
    }`);
  }

  if (endpoints.includes("delete")) {
    schemas.push(`    DELETE: {
      // No body for DELETE
    }`);
  }

  return schemas.join(",\n\n");
}

/**
 * Generate response schemas
 */
function generateResponseSchemas(definition: ResourceDefinition, pascalName: string): string {
  return `    200: z.object({
      data: z.union([${pascalName}Schema, z.array(${pascalName}Schema)]),
      pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
      }).optional(),
    }),
    201: z.object({
      data: ${pascalName}Schema,
    }),
    400: z.object({
      error: z.string(),
      details: z.array(z.object({
        type: z.string(),
        issues: z.array(z.object({
          path: z.string(),
          message: z.string(),
        })),
      })).optional(),
    }),
    404: z.object({
      error: z.string(),
    })`;
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
