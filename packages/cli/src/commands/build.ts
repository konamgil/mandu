/**
 * mandu build - 클라이언트 번들 빌드
 *
 * Hydration이 필요한 Island들을 번들링합니다.
 */

import { loadManifest, buildClientBundles, printBundleStats } from "@mandujs/core";
import path from "path";
import fs from "fs/promises";

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
  const specPath = path.join(cwd, "spec", "routes.manifest.json");

  console.log("📦 Mandu Build - Client Bundle Builder\n");

  // 1. Spec 로드
  const specResult = await loadManifest(specPath);
  if (!specResult.success) {
    console.error("❌ Spec 로드 실패:");
    for (const error of specResult.errors) {
      console.error(`   ${error}`);
    }
    return false;
  }

  const manifest = specResult.manifest;
  console.log(`✅ Spec 로드 완료: ${manifest.routes.length}개 라우트`);

  // 2. Hydration이 필요한 라우트 확인
  const hydratedRoutes = manifest.routes.filter(
    (route) =>
      route.kind === "page" &&
      route.clientModule &&
      (!route.hydration || route.hydration.strategy !== "none")
  );

  if (hydratedRoutes.length === 0) {
    console.log("\n📭 Hydration이 필요한 라우트가 없습니다.");
    console.log("   (clientModule이 없거나 hydration.strategy: none)");
    return true;
  }

  console.log(`\n🏝️  ${hydratedRoutes.length}개 Island 빌드 중...`);
  for (const route of hydratedRoutes) {
    const hydration = route.hydration || { strategy: "island", priority: "visible" };
    console.log(`   - ${route.id} (${hydration.strategy}, ${hydration.priority || "visible"})`);
  }

  // 3. 번들 빌드
  const startTime = performance.now();
  const result = await buildClientBundles(manifest, cwd, {
    minify: options.minify,
    sourcemap: options.sourcemap,
    outDir: options.outDir,
  });

  // 4. 결과 출력
  console.log("");
  printBundleStats(result);

  if (!result.success) {
    console.error("\n❌ 빌드 실패");
    return false;
  }

  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log(`\n✅ 빌드 완료 (${elapsed}ms)`);
  console.log(`   출력: .mandu/client/`);

  // 5. 감시 모드
  if (options.watch) {
    console.log("\n👀 파일 감시 모드...");
    console.log("   Ctrl+C로 종료\n");

    await watchAndRebuild(manifest, cwd, options);
  }

  return true;
}

/**
 * 파일 감시 및 재빌드
 */
async function watchAndRebuild(
  manifest: Awaited<ReturnType<typeof loadManifest>>["manifest"],
  rootDir: string,
  options: BuildOptions
): Promise<void> {
  const slotsDir = path.join(rootDir, "spec", "slots");

  // 디렉토리 존재 확인
  try {
    await fs.access(slotsDir);
  } catch {
    console.warn(`⚠️  슬롯 디렉토리가 없습니다: ${slotsDir}`);
    return;
  }

  const { watch } = await import("fs");

  const watcher = watch(slotsDir, { recursive: true }, async (event, filename) => {
    if (!filename) return;

    // .client.ts 파일만 감시
    if (!filename.endsWith(".client.ts")) return;

    const routeId = filename.replace(".client.ts", "").replace(/\\/g, "/").split("/").pop();
    if (!routeId) return;

    const route = manifest!.routes.find((r) => r.id === routeId);
    if (!route || !route.clientModule) return;

    console.log(`\n🔄 변경 감지: ${routeId}`);

    try {
      const result = await buildClientBundles(manifest!, rootDir, {
        minify: options.minify,
        sourcemap: options.sourcemap,
        outDir: options.outDir,
      });

      if (result.success) {
        console.log(`✅ 재빌드 완료: ${routeId}`);
      } else {
        console.error(`❌ 재빌드 실패: ${routeId}`);
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
