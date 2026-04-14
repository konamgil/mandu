import {
  startServer,
  startDevBundler,
  SSR_CHANGE_WILDCARD,
  buildClientBundles,
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
  runHook,
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
import {
  validateRuntimeLockfile,
  handleBlockedLockfile,
  printRuntimeLockfileStatus,
} from "../util/lockfile";
import { registerManifestHandlers } from "../util/handlers";
import { getFsRoutesGuardPolicy } from "../util/guard-policy";
import { openBrowser } from "../util/browser";
import {
  handleDevShortcutInput,
  renderDevReadySummary,
  shouldEnableDevShortcuts,
} from "../util/dev-shortcuts";
import { removeRuntimeControl, writeRuntimeControl } from "../util/runtime-control";
import path from "path";

export interface DevOptions {
  port?: number;
  /** 서버 시작 후 브라우저 자동 열기 */
  open?: boolean;
}

function logDevEvent(title: string, details: string[] = []): void {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n[${timestamp}] ${title}`);
  for (const detail of details) {
    console.log(`  ${detail}`);
  }
}

export async function dev(options: DevOptions = {}): Promise<void> {
  const devStartTime = performance.now();
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);

  if (!config) {
    printCLIError(CLI_ERROR_CODES.CONFIG_VALIDATION_FAILED);
    process.exit(1);
  }

  // Lockfile validation (config integrity)
  const { lockfile, lockResult, action, bypassed } = await validateRuntimeLockfile(config, rootDir);
  handleBlockedLockfile(action, lockResult);

  const serverConfig = config.server ?? {};
  const devConfig = config.dev ?? {};
  const guardConfigFromFile = config.guard ?? {};
  const plugins = config.plugins ?? [];
  const hooks = config.hooks;
  const HMR_OFFSET = 1;

  console.log("Starting dev server...");

  // Print lockfile status
  printRuntimeLockfileStatus(action, bypassed, lockfile, lockResult);

  // Load .env files
  const envResult = await loadEnv({
    rootDir,
    env: "development",
  });

  if (envResult.loaded.length > 0) {
    console.log(`Env loaded: ${envResult.loaded.join(", ")}`);
  }

  // Phase 6-1: SQLite observability store 시작 (옵션)
  if (devConfig.observability !== false) {
    try {
      const { startSqliteStore } = await import("@mandujs/core/observability");
      await startSqliteStore(rootDir);
    } catch { /* SQLite 미사용 환경에서는 무시 */ }
  }

  // Scan routes (FS Routes first, fallback to spec manifest)
  console.log("Scanning routes...");
  let manifest: RoutesManifest;
  let enableFsRoutes = false;

  try {
    const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;
    enableFsRoutes = resolved.source === "fs";

    if (manifest.routes.length === 0) {
      printCLIError(CLI_ERROR_CODES.DEV_NO_ROUTES);
      console.log("Create a page.tsx file in the app/ directory:");
      console.log("");
      console.log("  app/page.tsx             -> /");
      console.log("  app/blog/page.tsx        -> /blog");
      console.log("  app/api/users/route.ts   -> /api/users");
      console.log("");
      process.exit(1);
    }

    console.log(`Routes found: ${manifest.routes.length}\n`);
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
          fsRoutes: getFsRoutesGuardPolicy(enableFsRoutes),
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
      console.error("\nArchitecture Guard failed. Fix errors before starting dev server.");
      process.exit(1);
    }
  }

  // Track layout paths (prevent duplicate registration)
  const registeredLayouts = new Set<string>();

  // Handler registration function (uses shared utility)
  const registerHandlers = async (m: RoutesManifest, isReload = false) => {
    await registerManifestHandlers(m, rootDir, {
      importFn: importFresh,
      registeredLayouts,
      isReload,
    });
  };

  // Register initial handlers
  await registerHandlers(manifest);
  console.log("");

  const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
  const desiredPort =
    options.port ??
    (envPort && Number.isFinite(envPort) ? envPort : undefined) ??
    serverConfig.port ??
    3333;

  // Port is explicitly configured if it came from CLI flag, env var, or config file
  const isExplicitPort = !!(
    options.port ||
    (envPort && Number.isFinite(envPort)) ||
    serverConfig.port
  );

  const hasIslands = manifest.routes.some(
    (r) => r.kind === "page" && r.clientModule && needsHydration(r)
  );
  const routeStats = {
    pageCount: manifest.routes.filter((route) => route.kind === "page").length,
    apiCount: manifest.routes.filter((route) => route.kind === "api").length,
    islandCount: manifest.routes.filter((route) => route.kind === "page" && route.clientModule).length,
  };
  const hmrEnabled = devConfig.hmr ?? true;
  const managementToken = crypto.randomUUID();

  let port: number;
  try {
    const resolved = await resolveAvailablePort(desiredPort, {
      hostname: serverConfig.hostname,
      // HMR 활성화 시 항상 HMR 포트 예약 (island 유무 무관)
      offsets: hmrEnabled ? [0, HMR_OFFSET] : [0],
      strict: isExplicitPort,
    });
    port = resolved.port;
  } catch (error) {
    if (isExplicitPort) {
      printCLIError(CLI_ERROR_CODES.DEV_PORT_IN_USE, { port: desiredPort });
      process.exit(1);
    }
    throw error;
  }

  if (port !== desiredPort) {
    console.warn(`Port ${desiredPort} is in use.`);
    console.warn(`  Dev server:    http://localhost:${port}`);
    console.warn(`  HMR WebSocket: ws://localhost:${port + HMR_OFFSET}`);
  }

  // Start HMR server (when client slots exist)
  let hmrServer: ReturnType<typeof createHMRServer> | null = null;
  let devBundler: Awaited<ReturnType<typeof startDevBundler>> | null = null;
  let cssWatcher: CSSWatcher | null = null;

  // Start CSS build (only when Tailwind v4 detected)
  const hasTailwind = await isTailwindProject(rootDir);
  if (hasTailwind) {
    cssWatcher = await startCSSWatch({
      rootDir,
      watch: true,
      onBuild: (result) => {
        if (result.success && hmrServer) {
          // Use cssWatcher.serverPath for path consistency
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

  if (!hasIslands && !hmrEnabled) {
    // HMR 비활성 + island 없음: devBundler가 안 도니까 수동으로 DevTools 번들 빌드
    await buildClientBundles(manifest, rootDir, { minify: false });
  }

  // Dev bundler callbacks (extracted as named functions for restart reuse)
  const handleRebuild = (result: { routeId: string; success: boolean; error?: string; file?: string }) => {
    if (result.success) {
      // Broadcast file change for Kitchen Preview
      if (result.file) {
        hmrServer?.broadcast({
          type: "kitchen:file-change",
          data: {
            file: result.file,
            changeType: "change",
            timestamp: Date.now(),
          },
        });
      }

      if (result.routeId === "*") {
        hmrServer?.broadcast({
          type: "reload",
          data: { timestamp: Date.now() },
        });
      } else {
        hmrServer?.broadcast({
          type: "island-update",
          data: { routeId: result.routeId, timestamp: Date.now() },
        });
      }
    } else {
      hmrServer?.broadcast({
        type: "error",
        data: { routeId: result.routeId, message: result.error },
      });
    }
  };

  const handleBundlerError = (error: Error, routeId?: string) => {
    hmrServer?.broadcast({
      type: "error",
      data: { routeId, message: error.message },
    });
  };

  // SSR file change callback (page.tsx, layout.tsx -> re-register server handlers + browser reload)
  // #184: wildcard ("*") 입력 시 전체 레지스트리 invalidate (common dir 변경)
  const handleSSRChange = async (filePath: string) => {
    const isWildcard = filePath === SSR_CHANGE_WILDCARD;
    if (isWildcard) {
      logDevEvent("Common dir changed", [
        "Action: clear SSR registry + re-register handlers",
        "Note: Bun의 transitive ESM 캐시 때문에 transitive 의존성까지 완전히 갱신되지 않을 수 있음",
      ]);
    } else {
      logDevEvent("SSR change detected", [
        `File: ${path.relative(rootDir, filePath)}`,
        "Action: re-register handlers",
        "Browser: full reload",
      ]);
    }

    clearDefaultRegistry();
    registeredLayouts.clear();
    await registerHandlers(manifest, true);

    // Kitchen Preview에는 파일 경로가 있을 때만 broadcast (wildcard는 파일 경로 없음)
    if (!isWildcard) {
      hmrServer?.broadcast({
        type: "kitchen:file-change",
        data: {
          file: filePath,
          changeType: "change",
          timestamp: Date.now(),
        },
      });
    }

    hmrServer?.broadcast({
      type: "reload",
      data: { timestamp: Date.now() },
    });
    console.log("  Status: SSR refresh complete");
  };

  // API route file change callback (route.ts -> re-register API handler + browser reload)
  const handleAPIChange = async (filePath: string) => {
    logDevEvent("API route changed", [
      `File: ${path.relative(rootDir, filePath)}`,
      "Action: re-register API handler",
    ]);
    await registerHandlers(manifest, true);

    // Broadcast file change for Kitchen Preview
    hmrServer?.broadcast({
      type: "kitchen:file-change",
      data: {
        file: filePath,
        changeType: "change",
        timestamp: Date.now(),
      },
    });

    hmrServer?.broadcast({
      type: "reload",
      data: { timestamp: Date.now() },
    });
    console.log("  Status: API handler refreshed");
  };

  const restartDevServer = async () => {
    clearDefaultRegistry();
    registeredLayouts.clear();

    const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;
    await registerHandlers(manifest, true);

    if (hmrServer) {
      devBundler?.close();
      devBundler = await startDevBundler({
        rootDir,
        manifest,
        watchDirs: devConfig.watchDirs,
        onRebuild: handleRebuild,
        onError: handleBundlerError,
        onSSRChange: handleSSRChange,
        onAPIChange: handleAPIChange,
      });

      hmrServer.broadcast({
        type: "reload",
        data: { timestamp: Date.now() },
      });
    }

    console.log("Restart complete.");
  };

  if (hmrEnabled) {
    // HMR 서버는 island 유무와 무관하게 시작 (SSR 페이지에서도 CSS/페이지 리로드 필요)
    hmrServer = createHMRServer(port);
    hmrServer.setRestartHandler(async () => {
      await restartDevServer();
    });

    // Dev bundler: 파일 감시 + 리빌드 (island이 있으면 island 리빌드, 없어도 SSR 변경 감지)
    devBundler = await startDevBundler({
      rootDir,
      manifest,
      watchDirs: devConfig.watchDirs,
      onRebuild: handleRebuild,
      onError: handleBundlerError,
      onSSRChange: handleSSRChange,
      onAPIChange: handleAPIChange,
    });
  }

  // Start main server
  const server = startServer(manifest, {
    port,
    hostname: serverConfig.hostname,
    rootDir,
    isDev: true,
    hmrPort: hmrServer ? port : undefined,
    bundleManifest: devBundler?.initialBuild.manifest,
    cors: serverConfig.cors,
    streaming: serverConfig.streaming,
    rateLimit: serverConfig.rateLimit,
    // Inject CSS link only when Tailwind detected
    cssPath: hasTailwind ? cssWatcher?.serverPath : false,
    guardConfig,
    cache: true,
    managementToken,
  });

  const actualPort = server.server.port ?? port;
  if (actualPort !== port) {
    if (hmrServer) {
      hmrServer.close();
      hmrServer = createHMRServer(actualPort);
      hmrServer.setRestartHandler(async () => {
        await restartDevServer();
      });
      server.registry.settings.hmrPort = actualPort;
      console.log(`HMR port updated: ${actualPort + HMR_OFFSET}`);
    }
  }

  const openUrl = `http://${serverConfig.hostname || "localhost"}:${actualPort}`;

  // --open 옵션: 브라우저 자동 열기
  if (options.open) {
    openBrowser(openUrl);
  }

  // 시작 시간 표시
  const elapsed = Math.round(performance.now() - devStartTime);
  const readySummary = renderDevReadySummary({
    url: openUrl,
    hmrUrl: hmrServer ? `ws://localhost:${actualPort + HMR_OFFSET}` : undefined,
    guardLabel: guardConfig ? `${guardPreset} (watching)` : "disabled",
    pageCount: routeStats.pageCount,
    apiCount: routeStats.apiCount,
    islandCount: routeStats.islandCount,
    readyMs: elapsed,
  });
  console.log(readySummary);

  await writeRuntimeControl(rootDir, {
    mode: "dev",
    port: actualPort,
    token: managementToken,
    baseUrl: openUrl,
    startedAt: new Date().toISOString(),
  });

  await runHook("onDevStart", plugins, hooks, {
    port: actualPort,
    hostname: serverConfig.hostname || "localhost",
  });

  // FS Routes real-time watching
  const routesWatcher = await watchFSRoutes(rootDir, {
    onChange: async (result) => {
      // Clear registry (including layout cache)
      clearDefaultRegistry();

      // Update server with new manifest
      manifest = result.manifest;
      logDevEvent("Route manifest updated", [
        `Routes: ${manifest.routes.length}`,
        "Browser: full reload",
      ]);

      // Re-register routes (isReload = true)
      await registerHandlers(manifest, true);

      // HMR broadcast (full reload)
      if (hmrServer) {
        hmrServer.broadcast({
          type: "reload",
          data: { timestamp: Date.now() },
        });
      }
    },
  });

  // Architecture Guard real-time watch (optional)
  let archGuardWatcher: ReturnType<typeof createGuardWatcher> | null = null;
  let guardFailed = false;
  let shortcutCleanup: (() => void) | null = null;

  // Cleanup function
  const cleanup = () => {
    console.log("\nStopping dev server...");
    void runHook("onDevStop", plugins, hooks);
    server.stop();
    devBundler?.close();
    hmrServer?.close();
    cssWatcher?.close();
    routesWatcher.close();
    archGuardWatcher?.close();
    shortcutCleanup?.();
    // Phase 6-1: SQLite store 정리
    void import("@mandujs/core/observability").then((m) => m.stopSqliteStore?.()).catch(() => {});
    void removeRuntimeControl(rootDir).finally(() => {
      process.exit(0);
    });
  };

  const stopOnGuardError = (violation: Violation) => {
    if (violation.severity !== "error" || guardFailed) {
      return;
    }
    guardFailed = true;
    console.error("\nArchitecture Guard violation detected. Stopping dev server.");
    cleanup();
  };

  if (guardConfig) {
    archGuardWatcher = createGuardWatcher({
      config: guardConfig,
      rootDir,
      onViolation: stopOnGuardError,
      onFileAnalyzed: (analysis, violations) => {
        if (violations.length > 0) {
          // Broadcast as HMR error
          hmrServer?.broadcast({
            type: "guard-violation",
            data: {
              file: analysis.filePath,
              violations: violations.map((v) => ({
                line: v.line,
                message: `${v.fromLayer} -> ${v.toLayer}: ${v.ruleDescription}`,
              })),
            },
          });
        }
      },
    });

    archGuardWatcher.start();
  }

  if (shouldEnableDevShortcuts()) {
    shortcutCleanup = attachDevShortcuts({
      openUrl,
      readySummary,
      rootDir,
      restart: restartDevServer,
      cleanup,
    });
  }

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

function attachDevShortcuts(options: {
  openUrl: string;
  readySummary: string;
  rootDir: string;
  restart: () => Promise<void>;
  cleanup: () => void;
}): (() => void) | null {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return null;
  }

  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  // MCP activity monitor state — Phase 2-2: EventBus 기반 (#ATIVITY-LOG)
  let mcpMonitorActive = false;
  let mcpUnsubscribe: (() => void) | null = null;

  const toggleMonitor = async () => {
    mcpMonitorActive = !mcpMonitorActive;
    if (mcpMonitorActive) {
      console.log("\n🤖 MCP activity: ON (press 'm' again to stop)");
      const { eventBus } = await import("@mandujs/core/observability");
      mcpUnsubscribe = eventBus.on("mcp", (event) => {
        if (!mcpMonitorActive) return;
        const ts = new Date().toLocaleTimeString();
        const dur = event.duration ? ` ${Math.round(event.duration)}ms` : "";
        console.log(`[${ts}] 🤖 ${event.message}${dur}`);
      });
    } else {
      mcpUnsubscribe?.();
      mcpUnsubscribe = null;
      console.log("\n🤖 MCP activity: OFF");
    }
  };

  const onData = async (chunk: string) => {
    if (chunk === "\u0003") {
      options.cleanup();
      return;
    }

    await handleDevShortcutInput(chunk, {
      clearScreen: () => {
        console.clear();
        console.log(options.readySummary);
      },
      openBrowser: () => openBrowser(options.openUrl),
      restartServer: options.restart,
      toggleMonitor,
      quit: options.cleanup,
    });
  };

  stdin.on("data", onData);

  return () => {
    stdin.off("data", onData);
    stdin.setRawMode?.(false);
    mcpUnsubscribe?.();
  };
}
