import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  runContractGuardCheck,
  generateContractTemplate,
  generateOpenAPIDocument,
  openAPIToJSON,
  type RouteSpec,
  type RoutesManifest,
  type SpecHttpMethod,
} from "@mandujs/core";
import { getProjectPaths, readJsonFile, writeJsonFile } from "../utils/project.js";
import path from "path";
import fs from "fs/promises";

export const contractToolDefinitions: Tool[] = [
  {
    name: "mandu_list_contracts",
    annotations: {
      readOnlyHint: true,
    },
    description:
      "List routes with contract modules and API routes missing contracts.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_get_contract",
    annotations: {
      readOnlyHint: true,
    },
    description:
      "Read the TypeScript source of a route's contract file.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to retrieve the contract for",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_create_contract",
    annotations: {
      destructiveHint: false,
      readOnlyHint: false,
    },
    description:
      "Create a new contract file with Zod schema stubs for a route and link it in the manifest.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to create a contract for",
        },
        description: {
          type: "string",
          description: "Human-readable API description added as a comment in the contract file",
        },
        methods: {
          type: "array",
          items: { type: "string" },
          description: "HTTP methods to generate schemas for (default: route's declared methods or ['GET', 'POST'])",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_update_route_contract",
    annotations: {
      readOnlyHint: false,
    },
    description:
      "Update the manifest to link an existing contract file to a route. Only changes the manifest reference.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to update",
        },
        contractModule: {
          type: "string",
          description: "Relative path to the contract file from project root (e.g., spec/contracts/users.contract.ts)",
        },
      },
      required: ["routeId", "contractModule"],
    },
  },
  {
    name: "mandu_validate_contracts",
    annotations: {
      readOnlyHint: true,
    },
    description:
      "Validate all contracts against their slot implementations for method and type consistency.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_sync_contract_slot",
    annotations: {
      readOnlyHint: true,
    },
    description:
      "Generate code snippets to resolve HTTP method mismatches between a contract and its slot. Does not write files.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to sync (must have both contractModule and slotModule)",
        },
        direction: {
          type: "string",
          enum: ["contract-to-slot", "slot-to-contract"],
          description:
            "'contract-to-slot': generate slot handler stubs for undocumented contract methods. " +
            "'slot-to-contract': generate contract schema stubs for undocumented slot handlers.",
        },
      },
      required: ["routeId", "direction"],
    },
  },
  {
    name: "mandu_generate_openapi",
    annotations: {
      readOnlyHint: false,
    },
    description:
      "Generate an OpenAPI 3.0 JSON spec from all routes with contract modules.",
    inputSchema: {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Output file path relative to project root (default: openapi.json)",
        },
        title: {
          type: "string",
          description: "API title shown in the spec (default: 'Mandu API')",
        },
        version: {
          type: "string",
          description: "API version string (default: taken from the manifest version)",
        },
      },
      required: [],
    },
  },
];

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return null;
  }
}

