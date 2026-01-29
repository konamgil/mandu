import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  loadManifest,
  buildClientBundles,
  formatSize,
  needsHydration,
  getRouteHydration,
  type BundleManifest,
  type HydrationStrategy,
  type HydrationPriority,
} from "@mandujs/core";
import { getProjectPaths, readJsonFile, writeJsonFile } from "../utils/project.js";
import path from "path";

export const hydrationToolDefinitions: Tool[] = [
  {
    name: "mandu_build",
    description:
      "Build client bundles for hydration. Compiles client slots (.client.ts) into browser-ready JavaScript bundles.",
    inputSchema: {
      type: "object",
      properties: {
        minify: {
          type: "boolean",
          description: "Minify the output bundles (default: true in production)",
        },
        sourcemap: {
          type: "boolean",
          description: "Generate source maps for debugging",
        },
      },
      required: [],
    },
  },
  {
    name: "mandu_build_status",
    description:
      "Get the current build status, bundle manifest, and statistics for client bundles.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_list_islands",
    description:
      "List all routes that have client-side hydration (islands). Shows hydration strategy and priority for each.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "mandu_set_hydration",
    description:
      "Set hydration configuration for a specific route. Updates the route's hydration strategy and priority.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to configure",
        },
        strategy: {
          type: "string",
          enum: ["none", "island", "full", "progressive"],
          description:
            "Hydration strategy: none (static), island (partial), full (entire page), progressive (lazy)",
        },
        priority: {
          type: "string",
          enum: ["immediate", "visible", "idle", "interaction"],
          description:
            "Hydration priority: immediate (on load), visible (in viewport), idle (when idle), interaction (on user action)",
        },
        preload: {
          type: "boolean",
          description: "Whether to preload the bundle with modulepreload",
        },
      },
      required: ["routeId"],
    },
  },
  {
    name: "mandu_add_client_slot",
    description:
      "Add a client slot file for a route to enable hydration. Creates the .client.ts file and updates the manifest.",
    inputSchema: {
      type: "object",
      properties: {
        routeId: {
          type: "string",
          description: "The route ID to add client slot for",
        },
        strategy: {
          type: "string",
          enum: ["island", "full", "progressive"],
          description: "Hydration strategy (default: island)",
        },
        priority: {
          type: "string",
          enum: ["immediate", "visible", "idle", "interaction"],
          description: "Hydration priority (default: visible)",
        },
      },
      required: ["routeId"],
    },
  },
];

