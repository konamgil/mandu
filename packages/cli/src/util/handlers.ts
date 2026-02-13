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

function hasHttpMethodHandlers(module: RouteModule): boolean {
  return HTTP_METHODS.some((method) => typeof module[method] === "function");
}

function createMethodDispatcher(module: RouteModule, routeId: string) {
  return async (req: Request, params: Record<string, string> = {}) => {
    const method = req.method.toUpperCase() as HttpMethod;
    const handler = module[method] as
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
  /** 모듈 import 함수 (dev: importFresh, start: 표준 import) */
  importFn: (modulePath: string) => Promise<any>;
  /** 이미 등록된 layout 경로 추적용 Set */
  registeredLayouts: Set<string>;
  /** 리로드 시 layout 캐시 클리어 */
  isReload?: boolean;
}

/**
 * 매니페스트 라우트를 서버 핸들러로 등록
 * dev.ts와 start.ts에서 공유
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

        // 1) ManduFilling 인스턴스
        if (handler && typeof handler.handle === "function") {
          console.log(`  🔄 ManduFilling 래핑: ${route.id}`);
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
          console.warn(`  ⚠️ API 핸들러 변환 실패: ${route.id} (type: ${typeof handler})`);
          continue;
        }

        registerApiHandler(route.id, handler);
        console.log(`  📡 API: ${route.pattern} -> ${route.id}`);
      } catch (error) {
        console.error(`  ❌ API 핸들러 로드 실패: ${route.id}`, error);
      }
    } else if (route.kind === "page" && route.componentModule) {
      const componentPath = path.resolve(rootDir, route.componentModule);
      const isIsland = needsHydration(route);
      const hasLayout = route.layoutChain && route.layoutChain.length > 0;

      // Layout 로더 등록
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

      // slotModule이 있으면 PageHandler 사용 (filling.loader 지원)
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
