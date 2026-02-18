/**
 * Mandu OpenAPI Generator
 * Contract에서 OpenAPI 3.0 스펙 자동 생성
 */

import type { z } from "zod";
import type { RoutesManifest, RouteSpec } from "../spec/schema";
import type {
  ContractSchema,
  MethodRequestSchema,
  ResponseSchemaWithExamples,
  SchemaExamples,
} from "../contract/schema";
import path from "path";
import {
  getZodTypeName,
  getZodInnerType,
  getZodArrayElementType,
  getZodEffectsSchema,
  getZodObjectShape,
  getZodChecks,
  getZodEnumValues,
  getZodUnionOptions,
  getZodLiteralValue,
  getZodDefaultValue,
  isZodRequired,
} from "../contract/zod-utils";

// ============================================
// OpenAPI Types
// ============================================

export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface OpenAPIParameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema: OpenAPISchema;
}

export interface OpenAPIExample {
  summary?: string;
  description?: string;
  value: unknown;
}

export interface OpenAPIRequestBody {
  required?: boolean;
  description?: string;
  content: {
    [mediaType: string]: {
      schema: OpenAPISchema;
      examples?: Record<string, OpenAPIExample>;
    };
  };
}

export interface OpenAPIResponse {
  description: string;
  content?: {
    [mediaType: string]: {
      schema: OpenAPISchema;
      examples?: Record<string, OpenAPIExample>;
    };
  };
}

export interface OpenAPIOperation {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: OpenAPIRequestBody;
  responses: {
    [statusCode: string]: OpenAPIResponse;
  };
}

export interface OpenAPIPathItem {
  get?: OpenAPIOperation;
  post?: OpenAPIOperation;
  put?: OpenAPIOperation;
  patch?: OpenAPIOperation;
  delete?: OpenAPIOperation;
}

export interface OpenAPISchema {
  type?: string;
  format?: string;
  description?: string;
  properties?: Record<string, OpenAPISchema>;
  items?: OpenAPISchema;
  required?: string[];
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  nullable?: boolean;
  oneOf?: OpenAPISchema[];
  anyOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
  $ref?: string;
}

export interface OpenAPIDocument {
  openapi: "3.0.3";
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
  paths: Record<string, OpenAPIPathItem>;
  components?: {
    schemas?: Record<string, OpenAPISchema>;
  };
  tags?: Array<{ name: string; description?: string }>;
}

// ============================================
// Zod to OpenAPI Conversion
// ============================================

/**
 * Convert Zod schema to OpenAPI schema
 * Note: This is a simplified conversion. For production,
 * consider using zod-to-openapi or similar library.
 */
