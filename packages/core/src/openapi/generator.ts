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
// Schema name-hint side table
// ============================================

/**
 * Side-channel naming hints for generated OpenAPI schemas.
 *
 * The hoist pass needs a preferred name for each object schema but we
 * don't want to serialize that hint into the output document. A WeakMap
 * keyed by the generated `OpenAPISchema` object gives us name access
 * during the post-processing pass without polluting the spec JSON.
 *
 * Hints are advisory — the hoist pass falls back to a deterministic
 * `Schema_<hash8>` name when no hint is attached.
 */
const schemaNameHints = new WeakMap<OpenAPISchema, string>();

function setSchemaNameHint(schema: OpenAPISchema | undefined, hint: string | undefined): void {
  if (!schema || !hint) return;
  // Don't overwrite an existing hint — first attribution wins. This matches
  // the "first-come wins" policy for structurally-identical schemas with
  // different user-given names.
  if (!schemaNameHints.has(schema)) {
    schemaNameHints.set(schema, hint);
  }
}

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

  // Handle ZodOptional — optionality is expressed by the parent object's
  // `required[]` array (or by `parameter.required: false`), NOT by the
  // field's own schema. Emitting `nullable: true` here would conflate
  // "may be absent" with "may literally be null", which breaks Postman,
  // codegen, and Swagger UI (they'd all treat the field as nullable).
  if (typeName === "ZodOptional") {
    const inner = getZodInnerType(zodSchema);
    return inner ? zodToOpenAPISchema(inner) : {};
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
 * Convert an arbitrary identifier to a PascalCase token suitable for an
 * OpenAPI component name. Non-alphanumeric characters become word
 * separators; leading digits are prefixed with `_` so the result is a
 * valid JSON Schema identifier.
 */
function pascal(input: string): string {
  if (!input) return "";
  const words = input
    .split(/[^a-zA-Z0-9]+/g)
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1));
  const joined = words.join("");
  if (!joined) return "";
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}

/**
 * Derive a naming hint root for a contract. Prefers the explicit
 * `contract.name`; falls back to the route id (e.g. `api/users` →
 * `ApiUsers`). Guarantees we always have a non-empty PascalCase prefix
 * for generated component names.
 */