export function hydrationTools(projectRoot: string) {
  const paths = getProjectPaths(projectRoot);

  return {
    mandu_build: async (args: Record<string, unknown>) => {
      const { minify, sourcemap } = args as {
        minify?: boolean;
        sourcemap?: boolean;
      };

      // Load manifest
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      // Build bundles
      const result = await buildClientBundles(manifestResult.data, projectRoot, {
        minify,
        sourcemap,
      });

      return {
        success: result.success,
        bundleCount: result.stats.bundleCount,
        totalSize: formatSize(result.stats.totalSize),
        totalGzipSize: formatSize(result.stats.totalGzipSize),
        buildTime: `${result.stats.buildTime.toFixed(0)}ms`,
        bundles: result.outputs.map((output) => ({
          routeId: output.routeId,
          path: output.outputPath,
          size: formatSize(output.size),
          gzipSize: formatSize(output.gzipSize),
        })),
        errors: result.errors,
        largestBundle: result.stats.largestBundle.routeId
          ? {
              routeId: result.stats.largestBundle.routeId,
              size: formatSize(result.stats.largestBundle.size),
            }
          : null,
      };
    },

    mandu_build_status: async () => {
      // Read bundle manifest
      const manifestPath = path.join(projectRoot, ".mandu/manifest.json");
      const manifest = await readJsonFile<BundleManifest>(manifestPath);

      if (!manifest) {
        return {
          hasBundles: false,
          message: "No bundle manifest found. Run mandu_build first.",
        };
      }

      const bundleCount = Object.keys(manifest.bundles).length;

      return {
        hasBundles: true,
        version: manifest.version,
        buildTime: manifest.buildTime,
        environment: manifest.env,
        bundleCount,
        shared: {
          runtime: manifest.shared.runtime,
          vendor: manifest.shared.vendor,
        },
        bundles: Object.entries(manifest.bundles).map(([routeId, bundle]) => ({
          routeId,
          js: bundle.js,
          css: bundle.css || null,
          priority: bundle.priority,
          dependencies: bundle.dependencies,
        })),
      };
    },

    mandu_list_islands: async () => {
      // Load manifest
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      const islands = manifestResult.data.routes
        .filter((route) => route.kind === "page")
        .map((route) => {
          const hydration = getRouteHydration(route);
          const isIsland = needsHydration(route);

          return {
            routeId: route.id,
            pattern: route.pattern,
            hasClientModule: !!route.clientModule,
            clientModule: route.clientModule || null,
            isIsland,
            hydration: {
              strategy: hydration.strategy,
              priority: hydration.priority,
              preload: hydration.preload,
            },
          };
        });

      const islandCount = islands.filter((i) => i.isIsland).length;
      const staticCount = islands.filter((i) => !i.isIsland).length;

      return {
        totalPages: islands.length,
        islandCount,
        staticCount,
        islands: islands.filter((i) => i.isIsland),
        staticPages: islands.filter((i) => !i.isIsland),
      };
    },

    mandu_set_hydration: async (args: Record<string, unknown>) => {
      const { routeId, strategy, priority, preload } = args as {
        routeId: string;
        strategy?: HydrationStrategy;
        priority?: HydrationPriority;
        preload?: boolean;
      };

      // Load manifest
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      const manifest = manifestResult.data;
      const routeIndex = manifest.routes.findIndex((r) => r.id === routeId);

      if (routeIndex === -1) {
        return { error: `Route not found: ${routeId}` };
      }

      const route = manifest.routes[routeIndex];

      if (route.kind !== "page") {
        return { error: `Route ${routeId} is not a page route (kind: ${route.kind})` };
      }

      // Update hydration config
      const currentHydration = route.hydration || {};
      const newHydration = {
        strategy: strategy || currentHydration.strategy || "island",
        priority: priority || currentHydration.priority || "visible",
        preload: preload !== undefined ? preload : currentHydration.preload || false,
      };

      // Validate: can't have clientModule with strategy: none
      if (newHydration.strategy === "none" && route.clientModule) {
        return {
          error: `Cannot set strategy to 'none' when clientModule is defined. Remove clientModule first or choose a different strategy.`,
        };
      }

      manifest.routes[routeIndex] = {
        ...route,
        hydration: newHydration,
      };

      // Write updated manifest
      await writeJsonFile(paths.manifestPath, manifest);

      return {
        success: true,
        routeId,
        previousHydration: route.hydration || { strategy: "none" },
        newHydration,
        message: `Updated hydration config for ${routeId}`,
      };
    },

    mandu_add_client_slot: async (args: Record<string, unknown>) => {
      const { routeId, strategy = "island", priority = "visible" } = args as {
        routeId: string;
        strategy?: HydrationStrategy;
        priority?: HydrationPriority;
      };

      // Load manifest
      const manifestResult = await loadManifest(paths.manifestPath);
      if (!manifestResult.success || !manifestResult.data) {
        return { error: manifestResult.errors };
      }

      const manifest = manifestResult.data;
      const routeIndex = manifest.routes.findIndex((r) => r.id === routeId);

      if (routeIndex === -1) {
        return { error: `Route not found: ${routeId}` };
      }

      const route = manifest.routes[routeIndex];

      if (route.kind !== "page") {
        return { error: `Route ${routeId} is not a page route` };
      }

      if (route.clientModule) {
        return {
          error: `Route ${routeId} already has a client module: ${route.clientModule}`,
        };
      }

      // Create client slot file in apps/web/components/ (not spec/slots/)
      const clientModulePath = `apps/web/components/${routeId}.client.tsx`;
      const clientFilePath = path.join(projectRoot, clientModulePath);

      // Check if file already exists
      const clientFile = Bun.file(clientFilePath);
      if (await clientFile.exists()) {
        return {
          error: `Client slot file already exists: ${clientModulePath}`,
        };
      }

      // Generate client slot template
      const template = generateClientSlotTemplate(routeId, route.slotModule);

      // Write client slot file
      await Bun.write(clientFilePath, template);

      // Update manifest
      manifest.routes[routeIndex] = {
        ...route,
        clientModule: clientModulePath,
        hydration: {
          strategy: strategy as HydrationStrategy,
          priority: priority as HydrationPriority,
          preload: false,
        },
      };

      await writeJsonFile(paths.manifestPath, manifest);

      return {
        success: true,
        routeId,
        clientModule: clientModulePath,
        hydration: {
          strategy,
          priority,
          preload: false,
        },
        message: `Created client slot: ${clientModulePath}`,
        nextSteps: [
          `Edit ${clientModulePath} to add client-side logic`,
          `Run mandu_build to compile the client bundle`,
          `The page will now hydrate in the browser`,
        ],
      };
    },
  };
}

/**
 * Generate a client slot template
 */
function generateClientSlotTemplate(routeId: string, slotModule?: string): string {
  const pascalCase = routeId
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

  const typeImport = slotModule
    ? `// Import types from server slot if needed
// import type { LoaderData } from "./${routeId}.slot";

`
    : "";

  return `/**
 * ${pascalCase} Client Slot
 * 브라우저에서 실행되는 클라이언트 로직
 */

import { Mandu } from "@mandujs/core/client";
import { useState, useCallback } from "react";

${typeImport}// 서버에서 전달받는 데이터 타입
interface ServerData {
  // TODO: Define your server data type
  [key: string]: unknown;
}

export default Mandu.island<ServerData>({
  /**
   * Setup Phase
   * - 서버 데이터를 받아 클라이언트 상태 초기화
   * - React hooks 사용 가능
   */
  setup: (serverData) => {
    // 서버 데이터로 상태 초기화
    const [data, setData] = useState(serverData);
    const [loading, setLoading] = useState(false);

    // 예시: 데이터 새로고침
    const refresh = useCallback(async () => {
      setLoading(true);
      try {
        // API 호출 예시
        // const res = await fetch("/api/${routeId}");
        // const newData = await res.json();
        // setData(newData);
      } finally {
        setLoading(false);
      }
    }, []);

    return {
      data,
      loading,
      refresh,
    };
  },

  /**
   * Render Phase
   * - setup 반환값을 props로 받음
   * - 순수 렌더링 로직
   */
  render: ({ data, loading, refresh }) => (
    <div className="${routeId}-island">
      {loading && <div className="loading">로딩 중...</div>}

      {/* TODO: Implement your UI */}
      <pre>{JSON.stringify(data, null, 2)}</pre>

      <button onClick={refresh} disabled={loading}>
        새로고침
      </button>
    </div>
  ),
});
`;
}
