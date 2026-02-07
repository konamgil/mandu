import {
  registerApiHandler,
  registerPageLoader,
  registerPageHandler,
  registerLayoutLoader,
  needsHydration,
  type RoutesManifest,
} from "@mandujs/core";
import path from "path";

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

        // ManduFilling 인스턴스를 핸들러 함수로 래핑
        if (handler && typeof handler.handle === "function") {
          console.log(`  🔄 ManduFilling 래핑: ${route.id}`);
          const filling = handler;
          handler = async (req: Request, params?: Record<string, string>) => {
            return filling.handle(req, params);
          };
        } else {
          console.log(
            `  ⚠️ 핸들러 타입: ${typeof handler}, handle: ${typeof handler?.handle}`
          );
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
