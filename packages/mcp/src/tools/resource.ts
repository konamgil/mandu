/**
 * Resource Management Tools
 * MCP tools for managing Mandu resources
 */

import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  defineResource,
  parseResourceSchema,
  generateResourceArtifacts,
  type ResourceDefinition,
  type ResourceField,
  type FieldType,
  type GeneratorOptions,
  type GeneratorResult,
  FieldTypes,
} from "@mandujs/core";
import path from "path";
import fs from "fs/promises";

// ============================================
// Tool Definitions
// ============================================

export const resourceToolDefinitions: Tool[] = [
  {
    name: "mandu.resource.create",
    description:
      "Create a new resource with schema definition. " +
      "Generates schema file in spec/resources/{name}/schema.ts and creates " +
      "CRUD handlers, types, contracts, and API clients based on the schema.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Resource name in singular form (e.g., 'user', 'post', 'product')",
        },
        fields: {
          type: "object",
          description: "Field definitions as key-value pairs",
          additionalProperties: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: FieldTypes,
                description: "Field data type",
              },
              required: {
                type: "boolean",
                description: "Whether this field is required (default: false)",
              },
              default: {
                description: "Default value for this field",
              },
              description: {
                type: "string",
                description: "Field description",
              },
              items: {
                type: "string",
                enum: FieldTypes,
                description: "Array element type (required if type is 'array')",
              },
            },
            required: ["type"],
          },
        },
        description: {
          type: "string",
          description: "Resource description",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "API tags for categorization",
        },
        endpoints: {
          type: "object",
          description: "Which endpoints to enable (default: all true)",
          properties: {
            list: { type: "boolean" },
            get: { type: "boolean" },
            create: { type: "boolean" },
            update: { type: "boolean" },
            delete: { type: "boolean" },
          },
        },
      },
      required: ["name", "fields"],
    },
  },
  {
    name: "mandu.resource.list",
    description:
      "List all resources in the project. " +
      "Scans spec/resources/ directory and returns resource names with field summaries.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu.resource.get",
    description:
      "Get detailed information about a specific resource. " +
      "Returns full schema definition including fields, types, and options.",
    inputSchema: {
      type: "object",
      properties: {
        resourceName: {
          type: "string",
          description: "The resource name to retrieve (e.g., 'user', 'post')",
        },
      },
      required: ["resourceName"],
    },
  },
  {
    name: "mandu.resource.addField",
    description:
      "Add a new field to an existing resource schema. " +
      "⚠️ IMPORTANT: Preserves custom slot logic by using force: false during regeneration. " +
      "Updates schema file and regenerates artifacts without overwriting slot implementations.",
    inputSchema: {
      type: "object",
      properties: {
        resourceName: {
          type: "string",
          description: "The resource to modify (e.g., 'user')",
        },
        fieldName: {
          type: "string",
          description: "Name of the new field (e.g., 'phoneNumber', 'email')",
        },
        fieldType: {
          type: "string",
          enum: FieldTypes,
          description: "Data type of the new field",
        },
        required: {
          type: "boolean",
          description: "Whether the field is required (default: false)",
        },
        default: {
          description: "Default value for the field",
        },
        description: {
          type: "string",
          description: "Field description",
        },
        items: {
          type: "string",
          enum: FieldTypes,
          description: "Array element type (required if fieldType is 'array')",
        },
        force: {
          type: "boolean",
          description:
            "⚠️ WARNING: Overwrites custom slot logic if true. " +
            "Only use when you want to reset slot to default template. (default: false)",
        },
      },
      required: ["resourceName", "fieldName", "fieldType"],
    },
  },
  {
    name: "mandu.resource.removeField",
    description:
      "Remove a field from an existing resource schema. " +
      "Updates schema file and regenerates artifacts with force: false to preserve slots.",
    inputSchema: {
      type: "object",
      properties: {
        resourceName: {
          type: "string",
          description: "The resource to modify",
        },
        fieldName: {
          type: "string",
          description: "Name of the field to remove",
        },
      },
      required: ["resourceName", "fieldName"],
    },
  },
];

