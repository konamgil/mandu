import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  validateManifest,
  writeLock,
  type RouteSpec,
  type RoutesManifest,
} from "@mandujs/core";
import { getProjectPaths, readJsonFile, writeJsonFile } from "../utils/project.js";
import path from "path";

export const specToolDefinitions: Tool[] = [
  {
    name: "mandu_list_routes",
    description: "List all routes in the current Mandu project",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_get_route",
    description: "Get details of a specific route by ID",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to retrieve",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_add_route",
    description: "Add a new route to the manifest",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique route identifier",
        },
        pattern: {
          type: "string",
          description: "URL pattern (e.g., /api/users/:id)",
        },
        kind: {
          type: "string",
          enum: ["api", "page"],
          description: "Route type: api or page",
        },
        slotModule: {
          type: "string",
          description: "Path to slot file (optional)",
        },
        componentModule: {
          type: "string",
          description: "Path to component module (required for page kind)",
        },
      },
      required: ["id", "pattern", "kind"],
    },
  },
  {
    name: "mandu_update_route",
    description: "Update an existing route",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to update",
        },
        updates: {
          type: "object",
          description: "Partial route updates",
          properties: {
            pattern: { type: "string" },
            kind: { type: "string", enum: ["api", "page"] },
            slotModule: { type: "string" },
            componentModule: { type: "string" },
          },
        },
      },
      required: ["routeId", "updates"],
    },
  },
  {
    name: "mandu_delete_route",
    description: "Delete a route from the manifest",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to delete",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_validate_spec",
    description: "Validate the current spec manifest",
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
      const { id, pattern, kind, slotModule, componentModule } = args as {
        id: string;
        pattern: string;
        kind: "api" | "page";
        slotModule?: string;
        componentModule?: string;
      };

      // Load current manifest
      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      // Check for duplicate
      if (result.data.routes.some((r) => r.id === id)) {
        return { error: `Route with id '${id}' already exists` };
      }

      if (result.data.routes.some((r) => r.pattern === pattern)) {
        return { error: `Route with pattern '${pattern}' already exists` };
      }

      // Build new route
      const newRoute: RouteSpec = {
        id,
        pattern,
        kind,
        module: `apps/server/generated/routes/${id}.route.ts`,
        slotModule: slotModule || `spec/slots/${id}.slot.ts`,
      };

      if (kind === "page") {
        newRoute.componentModule = componentModule || `apps/web/generated/routes/${id}.route.tsx`;
      }

      // Validate new route
      const newManifest: RoutesManifest = {
        version: result.data.version,
        routes: [...result.data.routes, newRoute],
      };

      const validation = validateManifest(newManifest);
      if (!validation.success) {
        return { error: validation.errors };
      }

      // Write updated manifest
      await writeJsonFile(paths.manifestPath, newManifest);

      // Update lock file
      await writeLock(paths.lockPath, newManifest);

      return {
        success: true,
        route: newRoute,
        message: `Route '${id}' added successfully`,
      };
    },

    mandu_update_route: async (args: Record<string, unknown>) => {
      const { routeId, updates } = args as {
        routeId: string;
        updates: Partial<RouteSpec>;
      };

      // Load current manifest
      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      // Find route
      const routeIndex = result.data.routes.findIndex((r) => r.id === routeId);
      if (routeIndex === -1) {
        return { error: `Route not found: ${routeId}` };
      }

      // Apply updates
      const updatedRoute = {
        ...result.data.routes[routeIndex],
        ...updates,
        id: routeId, // ID cannot be changed
      };

      const newRoutes = [...result.data.routes];
      newRoutes[routeIndex] = updatedRoute as RouteSpec;

      // Validate
      const newManifest: RoutesManifest = {
        version: result.data.version,
        routes: newRoutes,
      };

      const validation = validateManifest(newManifest);
      if (!validation.success) {
        return { error: validation.errors };
      }

      // Write updated manifest
      await writeJsonFile(paths.manifestPath, newManifest);

      // Update lock file
      await writeLock(paths.lockPath, newManifest);

      return {
        success: true,
        route: updatedRoute,
        message: `Route '${routeId}' updated successfully`,
      };
    },

    mandu_delete_route: async (args: Record<string, unknown>) => {
      const { routeId } = args as { routeId: string };

      // Load current manifest
      const result = await loadManifest(paths.manifestPath);
      if (!result.success || !result.data) {
        return { error: result.errors };
      }

      // Find route
      const routeIndex = result.data.routes.findIndex((r) => r.id === routeId);
      if (routeIndex === -1) {
        return { error: `Route not found: ${routeId}` };
      }

      const deletedRoute = result.data.routes[routeIndex];

      // Remove route
      const newRoutes = result.data.routes.filter((r) => r.id !== routeId);

      const newManifest: RoutesManifest = {
        version: result.data.version,
        routes: newRoutes,
      };

      // Write updated manifest
      await writeJsonFile(paths.manifestPath, newManifest);

      // Update lock file
      await writeLock(paths.lockPath, newManifest);

      return {
        success: true,
        deletedRoute,
        message: `Route '${routeId}' deleted successfully`,
      };
    },

    mandu_validate_spec: async () => {
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