function deriveContractNameRoot(contract: ContractSchema, route: RouteSpec): string {
  const hint = contract.name ?? route.id;
  const pascalized = pascal(hint);
  return pascalized || "Schema";
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

  // Derive a naming hint root from the contract for the hoist pass.
  // Example: `contract.name = "users"` → `Users`. Falls back to a
  // route-derived identifier so every contract has *some* stable prefix.
  const nameRoot = deriveContractNameRoot(contract, route);

  // Parameters
  if (methodSchema) {
    const params = generateParameters(methodSchema, route.pattern);
    if (params.length > 0) {
      operation.parameters = params;
    }

    // Request body
    if (methodSchema.body) {
      const bodySchema = zodToOpenAPISchema(methodSchema.body);
      // Hint: `UsersBody` / `UsersPostBody` — method-qualified avoids
      // collisions when GET/POST/PUT on the same contract have distinct
      // request bodies.
      setSchemaNameHint(bodySchema, `${nameRoot}${pascal(method)}Body`);
      const requestBodyContent: OpenAPIRequestBody["content"]["application/json"] = {
        schema: bodySchema,
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
    // Hint: `UsersResponse200` / `UsersPostResponse201`. Status-qualified
    // so `200` and `400` responses don't collide when both are
    // `{ error: string }` style objects.
    setSchemaNameHint(schema, `${nameRoot}${pascal(method)}Response${statusCode}`);
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
    /**
     * Hoist schemas that appear ≥`hoistThreshold` times into
     * `components.schemas` and replace inline occurrences with `$ref`.
     * @default true
     */
    hoistSchemas?: boolean;
    /**
     * Minimum occurrence count required to hoist a schema.
     * @default 2
     */
    hoistThreshold?: number;
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

  const doc: OpenAPIDocument = {
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

  // Post-processing: hoist shared schemas into components.schemas.
  // `hoistSchemas: false` → pure backwards-compatible inline output.
  const hoistEnabled = options.hoistSchemas !== false;
  if (hoistEnabled) {
    await hoistSharedSchemas(doc, {
      threshold: options.hoistThreshold ?? 2,
    });
  }

  return doc;
}

// ============================================
// Schema hoisting (post-processing)
// ============================================

export interface HoistOptions {
  /** Minimum occurrences required to hoist. Default `2`. */
  threshold?: number;
}

interface SchemaOccurrence {
  /** Structural hash of the schema body (identity key). */
  hash: string;
  /** Every parent reference we might need to rewrite to `$ref`. */
  sites: Array<{ parent: Record<string, unknown>; key: string | number }>;
  /** The canonical schema body (first-seen value; all sites share equal shape). */
  body: OpenAPISchema;
  /** Ordered list of name hints collected at each occurrence site. */
  hints: string[];
}

/**
 * Hoist shared object schemas into `components.schemas` and replace
 * inline occurrences with `$ref` pointers.
 *
 * Only hoists:
 *   - `type: "object"` schemas (primitives / enums / unions-of-primitives stay inline).
 *   - Schemas appearing at a "hoistable site" (requestBody/response root or a top-level
 *     property of either). Path/query/header parameter schemas are explicitly skipped.
 *   - Schemas reaching the occurrence threshold (default 2).
 *
 * Naming:
 *   - First hint wins for structurally-identical schemas.
 *   - Name collisions across structurally-different schemas are disambiguated with
 *     `_v2`, `_v3`, … suffixes (deterministic by walk order).
 *   - Hint-less schemas fall back to `Schema_<first-8-hex-of-hash>`.
 */
export async function hoistSharedSchemas(
  doc: OpenAPIDocument,
  options: HoistOptions = {}
): Promise<void> {
  const threshold = Math.max(2, options.threshold ?? 2);
  const occurrences = new Map<string, SchemaOccurrence>();

  // --- Pass 1: walk every hoistable site and record occurrences. ---
  for (const pathItem of Object.values(doc.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const op = pathItem[method];
      if (!op) continue;

      // Request body root schema (+ top-level property values).
      if (op.requestBody?.content) {
        for (const mediaObj of Object.values(op.requestBody.content)) {
          recordHoistableTree(mediaObj as Record<string, unknown>, "schema", occurrences);
        }
      }

      // Response root schema (+ top-level property values).
      for (const resp of Object.values(op.responses)) {
        if (!resp.content) continue;
        for (const mediaObj of Object.values(resp.content)) {
          recordHoistableTree(mediaObj as Record<string, unknown>, "schema", occurrences);
        }
      }
    }
  }

  // --- Pass 2: pick the winners (count ≥ threshold, type === "object"). ---
  const winners: Array<{ name: string; hash: string; body: OpenAPISchema; sites: SchemaOccurrence["sites"] }> = [];
  const nameIndex = new Map<string, string>(); // name → hash (for collision detection)

  // Stable iteration: sort by hash so hoisted output is deterministic
  // regardless of JS property enumeration order quirks.
  const entries = Array.from(occurrences.entries()).sort(([a], [b]) => a.localeCompare(b));
  for (const [hash, entry] of entries) {
    if (entry.sites.length < threshold) continue;
    if (!isHoistableObject(entry.body)) continue;

    // Pick the first-seen hint; fall back to the hash-derived default.
    const preferred = entry.hints[0] || `Schema_${hash.slice(0, 8)}`;
    let finalName = preferred;
    let suffix = 2;
    // If the name is already claimed by a *different* hash, walk `_v2`, `_v3`…
    while (nameIndex.has(finalName) && nameIndex.get(finalName) !== hash) {
      finalName = `${preferred}_v${suffix++}`;
    }
    nameIndex.set(finalName, hash);
    winners.push({ name: finalName, hash, body: entry.body, sites: entry.sites });
  }

  if (winners.length === 0) return;

  // --- Pass 3: install winners into components.schemas + rewrite sites. ---
  if (!doc.components) doc.components = {};
  if (!doc.components.schemas) doc.components.schemas = {};
  const schemas = doc.components.schemas;

  for (const winner of winners) {
    schemas[winner.name] = winner.body;
    const ref: OpenAPISchema = { $ref: `#/components/schemas/${winner.name}` };
    for (const site of winner.sites) {
      // Replace inline schema with a `$ref` pointer. We write a *new*
      // ref object per site (JSON.stringify would collapse shared refs
      // anyway, but distinct identities make future passes safer).
      (site.parent as Record<string | number, unknown>)[site.key] = { ...ref };
    }
  }
}

/**
 * Walk a container object and record every hoistable schema site. A
 * hoistable site is:
 *
 *   1. The root schema at `container[key]` (typically the `"schema"` key of a
 *      requestBody/response media type object).
 *   2. Every top-level property of that root, *if* the root is an object schema.
 *
 * Nested properties beyond depth 1 are intentionally ignored — hoisting
 * deep nests produces spec trees that are harder for codegen tools to
 * follow than the inline original.
 */
function recordHoistableTree(
  container: Record<string, unknown>,
  key: string,
  occurrences: Map<string, SchemaOccurrence>
): void {
  const root = container[key] as OpenAPISchema | undefined;
  if (!root || typeof root !== "object") return;
  // Skip anything that's already a $ref (e.g., from an earlier pass).
  if ("$ref" in root && root.$ref) return;

  // Record the root itself (regardless of object vs primitive — we filter
  // in pass 2 so that primitives with many occurrences still get counted
  // but are never emitted as component entries).
  recordOccurrence(root, container as Record<string, unknown>, key, occurrences);

  // Drill into top-level properties for object roots.
  if (root.type === "object" && root.properties) {
    for (const [propKey, propSchema] of Object.entries(root.properties)) {
      if (!propSchema || typeof propSchema !== "object") continue;
      if ("$ref" in propSchema && propSchema.$ref) continue;
      recordOccurrence(
        propSchema as OpenAPISchema,
        root.properties as Record<string, unknown>,
        propKey,
        occurrences
      );
    }
  }

  // Drill into array items when the root is an array — the element shape
  // is the real reusable schema, not the array wrapper itself.
  if (root.type === "array" && root.items) {
    const items = root.items;
    if (items && typeof items === "object" && !("$ref" in items && items.$ref)) {
      recordOccurrence(
        items,
        root as unknown as Record<string, unknown>,
        "items",
        occurrences
      );
    }
  }
}

function recordOccurrence(
  schema: OpenAPISchema,
  parent: Record<string, unknown>,
  key: string | number,
  occurrences: Map<string, SchemaOccurrence>
): void {
  const hash = structuralHash(schema);
  let entry = occurrences.get(hash);
  if (!entry) {
    entry = { hash, sites: [], body: schema, hints: [] };
    occurrences.set(hash, entry);
  }
  entry.sites.push({ parent, key });
  const hint = schemaNameHints.get(schema);
  if (hint && !entry.hints.includes(hint)) {
    entry.hints.push(hint);
  }
}

/**
 * A schema is hoistable iff it is an object with ≥1 property. We
 * deliberately skip:
 *   - primitives (`string`, `number`, `boolean`, `integer`) — they are
 *     small enough that inline is clearer than a pointer chase.
 *   - enums and unions of primitives — same argument, and codegen tools
 *     tend to de-duplicate these separately.
 *   - empty object schemas — no information to share.
 *   - $ref passthroughs — already hoisted.
 *   - object schemas with a composed keyword (allOf/oneOf/anyOf) but no
 *     `properties` — these are structural compositions, not data shapes.
 */
function isHoistableObject(schema: OpenAPISchema): boolean {
  if (!schema || typeof schema !== "object") return false;
  if (schema.$ref) return false;
  if (schema.type !== "object") return false;
  if (!schema.properties) return false;
  if (Object.keys(schema.properties).length === 0) return false;
  return true;
}

/**
 * Stable structural hash of a schema. Sorts object keys recursively
 * before stringifying so `{a:1,b:2}` and `{b:2,a:1}` hash identically,
 * then feeds the canonical string through SHA-256.
 */
function structuralHash(schema: OpenAPISchema): string {
  const canonical = stableStringify(schema);
  return sha256Hex(canonical);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => stableStringify(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) continue;
      parts.push(JSON.stringify(k) + ":" + stableStringify(v));
    }
    return "{" + parts.join(",") + "}";
  }
  return JSON.stringify(value);
}

/**
 * Synchronous SHA-256 hex digest. Uses `Bun.CryptoHasher` when present,
 * then Node `crypto.createHash` as a fallback. WebCrypto is async-only
 * so we intentionally skip it here — the hoist pass hashes many small
 * payloads and the sync path keeps the post-process simple and fast.
 *
 * This is a purely structural identity key (not a security primitive),
 * so the brief Node-fallback surface is acceptable.
 */
function sha256Hex(input: string): string {
  const bunGlobal = (globalThis as { Bun?: { CryptoHasher?: new (algo: string) => { update(input: string | Uint8Array): void; digest(encoding: "hex"): string } } }).Bun;
  if (bunGlobal?.CryptoHasher) {
    const hasher = new bunGlobal.CryptoHasher("sha256");
    hasher.update(input);
    return hasher.digest("hex");
  }
  // Node fallback — `require` at call time to keep module-load lean.
  // Callers who run in an edge runtime without Node crypto should have
  // Bun available; we therefore don't bother with a WebCrypto async
  // path (it would turn `hoistSharedSchemas` into an unnecessarily async
  // cascade on the hot path).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require("node:crypto") as typeof import("node:crypto");
  return nodeCrypto.createHash("sha256").update(input).digest("hex");
}

// ============================================
// YAML Serialization
// ============================================

/**
 * Quote a string value for YAML if required by the spec.
 *
 * Follows a conservative subset of YAML 1.2 rules: any scalar that
 * could be confused for a YAML reserved word, a number, a boolean, a
 * null, or that contains indicator characters must be double-quoted.
 * Everything else is emitted as a plain scalar for maximum
 * readability.
 */
function yamlScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ".nan";
    return String(value);
  }
  if (typeof value === "string") {
    // Quote strings that a YAML 1.2 parser would otherwise interpret
    // as a non-string scalar (null/bool/number) or that contain indicator
    // characters at positions where they are load-bearing.
    //
    // Conservative heuristic:
    //   - empty string
    //   - leading/trailing whitespace (would be silently trimmed)
    //   - reserved scalars: null / true / false / yes / no / on / off (+ ~)
    //   - parses cleanly as a YAML number (integer or float)
    //   - contains a flow indicator (`[ ]`, `{ }`, `,`) or a comment start `#`
    //   - contains `: ` (key separator) anywhere, or ends with `:`
    //   - starts with an indicator char that would collide with block syntax:
    //       `-` (sequence), `?` (mapping key), `&`/`*` (anchor/alias),
    //       `!` (tag), `|`/`>` (block scalar), `'`/`"` / backtick / `%`/`@`
    //   - embedded newline
    const numericLike = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(value);
    const reservedScalar = /^(~|null|true|false|yes|no|on|off)$/i.test(value);
    const leadingIndicator = /^[-?&*!|>'"%@`]/.test(value);
    const hasFlowOrComment = /[\[\]{},#]/.test(value);
    const hasKeyLike = /:\s/.test(value) || /:$/.test(value);
    const needsQuote =
      value === "" ||
      /^[\s]|[\s]$/.test(value) ||
      reservedScalar ||
      numericLike ||
      leadingIndicator ||
      hasFlowOrComment ||
      hasKeyLike ||
      value.includes("\n");
    if (!needsQuote) return value;
    // Use double quotes with JSON-style escaping (valid YAML subset).
    return JSON.stringify(value);
  }
  // Fallback: JSON-stringify anything exotic.
  return JSON.stringify(value);
}

function emitYAML(value: unknown, indent: number, lines: string[]): void {
  const pad = "  ".repeat(indent);

  if (value === null || typeof value !== "object") {
    lines.push(`${pad}${yamlScalar(value)}`);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      lines.push(`${pad}[]`);
      return;
    }
    for (const item of value) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const entries = Object.entries(item).filter(([, v]) => v !== undefined);
        if (entries.length === 0) {
          lines.push(`${pad}- {}`);
          continue;
        }
        const [firstKey, firstVal] = entries[0];
        lines.push(`${pad}- ${yamlKeyValue(firstKey, firstVal, indent + 1)}`);
        for (let i = 1; i < entries.length; i++) {
          const [k, v] = entries[i];
          lines.push(`${pad}  ${yamlKeyValue(k, v, indent + 1)}`);
        }
      } else {
        lines.push(`${pad}- ${yamlScalar(item).trimStart()}`);
      }
    }
    return;
  }

  // Plain object.
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined
  );
  if (entries.length === 0) {
    lines.push(`${pad}{}`);
    return;
  }
  for (const [k, v] of entries) {
    if (v !== null && typeof v === "object") {
      const isEmptyArray = Array.isArray(v) && v.length === 0;
      const isEmptyObject = !Array.isArray(v) && Object.keys(v).length === 0;
      if (isEmptyArray) {
        lines.push(`${pad}${k}: []`);
        continue;
      }
      if (isEmptyObject) {
        lines.push(`${pad}${k}: {}`);
        continue;
      }
      lines.push(`${pad}${k}:`);
      emitYAML(v, indent + 1, lines);
    } else {
      lines.push(`${pad}${k}: ${yamlScalar(v)}`);
    }
  }
}

