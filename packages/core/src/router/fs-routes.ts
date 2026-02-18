/**
 * FS Routes Generator
 *
 * 스캔 결과를 RoutesManifest로 변환
 *
 * @module router/fs-routes
 */

import { writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import type { RoutesManifest, RouteSpec } from "../spec/schema";
import type { FSRouteConfig, FSScannerConfig, ScanResult } from "./fs-types";
import { DEFAULT_SCANNER_CONFIG } from "./fs-types";
import { scanRoutes } from "./fs-scanner";
import { loadManduConfig } from "../config";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 매니페스트 생성 결과
 */
export interface FSGenerateResult {
  /** 생성된 매니페스트 */
  manifest: RoutesManifest;

  /** FS Routes에서 생성된 라우트 수 */
  fsRoutesCount: number;

  /** 경고 메시지 */
  warnings: string[];
}

/**
 * 매니페스트 생성 옵션
 */
export interface GenerateOptions {
  /** 스캐너 설정 */
  scanner?: Partial<FSScannerConfig>;

  /** 출력 파일 경로 (지정 시 파일로 저장) */
  outputPath?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Conversion Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FSRouteConfig를 RouteSpec으로 변환
 */
export function fsRouteToRouteSpec(fsRoute: FSRouteConfig): RouteSpec {
  const base = {
    id: fsRoute.id,
    pattern: fsRoute.pattern,
    module: fsRoute.module,
  };

  if (fsRoute.kind === "page") {
    const pageRoute: RouteSpec = {
      ...base,
      kind: "page" as const,
      componentModule: fsRoute.componentModule ?? "",
      ...(fsRoute.clientModule
        ? {
            clientModule: fsRoute.clientModule,
            hydration: fsRoute.hydration ?? {
              strategy: "island" as const,
              priority: "visible" as const,
              preload: false,
            },
          }
        : {}),
      ...(fsRoute.layoutChain && fsRoute.layoutChain.length > 0
        ? { layoutChain: fsRoute.layoutChain }
        : {}),
      ...(fsRoute.loadingModule ? { loadingModule: fsRoute.loadingModule } : {}),
      ...(fsRoute.errorModule ? { errorModule: fsRoute.errorModule } : {}),
    };
    return pageRoute;
  }

  // API 라우트
  const apiRoute: RouteSpec = {
    ...base,
    kind: "api" as const,
    ...(fsRoute.methods ? { methods: fsRoute.methods } : {}),
  };
  return apiRoute;
}

/**
 * 스캔 결과를 RoutesManifest로 변환
 */
export function scanResultToManifest(scanResult: ScanResult): RoutesManifest {
  const routes = scanResult.routes.map(fsRouteToRouteSpec);

  return {
    version: 1,
    routes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Auto-Linking (spec/slots + spec/contracts → manifest routes)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 매니페스트 라우트에 slot/contract 모듈을 자동 연결
 *
 * ID 컨벤션 기반: route.id → spec/slots/{id}.slot.ts, spec/contracts/{id}.contract.ts
 */
export async function resolveAutoLinks(
  manifest: RoutesManifest,
  rootDir: string
): Promise<void> {
  await Promise.all(
    manifest.routes.map(async (route) => {
      const slotPath = join(rootDir, "spec", "slots", `${route.id}.slot.ts`);
      const contractPath = join(rootDir, "spec", "contracts", `${route.id}.contract.ts`);

      const [slotExists, contractExists] = await Promise.all([
        Bun.file(slotPath).exists(),
        Bun.file(contractPath).exists(),
      ]);

      if (slotExists) {
        route.slotModule = `spec/slots/${route.id}.slot.ts`;
      }
      if (contractExists) {
        route.contractModule = `spec/contracts/${route.id}.contract.ts`;
      }
    })
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Main Generator
// ═══════════════════════════════════════════════════════════════════════════

/**
 * mandu.config 기반 스캐너 설정 해석
 */
async function resolveScannerConfig(
  rootDir: string,
  scannerOverrides: Partial<FSScannerConfig> = {}
): Promise<FSScannerConfig> {
  const config = await loadManduConfig(rootDir);
  const configScanner = config.fsRoutes ?? {};

  return {
    ...DEFAULT_SCANNER_CONFIG,
    ...configScanner,
    ...scannerOverrides,
  };
}

/**
 * FS Routes 기반 매니페스트 생성
 *
 * app/ 디렉토리를 스캔하여 매니페스트를 생성하고
 * spec/slots/, spec/contracts/와 자동 연결한 후
 * .mandu/routes.manifest.json에 저장
 *
 * @example
 * const result = await generateManifest("/path/to/project");
 * console.log(result.manifest.routes);
 */
export async function generateManifest(
  rootDir: string,
  options: GenerateOptions = {}
): Promise<FSGenerateResult> {
  const scannerConfig = await resolveScannerConfig(rootDir, options.scanner);

  // FS Routes 스캔
  const scanResult = await scanRoutes(rootDir, scannerConfig);

  // 스캔 에러 체크
  if (scanResult.errors.length > 0) {
    const errorMessages = scanResult.errors.map((e) => `${e.type}: ${e.message}`);
    console.warn("FS Routes scan warnings:", errorMessages);
  }

  // FS Routes 매니페스트 생성
  const manifest = scanResultToManifest(scanResult);
  const warnings: string[] = [];

  // Auto-linking: spec/slots/, spec/contracts/ 자동 연결
  await resolveAutoLinks(manifest, rootDir);

  // .mandu/ 디렉토리에 매니페스트 저장
  const outputPath = options.outputPath ?? ".mandu/routes.manifest.json";
  const outputFullPath = join(rootDir, outputPath);
  await mkdir(dirname(outputFullPath), { recursive: true });
  await writeFile(outputFullPath, JSON.stringify(manifest, null, 2), "utf-8");

  return {
    manifest,
    fsRoutesCount: scanResult.routes.length,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Watch Mode Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 라우트 변경 콜백
 */
export type RouteChangeCallback = (result: FSGenerateResult) => void | Promise<void>;

/**
 * FS Routes 감시자 인터페이스
 */
export interface FSRoutesWatcher {
  /** 감시 중지 */
  close(): void;

  /** 수동 재스캔 */
  rescan(): Promise<FSGenerateResult>;
}

/**
 * FS Routes 감시 시작
 *
 * 파일 변경 시 자동으로 매니페스트 재생성
 *
 * @example
 * const watcher = await watchFSRoutes("/path/to/project", {
 *   onChange: (result) => {
 *     console.log("Routes updated:", result.manifest.routes.length);
 *   }
 * });
 *
 * // 나중에 중지
 * watcher.close();
 */
export async function watchFSRoutes(
  rootDir: string,
  options: GenerateOptions & { onChange?: RouteChangeCallback }
): Promise<FSRoutesWatcher> {
  const { onChange, ...generateOptions } = options;
  const scannerConfig = await resolveScannerConfig(rootDir, options.scanner);

  const routesDir = join(rootDir, scannerConfig.routesDir);
  const slotsDir = join(rootDir, "spec", "slots");
  const contractsDir = join(rootDir, "spec", "contracts");

  // chokidar 동적 import
  const chokidar = await import("chokidar");

  // Watch app/ routes directory
  const routesWatcher = chokidar.watch(routesDir, {
    ignored: Array.from(
      new Set([
        ...scannerConfig.exclude,
        "**/node_modules/**",
        "**/_*/**", // 비공개 폴더
        "**/*.test.*",
        "**/*.spec.*",
      ])
    ),
    persistent: true,
    ignoreInitial: true,
  });

  // Watch spec/slots/ and spec/contracts/ for auto-link refresh
  const specWatcher = chokidar.watch([slotsDir, contractsDir], {
    ignored: ["**/node_modules/**"],
    persistent: true,
    ignoreInitial: true,
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const triggerRescan = async (): Promise<FSGenerateResult> => {
    const result = await generateManifest(rootDir, generateOptions);
    if (onChange) {
      await onChange(result);
    }
    return result;
  };

  const debouncedRescan = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      triggerRescan().catch(console.error);
    }, 100);
  };

  // 파일 변경 이벤트 핸들러 (app/ routes)
  routesWatcher.on("add", debouncedRescan);
  routesWatcher.on("unlink", debouncedRescan);
  routesWatcher.on("change", debouncedRescan);

  // spec/slots/ and spec/contracts/ 변경 시 auto-link refresh
  specWatcher.on("add", debouncedRescan);
  specWatcher.on("unlink", debouncedRescan);

  return {
    close() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      routesWatcher.close();
      specWatcher.close();
    },
    async rescan() {
      return triggerRescan();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI Helper
// ═══════════════════════════════════════════════════════════════════════════

/**
 * CLI용 라우트 목록 출력 형식
 */
export function formatRoutesForCLI(manifest: RoutesManifest): string {
  const lines: string[] = [];

  lines.push(`📋 Routes (${manifest.routes.length} total)`);
  lines.push("─".repeat(60));

  for (const route of manifest.routes) {
    const icon = route.kind === "page" ? "📄" : "📡";
    const hydration = route.clientModule ? " 🏝️" : "";
    lines.push(`${icon} ${route.pattern.padEnd(30)} → ${route.id}${hydration}`);
  }

  return lines.join("\n");
}
