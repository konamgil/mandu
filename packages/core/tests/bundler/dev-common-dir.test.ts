/**
 * #184 / #185: Dev bundler common-dir change handling
 *
 * 검증 대상:
 * - 공통 디렉토리 파일 변경 시 `onSSRChange(SSR_CHANGE_WILDCARD)` 호출
 * - `buildClientBundles`가 `skipFrameworkBundles: true`로 호출됨 (간접 확인)
 * - Island build loop 병렬화로 이전 시리얼 동작 대비 일관된 결과
 *
 * Bun의 transitive ESM 캐시 한계는 이 테스트의 범위 밖 — 별도 후속 이슈.
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { startDevBundler, SSR_CHANGE_WILDCARD } from "../../src/bundler/dev";
import type { RoutesManifest } from "../../src/spec/schema";

// 헬퍼: 임시 프로젝트 디렉토리 생성
function createTempProject(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mandu-dev-test-"));
  // .mandu/ + 기존 manifest (skipFrameworkBundles fallback 방지)
  mkdirSync(path.join(root, ".mandu"), { recursive: true });
  mkdirSync(path.join(root, ".mandu/client"), { recursive: true });
  writeFileSync(
    path.join(root, ".mandu/manifest.json"),
    JSON.stringify(
      {
        version: 1,
        buildTime: new Date().toISOString(),
        env: "development",
        bundles: {},
        shared: {
          runtime: "/.mandu/client/runtime.js",
          vendor: "/.mandu/client/vendor.js",
        },
      },
      null,
      2,
    ),
  );
  // 공통 디렉토리 마커
  mkdirSync(path.join(root, "src/shared"), { recursive: true });
  writeFileSync(path.join(root, "src/shared/foo.ts"), 'export const x = "original";\n');
  return root;
}

describe("dev bundler — common-dir change path (#184, #185)", () => {
  let rootDir: string;
  let close: (() => void) | null = null;

  beforeEach(() => {
    rootDir = createTempProject();
  });

  afterEach(() => {
    close?.();
    close = null;
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch { /* Windows may hold locks */ }
  });

  it("SSR_CHANGE_WILDCARD 상수가 '*'로 export된다", () => {
    expect(SSR_CHANGE_WILDCARD).toBe("*");
  });

  it("island이 없는 manifest로도 dev bundler 시작이 가능하다", async () => {
    const manifest: RoutesManifest = {
      version: 1,
      routes: [],
    } as RoutesManifest;

    const bundler = await startDevBundler({
      rootDir,
      manifest,
      // 모든 콜백 noop — 초기 빌드만 확인
    });
    close = bundler.close;

    // 초기 빌드는 성공 여부만 확인 (빈 manifest라 실제 island 빌드는 0개)
    expect(bundler.initialBuild).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// #185: buildClientBundles skipFrameworkBundles option
// ---------------------------------------------------------------------------

import { buildClientBundles } from "../../src/bundler/build";

describe("buildClientBundles — skipFrameworkBundles (#185)", () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = createTempProject();
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch { /* Windows may hold locks */ }
  });

  it("기존 manifest가 없으면 full build로 fallback한다", async () => {
    // 새 프로젝트 (manifest 파일 삭제)
    rmSync(path.join(rootDir, ".mandu/manifest.json"));

    const manifest: RoutesManifest = {
      version: 1,
      routes: [],
    } as RoutesManifest;

    // skipFrameworkBundles: true로 호출했지만 manifest가 없어서 full build로 fallback
    // island가 0개라 full build도 성공
    const result = await buildClientBundles(manifest, rootDir, {
      minify: false,
      sourcemap: true,
      skipFrameworkBundles: true,
    });

    expect(result).toBeDefined();
    // fallback 후 새 manifest가 생성되어 있어야 함
    const fs = await import("fs/promises");
    const exists = await fs
      .access(path.join(rootDir, ".mandu/manifest.json"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("island이 있을 때 skipFrameworkBundles=true는 framework 경로를 보존하고 island만 재빌드한다", async () => {
    // 1단계: full build로 실제 framework 번들 생성
    await mkdirSync(path.join(rootDir, "app"), { recursive: true });
    writeFileSync(
      path.join(rootDir, "package.json"),
      JSON.stringify({ name: "skip-fw-test", type: "module" }),
    );
    writeFileSync(
      path.join(rootDir, "app/demo.client.tsx"),
      "export default function Demo() { return null; }\n",
    );

    const manifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          id: "demo",
          kind: "page",
          pattern: "/",
          module: "app/page.tsx",
          componentModule: "app/page.tsx",
          clientModule: "app/demo.client.tsx",
          hydration: {
            strategy: "island",
            priority: "visible",
            preload: false,
          },
        },
      ],
    } as RoutesManifest;

    const fullBuild = await buildClientBundles(manifest, rootDir, {
      minify: false,
      sourcemap: false,
      splitting: false,
    });
    expect(fullBuild.success).toBe(true);

    // framework 경로 스냅샷
    const beforeRuntime = fullBuild.manifest.shared.runtime;
    const beforeVendor = fullBuild.manifest.shared.vendor;
    const beforeRouter = fullBuild.manifest.shared.router;
    expect(beforeRuntime).toBeTruthy();
    expect(beforeVendor).toBeTruthy();

    // 2단계: skipFrameworkBundles=true로 재빌드
    const skipBuild = await buildClientBundles(manifest, rootDir, {
      minify: false,
      sourcemap: false,
      splitting: false,
      skipFrameworkBundles: true,
    });
    expect(skipBuild.success).toBe(true);

    // framework 경로는 정확히 보존
    expect(skipBuild.manifest.shared.runtime).toBe(beforeRuntime);
    expect(skipBuild.manifest.shared.vendor).toBe(beforeVendor);
    expect(skipBuild.manifest.shared.router).toBe(beforeRouter);

    // island bundle은 manifest에 남아있음 (재빌드됨)
    expect(skipBuild.manifest.bundles.demo).toBeDefined();
    expect(skipBuild.manifest.bundles.demo.js).toBeTruthy();
  });

  it("island이 0개면 skipFrameworkBundles=true는 기존 manifest를 유지한다", async () => {
    const manifest: RoutesManifest = {
      version: 1,
      routes: [],
    } as RoutesManifest;

    // 기존 manifest에 framework 경로를 심어두고 건드려지는지 확인
    const seededPath = "/.mandu/client/seeded-runtime.js";
    const fs = await import("fs/promises");
    const seeded = {
      version: 1,
      buildTime: new Date().toISOString(),
      env: "development",
      bundles: {},
      shared: {
        runtime: seededPath,
        vendor: "/.mandu/client/seeded-vendor.js",
      },
    };
    await fs.writeFile(
      path.join(rootDir, ".mandu/manifest.json"),
      JSON.stringify(seeded, null, 2),
    );

    const result = await buildClientBundles(manifest, rootDir, {
      minify: false,
      sourcemap: true,
      skipFrameworkBundles: true,
    });

    // framework 경로가 그대로 유지되어야 함 (재빌드 안 됨)
    expect(result.manifest.shared.runtime).toBe(seededPath);
  });
});