function yamlKeyValue(key: string, value: unknown, indent: number): string {
  if (value === null || typeof value !== "object") {
    return `${key}: ${yamlScalar(value)}`;
  }
  // Nested object / array: emit header + drop into recursion on subsequent lines.
  // The caller pushes lines after this; we return the header only.
  const tmp: string[] = [];
  emitYAML(value, indent, tmp);
  return `${key}:\n${tmp.join("\n")}`;
}

/**
 * Convert an OpenAPI document to a YAML string.
 *
 * Emits a conservative YAML 1.2 subset — two-space indentation,
 * double-quoted scalars where required, literal `[]` / `{}` for empty
 * collections. Produces output that round-trips cleanly through
 * Swagger UI, openapi-generator, and `yq`.
 */
export function openAPIToYAML(doc: OpenAPIDocument): string {
  const lines: string[] = [];
  emitYAML(doc, 0, lines);
  // Terminate with a newline per POSIX text-file convention so `cat`
  // doesn't elide the final byte.
  return lines.join("\n") + "\n";
}

/**
 * Convert OpenAPI document to JSON string
 */
export function openAPIToJSON(doc: OpenAPIDocument): string {
  return JSON.stringify(doc, null, 2);
}

// ============================================
// Content hashing (for ETag)
// ============================================

