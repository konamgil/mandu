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
  watchFSRoutes,
  clearDefaultRegistry,
  createGuardWatcher,
  checkDirectory,
  printReport,
  formatReportForAgent,
  formatReportAsAgentJSON,
  getPreset,
  validateAndReport,
  isTailwindProject,
  startCSSWatch,
  type RoutesManifest,
  type GuardConfig,
  type Violation,
  type CSSWatcher,
} from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";
import { resolveOutputFormat } from "../util/output";
import { CLI_ERROR_CODES, printCLIError } from "../errors";
import { importFresh } from "../util/bun";
import { resolveManifest } from "../util/manifest";
import { resolveAvailablePort } from "../util/port";
import path from "path";

export interface DevOptions {
  port?: number;
}

export async function dev(options: DevOptions = {}): Promise<void> {
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);

  if (!config) {
    printCLIError(CLI_ERROR_CODES.CONFIG_VALIDATION_FAILED);
    process.exit(1);
  }

  const serverConfig = config.server ?? {};
  const devConfig = config.dev ?? {};
  const guardConfigFromFile = config.guard ?? {};
  const HMR_OFFSET = 1;

  console.log(`🥟 Mandu Dev Server`);

  // .env 파일 로드
  const envResult = await loadEnv({
    rootDir,
    env: "development",
  });

  if (envResult.loaded.length > 0) {
    console.log(`🔐 환경 변수 로드: ${envResult.loaded.join(", ")}`);
  }

  // 라우트 스캔 (FS Routes 우선, 없으면 spec manifest)
  console.log(`📂 라우트 스캔 중...`);
  let manifest: RoutesManifest;
  let enableFsRoutes = false;

  try {
    const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;
    enableFsRoutes = resolved.source === "fs";

    if (manifest.routes.length === 0) {
      printCLIError(CLI_ERROR_CODES.DEV_NO_ROUTES);
      console.log("💡 app/ 폴더에 page.tsx 파일을 생성하세요:");
      console.log("");
      console.log("  app/page.tsx        → /");
      console.log("  app/blog/page.tsx   → /blog");
      console.log("  app/api/users/route.ts → /api/users");
      console.log("");
      process.exit(1);
    }

    console.log(`✅ ${manifest.routes.length}개 라우트 발견\n`);
  } catch (error) {
    printCLIError(CLI_ERROR_CODES.DEV_MANIFEST_NOT_FOUND);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const guardPreset = guardConfigFromFile.preset || "mandu";
  const guardFormat = resolveOutputFormat();
  const guardConfig: GuardConfig | null =
    guardConfigFromFile.realtime === false
      ? null
      : {
          preset: guardPreset,
          srcDir: guardConfigFromFile.srcDir || "src",
          realtime: guardConfigFromFile.realtime ?? true,
          exclude: guardConfigFromFile.exclude,
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
          const module = await importFresh(modulePath);
          let handler = module.default || module.handler || module;

          // ManduFilling 인스턴스를 핸들러 함수로 래핑
          if (handler && typeof handler.handle === 'function') {
            console.log(`  🔄 ManduFilling 래핑: ${route.id}`);
            const filling = handler;
            handler = async (req: Request, params?: Record<string, string>) => {
              return filling.handle(req, params);
            };
          } else {
            console.log(`  ⚠️ 핸들러 타입: ${typeof handler}, handle: ${typeof handler?.handle}`);
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
                // 캐시 무효화 (HMR용)
                return importFresh(absLayoutPath);
              });
              registeredLayouts.add(layoutPath);
              console.log(`  🎨 Layout: ${layoutPath}`);
            }
          }
        }

        // slotModule이 있으면 PageHandler 사용 (filling.loader 지원)
        if (route.slotModule) {
          registerPageHandler(route.id, async () => {
            const module = await importFresh(componentPath);
            return module.default;
          });
          console.log(`  📄 Page: ${route.pattern} -> ${route.id} (with loader)${isIsland ? " 🏝️" : ""}${hasLayout ? " 🎨" : ""}`);
        } else {
          registerPageLoader(route.id, () => importFresh(componentPath));
          console.log(`  📄 Page: ${route.pattern} -> ${route.id}${isIsland ? " 🏝️" : ""}${hasLayout ? " 🎨" : ""}`);
        }
      }
    }
  };

  // 초기 핸들러 등록
  await registerHandlers(manifest);
  console.log("");

  const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
  const desiredPort =
    options.port ??
    (envPort && Number.isFinite(envPort) ? envPort : undefined) ??
    serverConfig.port ??
    3333;

  const hasIslands = manifest.routes.some(
    (r) => r.kind === "page" && r.clientModule && needsHydration(r)
  );
  const hmrEnabled = devConfig.hmr ?? true;

  const { port } = await resolveAvailablePort(desiredPort, {
    hostname: serverConfig.hostname,
    offsets: hasIslands && hmrEnabled ? [0, HMR_OFFSET] : [0],
  });

  if (port !== desiredPort) {
    console.warn(`⚠️  Port ${desiredPort} is in use. Using ${port} instead.`);
  }

  // HMR 서버 시작 (클라이언트 슬롯이 있는 경우)
  let hmrServer: ReturnType<typeof createHMRServer> | null = null;
  let devBundler: Awaited<ReturnType<typeof startDevBundler>> | null = null;
  let cssWatcher: CSSWatcher | null = null;

  // CSS 빌드 시작 (Tailwind v4 감지 시에만)
  const hasTailwind = await isTailwindProject(rootDir);
  if (hasTailwind) {
    cssWatcher = await startCSSWatch({
      rootDir,
      watch: true,
      onBuild: (result) => {
        if (result.success && hmrServer) {
          // cssWatcher.serverPath 사용 (경로 일관성)
          hmrServer.broadcast({
            type: "css-update",
            data: {
              cssPath: cssWatcher?.serverPath || "/.mandu/client/globals.css",
              timestamp: Date.now(),
            },
          });
        }
      },
      onError: (error) => {
        if (hmrServer) {
          hmrServer.broadcast({
            type: "error",
            data: {
              message: `CSS Error: ${error.message}`,
            },
          });
        }
      },
    });
  }

  if (hasIslands && hmrEnabled) {
    // HMR 서버 시작
    hmrServer = createHMRServer(port);

    // Dev 번들러 시작 (파일 감시)
    devBundler = await startDevBundler({
      rootDir,
      manifest,
      watchDirs: devConfig.watchDirs,
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
    hostname: serverConfig.hostname,
    rootDir,
    isDev: true,
    hmrPort: hmrServer ? port : undefined,
    bundleManifest: devBundler?.initialBuild.manifest,
    cors: serverConfig.cors,
    streaming: serverConfig.streaming,
    // Tailwind 감지 시에만 CSS 링크 주입
    cssPath: hasTailwind ? cssWatcher?.serverPath : false,
  });

  const actualPort = server.server.port ?? port;
  if (actualPort !== port) {
    if (hmrServer) {
      hmrServer.close();
      hmrServer = createHMRServer(actualPort);
      server.registry.settings.hmrPort = actualPort;
      console.log(`🔁 HMR port updated: ${actualPort + HMR_OFFSET}`);
    }
  }

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
    cssWatcher?.close();
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
