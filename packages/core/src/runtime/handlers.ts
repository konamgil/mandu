/**
 * Manifest → runtime registry wiring.
 *
 * Lives in `@mandujs/core/runtime` (not in `@mandujs/cli`) because it
 * runs at *server* boot, not at build time. Deploy adapters generate
 * SSR entry files that need to call this — having it here means the
 * generated entry imports a single, public package (`@mandujs/core`)
 * instead of reaching into a CLI subpath that has no `exports` map.
 *
 * @module core/runtime/handlers
 */
import fs from "node:fs/promises";
import path from "node:path";

import {
  registerApiHandler,
  registerPageLoader,
  registerPageHandler,
  registerLayoutLoader,
  registerNotFoundHandler,
  registerMetadataHandler,
  registerWSHandler,
  type PageRegistration,
} from "./server";
import { registerManifest } from "./registry";
import { needsHydration, type RouteClientBoundary, type RoutesManifest } from "../spec/schema";

type RouteModule = Record<string, unknown>;

/**
 * Structural shape of a `ManduFilling` instance as seen by the registrar.
 * Mirrors the subset of the public API we depend on (handle/hasWS/getWSHandlers)
 * without importing the concrete class — that would pull in runtime deps
 * the CLI shouldn't need at import time.
 */
interface FillingInstance {
  handle: (req: Request, params?: Record<string, string>) => Response | Promise<Response>;
  hasWS?: () => boolean;
  getWSHandlers?: () => Parameters<typeof registerWSHandler>[1];
}

