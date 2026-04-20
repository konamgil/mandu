/**
 * FS Routes Generator
 *
 * 스캔 결과를 RoutesManifest로 변환
 *
 * @module router/fs-routes
 */

import { writeFile, readFile, mkdir } from "fs/promises";
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
/** Normalize path separators to forward slashes for cross-platform consistency */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function fsRouteToRouteSpec(fsRoute: FSRouteConfig): RouteSpec {
  const base = {
    id: fsRoute.id,
    pattern: fsRoute.pattern,
    module: normalizePath(fsRoute.module),
  };

  if (fsRoute.kind === "page") {
    const pageRoute: RouteSpec = {
      ...base,
      kind: "page" as const,
      componentModule: normalizePath(fsRoute.componentModule ?? ""),
      ...(fsRoute.clientModule
        ? {
            clientModule: normalizePath(fsRoute.clientModule),
            hydration: fsRoute.hydration ?? {
              strategy: "island" as const,
              priority: "immediate" as const,
              preload: false,
            },
          }
        : {}),
      ...(fsRoute.layoutChain && fsRoute.layoutChain.length > 0
        ? { layoutChain: fsRoute.layoutChain.map(normalizePath) }
        : {}),
      ...(fsRoute.loadingModule ? { loadingModule: normalizePath(fsRoute.loadingModule) } : {}),
      ...(fsRoute.errorModule ? { errorModule: normalizePath(fsRoute.errorModule) } : {}),
      ...(fsRoute.notFoundModule ? { notFoundModule: normalizePath(fsRoute.notFoundModule) } : {}),
    };
    return pageRoute;
  }

  // Issue #206: metadata 라우트 (sitemap / robots / llms-txt / manifest).
  // metadataKind + contentType는 fs-scanner에서 채워진다. 방어적으로
  // 없는 경우를 떨어뜨리지 않고 빈 값으로 통과시켜 RoutesManifest 검증
  // 단계에서 명확한 에러가 나오게 한다.
  if (fsRoute.kind === "metadata") {
    const metadataRoute: RouteSpec = {
      ...base,
      kind: "metadata" as const,
      metadataKind: fsRoute.metadataKind ?? "sitemap",
      contentType: fsRoute.contentType ?? "text/plain; charset=utf-8",
    };
    return metadataRoute;
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
  // Slot = server-side data loader (.slot.ts/.tsx)
  // Client = client-side island module (.client.ts/.tsx) — sets clientModule, NOT slotModule
  const slotExtensions = [".slot.ts", ".slot.tsx"];
  const clientExtensions = [".client.ts", ".client.tsx"];

  await Promise.all(
    manifest.routes.map(async (route) => {
      // Metadata routes (sitemap/robots/llms-txt/manifest) have a
      // strict file-convention contract — no slots, no contracts.
      // Skipping them here avoids fs.access chatter on every dev
      // rescan.
      if (route.kind === "metadata") return;

      const contractPath = join(rootDir, "spec", "contracts", `${route.id}.contract.ts`);

      // Check all extensions in parallel
      const slotChecks = slotExtensions.map(async (ext) => {
        const path = join(rootDir, "spec", "slots", `${route.id}${ext}`);
        return (await Bun.file(path).exists()) ? ext : null;
      });
      const clientChecks = clientExtensions.map(async (ext) => {
        const path = join(rootDir, "spec", "slots", `${route.id}${ext}`);
        return (await Bun.file(path).exists()) ? ext : null;
      });

      const [contractExists, ...allResults] = await Promise.all([
        Bun.file(contractPath).exists(),
        ...slotChecks,
        ...clientChecks,
      ]);

      const slotResults = allResults.slice(0, slotExtensions.length);
      const clientResults = allResults.slice(slotExtensions.length);

      // Set slotModule for .slot.ts(x) files (server data loaders)
      const matchedSlotExt = slotResults.find((ext) => ext !== null);
      if (matchedSlotExt) {
        route.slotModule = `spec/slots/${route.id}${matchedSlotExt}`;
      }

      // Set clientModule for .client.ts(x) files (island hydration) — only if not already set
      const matchedClientExt = clientResults.find((ext) => ext !== null);
      if (matchedClientExt && !route.clientModule) {
        route.clientModule = `spec/slots/${route.id}${matchedClientExt}`;
        // Also set default hydration config if not present
        if (!route.hydration) {
          route.hydration = {
            strategy: "island" as const,
            priority: "immediate" as const,
            preload: false,
          };
        }
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

  // 기존 매니페스트에서 사용자 설정 필드 보존 (clientModule, hydration 등)
  const outputPath = options.outputPath ?? ".mandu/routes.manifest.json";
  const outputFullPath = join(rootDir, outputPath);
  await mkdir(dirname(outputFullPath), { recursive: true });

  try {
    const existingRaw = await readFile(outputFullPath, "utf-8");
    const existingManifest = JSON.parse(existingRaw) as RoutesManifest;
    if (existingManifest.routes) {
      const existingMap = new Map(
        existingManifest.routes.map((r) => [r.id, r])
      );
      for (const route of manifest.routes) {
        const prev = existingMap.get(route.id);
        if (!prev) continue;
        // 사용자가 설정한 clientModule/hydration 보존
        if (prev.clientModule && !route.clientModule) {
          route.clientModule = prev.clientModule;
        }
        if (prev.hydration && !route.hydration) {
          route.hydration = prev.hydration;
        }
      }
    }
  } catch {
    // 기존 매니페스트가 없으면 무시
  }

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
    const icon = route.kind === "page" ? "📄" : route.kind === "api" ? "📡" : "🗺️";
    const hydration = route.clientModule ? " 🏝️" : "";
    lines.push(`${icon} ${route.pattern.padEnd(30)} → ${route.id}${hydration}`);
  }

  return lines.join("\n");
}
