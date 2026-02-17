import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { loadManifest, generateRoutes, generateManifest, GENERATED_RELATIVE_PATHS, type GeneratedMap, parseResourceSchema, generateResourceArtifacts } from "@mandujs/core";
import { getProjectPaths, readJsonFile } from "../utils/project.js";
import path from "path";
import fs from "fs/promises";

export const generateToolDefinitions: Tool[] = [
  {
    name: "mandu_generate",
    description:
      "Generate all Mandu framework artifacts from the current routes manifest and resource schemas. " +
      "Runs two generation steps: " +
      "(1) Route generation: for every route in .mandu/routes.manifest.json, creates " +
      "a server-side handler in .mandu/generated/server/{routeId}.route.ts and " +
      "a web component in .mandu/generated/web/{routeId}.route.tsx. " +
      "These generated files wire up slots and contracts automatically — do NOT edit them directly. " +
      "Instead, edit source files in app/ (route definition) or spec/ (slots, contracts). " +
      "(2) Resource generation (resources=true, default): scans spec/resources/{name}/schema.ts " +
      "and generates CRUD boilerplate (repository, service, handlers) for each declared resource. " +
      "Run this after adding routes, modifying slot/contract files, or changing resource schemas. " +
      "Use dryRun=true to preview what would be created or overwritten without writing any files.",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: {
          type: "boolean",
          description: "Preview what would be generated without writing files (default: false)",
        },
        resources: {
          type: "boolean",
          description: "Include resource artifact generation from spec/resources/ (default: true)",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_generate_status",
    description:
      "Show the current state of all generated artifacts from .mandu/generated.map.json. " +
      "Returns: generation timestamp, source spec version, total file count, " +
      "and a list of generated files per route with their kinds (server handler, web component, slot stub). " +
      "If no generated.map.json exists, prompts to run mandu_generate first.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function generateTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_generate: async (args: Record<string, unknown>) => {
      const { dryRun, resources = true } = args as { dryRun?: boolean; resources?: boolean };

      // Regenerate manifest from FS Routes first
      const fsResult = await generateManifest(projectRoot);

      // Load the freshly generated manifest
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      if (dryRun) {
        // Dry run - just show what would be generated
        const routes = manifestResult.data.routes;
        const wouldCreate: string[] = [];
        const wouldSkip: string[] = [];

        for (const route of routes) {
          // Server handler
          wouldCreate.push(`${GENERATED_RELATIVE_PATHS.serverRoutes}/${route.id}.route.ts`);

          // Page component (for page kind)
          if (route.kind === "page") {
            wouldCreate.push(`${GENERATED_RELATIVE_PATHS.webRoutes}/${route.id}.route.tsx`);
          }

          // Slot file (only if not exists)
          if (route.slotModule) {
            const slotFile = Bun.file(`${projectRoot}/${route.slotModule}`);
            if (await slotFile.exists()) {
              wouldSkip.push(route.slotModule);
            } else {
              wouldCreate.push(route.slotModule);
            }
          }
        }

        return {
          dryRun: true,
          wouldCreate,
          wouldSkip,
          routeCount: routes.length,
        };
      }

      // Actually generate routes
      const result = await generateRoutes(manifestResult.data, projectRoot);

      // Generate resources if enabled
      let resourceResults: {
        created: string[];
        skipped: string[];
        errors: string[];
      } = {
        created: [],
        skipped: [],
        errors: [],
      };

      if (resources) {
        try {
          const resourcesDir = path.join(projectRoot, "spec", "resources");
          const entries = await fs.readdir(resourcesDir, { withFileTypes: true });
          const resourceDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

          for (const resourceName of resourceDirs) {
            const schemaPath = path.join(resourcesDir, resourceName, "schema.ts");
            try {
              const parsed = await parseResourceSchema(schemaPath);
              const resourceResult = await generateResourceArtifacts(parsed, {
                rootDir: projectRoot,
                force: false,
              });

              resourceResults.created.push(...resourceResult.created);
              resourceResults.skipped.push(...resourceResult.skipped);
              resourceResults.errors.push(...resourceResult.errors);
            } catch (err) {
              resourceResults.errors.push(`Failed to generate resource '${resourceName}': ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } catch {
          // spec/resources/ doesn't exist or is empty - not an error
        }
      }

      return {
        success: result.success && resourceResults.errors.length === 0,
        routes: {
          created: result.created,
          deleted: result.deleted,
          skipped: result.skipped,
          errors: result.errors,
        },
        resources: resources
          ? {
              created: resourceResults.created,
              skipped: resourceResults.skipped,
              errors: resourceResults.errors,
            }
          : undefined,
        summary: {
          routesCreated: result.created.length,
          routesDeleted: result.deleted.length,
          routesSkipped: result.skipped.length,
          resourcesCreated: resourceResults.created.length,
          resourcesSkipped: resourceResults.skipped.length,
          totalErrors: result.errors.length + resourceResults.errors.length,
        },
      };
    },

    mandu_generate_status: async () => {
      // Read generated map
      const generatedMap = await readJsonFile<GeneratedMap>(paths.generatedMapPath);

      if (!generatedMap) {
        return {
          hasGeneratedFiles: false,
          message: "No generated.map.json found. Run mandu_generate first.",
        };
      }

      const fileCount = Object.keys(generatedMap.files).length;
      const routeIds = Object.values(generatedMap.files).map((f) => f.routeId);
      const uniqueRoutes = [...new Set(routeIds)];

      return {
        hasGeneratedFiles: true,
        version: generatedMap.version,
        generatedAt: generatedMap.generatedAt,
        specSource: generatedMap.specSource,
        fileCount,
        routeCount: uniqueRoutes.length,
        files: Object.entries(generatedMap.files).map(([path, info]) => ({
          path,
          routeId: info.routeId,
          kind: info.kind,
          hasSlot: !!info.slotMapping,
        })),
      };
    },
  };
}