function isFillingInstance(value: unknown): value is FillingInstance {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { handle?: unknown }).handle === "function"
  );
}

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
    // RFC 7231 §4.3.2: HEAD is GET without a body. When no explicit HEAD
    // export exists, dispatch to GET and strip the body — preserving the
    // status + headers GET produced. An explicit HEAD export wins.
    const stripBody = method === "HEAD" && typeof module.HEAD !== "function";
    const lookup = stripBody ? "GET" : method;
    const handler = (isHttpMethod(lookup) ? module[lookup] : undefined) as
      | ((request: Request, context?: { params: Record<string, string> }) => Response | Promise<Response>)
      | undefined;

    if (!handler) {
      const allow = HTTP_METHODS.filter((m) => typeof module[m] === "function");
      if (typeof module.GET === "function" && !allow.includes("HEAD")) {
        allow.push("HEAD");
      }
      // RFC 7231 §4.3.7: auto-respond to a plain OPTIONS request (no explicit
      // OPTIONS export) with 204 + an `Allow` header. CORS preflights (which
      // carry `Access-Control-Request-Method`) are left to the normal flow.
      if (method === "OPTIONS" && !req.headers.get("access-control-request-method")) {
        const optionsAllow = allow.includes("OPTIONS") ? allow : [...allow, "OPTIONS"];
        return new Response(null, {
          status: 204,
          headers: { Allow: optionsAllow.join(", ") },
        });
      }
      return Response.json(
        {
          error: `Method ${method} not allowed for route ${routeId}`,
        },
        {
          status: 405,
          headers: {
            Allow: allow.join(", "),
          },
        }
      );
    }

    const response = await handler(req, { params });
    if (stripBody) {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    return response;
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
  importFn: (
    modulePath: string,
    opts?: {
      changedFile?: string;
      clientBoundaryTransform?: {
        routeId: string;
        hydrate?: string;
        boundaries?: RouteClientBoundary[];
      };
    },
  ) => Promise<unknown>;
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
 * Register manifest routes as server handlers.
 * Shared between dev/build/start commands and deploy-target SSR entries.
 */
export async function registerManifestHandlers(
  manifest: RoutesManifest,
  rootDir: string,
  options: RegisterHandlersOptions
): Promise<void> {
  const { importFn, registeredLayouts, isReload = false, changedFile } = options;
  const baseImportOpts: { changedFile?: string } | undefined =
    changedFile !== undefined ? { changedFile } : undefined;
  const importOptsForRoute = (route?: RoutesManifest["routes"][number]) => {
    const boundaryTransform = route?.kind === "page" && route.boundaries?.length
        ? {
            routeId: route.id,
            hydrate: route.hydration?.priority ?? "visible",
            boundaries: route.boundaries,
          }
      : undefined;
    if (!baseImportOpts && !boundaryTransform) return undefined;
    return {
      ...baseImportOpts,
      ...(boundaryTransform ? { clientBoundaryTransform: boundaryTransform } : {}),
    };
  };

  if (isReload) {
    registeredLayouts.clear();
  }

  // Expose the live manifest through the runtime registry so user code can
  // read generated artifacts via `getGenerated("routes")` / `getManifest()`
  // — the only official path. See `packages/core/src/runtime/registry.ts`.
  registerManifest("routes", manifest);

  for (const route of manifest.routes) {
    // Issue #206: metadata routes (sitemap/robots/llms.txt/manifest)
    // register a thunk that lazily imports the user module. The
    // runtime dispatcher invokes the default export on each request
    // so HMR reloads pick up edits automatically (same pattern as
    // API routes below).
    if (route.kind === "metadata") {
      const modulePath = path.resolve(rootDir, route.module);
      registerMetadataHandler(route.id, async () => {
        return importFn(modulePath, importOptsForRoute(route));
      });
      console.log(`  🗺️  Metadata: ${route.pattern} -> ${route.id}`);
      continue;
    }

    if (route.kind === "api") {
      const modulePath = path.resolve(rootDir, route.module);
      try {
        const module = (await importFn(modulePath, importOptsForRoute(route))) as RouteModule;
        let handler: unknown = module.default ?? module.handler ?? module;

        // 1) ManduFilling instance
        if (isFillingInstance(handler)) {
          console.log(`  🔄 ManduFilling wrapped: ${route.id}`);
          const filling = handler;

          // WebSocket 핸들러 등록
          if (typeof filling.hasWS === "function" && filling.hasWS() && filling.getWSHandlers) {
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

        registerApiHandler(route.id, handler as (req: Request, params?: Record<string, string>) => Response | Promise<Response>);
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
            registerLayoutLoader(layoutPath, (async () => {
              // Layout modules must export a default component. Runtime
              // validation in `renderToHTML` / page-loader asserts this —
              // so casting the unknown `importFn` result is safe here.
              return importFn(absLayoutPath, baseImportOpts);
            }) as Parameters<typeof registerLayoutLoader>[1]);
            registeredLayouts.add(layoutPath);
            console.log(`  🎨 Layout: ${layoutPath}`);
          }
        }
      }

      // Use PageHandler if slotModule exists (filling.loader support)
      if (route.slotModule) {
        registerPageHandler(route.id, async () => {
          const mod = (await importFn(componentPath, importOptsForRoute(route))) as Record<string, unknown>;
          // Normalize the page module shape. Users write pages in two styles:
          //   (a) `export default function Page() {…}` + `export const filling = …`
          //   (b) `export default { component: …, filling: … }`
          // Spreading a function default drops the component silently (you get
          // the function's own props like `name`/`length`, not the function).
          // Auto-promote form (a) to form (b) so both work without surprises.
          const rawDefault = mod.default as unknown;

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
        registerPageLoader(route.id, (() => importFn(componentPath, importOptsForRoute(route))) as Parameters<typeof registerPageLoader>[1]);
        console.log(
          `  📄 Page: ${route.pattern} -> ${route.id}${isIsland ? " 🏝️" : ""}${hasLayout ? " 🎨" : ""}`
        );
      }
    }
  }

  // Phase 6.3: register `app/not-found.tsx` if it exists. Global, one per
  // app — the server falls through to the built-in 404 if unregistered.
  await registerAppNotFound(rootDir, importFn, baseImportOpts);
}

/**
 * Phase 6.3: look for `app/not-found.tsx` (or its variants) at the
 * project root and register it as the app-level 404 handler. Silent
 * no-op if no file exists — the server's built-in 404 covers that case.
 */
async function registerAppNotFound(
  rootDir: string,
  importFn: RegisterHandlersOptions["importFn"],
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
