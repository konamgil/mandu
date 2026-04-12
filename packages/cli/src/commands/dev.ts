import {
  startServer,
  startDevBundler,
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
import path from "path";

export interface DevOptions {
  port?: number;
  /** 서버 시작 후 브라우저 자동 열기 */
  open?: boolean;
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
  const HMR_OFFSET = 1;

  console.log(`🥟 Mandu Dev Server`);

  // Print lockfile status
  printRuntimeLockfileStatus(action, bypassed, lockfile, lockResult);

  // Load .env files
  const envResult = await loadEnv({
    rootDir,
    env: "development",
  });

  if (envResult.loaded.length > 0) {
    console.log(`🔐 Env loaded: ${envResult.loaded.join(", ")}`);
  }

  // Scan routes (FS Routes first, fallback to spec manifest)
  console.log(`📂 Scanning routes...`);
  let manifest: RoutesManifest;
  let enableFsRoutes = false;

  try {
    const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;
    enableFsRoutes = resolved.source === "fs";

    if (manifest.routes.length === 0) {
      printCLIError(CLI_ERROR_CODES.DEV_NO_ROUTES);
      console.log("💡 Create a page.tsx file in the app/ directory:");
      console.log("");
      console.log("  app/page.tsx        → /");
      console.log("  app/blog/page.tsx   → /blog");
      console.log("  app/api/users/route.ts → /api/users");
      console.log("");
      process.exit(1);
    }

    console.log(`✅ ${manifest.routes.length} route(s) found\n`);
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
      console.error("\n❌ Architecture Guard failed. Fix errors before starting dev server.");
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
  const hmrEnabled = devConfig.hmr ?? true;

  let port: number;
  try {
    const resolved = await resolveAvailablePort(desiredPort, {
      hostname: serverConfig.hostname,
      offsets: hasIslands && hmrEnabled ? [0, HMR_OFFSET] : [0],
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
    console.warn(`⚠️  Port ${desiredPort} is in use.`);
    console.warn(`    Dev server:    http://localhost:${port}`);
    console.warn(`    HMR WebSocket: ws://localhost:${port + HMR_OFFSET}`);
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

  if (!hasIslands) {
    // Build DevTools bundle even without Islands (_devtools.js needed in dev mode)
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
  const handleSSRChange = async (filePath: string) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`\n🔄 [${timestamp}] SSR change detected -> re-registering handlers`);
    clearDefaultRegistry();
    registeredLayouts.clear();
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
    console.log(`   ✅ SSR refresh complete — browser reload`);
  };

  if (hasIslands && hmrEnabled) {
    // Start HMR server
    hmrServer = createHMRServer(port);

    // Start dev bundler (file watching)
    devBundler = await startDevBundler({
      rootDir,
      manifest,
      watchDirs: devConfig.watchDirs,
      onRebuild: handleRebuild,
      onError: handleBundlerError,
      onSSRChange: handleSSRChange,
    });

    // Register restart handler
    hmrServer.setRestartHandler(async () => {
      // 1. Clear registry
      clearDefaultRegistry();
      registeredLayouts.clear();

      // 2. Rescan routes
      const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
      manifest = resolved.manifest;

      // 3. Re-register handlers (importFresh)
      await registerHandlers(manifest, true);

      // 4. Restart dev bundler
      devBundler?.close();
      devBundler = await startDevBundler({
        rootDir,
        manifest,
        watchDirs: devConfig.watchDirs,
        onRebuild: handleRebuild,
        onError: handleBundlerError,
        onSSRChange: handleSSRChange,
      });

      // 5. Full browser reload
      hmrServer?.broadcast({
        type: "reload",
        data: { timestamp: Date.now() },
      });

      console.log("✅ Full restart completed");
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

  // --open 옵션: 브라우저 자동 열기
  if (options.open) {
    const openUrl = `http://${serverConfig.hostname || "localhost"}:${actualPort}`;
    try {
      const { exec } = require("child_process");
      const cmd = process.platform === "win32" ? `start ${openUrl}`
        : process.platform === "darwin" ? `open ${openUrl}`
        : `xdg-open ${openUrl}`;
      exec(cmd);
    } catch { /* 브라우저 열기 실패 무시 */ }
  }

  // 시작 시간 표시
  const elapsed = Math.round(performance.now() - devStartTime);
  console.log(`🥟 Mandu Dev Server running at http://localhost:${actualPort}`);
  console.log(`🔥 HMR enabled on port ${actualPort + HMR_OFFSET}`);
  console.log(`⚡ Ready in ${elapsed}ms`);

  // FS Routes real-time watching
  const routesWatcher = await watchFSRoutes(rootDir, {
    onChange: async (result) => {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`\n🔄 [${timestamp}] Route change detected`);

      // Clear registry (including layout cache)
      clearDefaultRegistry();

      // Update server with new manifest
      manifest = result.manifest;
      console.log(`   📋 Routes: ${manifest.routes.length}`);

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

  // Cleanup function
  const cleanup = () => {
    console.log("\n🛑 Shutting down server...");
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
    console.log(`🛡️  Architecture Guard enabled (${guardPreset})`);

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
