import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { loadManifest, generateRoutes, generateManifest, GENERATED_RELATIVE_PATHS, type GeneratedMap } from "@mandujs/core";
import { getProjectPaths, readJsonFile } from "../utils/project.js";

export const generateToolDefinitions: Tool[] = [
  {
    name: "mandu_generate",
    description:
      "Generate route handlers and components from the spec manifest. Creates server handlers, page components, and slot files.",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: {
          type: "boolean",
          description: "If true, show what would be generated without writing files",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_generate_status",
    description: "Get the current generation status and generated file map",
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
      const { dryRun } = args as { dryRun?: boolean };

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

      // Actually generate
      const result = await generateRoutes(manifestResult.data, projectRoot);

      return {
        success: result.success,
        created: result.created,
        deleted: result.deleted,
        skipped: result.skipped,
        errors: result.errors,
        summary: {
          createdCount: result.created.length,
          deletedCount: result.deleted.length,
          skippedCount: result.skipped.length,
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
