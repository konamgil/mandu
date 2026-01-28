/**
 * Mandu Client Bundler 📦
 * Bun.build 기반 클라이언트 번들 빌드
 */

import type { RoutesManifest, RouteSpec } from "../spec/schema";
import { needsHydration, getRouteHydration } from "../spec/schema";
import type {
  BundleResult,
  BundleOutput,
  BundleManifest,
  BundleStats,
  BundlerOptions,
} from "./types";
import path from "path";
import fs from "fs/promises";

/**
 * 빈 매니페스트 생성
 */
function createEmptyManifest(env: "development" | "production"): BundleManifest {
  return {
    version: 1,
    buildTime: new Date().toISOString(),
    env,
    bundles: {},
    shared: {
      runtime: "",
      vendor: "",
    },
    importMap: {
      imports: {},
    },
  };
}

/**
 * Hydration이 필요한 라우트 필터링
 */
function getHydratedRoutes(manifest: RoutesManifest): RouteSpec[] {
  return manifest.routes.filter(
    (route) =>
      route.kind === "page" &&
      route.clientModule &&
      needsHydration(route)
  );
}

/**
 * Runtime 번들 소스 생성
 */
function generateRuntimeSource(): string {
  return `
/**
 * Mandu Hydration Runtime (Generated)
 */

const islandRegistry = new Map();
const hydratedRoots = new Map();

// 서버 데이터
const serverData = window.__MANDU_DATA__ || {};

/**
 * Island 등록
 */
export function registerIsland(id, loader) {
  islandRegistry.set(id, loader);
}

/**
 * 서버 데이터 가져오기
 */
export function getServerData(id) {
  return serverData[id]?.serverData;
}

/**
 * Hydration 스케줄러
 */
function scheduleHydration(element, id, priority, data) {
  switch (priority) {
    case 'immediate':
      hydrateIsland(element, id, data);
      break;

    case 'visible':
      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            observer.disconnect();
            hydrateIsland(element, id, data);
          }
        }, { rootMargin: '50px' });
        observer.observe(element);
      } else {
        hydrateIsland(element, id, data);
      }
      break;

    case 'idle':
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => hydrateIsland(element, id, data));
      } else {
        setTimeout(() => hydrateIsland(element, id, data), 200);
      }
      break;

    case 'interaction': {
      const hydrate = () => {
        element.removeEventListener('mouseenter', hydrate);
        element.removeEventListener('focusin', hydrate);
        element.removeEventListener('touchstart', hydrate);
        hydrateIsland(element, id, data);
      };
      element.addEventListener('mouseenter', hydrate, { once: true, passive: true });
      element.addEventListener('focusin', hydrate, { once: true });
      element.addEventListener('touchstart', hydrate, { once: true, passive: true });
      break;
    }
  }
}

/**
 * 단일 Island hydrate (또는 mount)
 * SSR 플레이스홀더를 Island 컴포넌트로 교체
 */
async function hydrateIsland(element, id, data) {
  const loader = islandRegistry.get(id);
  if (!loader) {
    console.warn('[Mandu] Island not found:', id);
    return;
  }

  try {
    const island = await Promise.resolve(loader());

    // Island 컴포넌트 가져오기
    const islandDef = island.default || island;
    if (!islandDef.__mandu_island) {
      throw new Error('[Mandu] Invalid island: ' + id);
    }

    const { definition } = islandDef;
    const { createRoot } = await import('react-dom/client');
    const React = await import('react');

    // Island 컴포넌트
    function IslandComponent() {
      const setupResult = definition.setup(data);
      return definition.render(setupResult);
    }

    // Mount (createRoot 사용 - SSR 플레이스홀더 교체)
    // hydrateRoot 대신 createRoot 사용: Island는 SSR과 다른 컨텐츠를 렌더링할 수 있음
    const root = createRoot(element);
    root.render(React.createElement(IslandComponent));
    hydratedRoots.set(id, root);

    // 완료 표시
    element.setAttribute('data-mandu-hydrated', 'true');

    // 성능 마커
    if (performance.mark) {
      performance.mark('mandu-hydrated-' + id);
    }

    // 이벤트 발송
    element.dispatchEvent(new CustomEvent('mandu:hydrated', {
      bubbles: true,
      detail: { id, data }
    }));
  } catch (error) {
    console.error('[Mandu] Hydration failed for', id, error);
    element.setAttribute('data-mandu-error', 'true');
  }
}

/**
 * 모든 Island hydrate
 */
export async function hydrateIslands() {
  const islands = document.querySelectorAll('[data-mandu-island]');

  for (const el of islands) {
    const id = el.getAttribute('data-mandu-island');
    if (!id) continue;

    const priority = el.getAttribute('data-mandu-priority') || 'visible';
    const data = serverData[id]?.serverData || {};

    scheduleHydration(el, id, priority, data);
  }
}

/**
 * 자동 초기화
 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrateIslands);
} else {
  hydrateIslands();
}

export { islandRegistry, hydratedRoots };
`;
}