export function zodToOpenAPISchema(zodSchema: z.ZodTypeAny): OpenAPISchema {
  const typeName = getZodTypeName(zodSchema);

  // Handle ZodOptional
  if (typeName === "ZodOptional") {
    const inner = getZodInnerType(zodSchema);
    const innerSchema = inner ? zodToOpenAPISchema(inner) : {};
    return { ...innerSchema, nullable: true };
  }

  // Handle ZodDefault
  if (typeName === "ZodDefault") {
    const inner = getZodInnerType(zodSchema);
    const innerSchema = inner ? zodToOpenAPISchema(inner) : {};
    return { ...innerSchema, default: getZodDefaultValue(zodSchema) };
  }

  // Handle ZodNullable
  if (typeName === "ZodNullable") {
    const inner = getZodInnerType(zodSchema);
    const innerSchema = inner ? zodToOpenAPISchema(inner) : {};
    return { ...innerSchema, nullable: true };
  }

  // Handle ZodEffects (coerce, transform, etc.)
  if (typeName === "ZodEffects") {
    const effectsSchema = getZodEffectsSchema(zodSchema);
    return effectsSchema ? zodToOpenAPISchema(effectsSchema) : {};
  }

  // Handle ZodString
  if (typeName === "ZodString") {
    const schema: OpenAPISchema = { type: "string" };
    for (const check of getZodChecks(zodSchema)) {
      if (check.kind === "email") schema.format = "email";
      if (check.kind === "uuid") schema.format = "uuid";
      if (check.kind === "url") schema.format = "uri";
      if (check.kind === "datetime") schema.format = "date-time";
      if (check.kind === "min") schema.minLength = check.value;
      if (check.kind === "max") schema.maxLength = check.value;
      if (check.kind === "regex") schema.pattern = check.regex?.source;
    }
    return schema;
  }

  // Handle ZodNumber
  if (typeName === "ZodNumber") {
    const schema: OpenAPISchema = { type: "number" };
    for (const check of getZodChecks(zodSchema)) {
      if (check.kind === "int") schema.type = "integer";
      if (check.kind === "min") schema.minimum = check.value;
      if (check.kind === "max") schema.maximum = check.value;
    }
    return schema;
  }

  // Handle ZodBoolean
  if (typeName === "ZodBoolean") {
    return { type: "boolean" };
  }

  // Handle ZodArray
  if (typeName === "ZodArray") {
    const elementType = getZodArrayElementType(zodSchema);
    return {
      type: "array",
      items: elementType ? zodToOpenAPISchema(elementType) : {},
    };
  }

  // Handle ZodObject
  if (typeName === "ZodObject") {
    const properties: Record<string, OpenAPISchema> = {};
    const required: string[] = [];

    const shape = getZodObjectShape(zodSchema) ?? {};
    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToOpenAPISchema(value);

      // Check if field is required
      if (isZodRequired(value)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  // Handle ZodEnum
  if (typeName === "ZodEnum") {
    return {
      type: "string",
      enum: getZodEnumValues(zodSchema) as unknown[],
    };
  }

  // Handle ZodUnion
  if (typeName === "ZodUnion") {
    const options = getZodUnionOptions(zodSchema) ?? [];
    return {
      oneOf: options.map((opt) => zodToOpenAPISchema(opt)),
    };
  }

  // Handle ZodLiteral
  if (typeName === "ZodLiteral") {
    const value = getZodLiteralValue(zodSchema);
    return {
      type: typeof value as string,
      enum: [value],
    };
  }

  // Handle ZodVoid/ZodUndefined (no content)
  if (typeName === "ZodVoid" || typeName === "ZodUndefined") {
    return {};
  }

  // Handle ZodAny/ZodUnknown
  if (typeName === "ZodAny" || typeName === "ZodUnknown") {
    return {};
  }

  // Fallback
  return {};
}

// ============================================
// Helpers
// ============================================

/**
 * Convert SchemaExamples to OpenAPI examples format
 */
function convertExamples(examples: SchemaExamples): Record<string, OpenAPIExample> {
  const result: Record<string, OpenAPIExample> = {};
  for (const [name, value] of Object.entries(examples)) {
    result[name] = { value };
  }
  return result;
}

/**
 * Check if response schema has examples (ResponseSchemaWithExamples type)
 */
function isResponseSchemaWithExamples(
  schema: z.ZodTypeAny | ResponseSchemaWithExamples | undefined
): schema is ResponseSchemaWithExamples {
  return (
    schema !== undefined &&
    typeof schema === "object" &&
    "schema" in schema
  );
}

// ============================================
// OpenAPI Generation
// ============================================

/**
 * Get HTTP status description
 */
function getStatusDescription(status: number): string {
  const descriptions: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
  };
  return descriptions[status] || "Response";
}

/**
 * Generate OpenAPI parameters from method request schema
 */
function generateParameters(
  methodSchema: MethodRequestSchema,
  routePattern: string
): OpenAPIParameter[] {
  const parameters: OpenAPIParameter[] = [];

  // Extract path parameters from pattern
  const pathParamMatches = routePattern.matchAll(/:(\w+)/g);
  for (const match of pathParamMatches) {
    parameters.push({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }

  // Query parameters
  if (methodSchema.query) {
    const querySchema = zodToOpenAPISchema(methodSchema.query);
    if (querySchema.properties) {
      for (const [name, schema] of Object.entries(querySchema.properties)) {
        parameters.push({
          name,
          in: "query",
          required: querySchema.required?.includes(name) ?? false,
          schema: schema as OpenAPISchema,
        });
      }
    }
  }

  // Header parameters
  if (methodSchema.headers) {
    const headerSchema = zodToOpenAPISchema(methodSchema.headers);
    if (headerSchema.properties) {
      for (const [name, schema] of Object.entries(headerSchema.properties)) {
        parameters.push({
          name,
          in: "header",
          required: headerSchema.required?.includes(name) ?? false,
          schema: schema as OpenAPISchema,
        });
      }
    }
  }

  return parameters;
}

/**
 * Generate OpenAPI operation for a method
 */
function generateOperation(
  route: RouteSpec,
  method: string,
  contract: ContractSchema
): OpenAPIOperation {
  const methodSchema = contract.request[method] as MethodRequestSchema | undefined;
  const operation: OpenAPIOperation = {
    summary: contract.description,
    operationId: `${route.id}_${method.toLowerCase()}`,
    tags: contract.tags || [route.id],
    responses: {},
  };

  // Parameters
  if (methodSchema) {
    const params = generateParameters(methodSchema, route.pattern);
    if (params.length > 0) {
      operation.parameters = params;
    }

    // Request body
    if (methodSchema.body) {
      const requestBodyContent: OpenAPIRequestBody["content"]["application/json"] = {
        schema: zodToOpenAPISchema(methodSchema.body),
      };

      // Add examples if provided
      if (methodSchema.examples) {
        requestBodyContent.examples = convertExamples(methodSchema.examples);
      }

      operation.requestBody = {
        required: true,
        content: {
          "application/json": requestBodyContent,
        },
      };
    }
  }

  // Responses
  for (const [statusCode, responseSchemaOrWithExamples] of Object.entries(contract.response)) {
    const status = parseInt(statusCode, 10);
    if (isNaN(status)) continue;

    // Handle ResponseSchemaWithExamples or plain ZodTypeAny
    let zodSchema: z.ZodTypeAny;
    let examples: SchemaExamples | undefined;

    if (isResponseSchemaWithExamples(responseSchemaOrWithExamples)) {
      zodSchema = responseSchemaOrWithExamples.schema;
      examples = responseSchemaOrWithExamples.examples;
    } else {
      zodSchema = responseSchemaOrWithExamples as z.ZodTypeAny;
    }

    const schema = zodToOpenAPISchema(zodSchema);
    const hasContent = Object.keys(schema).length > 0;

    const responseContent: OpenAPIResponse["content"] = hasContent
      ? {
          "application/json": {
            schema,
            ...(examples && { examples: convertExamples(examples) }),
          },
        }
      : undefined;

    operation.responses[statusCode] = {
      description: getStatusDescription(status),
      ...(responseContent && { content: responseContent }),
    };
  }

  // Default 500 response if not defined
  if (!operation.responses["500"]) {
    operation.responses["500"] = {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    };
  }

  return operation;
}

/**
 * Load contract from file
 */
async function loadContract(contractPath: string, rootDir: string): Promise<ContractSchema | null> {
  try {
    const fullPath = path.join(rootDir, contractPath);
    const module = await import(fullPath);
    return module.default;
  } catch (error) {
    console.warn(`Failed to load contract: ${contractPath}`, error);
    return null;
  }
}

/**
 * Generate OpenAPI document from manifest and contracts
 */
export async function generateOpenAPIDocument(
  manifest: RoutesManifest,
  rootDir: string,
  options: {
    title?: string;
    version?: string;
    description?: string;
    servers?: OpenAPIServer[];
  } = {}
): Promise<OpenAPIDocument> {
  const paths: Record<string, OpenAPIPathItem> = {};
  const tags = new Set<string>();

  for (const route of manifest.routes) {
    // Skip routes without contracts
    if (!route.contractModule || route.kind !== "api") continue;

    const contract = await loadContract(route.contractModule, rootDir);
    if (!contract) continue;

    const pathItem: OpenAPIPathItem = {};

    // Generate operations for each method
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    for (const method of methods) {
      if (contract.request[method]) {
        const operation = generateOperation(route, method, contract);
        pathItem[method.toLowerCase() as keyof OpenAPIPathItem] = operation;

        // Collect tags
        for (const tag of operation.tags || []) {
          tags.add(tag);
        }
      }
    }

    // Convert Mandu pattern to OpenAPI pattern
    // /api/users/:id -> /api/users/{id}
    const openApiPattern = route.pattern.replace(/:(\w+)/g, "{$1}");
    paths[openApiPattern] = pathItem;
  }

  return {
    openapi: "3.0.3",
    info: {
      title: options.title || "Mandu API",
      version: options.version || `${manifest.version}.0.0`,
      description: options.description || "Generated by Mandu Framework",
    },
    servers: options.servers || [
      { url: "http://localhost:3000", description: "Development server" },
    ],
    paths,
    tags: Array.from(tags).map((name) => ({ name })),
  };
}

/**
 * Convert OpenAPI document to YAML string
 */
export function openAPIToYAML(doc: OpenAPIDocument): string {
  // Simple YAML conversion (for production, use a proper YAML library)
  return JSON.stringify(doc, null, 2)
    .replace(/"/g, "")
    .replace(/,$/gm, "")
    .replace(/\[/g, "\n  - ")
    .replace(/\]/g, "");
}

/**
 * Convert OpenAPI document to JSON string
 */
export function openAPIToJSON(doc: OpenAPIDocument): string {
  return JSON.stringify(doc, null, 2);
}