/**
 * Compute a SHA-256 hex digest of the serialized OpenAPI document.
 *
 * Uses `Bun.CryptoHasher` when available (zero allocations beyond the
 * input buffer) and falls back to the WebCrypto API so the helper works
 * under edge runtimes (Cloudflare Workers, Deno Deploy).
 */
export async function hashOpenAPIJSON(json: string): Promise<string> {
  const bunGlobal = (globalThis as { Bun?: { CryptoHasher?: new (algo: string) => { update(input: string | Uint8Array): void; digest(encoding: "hex"): string } } }).Bun;
  if (bunGlobal?.CryptoHasher) {
    const hasher = new bunGlobal.CryptoHasher("sha256");
    hasher.update(json);
    return hasher.digest("hex");
  }
  // WebCrypto fallback (browser / edge runtimes).
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    const data = new TextEncoder().encode(json);
    const buf = await subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  // Last-resort Node fallback.
  const nodeCrypto = await import("node:crypto");
  return nodeCrypto.createHash("sha256").update(json).digest("hex");
}

// ============================================
// Build-time artifact emission
// ============================================

export interface OpenAPIArtifactPaths {
  json: string;
  yaml: string;
}

export interface OpenAPIArtifactResult {
  /** OpenAPI 3.0.3 document serialized as JSON (two-space indented). */
  json: string;
  /** OpenAPI 3.0.3 document serialized as YAML. */
  yaml: string;
  /** SHA-256 hex digest of `json` — used as the runtime ETag. */
  hash: string;
  /** Absolute paths of the emitted artifacts (matches the dir argument). */
  paths: OpenAPIArtifactPaths;
  /** Number of route paths captured in the document. */
  pathCount: number;
}

