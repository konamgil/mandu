/**
 * mandu start - 프로덕션 서버 실행
 *
 * dev.ts에서 개발 전용 기능(HMR, 파일 감시, Guard)을 제거한 프로덕션 버전.
 * 반드시 mandu build 이후에 실행해야 합니다.
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

  // 빌드 결과물 확인
  const manifestJsonPath = path.join(rootDir, ".mandu/manifest.json");
  if (!fs.existsSync(manifestJsonPath)) {
    console.error("❌ 빌드 결과물이 없습니다. 먼저 'mandu build'를 실행하세요.");
    process.exit(1);
  }

  // 번들 매니페스트 로드
  let bundleManifest: BundleManifest | undefined;
  try {
    const raw = fs.readFileSync(manifestJsonPath, "utf-8");
    bundleManifest = JSON.parse(raw);
  } catch {
    console.warn("⚠️  번들 매니페스트 파싱 실패. Island hydration이 비활성됩니다.");
  }

  // Lockfile 검증 (strict: block 정책)
  const { lockfile, lockResult, action, bypassed } = await validateRuntimeLockfile(config, rootDir);
  handleBlockedLockfile(action, lockResult);

  const serverConfig = config.server ?? {};

  console.log(`🥟 Mandu Production Server`);

  // Lockfile 상태 출력
  printRuntimeLockfileStatus(action, bypassed, lockfile, lockResult);

  // .env 파일 로드 (production 모드)
  const envResult = await loadEnv({
    rootDir,
    env: "production",
  });

  if (envResult.loaded.length > 0) {
    console.log(`🔐 환경 변수 로드: ${envResult.loaded.join(", ")}`);
  }

  // 라우트 스캔
  console.log(`📂 라우트 스캔 중...`);
  let manifest: RoutesManifest;

  try {
    const resolved = await resolveManifest(rootDir, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;

    if (manifest.routes.length === 0) {
      printCLIError(CLI_ERROR_CODES.DEV_NO_ROUTES);
      process.exit(1);
    }

    console.log(`✅ ${manifest.routes.length}개 라우트 발견\n`);
  } catch (error) {
    printCLIError(CLI_ERROR_CODES.DEV_MANIFEST_NOT_FOUND);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // 핸들러 등록 (표준 import — 캐시 무효화 없음)
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

  // 포트 결정
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

  // 메인 서버 시작 (프로덕션 모드)
  const server = startServer(manifest, {
    port,
    hostname: serverConfig.hostname,
    rootDir,
    isDev: false,
    bundleManifest,
    cors: serverConfig.cors,
    streaming: serverConfig.streaming,
    rateLimit: serverConfig.rateLimit,
  });

  const actualPort = server.server.port ?? port;
  console.log(`\n🚀 Production server running on http://${serverConfig.hostname || "localhost"}:${actualPort}`);

  // Graceful shutdown
  const cleanup = () => {
    console.log("\n🛑 서버 종료 중...");
    server.stop();
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}
