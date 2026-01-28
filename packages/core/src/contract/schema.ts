/**
 * Mandu Contract Schema Types
 * API 계약 정의를 위한 타입 시스템
 */

import type { z } from "zod";

/** HTTP Methods supported in contracts */
export type ContractMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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

/** Response schemas by status code */
export interface ContractResponseSchema {
  200?: z.ZodTypeAny;
  201?: z.ZodTypeAny;
  204?: z.ZodTypeAny;
  400?: z.ZodTypeAny;
  401?: z.ZodTypeAny;
  403?: z.ZodTypeAny;
  404?: z.ZodTypeAny;
  500?: z.ZodTypeAny;
  [statusCode: number]: z.ZodTypeAny | undefined;
}

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
}

/** Contract definition input (what user provides) */
export interface ContractDefinition {
  description?: string;
  tags?: string[];
  request: ContractRequestSchema;
  response: ContractResponseSchema;
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