/**
 * Generate and write both `openapi.json` and `openapi.yaml` under the
 * given output directory. Returns the serialized bodies and the SHA-256
 * hash so callers (e.g., `mandu build`) can log a stable artifact id
 * and the runtime endpoint can skip re-hashing on boot.
 *
 * Safe to call repeatedly — the directory is created if absent and the
 * existing files are overwritten atomically by `Bun.write`.
 */
export async function writeOpenAPIArtifacts(
  manifest: RoutesManifest,
  rootDir: string,
  outDir: string,
  options: Parameters<typeof generateOpenAPIDocument>[2] = {}
): Promise<OpenAPIArtifactResult> {
  const { mkdir } = await import("node:fs/promises");
  const pathMod = await import("node:path");

  const doc = await generateOpenAPIDocument(manifest, rootDir, options);
  const json = openAPIToJSON(doc);
  const yaml = openAPIToYAML(doc);
  const hash = await hashOpenAPIJSON(json);

  const absoluteDir = pathMod.isAbsolute(outDir)
    ? outDir
    : pathMod.join(rootDir, outDir);
  await mkdir(absoluteDir, { recursive: true });

  const jsonPath = pathMod.join(absoluteDir, "openapi.json");
  const yamlPath = pathMod.join(absoluteDir, "openapi.yaml");
  await Bun.write(jsonPath, json);
  await Bun.write(yamlPath, yaml);

  return {
    json,
    yaml,
    hash,
    paths: { json: jsonPath, yaml: yamlPath },
    pathCount: Object.keys(doc.paths).length,
  };
}

/**
 * Read previously emitted OpenAPI artifacts from disk. Returns
 * `null` when either file is missing so the caller can fall back to
 * on-demand generation without logging a misleading error.
 */
export async function readOpenAPIArtifacts(
  outDir: string,
  rootDir: string
): Promise<{ json: string; yaml: string; hash: string } | null> {
  const pathMod = await import("node:path");
  const absoluteDir = pathMod.isAbsolute(outDir)
    ? outDir
    : pathMod.join(rootDir, outDir);
  const jsonPath = pathMod.join(absoluteDir, "openapi.json");
  const yamlPath = pathMod.join(absoluteDir, "openapi.yaml");

  const jsonFile = Bun.file(jsonPath);
  const yamlFile = Bun.file(yamlPath);
  if (!(await jsonFile.exists()) || !(await yamlFile.exists())) {
    return null;
  }
  const json = await jsonFile.text();
  const yaml = await yamlFile.text();
  const hash = await hashOpenAPIJSON(json);
  return { json, yaml, hash };
}