export function contractTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_list_contracts: async () => {
      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const contracts = result.data.routes
        .filter((r) => r.contractModule)
        .map((r) => ({
          routeId: r.id,
          pattern: r.pattern,
          contractModule: r.contractModule,
          slotModule: r.slotModule,
        }));

      const routesWithoutContract = result.data.routes
        .filter((r) => !r.contractModule && r.kind === "api")
        .map((r) => r.id);

      return {
        contracts,
        count: contracts.length,
        routesWithoutContract,
      };
    },

    mandu_get_contract: async (args: Record<string, unknown>) => {
      const { routeId } = args as { routeId: string };

      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const route = result.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      if (!route.contractModule) {
        return {
          routeId,
          hasContract: false,
          suggestion: `Create a contract with: mandu_create_contract({ routeId: "${routeId}" })`,
        };
      }

      // Read contract file
      const contractPath = path.join(projectRoot, route.contractModule);
      const contractContent = await readFileContent(contractPath);

      if (!contractContent) {
        return {
          routeId,
          contractModule: route.contractModule,
          error: "Contract file not found",
        };
      }

      return {
        routeId,
        contractModule: route.contractModule,
        hasContract: true,
        content: contractContent,
      };
    },

    mandu_create_contract: async (args: Record<string, unknown>) => {
      const { routeId, description, methods } = args as {
        routeId: string;
        description?: string;
        methods?: string[];
      };

      // Load manifest
      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      // Find route
      const route = result.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      // Determine contract path
      const contractPath = route.contractModule || `spec/contracts/${routeId}.contract.ts`;
      const fullContractPath = path.join(projectRoot, contractPath);

      // Check if contract already exists
      if (await fileExists(fullContractPath)) {
        return {
          error: "Contract file already exists",
          contractModule: contractPath,
        };
      }

      // Create directory if needed
      const contractDir = path.dirname(fullContractPath);
      await fs.mkdir(contractDir, { recursive: true });

      // Generate contract with custom methods if provided
      const routeWithMethods: RouteSpec = {
        ...route,
        methods: (methods as SpecHttpMethod[] | undefined) || route.methods || ["GET", "POST"],
      };

      const contractContent = generateContractTemplate(routeWithMethods);
      await Bun.write(fullContractPath, contractContent);

      // Update manifest if contractModule wasn't set
      if (!route.contractModule) {
        const routeIndex = result.data.routes.findIndex((r) => r.id === routeId);
        result.data.routes[routeIndex] = {
          ...route,
          contractModule: contractPath,
        };

        await writeJsonFile(paths.manifestPath, result.data);
      }

      return {
        success: true,
        contractModule: contractPath,
        message: `Contract created for route '${routeId}'`,
        nextSteps: [
          `Edit ${contractPath} to define your API schema`,
          "Run mandu_generate to regenerate handlers with validation",
          "Run mandu_validate_contracts to check consistency",
        ],
      };
    },

    mandu_update_route_contract: async (args: Record<string, unknown>) => {
      const { routeId, contractModule } = args as {
        routeId: string;
        contractModule: string;
      };

      // Load manifest
      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      // Find route
      const routeIndex = result.data.routes.findIndex((r) => r.id === routeId);
      if (routeIndex === -1) {
        return { error: `Route not found: ${routeId}` };
      }

      // Update route
      result.data.routes[routeIndex] = {
        ...result.data.routes[routeIndex],
        contractModule,
      };

      // Write updated manifest
      await writeJsonFile(paths.manifestPath, result.data);

      return {
        success: true,
        route: result.data.routes[routeIndex],
        message: `Route '${routeId}' updated with contract: ${contractModule}`,
      };
    },

    mandu_validate_contracts: async () => {
      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const violations = await runContractGuardCheck(result.data, projectRoot);

      if (violations.length === 0) {
        const contractCount = result.data.routes.filter((r) => r.contractModule).length;
        return {
          valid: true,
          contractCount,
          totalRoutes: result.data.routes.length,
          message: "All contracts are valid",
        };
      }

      return {
        valid: false,
        violations: violations.map((v) => ({
          ruleId: v.ruleId,
          routeId: v.routeId,
          file: v.file,
          message: v.message,
          suggestion: v.suggestion,
        })),
        count: violations.length,
      };
    },

    mandu_sync_contract_slot: async (args: Record<string, unknown>) => {
      const { routeId, direction } = args as {
        routeId: string;
        direction: "contract-to-slot" | "slot-to-contract";
      };

      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const route = result.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      if (!route.contractModule || !route.slotModule) {
        return {
          error: "Route must have both contractModule and slotModule",
          contractModule: route.contractModule,
          slotModule: route.slotModule,
        };
      }

      // Read files
      const contractPath = path.join(projectRoot, route.contractModule);
      const slotPath = path.join(projectRoot, route.slotModule);

      const contractContent = await readFileContent(contractPath);
      const slotContent = await readFileContent(slotPath);

      if (!contractContent) {
        return { error: `Contract file not found: ${route.contractModule}` };
      }

      if (!slotContent) {
        return { error: `Slot file not found: ${route.slotModule}` };
      }

      // Extract methods
      const contractMethods: string[] = [];
      const contractMethodRegex = /\b(GET|POST|PUT|PATCH|DELETE)\s*:\s*\{/g;
      let match;
      while ((match = contractMethodRegex.exec(contractContent)) !== null) {
        if (!contractMethods.includes(match[1])) {
          contractMethods.push(match[1]);
        }
      }

      const slotMethods: string[] = [];
      const slotMethodRegex = /\.(get|post|put|patch|delete)\s*\(/gi;
      while ((match = slotMethodRegex.exec(slotContent)) !== null) {
        const method = match[1].toUpperCase();
        if (!slotMethods.includes(method)) {
          slotMethods.push(method);
        }
      }

      if (direction === "contract-to-slot") {
        // Add missing methods to slot
        const missingInSlot = contractMethods.filter((m) => !slotMethods.includes(m));

        if (missingInSlot.length === 0) {
          return {
            success: true,
            message: "Slot already has all contract methods",
            contractMethods,
            slotMethods,
          };
        }

        // Generate slot stubs
        const stubs = missingInSlot
          .map((m) => {
            const method = m.toLowerCase();
            return `
  // 📋 ${m} ${route.pattern}
  .${method}((ctx) => {
    // TODO: Implement ${m} handler
    return ctx.ok({ message: "${m} not implemented yet" });
  })`;
          })
          .join("\n");

        return {
          success: true,
          message: `Add these handlers to ${route.slotModule}:`,
          missingMethods: missingInSlot,
          stubCode: stubs,
          contractMethods,
          slotMethods,
        };
      } else {
        // Add missing methods to contract
        const undocumented = slotMethods.filter((m) => !contractMethods.includes(m));

        if (undocumented.length === 0) {
          return {
            success: true,
            message: "Contract already documents all slot methods",
            contractMethods,
            slotMethods,
          };
        }

        // Generate contract schemas
        const schemas = undocumented
          .map((m) => {
            if (m === "GET" || m === "DELETE") {
              return `    ${m}: {
      // Query parameters
      query: z.object({}).optional(),
    }`;
            }
            return `    ${m}: {
      // Request body
      body: z.object({
        // TODO: Define your schema
      }),
    }`;
          })
          .join(",\n\n");

        return {
          success: true,
          message: `Add these schemas to ${route.contractModule} request object:`,
          undocumentedMethods: undocumented,
          schemaCode: schemas,
          contractMethods,
          slotMethods,
        };
      }
    },

    mandu_generate_openapi: async (args: Record<string, unknown>) => {
      const { output, title, version } = args as {
        output?: string;
        title?: string;
        version?: string;
      };

      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      // Count routes with contracts
      const contractRoutes = result.data.routes.filter((r) => r.contractModule);
      if (contractRoutes.length === 0) {
        return {
          error: "No routes with contracts found",
          suggestion: "Add contractModule to your routes to generate OpenAPI docs",
        };
      }

      try {
        const doc = await generateOpenAPIDocument(result.data, projectRoot, {
          title,
          version,
        });

        const json = openAPIToJSON(doc);
        const outputPath = output || path.join(projectRoot, "openapi.json");

        // Ensure directory exists
        const outputDir = path.dirname(outputPath);
        await fs.mkdir(outputDir, { recursive: true });

        await Bun.write(outputPath, json);

        const pathCount = Object.keys(doc.paths).length;
        const tagCount = doc.tags?.length || 0;

        return {
          success: true,
          outputPath: path.relative(projectRoot, outputPath),
          summary: {
            paths: pathCount,
            tags: tagCount,
            version: doc.info.version,
          },
        };
      } catch (error) {
        return {
          error: `Failed to generate OpenAPI: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  };
}
