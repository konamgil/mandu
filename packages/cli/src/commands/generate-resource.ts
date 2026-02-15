/**
 * Mandu CLI - Generate Resource Command
 * Interactive and flag-based resource creation
 */

import {
  defineResource,
  type ResourceDefinition,
  type ResourceField,
  type FieldType,
  FieldTypes,
  generateResourceArtifacts,
  parseResourceSchema,
  logGeneratorResult,
} from "@mandujs/core";
import path from "path";
import fs from "fs/promises";
import { createInterface } from "readline/promises";

// ============================================
// Types
// ============================================

export interface GenerateResourceOptions {
  name?: string;
  fields?: string;
  timestamps?: boolean;
  methods?: string;
  force?: boolean;
}

interface InteractiveAnswers {
  name: string;
  fields: Record<string, ResourceField>;
  timestamps: boolean;
  endpoints: string[];
}

// ============================================
// Field Parsing
// ============================================

/**
 * Parse fields flag string to ResourceField objects
 *
 * @example
 * "name:string,email:email,age:number" → { name: { type: "string" }, ... }
 */
export function parseFieldsFlag(input: string): Record<string, ResourceField> {
  const fields: Record<string, ResourceField> = {};

  for (const fieldStr of input.split(",")) {
    const trimmed = fieldStr.trim();
    if (!trimmed) continue;

    // Parse: "name:string?" or "email:email!"
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*):([a-z]+)([?!])?$/);

    if (!match) {
      throw new Error(
        `Invalid field format: "${fieldStr}". Expected format: fieldName:fieldType (e.g., name:string)`
      );
    }

    const [, name, type, modifier] = match;

    // Validate type
    if (!FieldTypes.includes(type as FieldType)) {
      throw new Error(
        `Invalid field type: "${type}". Valid types: ${FieldTypes.join(", ")}`
      );
    }

    fields[name] = {
      type: type as FieldType,
      required: modifier !== "?",
      description: undefined,
    };
  }

  return fields;
}

/**
 * Parse methods flag to endpoints configuration
 *
 * @example
 * "GET,POST,PUT,DELETE" → { list: true, get: true, create: true, update: true, delete: true }
 */
export function parseMethodsFlag(input: string): Record<string, boolean> {
  const methods = input.split(",").map((m) => m.trim().toUpperCase());
  const endpoints: Record<string, boolean> = {
    list: false,
    get: false,
    create: false,
    update: false,
    delete: false,
  };

  for (const method of methods) {
    switch (method) {
      case "GET":
        endpoints.list = true;
        endpoints.get = true;
        break;
      case "POST":
        endpoints.create = true;
        break;
      case "PUT":
      case "PATCH":
        endpoints.update = true;
        break;
      case "DELETE":
        endpoints.delete = true;
        break;
      default:
        throw new Error(
          `Invalid HTTP method: "${method}". Valid: GET, POST, PUT, PATCH, DELETE`
        );
    }
  }

  return endpoints;
}

// ============================================
// Interactive Mode
// ============================================

/**
 * Run interactive prompts to gather resource information
 */
async function runInteractiveMode(): Promise<InteractiveAnswers> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n🥟 Create a new resource\n");

  // Resource name
  const name = await rl.question("Resource name (singular, e.g., 'user'): ");
  if (!name || !/^[a-z][a-z0-9_]*$/i.test(name)) {
    rl.close();
    throw new Error(
      "Invalid resource name. Must start with a letter and contain only letters, numbers, and underscores."
    );
  }

  // Fields
  console.log("\nAdd fields (press Enter with empty input to finish):");
  const fields: Record<string, ResourceField> = {};
  let fieldIndex = 0;

  while (true) {
    fieldIndex++;
    const fieldInput = await rl.question(
      `  Field ${fieldIndex} (format: name:type, or empty to finish): `
    );

    if (!fieldInput.trim()) {
      if (fieldIndex === 1) {
        rl.close();
        throw new Error("Resource must have at least one field");
      }
      break;
    }

    try {
      const parsed = parseFieldsFlag(fieldInput);
      Object.assign(fields, parsed);
    } catch (error) {
      console.error(
        `  ❌ ${error instanceof Error ? error.message : String(error)}`
      );
      fieldIndex--; // Retry this field
    }
  }

  // Timestamps
  const timestampsAnswer = await rl.question(
    "\nAdd timestamp fields (createdAt, updatedAt)? (y/N): "
  );
  const timestamps = timestampsAnswer.toLowerCase() === "y";

  // Endpoints
  console.log("\nSelect endpoints to generate:");
  const listAnswer = await rl.question("  - List all (GET /resources)? (Y/n): ");
  const getAnswer = await rl.question("  - Get one (GET /resources/:id)? (Y/n): ");
  const createAnswer = await rl.question("  - Create (POST /resources)? (Y/n): ");
  const updateAnswer = await rl.question(
    "  - Update (PUT /resources/:id)? (Y/n): "
  );
  const deleteAnswer = await rl.question(
    "  - Delete (DELETE /resources/:id)? (Y/n): "
  );

  const endpoints: string[] = [];
  if (listAnswer.toLowerCase() !== "n") endpoints.push("list");
  if (getAnswer.toLowerCase() !== "n") endpoints.push("get");
  if (createAnswer.toLowerCase() !== "n") endpoints.push("create");
  if (updateAnswer.toLowerCase() !== "n") endpoints.push("update");
  if (deleteAnswer.toLowerCase() !== "n") endpoints.push("delete");

  rl.close();

  return { name, fields, timestamps, endpoints };
}