/**
 * React shim 소스 생성 (import map용)
 */
function generateReactShimSource(): string {
  return `
/**
 * Mandu React Shim (Generated)
 * import map을 통해 bare specifier 해결
 */
import * as React from 'react';
export * from 'react';
export default React;
`;
}

/**
 * React DOM shim 소스 생성
 */
function generateReactDOMShimSource(): string {
  return `
/**
 * Mandu React DOM Shim (Generated)
 */
import * as ReactDOM from 'react-dom';
export * from 'react-dom';
export default ReactDOM;
`;
}

/**
 * React DOM Client shim 소스 생성
 */
function generateReactDOMClientShimSource(): string {
  return `
/**
 * Mandu React DOM Client Shim (Generated)
 */
import * as ReactDOMClient from 'react-dom/client';
export * from 'react-dom/client';
export default ReactDOMClient;
`;
}

/**
 * Island 엔트리 래퍼 생성
 */
function generateIslandEntry(routeId: string, clientModulePath: string): string {
  // Windows 경로의 백슬래시를 슬래시로 변환 (JS escape 문제 방지)
  const normalizedPath = clientModulePath.replace(/\\/g, "/");
  return `
/**
 * Mandu Island Entry: ${routeId} (Generated)
 */

import island from "${normalizedPath}";
import { registerIsland } from "./_runtime.js";

registerIsland("${routeId}", () => island);

export default island;
`;
}

/**
 * Runtime 번들 빌드
 */
async function buildRuntime(
  outDir: string,
  options: BundlerOptions
): Promise<{ success: boolean; outputPath: string; errors: string[] }> {
  const runtimePath = path.join(outDir, "_runtime.src.js");
  const outputName = "_runtime.js";

  try {
    // 런타임 소스 작성
    await Bun.write(runtimePath, generateRuntimeSource());

    // 빌드
    const result = await Bun.build({
      entrypoints: [runtimePath],
      outdir: outDir,
      naming: outputName,
      minify: options.minify ?? process.env.NODE_ENV === "production",
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      external: ["react", "react-dom", "react-dom/client"],
      define: {
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
        ...options.define,
      },
    });

    // 소스 파일 정리
    await fs.unlink(runtimePath).catch(() => {});

    if (!result.success) {
      return {
        success: false,
        outputPath: "",
        errors: result.logs.map((l) => l.message),
      };
    }

    return {
      success: true,
      outputPath: `/.mandu/client/${outputName}`,
      errors: [],
    };
  } catch (error) {
    await fs.unlink(runtimePath).catch(() => {});
    return {
      success: false,
      outputPath: "",
      errors: [String(error)],
    };
  }
}

/**
 * Vendor shim 번들 빌드 결과
 */
interface VendorBuildResult {
  success: boolean;
  react: string;
  reactDom: string;
  reactDomClient: string;
  errors: string[];
}

/**
 * Vendor shim 번들 빌드
 * React, ReactDOM, ReactDOMClient를 각각의 shim으로 빌드
 */
