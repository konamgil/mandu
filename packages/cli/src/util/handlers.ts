import {
  registerApiHandler,
  registerPageLoader,
  registerPageHandler,
  registerLayoutLoader,
  needsHydration,
  type RoutesManifest,
} from "@mandujs/core";
import path from "path";

type RouteModule = Record<string, unknown>;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

function isHttpMethod(method: string): method is HttpMethod {
  return (HTTP_METHODS as readonly string[]).includes(method);
}

function hasHttpMethodHandlers(module: RouteModule): boolean {
  return HTTP_METHODS.some((method) => typeof module[method] === "function");
}

function createMethodDispatcher(module: RouteModule, routeId: string) {
  return async (req: Request, params: Record<string, string> = {}) => {
    const method = req.method.toUpperCase();
    const handler = (isHttpMethod(method) ? module[method] : undefined) as
      | ((request: Request, context?: { params: Record<string, string> }) => Response | Promise<Response>)
      | undefined;

    if (!handler) {
      return Response.json(
        {
          error: `Method ${method} not allowed for route ${routeId}`,
        },
        {
          status: 405,
          headers: {
            Allow: HTTP_METHODS.filter((m) => typeof module[m] === "function").join(", "),
          },
        }
      );
    }

    return handler(req, { params });
  };
}

export interface RegisterHandlersOptions {
  /** Module import function (dev: importFresh, start: standard import) */
  importFn: (modulePath: string) => Promise<any>;
  /** Set for tracking already registered layout paths */
  registeredLayouts: Set<string>;
  /** Clear layout cache on reload */
  isReload?: boolean;
}

/**
 * Register manifest routes as server handlers
 * Shared between dev.ts and start.ts
 */
export async function registerManifestHandlers(
  manifest: RoutesManifest,
  rootDir: string,
  options: RegisterHandlersOptions
): Promise<void> {
  const { importFn, registeredLayouts, isReload = false } = options;

  if (isReload) {
    registeredLayouts.clear();
  }

  for (const route of manifest.routes) {
    if (route.kind === "api") {
      const modulePath = path.resolve(rootDir, route.module);
      try {
        const module = await importFn(modulePath);
        let handler = module.default || module.handler || module;

        // 1) ManduFilling instance
        if (handler && typeof handler.handle === "function") {
          console.log(`  🔄 ManduFilling wrapped: ${route.id}`);
          const filling = handler;
          handler = async (req: Request, params?: Record<string, string>) => {
            return filling.handle(req, params);
          };
        }
        // 2) Route module with HTTP method exports (GET/POST/...)
        else if (handler && typeof handler === "object" && hasHttpMethodHandlers(handler as RouteModule)) {
          handler = createMethodDispatcher(handler as RouteModule, route.id);
        }

        if (typeof handler !== "function") {
          console.warn(`  ⚠️ API handler conversion failed: ${route.id} (type: ${typeof handler})`);
          continue;
        }

        registerApiHandler(route.id, handler);
        console.log(`  📡 API: ${route.pattern} -> ${route.id}`);
      } catch (error) {
        console.error(`  ❌ Failed to load API handler: ${route.id}`, error);
      }
    } else if (route.kind === "page" && route.componentModule) {
      const componentPath = path.resolve(rootDir, route.componentModule);
      const isIsland = needsHydration(route);
      const hasLayout = route.layoutChain && route.layoutChain.length > 0;

      // Register layout loaders
      if (route.layoutChain) {
        for (const layoutPath of route.layoutChain) {
          if (!registeredLayouts.has(layoutPath)) {
            const absLayoutPath = path.resolve(rootDir, layoutPath);
            registerLayoutLoader(layoutPath, async () => {
              return importFn(absLayoutPath);
            });
            registeredLayouts.add(layoutPath);
            console.log(`  🎨 Layout: ${layoutPath}`);
          }
        }
      }

      // Use PageHandler if slotModule exists (filling.loader support)
      if (route.slotModule) {
        registerPageHandler(route.id, async () => {
          const module = await importFn(componentPath);
          return module.default;
        });
        console.log(
          `  📄 Page: ${route.pattern} -> ${route.id} (with loader)${isIsland ? " 🏝️" : ""}${hasLayout ? " 🎨" : ""}`
        );
      } else {
        registerPageLoader(route.id, () => importFn(componentPath));
        console.log(
          `  📄 Page: ${route.pattern} -> ${route.id}${isIsland ? " 🏝️" : ""}${hasLayout ? " 🎨" : ""}`
        );
      }
    }
  }
}
