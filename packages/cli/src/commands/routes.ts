/**
 * FS Routes CLI Commands
 *
 * 파일 시스템 기반 라우트 관리 명령어
 */

import {
  scanRoutes,
  generateManifest,
  formatRoutesForCLI,
  watchFSRoutes,
  validateAndReport,
  type GenerateOptions,
  type FSScannerConfig,
} from "@mandujs/core";
import { resolveFromCwd } from "../util/fs";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface RoutesGenerateOptions {
  /** 출력 파일 경로 */
  output?: string;
  /** 상세 출력 */
  verbose?: boolean;
}

export interface RoutesListOptions {
  /** 상세 출력 */
  verbose?: boolean;
}

export interface RoutesWatchOptions {
  /** 출력 파일 경로 */
  output?: string;
  /** 상세 출력 */
  verbose?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * routes generate - FS Routes 스캔 및 매니페스트 생성
 */
export async function routesGenerate(options: RoutesGenerateOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);
  if (!config) return false;

  console.log("🥟 Mandu FS Routes Generate\n");

  try {
    const generateOptions: GenerateOptions = {
      scanner: config.fsRoutes,
      outputPath: options.output ?? ".mandu/routes.manifest.json",
      skipLegacy: true, // 레거시 병합 비활성화
    };

    const result = await generateManifest(rootDir, generateOptions);

    // 결과 출력
    console.log(`✅ FS Routes 스캔 완료`);
    console.log(`   📋 라우트: ${result.manifest.routes.length}개\n`);

    // 경고 출력
    if (result.warnings.length > 0) {
      console.log("⚠️  경고:");
      for (const warning of result.warnings) {
        console.log(`   - ${warning}`);
      }
      console.log("");
    }

    // 라우트 목록 출력
    if (options.verbose) {
      console.log(formatRoutesForCLI(result.manifest));
      console.log("");
    }

    // 출력 파일 경로
    if (generateOptions.outputPath) {
      console.log(`📁 매니페스트 저장: ${generateOptions.outputPath}`);
    }

    return true;
  } catch (error) {
    console.error("❌ FS Routes 생성 실패:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * routes list - 현재 라우트 목록 출력
 */
export async function routesList(options: RoutesListOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);
  if (!config) return false;

  console.log("🥟 Mandu Routes List\n");

  try {
    const result = await scanRoutes(rootDir, config.fsRoutes);

    if (result.errors.length > 0) {
      console.log("⚠️  스캔 경고:");
      for (const error of result.errors) {
        console.log(`   - ${error.type}: ${error.message}`);
      }
      console.log("");
    }

    if (result.routes.length === 0) {
      console.log("📭 라우트가 없습니다.");
      console.log("");
      console.log("💡 app/ 폴더에 page.tsx 또는 route.ts 파일을 생성하세요.");
      console.log("");
      console.log("예시:");
      console.log("  app/page.tsx        → /");
      console.log("  app/blog/page.tsx   → /blog");
      console.log("  app/api/users/route.ts → /api/users");
      return true;
    }

    // 라우트 목록 출력
    console.log(`📋 라우트 (${result.routes.length}개)`);
    console.log("─".repeat(70));

    for (const route of result.routes) {
      const icon = route.kind === "page" ? "📄" : "📡";
      const hydration = route.clientModule ? " 🏝️" : "";
      const pattern = route.pattern.padEnd(35);
      const id = route.id;

      console.log(`${icon} ${pattern} → ${id}${hydration}`);

      if (options.verbose) {
        console.log(`   📁 ${route.sourceFile}`);
        if (route.clientModule) {
          console.log(`   🏝️  ${route.clientModule}`);
        }
        if (route.layoutChain.length > 0) {
          console.log(`   📐 layouts: ${route.layoutChain.join(" → ")}`);
        }
      }
    }

    console.log("");

    // 통계
    console.log("📊 통계");
    console.log(`   페이지: ${result.stats.pageCount}개`);
    console.log(`   API: ${result.stats.apiCount}개`);
    console.log(`   레이아웃: ${result.stats.layoutCount}개`);
    console.log(`   Island: ${result.stats.islandCount}개`);
    console.log(`   스캔 시간: ${result.stats.scanTime}ms`);

    return true;
  } catch (error) {
    console.error("❌ 라우트 목록 조회 실패:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * routes watch - 실시간 라우트 감시
 */
export async function routesWatch(options: RoutesWatchOptions = {}): Promise<boolean> {
  const rootDir = resolveFromCwd(".");
  const config = await validateAndReport(rootDir);
  if (!config) return false;

  console.log("🥟 Mandu FS Routes Watch\n");
  console.log("👀 라우트 변경 감시 중... (Ctrl+C로 종료)\n");

  try {
    // 초기 스캔
    const initialResult = await generateManifest(rootDir, {
      scanner: config.fsRoutes,
      outputPath: options.output ?? ".mandu/routes.manifest.json",
    });

    console.log(`✅ 초기 스캔: ${initialResult.manifest.routes.length}개 라우트\n`);

    // 감시 시작
    const watcher = await watchFSRoutes(rootDir, {
      scanner: config.fsRoutes,
      outputPath: options.output ?? ".mandu/routes.manifest.json",
      onChange: (result) => {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`\n🔄 [${timestamp}] 라우트 변경 감지`);
        console.log(`   📋 총 라우트: ${result.manifest.routes.length}개`);

        if (result.warnings.length > 0) {
          for (const warning of result.warnings) {
            console.log(`   ⚠️  ${warning}`);
          }
        }

        if (options.verbose) {
          console.log("");
          console.log(formatRoutesForCLI(result.manifest));
        }
      },
    });

    // 종료 시그널 처리
    const cleanup = () => {
      console.log("\n\n🛑 감시 종료");
      watcher.close();
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // 무한 대기
    await new Promise(() => {});

    return true;
  } catch (error) {
    console.error("❌ 라우트 감시 실패:", error instanceof Error ? error.message : error);
    return false;
  }
}
