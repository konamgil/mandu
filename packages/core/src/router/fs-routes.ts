/**
 * FS Routes Generator
 *
 * 스캔 결과를 RoutesManifest로 변환
 *
 * @module router/fs-routes
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import type { RoutesManifest, RouteSpec } from "../spec/schema";
import type { FSRouteConfig, FSScannerConfig, ScanResult } from "./fs-types";
import { DEFAULT_SCANNER_CONFIG } from "./fs-types";
import { scanRoutes } from "./fs-scanner";
import { patternsConflict } from "./fs-patterns";
import { loadManduConfig } from "../config";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 매니페스트 생성 결과
 */
export interface GenerateResult {
  /** 생성된 매니페스트 */
  manifest: RoutesManifest;

  /** FS Routes에서 생성된 라우트 수 */
  fsRoutesCount: number;

  /** 레거시에서 병합된 라우트 수 */
  legacyRoutesCount: number;

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

  /** 레거시 매니페스트 경로 오버라이드 */
  legacyManifestPath?: string;

  /** 레거시 병합 비활성화 */
  skipLegacy?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Conversion Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FSRouteConfig를 RouteSpec으로 변환
 */
export function fsRouteToRouteSpec(fsRoute: FSRouteConfig): RouteSpec {
  const routeSpec: RouteSpec = {
    id: fsRoute.id,
    pattern: fsRoute.pattern,
    kind: fsRoute.kind,
    module: fsRoute.module,
  };

  // 페이지 라우트의 경우
  if (fsRoute.kind === "page") {
    routeSpec.componentModule = fsRoute.componentModule;

    // Island (클라이언트 모듈)
    if (fsRoute.clientModule) {
      routeSpec.clientModule = fsRoute.clientModule;
      routeSpec.hydration = fsRoute.hydration ?? {
        strategy: "island",
        priority: "visible",
        preload: false,
      };
    }

    // Layout 체인
    if (fsRoute.layoutChain && fsRoute.layoutChain.length > 0) {
      routeSpec.layoutChain = fsRoute.layoutChain;
    }

    // Loading UI
    if (fsRoute.loadingModule) {
      routeSpec.loadingModule = fsRoute.loadingModule;
    }

    // Error UI
    if (fsRoute.errorModule) {
      routeSpec.errorModule = fsRoute.errorModule;
    }
  }

  // API 라우트의 경우
  if (fsRoute.kind === "api" && fsRoute.methods) {
    routeSpec.methods = fsRoute.methods;
  }

  return routeSpec;
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
// Legacy Manifest
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 레거시 매니페스트 로드
 */
async function loadLegacyManifest(
  rootDir: string,
  legacyPath: string
): Promise<RoutesManifest | null> {
  const fullPath = join(rootDir, legacyPath);

  try {
    const content = await readFile(fullPath, "utf-8");
    const manifest = JSON.parse(content) as RoutesManifest;
    return manifest;
  } catch {
    // 파일이 없거나 파싱 실패 시 null
    return null;
  }
}

/**
 * 매니페스트 병합
 *
 * 레거시 매니페스트가 우선권을 가짐 (동일 패턴일 경우)
 */
export function mergeManifests(
  fsManifest: RoutesManifest,
  legacyManifest: RoutesManifest
): { merged: RoutesManifest; warnings: string[] } {
  const warnings: string[] = [];
  const mergedRoutes: RouteSpec[] = [];

  // 레거시 라우트 먼저 추가 (우선권)
  const legacyPatterns = new Set<string>();
  const legacyIds = new Set<string>();

  for (const route of legacyManifest.routes) {
    mergedRoutes.push(route);
    legacyPatterns.add(route.pattern);
    legacyIds.add(route.id);
  }

  // FS Routes 추가 (충돌 체크)
  for (const route of fsManifest.routes) {
    // ID 충돌 체크
    if (legacyIds.has(route.id)) {
      warnings.push(
        `Route ID "${route.id}" already exists in legacy manifest. FS Routes version skipped.`
      );
      continue;
    }

    // 패턴 충돌 체크
    let hasConflict = false;
    for (const legacyPattern of legacyPatterns) {
      if (patternsConflict(route.pattern, legacyPattern)) {
        warnings.push(
          `Route pattern "${route.pattern}" conflicts with legacy pattern "${legacyPattern}". FS Routes version skipped.`
        );
        hasConflict = true;
        break;
      }
    }

    if (!hasConflict) {
      mergedRoutes.push(route);
    }
  }

  return {
    merged: {
      version: Math.max(fsManifest.version, legacyManifest.version),
      routes: mergedRoutes,
    },
    warnings,
  };
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
 * @example
 * const result = await generateManifest("/path/to/project");
 * console.log(result.manifest.routes);
 */
export async function generateManifest(
  rootDir: string,
  options: GenerateOptions = {}
): Promise<GenerateResult> {
  const scannerConfig = await resolveScannerConfig(rootDir, options.scanner);

  // 레거시 매니페스트 경로
  const legacyPath =
    options.legacyManifestPath ?? scannerConfig.legacyManifestPath ?? "spec/routes.manifest.json";

  // FS Routes 스캔
  const scanResult = await scanRoutes(rootDir, scannerConfig);

  // 스캔 에러 체크
  if (scanResult.errors.length > 0) {
    const errorMessages = scanResult.errors.map((e) => `${e.type}: ${e.message}`);
    console.warn("FS Routes scan warnings:", errorMessages);
  }

  // FS Routes 매니페스트 생성
  const fsManifest = scanResultToManifest(scanResult);

  let finalManifest = fsManifest;
  let legacyRoutesCount = 0;
  const warnings: string[] = [];

  // 레거시 매니페스트 병합
  if (!options.skipLegacy && scannerConfig.mergeWithLegacy) {
    const legacyManifest = await loadLegacyManifest(rootDir, legacyPath);

    if (legacyManifest) {
      const mergeResult = mergeManifests(fsManifest, legacyManifest);
      finalManifest = mergeResult.merged;
      legacyRoutesCount = legacyManifest.routes.length;
      warnings.push(...mergeResult.warnings);
    }
  }

  // 파일로 저장 (옵션)
  if (options.outputPath) {
    const outputFullPath = join(rootDir, options.outputPath);
    await mkdir(dirname(outputFullPath), { recursive: true });
    await writeFile(outputFullPath, JSON.stringify(finalManifest, null, 2), "utf-8");
  }

  return {
    manifest: finalManifest,
    fsRoutesCount: scanResult.routes.length,
    legacyRoutesCount,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Watch Mode Support
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 라우트 변경 콜백
 */
export type RouteChangeCallback = (result: GenerateResult) => void | Promise<void>;

/**
 * FS Routes 감시자 인터페이스
 */
export interface FSRoutesWatcher {
  /** 감시 중지 */
  close(): void;

  /** 수동 재스캔 */
  rescan(): Promise<GenerateResult>;
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

  // chokidar 동적 import
  const chokidar = await import("chokidar");

  const watcher = chokidar.watch(routesDir, {
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

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const triggerRescan = async (): Promise<GenerateResult> => {
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

  // 파일 변경 이벤트 핸들러
  watcher.on("add", debouncedRescan);
  watcher.on("unlink", debouncedRescan);
  watcher.on("change", debouncedRescan);

  return {
    close() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      watcher.close();
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
