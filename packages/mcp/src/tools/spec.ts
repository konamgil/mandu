import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  validateManifest,
  writeLock,
  generateManifest,
  GENERATED_RELATIVE_PATHS,
  type RouteSpec,
  type RoutesManifest,
} from "@mandujs/core";
import { getProjectPaths, readJsonFile, writeJsonFile } from "../utils/project.js";
import path from "path";
import fs from "fs/promises";

export const specToolDefinitions: Tool[] = [
  {
    name: "mandu_list_routes",
    description:
      "List all routes registered in the Mandu project, read from .mandu/routes.manifest.json. " +
      "Route kinds: " +
      "'api' (REST endpoint — app/**/route.ts, exports named GET/POST/PUT/PATCH/DELETE handler functions), " +
      "'page' (SSR page — app/**/page.tsx, React component supporting client-side hydration islands). " +
      "Special files auto-detected by the filesystem router (not user-created routes): " +
      "layout.tsx (shared wrapper rendered around child routes), " +
      "error.tsx (error boundary for the route subtree), " +
      "loading.tsx (suspense fallback shown while page data loads). " +
      "Each route may have an associated slotModule (server data loader) and contractModule (Zod API schema).",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_get_route",
    description:
      "Get full details of a specific route by its ID. " +
      "Returns the complete route spec: kind, URL pattern, module paths (app, slot, contract, component), " +
      "HTTP methods, and hydration configuration (for page routes with client islands). " +
      "Use this before modifying a route to understand its current configuration.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to retrieve (use mandu_list_routes to see all IDs)",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_add_route",
    description:
      "Scaffold a new route by creating source files in app/ and registering it in the manifest. " +
      "For 'api' routes: creates app/{path}/route.ts with a GET handler stub. " +
      "For 'page' routes: creates app/{path}/page.tsx with a React component stub. " +
      "withSlot=true (default): also creates spec/slots/{routeId}.slot.ts — " +
      "the server-side data loader that runs on every request before rendering and injects typed props into the page. " +
      "withContract=true: also creates spec/contracts/{routeId}.contract.ts — " +
      "Zod schemas for request/response validation, enabling typed handlers, OpenAPI generation, and ATE L2/L3 testing. " +
      "Automatically runs generateManifest() after creation to link all files.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Route path relative to app/ (e.g., 'api/users' or 'blog/[slug]')",
        },
        kind: {
          type: "string",
          enum: ["api", "page"],
          description: "Route type: 'api' creates route.ts with HTTP handlers, 'page' creates page.tsx with a React component",
        },
        withSlot: {
          type: "boolean",
          description: "Also scaffold a server-side data loader at spec/slots/{routeId}.slot.ts (default: true)",
        },
        withContract: {
          type: "boolean",
          description: "Also scaffold a Zod contract at spec/contracts/{routeId}.contract.ts (default: false)",
        },
      },
      required: ["path", "kind"],
    },
  },
  {
    name: "mandu_delete_route",
    description:
      "Delete a route's app/ source file and regenerate the manifest. " +
      "Only removes the app/{path}/route.ts or page.tsx file — " +
      "slot files (spec/slots/) and contract files (spec/contracts/) are intentionally preserved, " +
      "as they may be reused when the route is recreated. " +
      "Use mandu_list_routes before deleting to confirm the correct routeId.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to delete (use mandu_list_routes to find it)",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_validate_manifest",
    description:
      "Validate the routes manifest (.mandu/routes.manifest.json) for structural integrity. " +
      "Checks required fields, valid route kinds, correct module paths, and manifest schema version. " +
      "Run this after manual manifest edits, after upgrading Mandu, or when routes behave unexpectedly.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export function specTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_list_routes: async () => {
      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      return {
        version: result.data.version,
        routes: result.data.routes.map((r) => ({
          id: r.id,
          pattern: r.pattern,
          kind: r.kind,
          slotModule: r.slotModule,
          contractModule: r.contractModule,
          componentModule: r.componentModule,
        })),
        count: result.data.routes.length,
      };
    },

    mandu_get_route: async (args: Record<string, unknown>) => {
      const { routeId } = args as { routeId: string };

      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const route = result.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      return { route };
    },

    mandu_add_route: async (args: Record<string, unknown>) => {
      const { path: routePath, kind, withSlot = true, withContract = false } = args as {
        path: string;
        kind: "api" | "page";
        withSlot?: boolean;
        withContract?: boolean;
      };

      const createdFiles: string[] = [];

      // Scaffold app/ file
      const fileName = kind === "api" ? "route.ts" : "page.tsx";
      const appFilePath = path.join(paths.appDir, routePath, fileName);
      const appFileDir = path.dirname(appFilePath);

      await fs.mkdir(appFileDir, { recursive: true });

      if (kind === "api") {
        await Bun.write(appFilePath, `export function GET(req: Request) {\n  return Response.json({ message: "Hello" });\n}\n`);
      } else {
        await Bun.write(appFilePath, `export default function Page() {\n  return <div>Page</div>;\n}\n`);
      }
      createdFiles.push(`app/${routePath}/${fileName}`);

      // Derive route ID from path
      const routeId = routePath.replace(/\//g, "-").replace(/[\[\]\.]/g, "");

      // Scaffold slot if requested
      if (withSlot) {
        const slotPath = path.join(paths.slotsDir, `${routeId}.slot.ts`);
        await fs.mkdir(paths.slotsDir, { recursive: true });
        if (!(await Bun.file(slotPath).exists())) {
          await Bun.write(slotPath, `export default function slot(req: Request) {\n  return {};\n}\n`);
          createdFiles.push(`spec/slots/${routeId}.slot.ts`);
        }
      }

      // Scaffold contract if requested
      if (withContract) {
        const contractPath = path.join(paths.contractsDir, `${routeId}.contract.ts`);
        await fs.mkdir(paths.contractsDir, { recursive: true });
        if (!(await Bun.file(contractPath).exists())) {
          await Bun.write(contractPath, `import { z } from "zod";\n\nexport const contract = {\n  request: z.object({}),\n  response: z.object({}),\n};\n`);
          createdFiles.push(`spec/contracts/${routeId}.contract.ts`);
        }
      }

      // Rescan to regenerate manifest with auto-linking
      const genResult = await generateManifest(projectRoot);

      return {
        success: true,
        routeId,
        createdFiles,
        totalRoutes: genResult.manifest.routes.length,
        message: `Route '${routeId}' scaffolded successfully`,
      };
    },

    mandu_delete_route: async (args: Record<string, unknown>) => {
      const { routeId } = args as { routeId: string };

      // Load current manifest to find the route
      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      const route = result.data.routes.find((r) => r.id === routeId);
      if (!route) {
        return { error: `Route not found: ${routeId}` };
      }

      // Delete app/ source file (module path points to generated; need to find source)
      const deletedFiles: string[] = [];
      if (route.module && route.module.startsWith("app/")) {
        const fullPath = path.join(projectRoot, route.module);
        try {
          await fs.unlink(fullPath);
          deletedFiles.push(route.module);
        } catch {}
      }

      // Rescan manifest (slot/contract files preserved)
      const genResult = await generateManifest(projectRoot);

      return {
        success: true,
        deletedRoute: route,
        deletedFiles,
        preservedFiles: [route.slotModule, route.contractModule].filter(Boolean),
        totalRoutes: genResult.manifest.routes.length,
        message: `Route '${routeId}' deleted from app/. Slot/contract files preserved.`,
      };
    },

    mandu_validate_manifest: async () => {
      const result = await loadManifest(paths.manifestPath);
      if (!result.success) {
        return {
          valid: false,
          errors: result.errors,
        };
      }

      return {
        valid: true,
        routeCount: result.data?.routes.length || 0,
        version: result.data?.version,
      };
    },
  };
}
