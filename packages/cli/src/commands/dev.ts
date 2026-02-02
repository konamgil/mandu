import {
  loadManifest,
  startServer,
  registerApiHandler,
  registerPageLoader,
  registerPageHandler,
  startDevBundler,
  createHMRServer,
  needsHydration,
  loadEnv,
} from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";
import path from "path";

export interface DevOptions {
  port?: number;
  /** HMR 비활성화 */
  noHmr?: boolean;
}

export async function dev(options: DevOptions = {}): Promise<void> {
  const specPath = resolveFromCwd("spec/routes.manifest.json");
  const rootDir = resolveFromCwd(".");

  console.log(`🥟 Mandu Dev Server`);

  // .env 파일 로드
  const envResult = await loadEnv({
    rootDir,
    env: "development",
  });

  if (envResult.loaded.length > 0) {
    console.log(`🔐 환경 변수 로드: ${envResult.loaded.join(", ")}`);
  }

  console.log(`📄 Spec 파일: ${specPath}\n`);

  const result = await loadManifest(specPath);

  if (!result.success || !result.data) {
    console.error("❌ Spec 로드 실패:");
    result.errors?.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  const manifest = result.data;
  console.log(`✅ Spec 로드 완료: ${manifest.routes.length}개 라우트`);

  // 핸들러 등록
  for (const route of manifest.routes) {
    if (route.kind === "api") {
      const modulePath = path.resolve(rootDir, route.module);
      try {
        const module = await import(modulePath);
        registerApiHandler(route.id, module.default || module.handler);
        console.log(`  📡 API: ${route.pattern} -> ${route.id}`);
      } catch (error) {
        console.error(`  ❌ API 핸들러 로드 실패: ${route.id}`, error);
      }
    } else if (route.kind === "page" && route.componentModule) {
      const componentPath = path.resolve(rootDir, route.componentModule);
      const isIsland = needsHydration(route);

      // slotModule이 있으면 PageHandler 사용 (filling.loader 지원)
      if (route.slotModule) {
        registerPageHandler(route.id, async () => {
          const module = await import(componentPath);
          // module.default = { component, filling }
          return module.default;
        });
        console.log(`  📄 Page: ${route.pattern} -> ${route.id} (with loader)${isIsland ? " 🏝️" : ""}`);
      } else {
        // slotModule이 없으면 기존 PageLoader 사용
        registerPageLoader(route.id, () => import(componentPath));
        console.log(`  📄 Page: ${route.pattern} -> ${route.id}${isIsland ? " 🏝️" : ""}`);
      }
    }
  }

  console.log("");

  const port = options.port || Number(process.env.PORT) || 3000;

  // HMR 서버 시작 (클라이언트 슬롯이 있는 경우)
  let hmrServer: ReturnType<typeof createHMRServer> | null = null;
  let devBundler: Awaited<ReturnType<typeof startDevBundler>> | null = null;

  const hasIslands = manifest.routes.some(
    (r) => r.kind === "page" && r.clientModule && needsHydration(r)
  );

  if (hasIslands && !options.noHmr) {
    // HMR 서버 시작
    hmrServer = createHMRServer(port);

    // Dev 번들러 시작 (파일 감시)
    devBundler = await startDevBundler({
      rootDir,
      manifest,
      onRebuild: (result) => {
        if (result.success) {
          if (result.routeId === "*") {
            hmrServer?.broadcast({
              type: "reload",
              data: {
                timestamp: Date.now(),
              },
            });
          } else {
            hmrServer?.broadcast({
              type: "island-update",
              data: {
                routeId: result.routeId,
                timestamp: Date.now(),
              },
            });
          }
        } else {
          hmrServer?.broadcast({
            type: "error",
            data: {
              routeId: result.routeId,
              message: result.error,
            },
          });
        }
      },
      onError: (error, routeId) => {
        hmrServer?.broadcast({
          type: "error",
          data: {
            routeId,
            message: error.message,
          },
        });
      },
    });
  }

  // 메인 서버 시작
  const server = startServer(manifest, {
    port,
    rootDir,
    isDev: true,
    hmrPort: hmrServer ? port : undefined,
    bundleManifest: devBundler?.initialBuild.manifest,
  });

  // 정리 함수
  const cleanup = () => {
    console.log("\n🛑 서버 종료 중...");
    server.stop();
    devBundler?.close();
    hmrServer?.close();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
