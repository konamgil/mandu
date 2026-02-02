import {
  startServer,
  registerApiHandler,
  registerPageLoader,
  registerPageHandler,
  registerLayoutLoader,
  startDevBundler,
  createHMRServer,
  needsHydration,
  loadEnv,
  generateManifest,
  watchFSRoutes,
  clearDefaultRegistry,
  createGuardWatcher,
  checkDirectory,
  printReport,
  formatReportForAgent,
  formatReportAsAgentJSON,
  getPreset,
  type RoutesManifest,
  type GuardConfig,
  type GuardPreset,
  type Violation,
} from "@mandujs/core";
import { isDirectory, resolveFromCwd } from "../util/fs";
import { resolveOutputFormat, type OutputFormat } from "../util/output";
import path from "path";

export interface DevOptions {
  port?: number;
  /** HMR 비활성화 */
  noHmr?: boolean;
  /** FS Routes 비활성화 (레거시 모드) */
  legacy?: boolean;
  /** Architecture Guard 활성화 */
  guard?: boolean;
  /** Guard 프리셋 */
  guardPreset?: GuardPreset;
  /** Guard 출력 형식 */
  guardFormat?: OutputFormat;
}

export async function dev(options: DevOptions = {}): Promise<void> {
  const rootDir = resolveFromCwd(".");

  console.log(`🥟 Mandu Dev Server (FS Routes)`);

  // .env 파일 로드
  const envResult = await loadEnv({
    rootDir,
    env: "development",
  });

  if (envResult.loaded.length > 0) {
    console.log(`🔐 환경 변수 로드: ${envResult.loaded.join(", ")}`);
  }

  // FS Routes 스캔
  console.log(`📂 app/ 폴더 스캔 중...`);

  const result = await generateManifest(rootDir, {
    skipLegacy: true,
  });

  if (result.manifest.routes.length === 0) {
    console.log("");
    console.log("📭 라우트가 없습니다.");
    console.log("");
    console.log("💡 app/ 폴더에 page.tsx 파일을 생성하세요:");
    console.log("");
    console.log("  app/page.tsx        → /");
    console.log("  app/blog/page.tsx   → /blog");
    console.log("  app/api/users/route.ts → /api/users");
    console.log("");
    process.exit(1);
  }

  let manifest = result.manifest;
  console.log(`✅ ${manifest.routes.length}개 라우트 발견\n`);

  const enableFsRoutes = !options.legacy && await isDirectory(path.resolve(rootDir, "app"));
  const guardPreset = options.guardPreset || "mandu";
  const guardFormat = resolveOutputFormat(options.guardFormat);
  const guardConfig: GuardConfig | null =
    options.guard === false
      ? null
      : {
          preset: guardPreset,
          srcDir: "src",
          realtime: true,
          realtimeOutput: guardFormat,
          fsRoutes: enableFsRoutes
            ? {
                noPageToPage: true,
                pageCanImport: [
                  "client/pages",
                  "client/widgets",
                  "client/features",
                  "client/entities",
                  "client/shared",
                  "shared/contracts",
                  "shared/types",
                  "shared/utils/client",
                ],
                layoutCanImport: [
                  "client/app",
                  "client/widgets",
                  "client/shared",
                  "shared/contracts",
                  "shared/types",
                  "shared/utils/client",
                ],
                routeCanImport: [
                  "server/api",
                  "server/application",
                  "server/domain",
                  "server/infra",
                  "server/core",
                  "shared/contracts",
                  "shared/schema",
                  "shared/types",
                  "shared/utils/client",
                  "shared/utils/server",
                  "shared/env",
                ],
              }
            : undefined,
        };

  if (guardConfig) {
    const preflightReport = await checkDirectory(guardConfig, rootDir);
    if (preflightReport.bySeverity.error > 0) {
      if (guardFormat === "json") {
        console.log(formatReportAsAgentJSON(preflightReport, guardPreset));
      } else if (guardFormat === "agent") {
        console.log(formatReportForAgent(preflightReport, guardPreset));
      } else {
        printReport(preflightReport, getPreset(guardPreset).hierarchy);
      }
      console.error("\n❌ Architecture Guard failed. Fix errors before starting dev server.");
      process.exit(1);
    }
  }

  // Layout 경로 추적 (중복 등록 방지)
  const registeredLayouts = new Set<string>();

  // 핸들러 등록 함수
  const registerHandlers = async (manifest: RoutesManifest, isReload = false) => {
    // 리로드 시 레이아웃 캐시 클리어
    if (isReload) {
      registeredLayouts.clear();
    }

    for (const route of manifest.routes) {
      if (route.kind === "api") {
        const modulePath = path.resolve(rootDir, route.module);
        try {
          // 캐시 무효화 (HMR용)
          delete require.cache[modulePath];
          const module = await import(modulePath);
          registerApiHandler(route.id, module.default || module.handler || module);
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
                // 캐시 무효화 (HMR용)
                delete require.cache[absLayoutPath];
                return import(absLayoutPath);
              });
              registeredLayouts.add(layoutPath);
              console.log(`  🎨 Layout: ${layoutPath}`);
            }
          }
        }

        // slotModule이 있으면 PageHandler 사용 (filling.loader 지원)
        if (route.slotModule) {
          registerPageHandler(route.id, async () => {
            delete require.cache[componentPath];
            const module = await import(componentPath);
            return module.default;
          });
          console.log(`  📄 Page: ${route.pattern} -> ${route.id} (with loader)${isIsland ? " 🏝️" : ""}${hasLayout ? " 🎨" : ""}`);
        } else {
          registerPageLoader(route.id, () => {
            delete require.cache[componentPath];
            return import(componentPath);
          });
          console.log(`  📄 Page: ${route.pattern} -> ${route.id}${isIsland ? " 🏝️" : ""}${hasLayout ? " 🎨" : ""}`);
        }
      }
    }
  };

  // 초기 핸들러 등록
  await registerHandlers(manifest);
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

  // FS Routes 실시간 감시
  const routesWatcher = await watchFSRoutes(rootDir, {
    skipLegacy: true,
    onChange: async (result) => {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`\n🔄 [${timestamp}] 라우트 변경 감지`);

      // 레지스트리 클리어 (layout 캐시 포함)
      clearDefaultRegistry();

      // 새 매니페스트로 서버 업데이트
      manifest = result.manifest;
      console.log(`   📋 라우트: ${manifest.routes.length}개`);

      // 라우트 재등록 (isReload = true)
      await registerHandlers(manifest, true);

      // HMR 브로드캐스트 (전체 리로드)
      if (hmrServer) {
        hmrServer.broadcast({
          type: "reload",
          data: { timestamp: Date.now() },
        });
      }
    },
  });

  // Architecture Guard 실시간 감시 (선택적)
  let archGuardWatcher: ReturnType<typeof createGuardWatcher> | null = null;
  let guardFailed = false;

  // 정리 함수
  const cleanup = () => {
    console.log("\n🛑 서버 종료 중...");
    server.stop();
    devBundler?.close();
    hmrServer?.close();
    routesWatcher.close();
    archGuardWatcher?.close();
    process.exit(0);
  };

  const stopOnGuardError = (violation: Violation) => {
    if (violation.severity !== "error" || guardFailed) {
      return;
    }
    guardFailed = true;
    console.error("\n❌ Architecture Guard violation detected. Stopping dev server.");
    cleanup();
  };

  if (guardConfig) {
    console.log(`🛡️  Architecture Guard 활성화 (${guardPreset})`);

    archGuardWatcher = createGuardWatcher({
      config: guardConfig,
      rootDir,
      onViolation: stopOnGuardError,
      onFileAnalyzed: (analysis, violations) => {
        if (violations.length > 0) {
          // HMR 에러로 브로드캐스트
          hmrServer?.broadcast({
            type: "guard-violation",
            data: {
              file: analysis.filePath,
              violations: violations.map((v) => ({
                line: v.line,
                message: `${v.fromLayer} → ${v.toLayer}: ${v.ruleDescription}`,
              })),
            },
          });
        }
      },
    });

    archGuardWatcher.start();
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
