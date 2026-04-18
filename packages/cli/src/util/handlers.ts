import {
  registerApiHandler,
  registerPageLoader,
  registerPageHandler,
  registerLayoutLoader,
  registerNotFoundHandler,
  registerWSHandler,
  needsHydration,
  type RoutesManifest,
  type PageRegistration,
} from "@mandujs/core";
import fs from "fs/promises";
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
  /**
   * Module import function (dev: importFresh, start: standard import).
   * The optional `opts.changedFile` is forwarded into Phase 7.0 B5's
   * incremental bundled-import: when the changed file is not in the
   * module's import graph, `importFn` returns the cached bundle in ~0.1 ms
   * instead of re-running Bun.build.
   */
  importFn: (modulePath: string, opts?: { changedFile?: string }) => Promise<any>;
  /** Set for tracking already registered layout paths */
  registeredLayouts: Set<string>;
  /** Clear layout cache on reload */
  isReload?: boolean;
  /**
   * Phase 7.0 B5 wire-up — on a live SSR reload, the changed file that
   * triggered the reload. Omit for cold boot / wildcard (full
   * invalidation). Forwarded to `importFn` so the incremental
   * `bundledImport` can skip rebuilds for modules the file isn't part of.
   */
  changedFile?: string;
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
  const { importFn, registeredLayouts, isReload = false, changedFile } = options;
  const importOpts: { changedFile?: string } | undefined =
    changedFile !== undefined ? { changedFile } : undefined;

  if (isReload) {
    registeredLayouts.clear();
  }

  for (const route of manifest.routes) {
    if (route.kind === "api") {
      const modulePath = path.resolve(rootDir, route.module);
      try {
        const module = await importFn(modulePath, importOpts);
        let handler = module.default || module.handler || module;

        // 1) ManduFilling instance
        if (handler && typeof handler.handle === "function") {
          console.log(`  🔄 ManduFilling wrapped: ${route.id}`);
          const filling = handler;

          // WebSocket 핸들러 등록
          if (typeof filling.hasWS === "function" && filling.hasWS()) {
            registerWSHandler(route.id, filling.getWSHandlers());
            console.log(`  🔌 WebSocket: ${route.pattern} -> ${route.id}`);
          }

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
              return importFn(absLayoutPath, importOpts);
            });
            registeredLayouts.add(layoutPath);
            console.log(`  🎨 Layout: ${layoutPath}`);
          }
        }
      }

      // Use PageHandler if slotModule exists (filling.loader support)
      if (route.slotModule) {
        registerPageHandler(route.id, async () => {
          const module = await importFn(componentPath, importOpts);
          // Normalize the page module shape. Users write pages in two styles:
          //   (a) `export default function Page() {…}` + `export const filling = …`
          //   (b) `export default { component: …, filling: … }`
          // Spreading a function default drops the component silently (you get
          // the function's own props like `name`/`length`, not the function).
          // Auto-promote form (a) to form (b) so both work without surprises.
          const rawDefault = module.default as unknown;
          const mod = module as Record<string, unknown>;

          let registration: PageRegistration;
          if (typeof rawDefault === "function") {
            registration = {
              component: rawDefault as PageRegistration["component"],
              filling: mod.filling as PageRegistration["filling"],
            };
          } else if (typeof rawDefault === "object" && rawDefault !== null) {
            registration = { ...(rawDefault as unknown as PageRegistration) };
          } else {
            throw new Error(
              `[Mandu] Page module '${route.id}' has no default export. ` +
                `Expected a React component or { component, filling } object.`,
            );
          }

          // #186: page 모듈의 metadata / generateMetadata 를 registration에 실어서
          // ensurePageRouteMetadata가 registry 캐시에 저장할 수 있게 전달.
          if (mod.metadata && typeof mod.metadata === "object") {
            registration.metadata = mod.metadata as PageRegistration["metadata"];
          }
          if (typeof mod.generateMetadata === "function") {
            registration.generateMetadata = mod.generateMetadata as PageRegistration["generateMetadata"];
          }
          return registration;
        });
        console.log(
          `  📄 Page: ${route.pattern} -> ${route.id} (with loader)${isIsland ? " 🏝️" : ""}${hasLayout ? " 🎨" : ""}`
        );
      } else {
        registerPageLoader(route.id, () => importFn(componentPath, importOpts));
        console.log(
          `  📄 Page: ${route.pattern} -> ${route.id}${isIsland ? " 🏝️" : ""}${hasLayout ? " 🎨" : ""}`
        );
      }
    }
  }

  // Phase 6.3: register `app/not-found.tsx` if it exists. Global, one per
  // app — the server falls through to the built-in 404 if unregistered.
  await registerAppNotFound(rootDir, importFn, importOpts);
}

/**
 * Phase 6.3: look for `app/not-found.tsx` (or its variants) at the
 * project root and register it as the app-level 404 handler. Silent
 * no-op if no file exists — the server's built-in 404 covers that case.
 */
async function registerAppNotFound(
  rootDir: string,
  importFn: (modulePath: string, opts?: { changedFile?: string }) => Promise<unknown>,
  importOpts?: { changedFile?: string },
): Promise<void> {
  const candidates = [
    "app/not-found.tsx",
    "app/not-found.ts",
    "app/not-found.jsx",
    "app/not-found.js",
  ];
  for (const rel of candidates) {
    const abs = path.resolve(rootDir, rel);
    try {
      await fs.access(abs);
    } catch {
      continue;
    }
    registerNotFoundHandler(async () => {
      const module = (await importFn(abs, importOpts)) as Record<string, unknown>;
      const rawDefault = module.default as unknown;
      if (typeof rawDefault === "function") {
        return {
          component: rawDefault as PageRegistration["component"],
          filling: module.filling as PageRegistration["filling"],
        };
      }
      if (typeof rawDefault === "object" && rawDefault !== null) {
        return { ...(rawDefault as PageRegistration) };
      }
      throw new Error(
        `[Mandu] app/not-found.tsx has no valid default export (type: ${typeof rawDefault})`,
      );
    });
    console.log(`  🚫 Not-Found: ${rel}`);
    return;
  }
}