async function buildVendorShims(
  outDir: string,
  options: BundlerOptions
): Promise<VendorBuildResult> {
  const errors: string[] = [];
  const results: Record<string, string> = {
    react: "",
    reactDom: "",
    reactDomClient: "",
  };

  const shims = [
    { name: "_react", source: generateReactShimSource(), key: "react" },
    { name: "_react-dom", source: generateReactDOMShimSource(), key: "reactDom" },
    { name: "_react-dom-client", source: generateReactDOMClientShimSource(), key: "reactDomClient" },
  ];

  for (const shim of shims) {
    const srcPath = path.join(outDir, `${shim.name}.src.js`);
    const outputName = `${shim.name}.js`;

    try {
      await Bun.write(srcPath, shim.source);

      const result = await Bun.build({
        entrypoints: [srcPath],
        outdir: outDir,
        naming: outputName,
        minify: options.minify ?? process.env.NODE_ENV === "production",
        sourcemap: options.sourcemap ? "external" : "none",
        target: "browser",
        define: {
          "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
          ...options.define,
        },
      });

      await fs.unlink(srcPath).catch(() => {});

      if (!result.success) {
        errors.push(`[${shim.name}] ${result.logs.map((l) => l.message).join(", ")}`);
      } else {
        results[shim.key] = `/.mandu/client/${outputName}`;
      }
    } catch (error) {
      await fs.unlink(srcPath).catch(() => {});
      errors.push(`[${shim.name}] ${String(error)}`);
    }
  }

  return {
    success: errors.length === 0,
    react: results.react,
    reactDom: results.reactDom,
    reactDomClient: results.reactDomClient,
    errors,
  };
}

/**
 * 단일 Island 번들 빌드
 */
async function buildIsland(
  route: RouteSpec,
  rootDir: string,
  outDir: string,
  options: BundlerOptions
): Promise<BundleOutput> {
  const clientModulePath = path.join(rootDir, route.clientModule!);
  const entryPath = path.join(outDir, `_entry_${route.id}.js`);
  const outputName = `${route.id}.island.js`;

  try {
    // 엔트리 래퍼 생성
    await Bun.write(entryPath, generateIslandEntry(route.id, clientModulePath));

    // 빌드
    const result = await Bun.build({
      entrypoints: [entryPath],
      outdir: outDir,
      naming: outputName,
      minify: options.minify ?? process.env.NODE_ENV === "production",
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      splitting: false, // Island 단위로 이미 분리됨
      external: ["react", "react-dom", "react-dom/client", ...(options.external || [])],
      define: {
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
        ...options.define,
      },
    });

    // 엔트리 파일 정리
    await fs.unlink(entryPath).catch(() => {});

    if (!result.success) {
      throw new Error(result.logs.map((l) => l.message).join("\n"));
    }

    // 출력 파일 정보
    const outputPath = path.join(outDir, outputName);
    const outputFile = Bun.file(outputPath);
    const content = await outputFile.text();
    const gzipped = Bun.gzipSync(Buffer.from(content));

    return {
      routeId: route.id,
      entrypoint: route.clientModule!,
      outputPath: `/.mandu/client/${outputName}`,
      size: outputFile.size,
      gzipSize: gzipped.length,
    };
  } catch (error) {
    await fs.unlink(entryPath).catch(() => {});
    throw error;
  }
}

/**
 * 번들 매니페스트 생성
 */
function createBundleManifest(
  outputs: BundleOutput[],
  routes: RouteSpec[],
  runtimePath: string,
  vendorResult: VendorBuildResult,
  env: "development" | "production"
): BundleManifest {
  const bundles: BundleManifest["bundles"] = {};

  for (const output of outputs) {
    const route = routes.find((r) => r.id === output.routeId);
    const hydration = route ? getRouteHydration(route) : null;

    bundles[output.routeId] = {
      js: output.outputPath,
      dependencies: ["_runtime", "_react"],
      priority: hydration?.priority || "visible",
    };
  }

  return {
    version: 1,
    buildTime: new Date().toISOString(),
    env,
    bundles,
    shared: {
      runtime: runtimePath,
      vendor: vendorResult.react, // primary vendor for backwards compatibility
    },
    importMap: {
      imports: {
        "react": vendorResult.react,
        "react-dom": vendorResult.reactDom,
        "react-dom/client": vendorResult.reactDomClient,
      },
    },
  };
}

/**
 * 번들 통계 계산
 */
