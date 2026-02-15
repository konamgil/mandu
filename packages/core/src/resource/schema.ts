/**
 * Resource Schema Definition
 * Resource-Centric Architecture의 핵심 스키마 정의
 */

import { z } from "zod";

// ============================================
// Field Types
// ============================================

export const FieldTypes = [
  "string",
  "number",
  "boolean",
  "date",
  "uuid",
  "email",
  "url",
  "json",
  "array",
  "object",
] as const;

export type FieldType = (typeof FieldTypes)[number];

// ============================================
// Field Definition
// ============================================

export interface ResourceField {
  /** 필드 타입 */
  type: FieldType;
  /** 필수 여부 */
  required?: boolean;
  /** 기본값 */
  default?: unknown;
  /** 설명 */
  description?: string;
  /** 배열 타입인 경우 요소 타입 */
  items?: FieldType;
  /** 커스텀 Zod 스키마 (고급 사용) */
  schema?: z.ZodType<any>;
}

// ============================================
// Resource Options
// ============================================

export interface ResourceOptions {
  /** 리소스 설명 */
  description?: string;
  /** API 태그 */
  tags?: string[];
  /** 자동 복수형 사용 여부 (기본: true) */
  autoPlural?: boolean;
  /** 커스텀 복수형 이름 */
  pluralName?: string;
  /** 활성화할 엔드포인트 */
  endpoints?: {
    list?: boolean;
    get?: boolean;
    create?: boolean;
    update?: boolean;
    delete?: boolean;
  };
  /** 인증 필요 여부 */
  auth?: boolean;
  /** 페이지네이션 설정 */
  pagination?: {
    defaultLimit?: number;
    maxLimit?: number;
  };
}

// ============================================
// Resource Definition
// ============================================

export interface ResourceDefinition {
  /** 리소스 이름 (단수형) */
  name: string;
  /** 필드 정의 */
  fields: Record<string, ResourceField>;
  /** 옵션 */
  options?: ResourceOptions;
}

// ============================================
// defineResource API
// ============================================

/**
 * Define a resource with fields and options
 *
 * @example
 * ```typescript
 * const UserResource = defineResource({
 *   name: "user",
 *   fields: {
 *     id: { type: "uuid", required: true },
 *     email: { type: "email", required: true },
 *     name: { type: "string", required: true },
 *     createdAt: { type: "date", required: true },
 *   },
 *   options: {
 *     description: "User management API",
 *     tags: ["users"],
 *     endpoints: {
 *       list: true,
 *       get: true,
 *       create: true,
 *       update: true,
 *       delete: true,
 *     },
 *   },
 * });
 * ```
 */
export function defineResource(definition: ResourceDefinition): ResourceDefinition {
  // Validation
  validateResourceDefinition(definition);

  // Default options
  const options: ResourceOptions = {
    autoPlural: true,
    endpoints: {
      list: true,
      get: true,
      create: true,
      update: true,
      delete: true,
    },
    pagination: {
      defaultLimit: 10,
      maxLimit: 100,
    },
    ...definition.options,
  };

  return {
    ...definition,
    options,
  };
}

// ============================================
// Validation
// ============================================

/**
 * Validate resource definition
 */
export function validateResourceDefinition(definition: ResourceDefinition): void {
  // Name validation
  if (!definition.name) {
    throw new Error("Resource name is required");
  }

  if (!/^[a-z][a-z0-9_]*$/i.test(definition.name)) {
    throw new Error(
      `Invalid resource name: "${definition.name}". Must start with a letter and contain only letters, numbers, and underscores.`
    );
  }

  // Fields validation
  if (!definition.fields || Object.keys(definition.fields).length === 0) {
    throw new Error(`Resource "${definition.name}" must have at least one field`);
  }

  for (const [fieldName, field] of Object.entries(definition.fields)) {
    validateField(definition.name, fieldName, field);
  }
}

/**
 * Validate individual field
 */
function validateField(resourceName: string, fieldName: string, field: ResourceField): void {
  // Field name validation
  if (!/^[a-z][a-z0-9_]*$/i.test(fieldName)) {
    throw new Error(
      `Invalid field name: "${fieldName}" in resource "${resourceName}". Must start with a letter and contain only letters, numbers, and underscores.`
    );
  }

  // Type validation
  if (!FieldTypes.includes(field.type)) {
    throw new Error(
      `Invalid field type: "${field.type}" for field "${fieldName}" in resource "${resourceName}". Must be one of: ${FieldTypes.join(", ")}`
    );
  }

  // Array type requires items
  if (field.type === "array" && !field.items && !field.schema) {
    throw new Error(
      `Field "${fieldName}" in resource "${resourceName}" is array type but missing "items" property`
    );
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get plural name for resource
 */
export function getPluralName(definition: ResourceDefinition): string {
  if (definition.options?.pluralName) {
    return definition.options.pluralName;
  }

  if (definition.options?.autoPlural === false) {
    return definition.name;
  }

  // Simple pluralization: add 's'
  // TODO: Add more sophisticated pluralization rules if needed
  return `${definition.name}s`;
}

/**
 * Get enabled endpoints
 */
export function getEnabledEndpoints(definition: ResourceDefinition): string[] {
  const endpoints = definition.options?.endpoints ?? {
    list: true,
    get: true,
    create: true,
    update: true,
    delete: true,
  };

  return Object.entries(endpoints)
    .filter(([_, enabled]) => enabled)
    .map(([name]) => name);
}

/**
 * Check if field is required
 */
export function isFieldRequired(field: ResourceField): boolean {
  return field.required ?? false;
}

/**
 * Get field default value
 */
export function getFieldDefault(field: ResourceField): unknown | undefined {
  return field.default;
}
