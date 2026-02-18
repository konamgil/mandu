/**
 * mandu start - Production server
 *
 * Production version of dev.ts without dev-only features (HMR, file watching, Guard).
 * Must be run after mandu build.
 */
import {
  startServer,
  loadEnv,
  validateAndReport,
  type RoutesManifest,
  type BundleManifest,
} from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";
import { CLI_ERROR_CODES, printCLIError } from "../errors";
import { resolveManifest } from "../util/manifest";
import { resolveAvailablePort } from "../util/port";
import {
  validateRuntimeLockfile,
  handleBlockedLockfile,
  printRuntimeLockfileStatus,
} from "../util/lockfile";
import { registerManifestHandlers } from "../util/handlers";
import path from "path";
import fs from "fs";

export interface StartOptions {
  port?: number;
}

export async function start(options: StartOptions = {}): Promise<void> {
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);

  if (!config) {
    printCLIError(CLI_ERROR_CODES.CONFIG_VALIDATION_FAILED);
    process.exit(1);
  }

  // Check build artifacts
  const manifestJsonPath = path.join(rootDir, ".mandu/manifest.json");
  if (!fs.existsSync(manifestJsonPath)) {
    console.error("❌ No build artifacts found. Run 'mandu build' first.");
    process.exit(1);
  }

  // Load bundle manifest
  let bundleManifest: BundleManifest | undefined;
  try {
    const raw = fs.readFileSync(manifestJsonPath, "utf-8");
    bundleManifest = JSON.parse(raw);
  } catch {
    console.warn("⚠️  Failed to parse bundle manifest. Island hydration will be disabled.");
  }

  // Lockfile validation (strict: block policy)
  const { lockfile, lockResult, action, bypassed } = await validateRuntimeLockfile(config, rootDir);
  handleBlockedLockfile(action, lockResult);

  const serverConfig = config.server ?? {};

  console.log(`🥟 Mandu Production Server`);

  // Print lockfile status
  printRuntimeLockfileStatus(action, bypassed, lockfile, lockResult);

  // Load .env files (production mode)
  const envResult = await loadEnv({
    rootDir,
    env: "production",
  });

  if (envResult.loaded.length > 0) {
    console.log(`🔐 Env loaded: ${envResult.loaded.join(", ")}`);
  }

  // Scan routes
  console.log(`📂 Scanning routes...`);
  let manifest: RoutesManifest;

  try {
    const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;

    if (manifest.routes.length === 0) {
      printCLIError(CLI_ERROR_CODES.DEV_NO_ROUTES);
      process.exit(1);
    }

    console.log(`✅ ${manifest.routes.length} route(s) found\n`);
  } catch (error) {
    printCLIError(CLI_ERROR_CODES.DEV_MANIFEST_NOT_FOUND);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Register handlers (standard import — no cache invalidation)
  const registeredLayouts = new Set<string>();
  const productionImport = async (modulePath: string) => {
    const url = Bun.pathToFileURL(modulePath);
    return import(url.href);
  };

  await registerManifestHandlers(manifest, rootDir, {
    importFn: productionImport,
    registeredLayouts,
  });
  console.log("");

  // Determine port
  const envPort = process.env.PORT ? Number(process.env.PORT) : undefined;
  const desiredPort =
    options.port ??
    (envPort && Number.isFinite(envPort) ? envPort : undefined) ??
    serverConfig.port ??
    3333;

  const { port } = await resolveAvailablePort(desiredPort, {
    hostname: serverConfig.hostname,
    offsets: [0],
  });

  if (port !== desiredPort) {
    console.warn(`⚠️  Port ${desiredPort} is in use. Using ${port} instead.`);
  }

  // Determine CSS path (inject when built CSS file exists)
  const cssFilePath = path.join(rootDir, ".mandu", "client", "globals.css");
  const hasCss = fs.existsSync(cssFilePath);
  const cssPath: string | false = hasCss ? "/.mandu/client/globals.css" : false;

  // Start main server (production mode)
  const server = startServer(manifest, {
    port,
    hostname: serverConfig.hostname,
    rootDir,
    isDev: false,
    bundleManifest,
    cors: serverConfig.cors,
    streaming: serverConfig.streaming,
    rateLimit: serverConfig.rateLimit,
    cssPath,
  });

  const actualPort = server.server.port ?? port;
  console.log(`\n🚀 Production server running on http://${serverConfig.hostname || "localhost"}:${actualPort}`);

  // Graceful shutdown
  const cleanup = () => {
    console.log("\n🛑 Shutting down server...");
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
