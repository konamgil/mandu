/**
 * Resource-Centric Architecture
 * Public API exports
 */

// Schema API
export {
  defineResource,
  validateResourceDefinition,
  getPluralName,
  getEnabledEndpoints,
  isFieldRequired,
  getFieldDefault,
  FieldTypes,
} from "./schema";

export type {
  ResourceDefinition,
  ResourceField,
  ResourceOptions,
  FieldType,
} from "./schema";

// Parser API
export { parseResourceSchema, parseResourceSchemas, validateResourceUniqueness } from "./parser";

export type { ParsedResource } from "./parser";

// Generator API
export {
  generateResourceArtifacts,
  generateResourcesArtifacts,
  logGeneratorResult,
} from "./generator";

export type { GeneratorOptions, GeneratorResult } from "./generator";

// Individual Generators (for advanced use)
export { generateResourceContract } from "./generators/contract";
export { generateResourceTypes } from "./generators/types";
export { generateResourceSlot } from "./generators/slot";
export { generateResourceClient } from "./generators/client";