function calculateStats(outputs: BundleOutput[], startTime: number): BundleStats {
  let totalSize = 0;
  let totalGzipSize = 0;
  let largestBundle = { routeId: "", size: 0 };

  for (const output of outputs) {
    totalSize += output.size;
    totalGzipSize += output.gzipSize;

    if (output.size > largestBundle.size) {
      largestBundle = { routeId: output.routeId, size: output.size };
    }
  }

  return {
    totalSize,
    totalGzipSize,
    largestBundle,
    buildTime: performance.now() - startTime,
    bundleCount: outputs.length,
  };
}

/**
 * 클라이언트 번들 빌드
 *
 * @example
 * ```typescript
 * import { buildClientBundles } from "@mandujs/core/bundler";
 *
 * const result = await buildClientBundles(manifest, "./my-app", {
 *   minify: true,
 *   sourcemap: true,
 * });
 *
 * if (result.success) {
 *   console.log("Built", result.stats.bundleCount, "bundles");
 * }
 * ```
 */
export async function buildClientBundles(
  manifest: RoutesManifest,
  rootDir: string,
  options: BundlerOptions = {}
): Promise<BundleResult> {
  const startTime = performance.now();
  const outputs: BundleOutput[] = [];
  const errors: string[] = [];
  const env = (process.env.NODE_ENV === "production" ? "production" : "development") as
    | "development"
    | "production";

  // 1. Hydration이 필요한 라우트 필터링
  const hydratedRoutes = getHydratedRoutes(manifest);

  if (hydratedRoutes.length === 0) {
    return {
      success: true,
      outputs: [],
      errors: [],
      manifest: createEmptyManifest(env),
      stats: {
        totalSize: 0,
        totalGzipSize: 0,
        largestBundle: { routeId: "", size: 0 },
        buildTime: 0,
        bundleCount: 0,
      },
    };
  }

  // 2. 출력 디렉토리 생성
  const outDir = options.outDir || path.join(rootDir, ".mandu/client");
  await fs.mkdir(outDir, { recursive: true });

  // 3. Runtime 번들 빌드
  const runtimeResult = await buildRuntime(outDir, options);
  if (!runtimeResult.success) {
    errors.push(...runtimeResult.errors.map((e) => `[Runtime] ${e}`));
  }

  // 4. Vendor shim 번들 빌드 (React, ReactDOM, ReactDOMClient)
  const vendorResult = await buildVendorShims(outDir, options);
  if (!vendorResult.success) {
    errors.push(...vendorResult.errors);
  }

  // 5. 각 Island 번들 빌드
  for (const route of hydratedRoutes) {
    try {
      const result = await buildIsland(route, rootDir, outDir, options);
      outputs.push(result);
    } catch (error) {
      errors.push(`[${route.id}] ${String(error)}`);
    }
  }

  // 6. 번들 매니페스트 생성
  const bundleManifest = createBundleManifest(
    outputs,
    hydratedRoutes,
    runtimeResult.outputPath,
    vendorResult,
    env
  );

  await fs.writeFile(
    path.join(rootDir, ".mandu/manifest.json"),
    JSON.stringify(bundleManifest, null, 2)
  );

  // 7. 통계 계산
  const stats = calculateStats(outputs, startTime);

  return {
    success: errors.length === 0,
    outputs,
    errors,
    manifest: bundleManifest,
    stats,
  };
}

/**
 * 번들 사이즈 포맷팅
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 번들 결과 요약 출력
 */
export function printBundleStats(result: BundleResult): void {
  console.log("\n📦 Mandu Client Bundles");
  console.log("=".repeat(50));

  if (result.outputs.length === 0) {
    console.log("No islands to bundle (hydration: none or no clientModule)");
    return;
  }

  console.log(`Environment: ${result.manifest.env}`);
  console.log(`Bundles: ${result.stats.bundleCount}`);
  console.log(`Total Size: ${formatSize(result.stats.totalSize)}`);
  console.log(`Total Gzip: ${formatSize(result.stats.totalGzipSize)}`);
  console.log(`Build Time: ${result.stats.buildTime.toFixed(0)}ms`);
  console.log("");

  // 각 번들 정보
  for (const output of result.outputs) {
    console.log(
      `  ${output.routeId}: ${formatSize(output.size)} (gzip: ${formatSize(output.gzipSize)})`
    );
  }

  if (result.errors.length > 0) {
    console.log("\n⚠️ Errors:");
    for (const error of result.errors) {
      console.log(`  ${error}`);
    }
  }

  console.log("");
}
