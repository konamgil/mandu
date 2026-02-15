/**
 * Resource Client Generator
 * Generate type-safe client methods for resource API
 */

import type { ResourceDefinition } from "../schema";
import { getPluralName, getEnabledEndpoints } from "../schema";

/**
 * Generate client file for resource
 *
 * @returns Client file content
 */
export function generateResourceClient(definition: ResourceDefinition): string {
  const resourceName = definition.name;
  const pascalName = toPascalCase(resourceName);
  const pluralName = getPluralName(definition);
  const endpoints = getEnabledEndpoints(definition);

  // Generate client methods
  const methods = generateClientMethods(definition, endpoints, pascalName, pluralName);

  return `// 🌐 Mandu Client - ${resourceName} Resource
// Auto-generated from resource definition
// DO NOT EDIT - Regenerated on every \`mandu generate\`

import type {
  ${pascalName}GetQuery,
  ${pascalName}PostBody,
  ${pascalName}PutBody,
  ${pascalName}Response200,
  ${pascalName}Response201,
} from "../types/${resourceName}.types";

/**
 * ${pascalName} Resource Client
 * Type-safe API client for ${pluralName}
 */
export class ${pascalName}Client {
  private baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

${methods}

  /**
   * Internal fetch wrapper with error handling
   */
  private async fetch<T>(
    path: string,
    options?: RequestInit
  ): Promise<T> {
    const url = \`\${this.baseUrl}\${path}\`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || \`HTTP \${response.status}\`);
    }

    return response.json();
  }
}

/**
 * Create a ${pascalName} client instance
 */
export function create${pascalName}Client(baseUrl?: string): ${pascalName}Client {
  return new ${pascalName}Client(baseUrl);
}
`;
}

/**
 * Generate client methods for enabled endpoints
 */
function generateClientMethods(
  definition: ResourceDefinition,
  endpoints: string[],
  pascalName: string,
  pluralName: string
): string {
  const methods: string[] = [];

  if (endpoints.includes("list")) {
    methods.push(generateListMethod(pascalName, pluralName));
  }

  if (endpoints.includes("get")) {
    methods.push(generateGetMethod(pascalName, pluralName));
  }

  if (endpoints.includes("create")) {
    methods.push(generateCreateMethod(pascalName, pluralName));
  }

  if (endpoints.includes("update")) {
    methods.push(generateUpdateMethod(pascalName, pluralName));
  }

  if (endpoints.includes("delete")) {
    methods.push(generateDeleteMethod(pascalName, pluralName));
  }

  return methods.join("\n\n");
}

/**
 * Generate LIST method
 */
function generateListMethod(pascalName: string, pluralName: string): string {
  return `  /**
   * List ${pascalName}s with pagination
   */
  async list(query?: ${pascalName}GetQuery): Promise<${pascalName}Response200> {
    const params = new URLSearchParams();
    if (query?.page) params.set("page", String(query.page));
    if (query?.limit) params.set("limit", String(query.limit));

    const queryString = params.toString();
    const path = queryString ? \`/api/${pluralName}?\${queryString}\` : \`/api/${pluralName}\`;

    return this.fetch<${pascalName}Response200>(path);
  }`;
}

/**
 * Generate GET method
 */
function generateGetMethod(pascalName: string, pluralName: string): string {
  return `  /**
   * Get a single ${pascalName} by ID
   */
  async get(id: string): Promise<${pascalName}Response200> {
    return this.fetch<${pascalName}Response200>(\`/api/${pluralName}/\${id}\`);
  }`;
}

/**
 * Generate CREATE method
 */
function generateCreateMethod(pascalName: string, pluralName: string): string {
  return `  /**
   * Create a new ${pascalName}
   */
  async create(data: ${pascalName}PostBody): Promise<${pascalName}Response201> {
    return this.fetch<${pascalName}Response201>(\`/api/${pluralName}\`, {
      method: "POST",
      body: JSON.stringify(data),
    });
  }`;
}

/**
 * Generate UPDATE method
 */
function generateUpdateMethod(pascalName: string, pluralName: string): string {
  return `  /**
   * Update an existing ${pascalName}
   */
  async update(id: string, data: ${pascalName}PutBody): Promise<${pascalName}Response200> {
    return this.fetch<${pascalName}Response200>(\`/api/${pluralName}/\${id}\`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }`;
}

/**
 * Generate DELETE method
 */
function generateDeleteMethod(pascalName: string, pluralName: string): string {
  return `  /**
   * Delete a ${pascalName}
   */
  async delete(id: string): Promise<${pascalName}Response200> {
    return this.fetch<${pascalName}Response200>(\`/api/${pluralName}/\${id}\`, {
      method: "DELETE",
    });
  }`;
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
