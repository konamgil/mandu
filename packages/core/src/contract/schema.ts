/**
 * Mandu Contract Schema Types
 * API 계약 정의를 위한 타입 시스템
 */

import type { z } from "zod";

/** HTTP Methods supported in contracts */
export type ContractMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Example data for request/response documentation */
export interface SchemaExamples {
  /** Example name → example data */
  [name: string]: unknown;
}

/** Request schema for a specific HTTP method */
export interface MethodRequestSchema {
  /** Query parameters schema */
  query?: z.ZodTypeAny;
  /** Request body schema */
  body?: z.ZodTypeAny;
  /** Path parameters schema (for nested routes) */
  params?: z.ZodTypeAny;
  /** Request headers schema */
  headers?: z.ZodTypeAny;
  /** Example request data for documentation */
  examples?: SchemaExamples;
}

/** Nested route schema (e.g., ":id" for /users/:id) */
export interface NestedRouteSchema extends MethodRequestSchema {
  GET?: MethodRequestSchema;
  POST?: MethodRequestSchema;
  PUT?: MethodRequestSchema;
  PATCH?: MethodRequestSchema;
  DELETE?: MethodRequestSchema;
}

/** Request schemas by method */
export interface ContractRequestSchema {
  GET?: MethodRequestSchema;
  POST?: MethodRequestSchema;
  PUT?: MethodRequestSchema;
  PATCH?: MethodRequestSchema;
  DELETE?: MethodRequestSchema;
  /** Nested routes (e.g., ":id" for /users/:id) */
  [key: string]: MethodRequestSchema | NestedRouteSchema | undefined;
}

/** Response schema with optional examples */
export interface ResponseSchemaWithExamples {
  /** Response body schema */
  schema: z.ZodTypeAny;
  /** Example response data for documentation */
  examples?: SchemaExamples;
}

/** Response schemas by status code */
export interface ContractResponseSchema {
  200?: z.ZodTypeAny | ResponseSchemaWithExamples;
  201?: z.ZodTypeAny | ResponseSchemaWithExamples;
  204?: z.ZodTypeAny | ResponseSchemaWithExamples;
  400?: z.ZodTypeAny | ResponseSchemaWithExamples;
  401?: z.ZodTypeAny | ResponseSchemaWithExamples;
  403?: z.ZodTypeAny | ResponseSchemaWithExamples;
  404?: z.ZodTypeAny | ResponseSchemaWithExamples;
  500?: z.ZodTypeAny | ResponseSchemaWithExamples;
  [statusCode: number]: z.ZodTypeAny | ResponseSchemaWithExamples | undefined;
}

/** Normalize mode for request data sanitization */
export type ContractNormalizeMode = "strip" | "strict" | "passthrough";

/** Full contract schema definition */
export interface ContractSchema {
  /** API description */
  description?: string;
  /** Tags for grouping (e.g., OpenAPI tags) */
  tags?: string[];
  /** Request schemas by method */
  request: ContractRequestSchema;
  /** Response schemas by status code */
  response: ContractResponseSchema;
  /**
   * Normalize mode for request data sanitization
   * - strip (default): Remove undefined fields (Mass Assignment prevention)
   * - strict: Error on undefined fields
   * - passthrough: Allow all fields
   */
  normalize?: ContractNormalizeMode;
  /**
   * Coerce query/params string values to proper types
   * @default true
   */
  coerceQueryParams?: boolean;
}

/** Contract definition input (what user provides) */
export interface ContractDefinition {
  description?: string;
  tags?: string[];
  request: ContractRequestSchema;
  response: ContractResponseSchema;
  /** Normalize mode for request data */
  normalize?: ContractNormalizeMode;
  /** Coerce query/params to proper types */
  coerceQueryParams?: boolean;
}

/** Contract instance with metadata */
export interface ContractInstance extends ContractSchema {
  /** Unique identifier (derived from route id) */
  _id?: string;
  /** Whether this contract is validated */
  _validated?: boolean;
}

/** Validation error detail */
export interface ContractValidationIssue {
  /** Field path (e.g., "body.email") */
  path: (string | number)[];
  /** Error message */
  message: string;
  /** Zod error code */
  code: string;
}

/** Validation error by type */
export interface ContractValidationError {
  /** Error type (query, body, params, headers, response) */
  type: "query" | "body" | "params" | "headers" | "response";
  /** Validation issues */
  issues: ContractValidationIssue[];
}

/** Validation result */
export interface ContractValidationResult {
  /** Whether validation succeeded */
  success: boolean;
  /** Validation errors if failed */
  errors?: ContractValidationError[];
  /** Parsed/transformed data if successful */
  data?: unknown;
}