// ============================================
// Helper Functions
// ============================================

/**
 * Get spec/resources directory path
 */
function getResourcesDir(projectRoot: string): string {
  return path.join(projectRoot, "spec", "resources");
}

/**
 * Get resource schema file path
 */
function getResourceSchemaPath(projectRoot: string, resourceName: string): string {
  return path.join(getResourcesDir(projectRoot), resourceName, "schema.ts");
}

/**
 * Check if file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * List all resource directories
 */
async function listResourceDirs(projectRoot: string): Promise<string[]> {
  const resourcesDir = getResourcesDir(projectRoot);

  try {
    const entries = await fs.readdir(resourcesDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Generate resource schema file content
 */
function generateSchemaFileContent(definition: ResourceDefinition): string {
  const { name, fields, options } = definition;

  const fieldsCode = Object.entries(fields)
    .map(([fieldName, field]) => {
      const props: string[] = [`type: "${field.type}"`];
      if (field.required) props.push("required: true");
      if (field.default !== undefined) props.push(`default: ${JSON.stringify(field.default)}`);
      if (field.description) props.push(`description: "${field.description}"`);
      if (field.items) props.push(`items: "${field.items}"`);

      return `    ${fieldName}: { ${props.join(", ")} },`;
    })
    .join("\n");

  const optionsCode = options
    ? `  options: {
${options.description ? `    description: "${options.description}",\n` : ""}${
        options.tags ? `    tags: ${JSON.stringify(options.tags)},\n` : ""
      }${
        options.endpoints
          ? `    endpoints: ${JSON.stringify(options.endpoints, null, 6).replace(/\n/g, "\n    ")},\n`
          : ""
      }  },`
    : "";

  return `import { defineResource } from "@mandujs/core";

export const ${name}Resource = defineResource({
  name: "${name}",
  fields: {
${fieldsCode}
  },
${optionsCode}
});

export default ${name}Resource;
`;
}

/**
 * Parse schema file to extract ResourceDefinition
 */
async function readResourceDefinition(
  projectRoot: string,
  resourceName: string
): Promise<ResourceDefinition | null> {
  const schemaPath = getResourceSchemaPath(projectRoot, resourceName);

  if (!(await fileExists(schemaPath))) {
    return null;
  }

  try {
    // Use parseResourceSchema from core
    const parsed = await parseResourceSchema(schemaPath);
    return parsed.definition;
  } catch (error) {
    throw new Error(
      `Failed to parse resource schema: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// ============================================
// Tool Handlers
// ============================================

export function resourceTools(projectRoot: string) {
  return {
    /**
     * Create a new resource
     */
    "mandu.resource.create": async (args: Record<string, unknown>) => {
      const { name, fields, description, tags, endpoints } = args as {
        name: string;
        fields: Record<string, ResourceField>;
        description?: string;
        tags?: string[];
        endpoints?: {
          list?: boolean;
          get?: boolean;
          create?: boolean;
          update?: boolean;
          delete?: boolean;
        };
      };

      // Validation
      if (!name || !fields) {
        return {
          error: "Missing required parameters: name and fields",
          tip: "Provide resource name (singular) and field definitions",
        };
      }

      // Check if resource already exists
      const schemaPath = getResourceSchemaPath(projectRoot, name);
      if (await fileExists(schemaPath)) {
        return {
          error: `Resource '${name}' already exists`,
          tip: "Use mandu.resource.get to view existing resource or mandu.resource.addField to add fields",
          existingPath: schemaPath,
        };
      }

      try {
        // Define resource
        const definition = defineResource({
          name,
          fields,
          options: {
            description,
            tags,
            endpoints,
          },
        });

        // Create schema file
        const resourceDir = path.dirname(schemaPath);
        await ensureDir(resourceDir);

        const schemaContent = generateSchemaFileContent(definition);
        await fs.writeFile(schemaPath, schemaContent, "utf-8");

        // Parse and generate artifacts
        const parsed = await parseResourceSchema(schemaPath);
        const result = await generateResourceArtifacts(parsed, {
          rootDir: projectRoot,
          force: false,
        });

        return {
          success: true,
          resourceName: name,
          schemaFile: schemaPath,
          generated: {
            created: result.created,
            skipped: result.skipped,
          },
          fieldCount: Object.keys(fields).length,
          message: `Resource '${name}' created successfully with ${Object.keys(fields).length} fields`,
          tip: "Run mandu.resource.get to view full resource details or start implementing slot logic",
        };
      } catch (error) {
        return {
          error: `Failed to create resource: ${error instanceof Error ? error.message : String(error)}`,
          tip: "Check field definitions and resource name format",
        };
      }
    },

    /**
     * List all resources
     */
    "mandu.resource.list": async () => {
      try {
        const resourceDirs = await listResourceDirs(projectRoot);

        if (resourceDirs.length === 0) {
          return {
            resources: [],
            total: 0,
            message: "No resources found in spec/resources/",
            tip: "Use mandu.resource.create to create your first resource",
          };
        }

        // Read each resource
        const resources = await Promise.all(
          resourceDirs.map(async (resourceName) => {
            try {
              const definition = await readResourceDefinition(projectRoot, resourceName);
              if (!definition) {
                return null;
              }

              return {
                name: resourceName,
                fieldCount: Object.keys(definition.fields).length,
                fields: Object.keys(definition.fields),
                description: definition.options?.description,
                tags: definition.options?.tags,
              };
            } catch {
              return null;
            }
          })
        );

        const validResources = resources.filter((r) => r !== null);

        return {
          resources: validResources,
          total: validResources.length,
          tip: "Use mandu.resource.get with resourceName to see full details",
        };
      } catch (error) {
        return {
          error: `Failed to list resources: ${error instanceof Error ? error.message : String(error)}`,
          tip: "Ensure spec/resources/ directory exists",
        };
      }
    },

    /**
     * Get resource details
     */
    "mandu.resource.get": async (args: Record<string, unknown>) => {
      const { resourceName } = args as { resourceName: string };

      if (!resourceName) {
        return {
          error: "Missing required parameter: resourceName",
          tip: "Use mandu.resource.list to see available resources",
        };
      }

      try {
        const definition = await readResourceDefinition(projectRoot, resourceName);

        if (!definition) {
          return {
            error: `Resource '${resourceName}' not found`,
            tip: "Use mandu.resource.list to see available resources or mandu.resource.create to create it",
          };
        }

        return {
          name: definition.name,
          fields: definition.fields,
          options: definition.options,
          fieldCount: Object.keys(definition.fields).length,
          schemaFile: getResourceSchemaPath(projectRoot, resourceName),
          tip: "Use mandu.resource.addField to add new fields or mandu.resource.removeField to remove fields",
        };
      } catch (error) {
        return {
          error: `Failed to read resource: ${error instanceof Error ? error.message : String(error)}`,
          tip: "Check if schema file is valid TypeScript",
        };
      }
    },

    /**
     * Add field to resource
     */
    "mandu.resource.addField": async (args: Record<string, unknown>) => {
      const { resourceName, fieldName, fieldType, required, default: defaultValue, description, items, force = false } =
        args as {
          resourceName: string;
          fieldName: string;
          fieldType: FieldType;
          required?: boolean;
          default?: unknown;
          description?: string;
          items?: FieldType;
          force?: boolean;
        };

      // Validation
      if (!resourceName || !fieldName || !fieldType) {
        return {
          error: "Missing required parameters: resourceName, fieldName, fieldType",
          tip: "Provide all required parameters",
        };
      }

      try {
        // Read existing resource
        const definition = await readResourceDefinition(projectRoot, resourceName);

        if (!definition) {
          return {
            error: `Resource '${resourceName}' not found`,
            tip: "Use mandu.resource.list to see available resources",
          };
        }

        // Check if field already exists
        if (definition.fields[fieldName]) {
          return {
            error: `Field '${fieldName}' already exists in resource '${resourceName}'`,
            tip: "Use mandu.resource.get to view existing fields or choose a different field name",
          };
        }

        // Add field
        const newField: ResourceField = {
          type: fieldType,
          required,
          default: defaultValue,
          description,
          items,
        };

        definition.fields[fieldName] = newField;

        // Update schema file
        const schemaPath = getResourceSchemaPath(projectRoot, resourceName);
        const schemaContent = generateSchemaFileContent(definition);
        await fs.writeFile(schemaPath, schemaContent, "utf-8");

        // Regenerate artifacts (force: false to preserve slots!)
        const parsed = await parseResourceSchema(schemaPath);
        const result = await generateResourceArtifacts(parsed, {
          rootDir: projectRoot,
          force: force, // Use force parameter from args
        });

        return {
          success: true,
          resourceName,
          fieldAdded: fieldName,
          fieldType,
          filesUpdated: [schemaPath, ...result.created],
          slotsPreserved: result.skipped,
          forceUsed: force,
          message: `Field '${fieldName}' added to resource '${resourceName}'. ${force ? "⚠️ Slots overwritten!" : "Slots preserved."}`,
          tip: force
            ? "⚠️ Custom slot logic was overwritten because force: true was used"
            : "Custom slot logic preserved. Run mandu_generate to apply changes to all resources.",
        };
      } catch (error) {
        return {
          error: `Failed to add field: ${error instanceof Error ? error.message : String(error)}`,
          tip: "Check field type and resource name",
        };
      }
    },

    /**
     * Remove field from resource
     */
    "mandu.resource.removeField": async (args: Record<string, unknown>) => {
      const { resourceName, fieldName } = args as {
        resourceName: string;
        fieldName: string;
      };

      // Validation
      if (!resourceName || !fieldName) {
        return {
          error: "Missing required parameters: resourceName, fieldName",
          tip: "Provide both resourceName and fieldName",
        };
      }

      try {
        // Read existing resource
        const definition = await readResourceDefinition(projectRoot, resourceName);

        if (!definition) {
          return {
            error: `Resource '${resourceName}' not found`,
            tip: "Use mandu.resource.list to see available resources",
          };
        }

        // Check if field exists
        if (!definition.fields[fieldName]) {
          return {
            error: `Field '${fieldName}' not found in resource '${resourceName}'`,
            tip: "Use mandu.resource.get to view existing fields",
            availableFields: Object.keys(definition.fields),
          };
        }

        // Remove field
        delete definition.fields[fieldName];

        // Validate at least one field remains
        if (Object.keys(definition.fields).length === 0) {
          return {
            error: `Cannot remove field '${fieldName}': resource must have at least one field`,
            tip: "Add other fields before removing this one, or delete the entire resource",
          };
        }

        // Update schema file
        const schemaPath = getResourceSchemaPath(projectRoot, resourceName);
        const schemaContent = generateSchemaFileContent(definition);
        await fs.writeFile(schemaPath, schemaContent, "utf-8");

        // Regenerate artifacts (force: false to preserve slots!)
        const parsed = await parseResourceSchema(schemaPath);
        const result = await generateResourceArtifacts(parsed, {
          rootDir: projectRoot,
          force: false,
        });

        return {
          success: true,
          resourceName,
          fieldRemoved: fieldName,
          filesUpdated: [schemaPath, ...result.created],
          slotsPreserved: result.skipped,
          remainingFields: Object.keys(definition.fields),
          message: `Field '${fieldName}' removed from resource '${resourceName}'. Slots preserved.`,
          tip: "Run mandu_generate to apply changes to all resources",
        };
      } catch (error) {
        return {
          error: `Failed to remove field: ${error instanceof Error ? error.message : String(error)}`,
          tip: "Check field name and resource name",
        };
      }
    },
  };
}