// ============================================
// Schema File Generation
// ============================================

/**
 * Format resource definition as TypeScript code
 */
export function formatSchemaFile(definition: ResourceDefinition): string {
  const { name, fields, options } = definition;

  const fieldsCode = Object.entries(fields)
    .map(([fieldName, field]) => {
      const parts: string[] = [`type: "${field.type}"`];
      if (field.required !== undefined) parts.push(`required: ${field.required}`);
      if (field.description) parts.push(`description: "${field.description}"`);
      return `    ${fieldName}: { ${parts.join(", ")} },`;
    })
    .join("\n");

  const endpointsCode = options?.endpoints
    ? Object.entries(options.endpoints)
        .map(([endpoint, enabled]) => `      ${endpoint}: ${enabled},`)
        .join("\n")
    : "";

  return `import { defineResource } from "@mandujs/core";

/**
 * ${name.charAt(0).toUpperCase() + name.slice(1)} Resource
 * Auto-generated by Mandu CLI
 */
export const ${name.charAt(0).toUpperCase() + name.slice(1)}Resource = defineResource({
  name: "${name}",
  fields: {
${fieldsCode}
  },
  options: {
    description: "${name.charAt(0).toUpperCase() + name.slice(1)} management API",
    tags: ["${name}"],
    endpoints: {
${endpointsCode}
    },
  },
});
`;
}

/**
 * Create schema file in spec/resources/{name}/schema.ts
 */
async function createSchemaFile(
  rootDir: string,
  definition: ResourceDefinition
): Promise<string> {
  const resourceDir = path.join(rootDir, "spec/resources", definition.name);
  const schemaPath = path.join(resourceDir, "schema.ts");

  // Check if already exists
  try {
    await fs.access(schemaPath);
    throw new Error(
      `Resource schema already exists: ${path.relative(rootDir, schemaPath)}\nUse --force to overwrite.`
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Resource schema already exists")
    ) {
      throw error;
    }
    // File doesn't exist, we can create it
  }

  // Create directory
  await fs.mkdir(resourceDir, { recursive: true });

  // Write schema file
  const content = formatSchemaFile(definition);
  await Bun.write(schemaPath, content);

  return schemaPath;
}

// ============================================
// Main Command
// ============================================

/**
 * Generate resource command
 */
export async function generateResource(
  options: GenerateResourceOptions
): Promise<boolean> {
  const rootDir = process.cwd();

  try {
    let definition: ResourceDefinition;

    // Interactive mode or flag-based mode
    if (!options.name || !options.fields) {
      // Interactive mode
      const answers = await runInteractiveMode();

      // Add timestamps if requested
      if (answers.timestamps) {
        answers.fields.createdAt = { type: "date", required: true };
        answers.fields.updatedAt = { type: "date", required: true };
      }

      // Build endpoints config
      const endpoints: Record<string, boolean> = {
        list: answers.endpoints.includes("list"),
        get: answers.endpoints.includes("get"),
        create: answers.endpoints.includes("create"),
        update: answers.endpoints.includes("update"),
        delete: answers.endpoints.includes("delete"),
      };

      definition = defineResource({
        name: answers.name,
        fields: answers.fields,
        options: { endpoints },
      });
    } else {
      // Flag-based mode
      const fields = parseFieldsFlag(options.fields);

      // Add timestamps if requested
      if (options.timestamps) {
        fields.createdAt = { type: "date", required: true };
        fields.updatedAt = { type: "date", required: true };
      }

      // Parse methods if provided
      const endpoints = options.methods
        ? parseMethodsFlag(options.methods)
        : {
            list: true,
            get: true,
            create: true,
            update: true,
            delete: true,
          };

      definition = defineResource({
        name: options.name,
        fields,
        options: { endpoints },
      });
    }

    console.log(`\n🥟 Generating resource: ${definition.name}\n`);

    // 1. Create schema file
    const schemaPath = await createSchemaFile(rootDir, definition);
    console.log(`✅ Created schema: ${path.relative(rootDir, schemaPath)}`);

    // 2. Generate artifacts
    const parsed = await parseResourceSchema(schemaPath);
    const result = await generateResourceArtifacts(parsed, {
      rootDir,
      force: options.force ?? false,
    });

    // 3. Log results
    logGeneratorResult(result);

    if (!result.success) {
      console.log("\n❌ Resource generation failed");
      return false;
    }

    // 4. Success guidance
    console.log("\n✅ Resource generated successfully!");
    console.log("\n💡 Next steps:");
    console.log(`   1. Edit slot implementation: spec/slots/${definition.name}.slot.ts`);
    console.log(`   2. Run \`mandu dev\` to start development server`);
    console.log(`   3. Test API endpoints with your resource\n`);

    return true;
  } catch (error) {
    console.error(
      `\n❌ Error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return false;
  }
}
