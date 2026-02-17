/**
 * mandu build - 클라이언트 번들 빌드
 *
 * Hydration이 필요한 Island들을 번들링합니다.
 * Tailwind v4 프로젝트는 CSS도 함께 빌드합니다.
 */

import { buildClientBundles, printBundleStats, validateAndReport, isTailwindProject, buildCSS, type RoutesManifest } from "@mandujs/core";
import path from "path";
import fs from "fs/promises";
import { resolveManifest } from "../util/manifest";

export interface BuildOptions {
  /** 코드 압축 (기본: production에서 true) */
  minify?: boolean;
  /** 소스맵 생성 */
  sourcemap?: boolean;
  /** 감시 모드 */
  watch?: boolean;
  /** 출력 디렉토리 */
  outDir?: string;
}

export async function build(options: BuildOptions = {}): Promise<boolean> {
  const cwd = process.cwd();

  console.log("📦 Mandu Build - Client Bundle Builder\n");

  const config = await validateAndReport(cwd);
  if (!config) {
    return false;
  }
  const buildConfig = config.build ?? {};

  // 1. 라우트 매니페스트 로드 (FS Routes 우선)
  let manifest: Awaited<ReturnType<typeof resolveManifest>>["manifest"];
  try {
    const resolved = await resolveManifest(cwd, { fsRoutes: config.fsRoutes });
    manifest = resolved.manifest;
    console.log(`✅ 라우트 로드 완료 (${resolved.source}): ${manifest.routes.length}개 라우트`);
  } catch (error) {
    console.error("❌ 라우트 로드 실패:");
    console.error(`   ${error instanceof Error ? error.message : error}`);
    return false;
  }

  // 2. Tailwind CSS 빌드 (Island 여부와 무관하게 먼저 실행)
  const hasTailwind = await isTailwindProject(cwd);
  const resolvedMinify = options.minify ?? buildConfig.minify ?? true;

  if (hasTailwind) {
    console.log(`\n🎨 Tailwind CSS v4 빌드 중...`);
    const cssResult = await buildCSS({
      rootDir: cwd,
      minify: resolvedMinify,
    });

    if (!cssResult.success) {
      console.error(`\n❌ CSS 빌드 실패: ${cssResult.error}`);
      return false;
    }

    console.log(`   ✅ CSS 빌드 완료 (${cssResult.buildTime?.toFixed(0)}ms)`);
    console.log(`   출력: ${cssResult.outputPath}`);
  }

  // 3. Hydration이 필요한 라우트 확인
  const hydratedRoutes = manifest.routes.filter(
    (route) =>
      route.kind === "page" &&
      route.clientModule &&
      (!route.hydration || route.hydration.strategy !== "none")
  );

  if (hydratedRoutes.length === 0) {
    console.log("\n📭 Hydration이 필요한 라우트가 없습니다.");
    console.log("   (clientModule이 없거나 hydration.strategy: none)");

    // CSS만 빌드된 경우도 성공으로 처리
    if (hasTailwind) {
      console.log(`\n✅ CSS 빌드 완료`);
      console.log(`   CSS: .mandu/client/globals.css`);
    }
    return true;
  }

  console.log(`\n🏝️  ${hydratedRoutes.length}개 Island 빌드 중...`);
  for (const route of hydratedRoutes) {
    const hydration = route.hydration || { strategy: "island", priority: "visible" };
    console.log(`   - ${route.id} (${hydration.strategy}, ${hydration.priority || "visible"})`);
  }

  // 4. 번들 빌드
  const startTime = performance.now();
  const resolvedBuildOptions: BuildOptions = {
    minify: options.minify ?? buildConfig.minify,
    sourcemap: options.sourcemap ?? buildConfig.sourcemap,
    outDir: options.outDir ?? buildConfig.outDir,
  };
  const result = await buildClientBundles(manifest, cwd, resolvedBuildOptions);

  // 5. 결과 출력
  console.log("");
  printBundleStats(result);

  if (!result.success) {
    console.error("\n❌ 빌드 실패");
    return false;
  }

  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log(`\n✅ 빌드 완료 (${elapsed}ms)`);
  console.log(`   출력: .mandu/client/`);
  if (hasTailwind) {
    console.log(`   CSS: .mandu/client/globals.css`);
  }

  // 6. 감시 모드
  if (options.watch) {
    console.log("\n👀 파일 감시 모드...");
    console.log("   Ctrl+C로 종료\n");

    await watchAndRebuild(manifest, cwd, resolvedBuildOptions);
  }

  return true;
}

/**
 * 파일 감시 및 재빌드
 * FS Routes 프로젝트: app/ 디렉토리의 island 파일 감시
 */
async function watchAndRebuild(
  manifest: RoutesManifest,
  rootDir: string,
  options: BuildOptions
): Promise<void> {
  // FS Routes 프로젝트는 app/ 디렉토리를, 구버전은 spec/slots/ 감시
  const fsRoutesDir = path.join(rootDir, "app");
  const slotsDir = path.join(rootDir, "spec", "slots");

  let watchDir: string;
  let watchMode: "fs-routes" | "slots";

  try {
    await fs.access(fsRoutesDir);
    watchDir = fsRoutesDir;
    watchMode = "fs-routes";
  } catch {
    try {
      await fs.access(slotsDir);
      watchDir = slotsDir;
      watchMode = "slots";
    } catch {
      console.warn(`⚠️  감시할 디렉토리가 없습니다 (app/ 또는 spec/slots/)`);
      return;
    }
  }

  console.log(`👀 감시 중: ${watchDir}`);

  const { watch } = await import("fs");

  const watcher = watch(watchDir, { recursive: true }, async (event, filename) => {
    if (!filename) return;

    const normalizedFilename = filename.replace(/\\/g, "/");

    // FS Routes: island 파일 변경 감지
    if (watchMode === "fs-routes") {
      const isIslandFile =
        normalizedFilename.endsWith(".island.tsx") ||
        normalizedFilename.endsWith(".island.ts") ||
        normalizedFilename.endsWith(".island.jsx") ||
        normalizedFilename.endsWith(".island.js");
      const isPageFile =
        normalizedFilename.endsWith("/page.tsx") ||
        normalizedFilename.endsWith("/page.ts");

      if (!isIslandFile && !isPageFile) return;
    } else {
      // Slots: .client.ts 파일만 감시
      if (!normalizedFilename.endsWith(".client.ts")) return;
    }

    console.log(`\n🔄 변경 감지: ${normalizedFilename}`);

    try {
      const result = await buildClientBundles(manifest!, rootDir, {
        minify: options.minify,
        sourcemap: options.sourcemap,
        outDir: options.outDir,
      });

      if (result.success) {
        console.log(`✅ 재빌드 완료`);
      } else {
        console.error(`❌ 재빌드 실패`);
        for (const error of result.errors) {
          console.error(`   ${error}`);
        }
      }
    } catch (error) {
      console.error(`❌ 재빌드 오류: ${error}`);
    }
  });

  // 종료 시 정리
  process.on("SIGINT", () => {
    console.log("\n\n👋 빌드 감시 종료");
    watcher.close();
    process.exit(0);
  });

  // 무한 대기
  await new Promise(() => {});
}
