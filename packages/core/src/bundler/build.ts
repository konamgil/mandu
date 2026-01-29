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
 * Runtime 번들 소스 생성 (v0.8.0 재설계)
 *
 * 설계 원칙:
 * - 글로벌 레지스트리 없음 (Island가 스스로 등록 안함)
 * - Runtime이 Island를 dynamic import()로 로드
 * - HTML의 data-mandu-src 속성에서 번들 URL 읽기
 * - 실행 순서 문제 완전 해결
 */
function generateRuntimeSource(): string {
  return `
/**
 * Mandu Hydration Runtime v0.8.0 (Generated)
 * Fresh-style dynamic import architecture
 */

// React 정적 import (Island와 같은 인스턴스 공유)
import React from 'react';
import { hydrateRoot } from 'react-dom/client';

// Hydrated roots 추적 (unmount용)
const hydratedRoots = new Map();

// 서버 데이터
const getServerData = (id) => (window.__MANDU_DATA__ || {})[id]?.serverData || {};

/**
 * Hydration 스케줄러
 */
function scheduleHydration(element, src, priority) {
  switch (priority) {
    case 'immediate':
      loadAndHydrate(element, src);
      break;

    case 'visible':
      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          if (entries[0].isIntersecting) {
            observer.disconnect();
            loadAndHydrate(element, src);
          }
        }, { rootMargin: '50px' });
        observer.observe(element);
      } else {
        loadAndHydrate(element, src);
      }
      break;

    case 'idle':
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => loadAndHydrate(element, src));
      } else {
        setTimeout(() => loadAndHydrate(element, src), 200);
      }
      break;

    case 'interaction': {
      const hydrate = () => {
        element.removeEventListener('mouseenter', hydrate);
        element.removeEventListener('focusin', hydrate);
        element.removeEventListener('touchstart', hydrate);
        loadAndHydrate(element, src);
      };
      element.addEventListener('mouseenter', hydrate, { once: true, passive: true });
      element.addEventListener('focusin', hydrate, { once: true });
      element.addEventListener('touchstart', hydrate, { once: true, passive: true });
      break;
    }
  }
}

/**
 * Island 로드 및 hydrate (핵심 함수)
 * Dynamic import로 Island 모듈 로드 후 렌더링
 */
async function loadAndHydrate(element, src) {
  const id = element.getAttribute('data-mandu-island');

  try {
    // Dynamic import - 이 시점에 Island 모듈 로드
    const module = await import(src);
    const island = module.default;

    // Island 유효성 검사
    if (!island || !island.__mandu_island) {
      throw new Error('[Mandu] Invalid island module: ' + id);
    }

    const { definition } = island;
    const data = getServerData(id);

    // Island 컴포넌트 (정적 import된 React 사용)
    function IslandComponent() {
      const setupResult = definition.setup(data);
      return definition.render(setupResult);
    }

    // Hydrate (SSR DOM 재사용 + 이벤트 연결)
    const root = hydrateRoot(element, React.createElement(IslandComponent));
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

    console.log('[Mandu] Hydrated:', id);
  } catch (error) {
    console.error('[Mandu] Hydration failed for', id, error);
    element.setAttribute('data-mandu-error', 'true');
  }
}

/**
 * 모든 Island hydrate 시작
 */
function hydrateIslands() {
  const islands = document.querySelectorAll('[data-mandu-island]');

  for (const el of islands) {
    const id = el.getAttribute('data-mandu-island');
    const src = el.getAttribute('data-mandu-src');
    const priority = el.getAttribute('data-mandu-priority') || 'visible';

    if (!id || !src) {
      console.warn('[Mandu] Island missing id or src:', el);
      continue;
    }

    scheduleHydration(el, src, priority);
  }
}

/**
 * Island unmount
 */
function unmountIsland(id) {
  const root = hydratedRoots.get(id);
  if (root) {
    root.unmount();
    hydratedRoots.delete(id);
    return true;
  }
  return false;
}

// 자동 초기화
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrateIslands);
} else {
  hydrateIslands();
}

// Export for external use
export { hydrateIslands, unmountIsland, hydratedRoots };
`;
}

/**
 * React shim 소스 생성 (import map용)
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateReactShimSource(): string {
  return `
/**
 * Mandu React Shim (Generated)
 * import map을 통해 bare specifier 해결
 */
import React, {
  // Core
  createElement,
  cloneElement,
  createContext,
  createRef,
  forwardRef,
  isValidElement,
  memo,
  lazy,
  // Hooks
  useState,
  useEffect,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
  useImperativeHandle,
  useDebugValue,
  useDeferredValue,
  useTransition,
  useId,
  useSyncExternalStore,
  useInsertionEffect,
  // Components
  Fragment,
  Suspense,
  StrictMode,
  Profiler,
  // Types
  Component,
  PureComponent,
  Children,
} from 'react';

// JSX Runtime functions (JSX 변환에 필요)
import { jsx, jsxs } from 'react/jsx-runtime';
import { jsxDEV } from 'react/jsx-dev-runtime';

// React internals (ReactDOM이 내부적으로 접근 필요)
const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

// 전역 React 설정 (모든 모듈에서 동일 인스턴스 공유)
if (typeof window !== 'undefined') {
  window.React = React;
  window.__MANDU_REACT__ = React;
}

// Named exports
export {
  createElement,
  cloneElement,
  createContext,
  createRef,
  forwardRef,
  isValidElement,
  memo,
  lazy,
  useState,
  useEffect,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useRef,
  useLayoutEffect,
  useImperativeHandle,
  useDebugValue,
  useDeferredValue,
  useTransition,
  useId,
  useSyncExternalStore,
  useInsertionEffect,
  Fragment,
  Suspense,
  StrictMode,
  Profiler,
  Component,
  PureComponent,
  Children,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  // JSX Runtime exports
  jsx,
  jsxs,
  jsxDEV,
};

// Default export
export default React;
`;
}

/**
 * React DOM shim 소스 생성
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateReactDOMShimSource(): string {
  return `
/**
 * Mandu React DOM Shim (Generated)
 */
import ReactDOM, {
  createPortal,
  flushSync,
  render,
  unmountComponentAtNode,
  findDOMNode,
  hydrate,
  version,
} from 'react-dom';

// Named exports
export {
  createPortal,
  flushSync,
  render,
  unmountComponentAtNode,
  findDOMNode,
  hydrate,
  version,
};

// Default export
export default ReactDOM;
`;
}

/**
 * React DOM Client shim 소스 생성
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateReactDOMClientShimSource(): string {
  return `
/**
 * Mandu React DOM Client Shim (Generated)
 */
import { createRoot, hydrateRoot } from 'react-dom/client';

// Named exports (명시적으로 re-export)
export { createRoot, hydrateRoot };

// Default export
export default { createRoot, hydrateRoot };
`;
}

/**
 * JSX Runtime shim 소스 생성
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateJsxRuntimeShimSource(): string {
  return `
/**
 * Mandu JSX Runtime Shim (Generated)
 * Production JSX 변환용
 * 순환 참조 방지: 'react'에서 import (import map이 _react.js로 매핑)
 */
import { jsx, jsxs, Fragment } from 'react';

// Named exports
export { jsx, jsxs, Fragment };

// Default export
export default { jsx, jsxs, Fragment };
`;
}

/**
 * JSX Dev Runtime shim 소스 생성
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateJsxDevRuntimeShimSource(): string {
  return `
/**
 * Mandu JSX Dev Runtime Shim (Generated)
 * Development JSX 변환용
 * 순환 참조 방지: 'react'에서 import (import map이 _react.js로 매핑)
 */
import { jsxDEV, Fragment } from 'react';

// Named exports
export { jsxDEV, Fragment };

// Default export
export default { jsxDEV, Fragment };
`;
}

/**
 * Client-side Router 런타임 소스 생성
 */
function generateRouterRuntimeSource(): string {
  return `
/**
 * Mandu Client Router Runtime (Generated)
 * Client-side Routing을 위한 런타임
 * 전역 상태를 사용하여 모든 모듈에서 동일 인스턴스 공유
 */

// 전역 상태 초기화 (Island와 공유)
(function initGlobalState() {
  if (window.__MANDU_ROUTER_STATE__) return;
  var route = window.__MANDU_ROUTE__;
  window.__MANDU_ROUTER_STATE__ = {
    currentRoute: route ? {
      id: route.id,
      pattern: route.pattern,
      params: route.params || {}
    } : null,
    loaderData: window.__MANDU_DATA__ && window.__MANDU_DATA__[route && route.id] ? window.__MANDU_DATA__[route.id].serverData : undefined,
    navigation: { state: 'idle' }
  };
  window.__MANDU_ROUTER_LISTENERS__ = window.__MANDU_ROUTER_LISTENERS__ || new Set();
})();

function getGlobalState() {
  return window.__MANDU_ROUTER_STATE__;
}

function setGlobalState(state) {
  window.__MANDU_ROUTER_STATE__ = state;
}

function getListeners() {
  return window.__MANDU_ROUTER_LISTENERS__;
}

// 패턴 매칭 캐시
var patternCache = new Map();

function compilePattern(pattern) {
  if (patternCache.has(pattern)) return patternCache.get(pattern);

  const paramNames = [];
  let paramIndex = 0;
  const paramMatches = [];

  const withPlaceholders = pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, name) => {
    paramMatches.push(name);
    return '%%PARAM%%';
  });

  const escaped = withPlaceholders.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  const regexStr = escaped.replace(/%%PARAM%%/g, () => {
    paramNames.push(paramMatches[paramIndex++]);
    return '([^/]+)';
  });

  const compiled = { regex: new RegExp('^' + regexStr + '$'), paramNames };
  patternCache.set(pattern, compiled);
  return compiled;
}

function extractParams(pattern, pathname) {
  const compiled = compilePattern(pattern);
  const match = pathname.match(compiled.regex);
  if (!match) return {};

  const params = {};
  compiled.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
  return params;
}

function notifyListeners() {
  const state = getGlobalState();
  getListeners().forEach(fn => { try { fn(state); } catch(e) {} });
}

export function subscribe(listener) {
  getListeners().add(listener);
  return () => getListeners().delete(listener);
}

export function getRouterState() {
  return getGlobalState();
}

export async function navigate(to, options = {}) {
  const { replace = false, scroll = true } = options;

  try {
    const url = new URL(to, location.origin);
    if (url.origin !== location.origin) {
      location.href = to;
      return;
    }

    // 로딩 상태로 전환
    const state = getGlobalState();
    setGlobalState({ ...state, navigation: { state: 'loading', location: to } });
    notifyListeners();

    const dataUrl = url.pathname + (url.search ? url.search + '&' : '?') + '_data=1';
    const res = await fetch(dataUrl);

    if (!res.ok) {
      location.href = to;
      return;
    }

    const data = await res.json();

    if (replace) {
      history.replaceState({ routeId: data.routeId }, '', to);
    } else {
      history.pushState({ routeId: data.routeId }, '', to);
    }

    // 전역 상태 업데이트
    setGlobalState({
      currentRoute: { id: data.routeId, pattern: data.pattern, params: data.params },
      loaderData: data.loaderData,
      navigation: { state: 'idle' }
    });

    window.__MANDU_DATA__ = window.__MANDU_DATA__ || {};
    window.__MANDU_DATA__[data.routeId] = { serverData: data.loaderData };

    notifyListeners();

    if (scroll) window.scrollTo(0, 0);
  } catch (err) {
    console.error('[Mandu Router] Error:', err);
    location.href = to;
  }
}

// Link 클릭 핸들러
function handleClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;

  const anchor = e.target.closest('a[data-mandu-link]');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  try {
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) return;
  } catch { return; }

  e.preventDefault();
  navigate(href);
}

// Popstate 핸들러
function handlePopState(e) {
  if (e.state?.routeId) {
    navigate(location.pathname + location.search, { replace: true, scroll: false });
  }
}

// 초기화
function init() {
  var state = getGlobalState();
  if (state.currentRoute) {
    state.currentRoute.params = extractParams(state.currentRoute.pattern, location.pathname);
    setGlobalState(state);
  }

  window.addEventListener('popstate', handlePopState);
  document.addEventListener('click', handleClick);
  console.log('[Mandu Router] Initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
`;
}

/**
 * Router 런타임 번들 빌드
 */
async function buildRouterRuntime(
  outDir: string,
  options: BundlerOptions
): Promise<{ success: boolean; outputPath: string; errors: string[] }> {
  const routerPath = path.join(outDir, "_router.src.js");
  const outputName = "_router.js";

  try {
    await Bun.write(routerPath, generateRouterRuntimeSource());

    const result = await Bun.build({
      entrypoints: [routerPath],
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

    await fs.unlink(routerPath).catch(() => {});

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
    await fs.unlink(routerPath).catch(() => {});
    return {
      success: false,
      outputPath: "",
      errors: [String(error)],
    };
  }
}

/**
 * Island 엔트리 래퍼 생성 (v0.8.0 재설계)
 *
 * 설계 원칙:
 * - 순수 export만 (부작용 없음)
 * - Runtime이 dynamic import로 로드
 * - 등록/초기화 코드 없음
 */
function generateIslandEntry(routeId: string, clientModulePath: string): string {
  // Windows 경로의 백슬래시를 슬래시로 변환 (JS escape 문제 방지)
  const normalizedPath = clientModulePath.replace(/\\/g, "/");
  return `
/**
 * Mandu Island: ${routeId} (Generated)
 * Pure export - no side effects
 */
import island from "${normalizedPath}";
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
  jsxRuntime: string;
  jsxDevRuntime: string;
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
    jsxRuntime: "",
    jsxDevRuntime: "",
  };

  const shims = [
    { name: "_react", source: generateReactShimSource(), key: "react" },
    { name: "_react-dom", source: generateReactDOMShimSource(), key: "reactDom" },
    { name: "_react-dom-client", source: generateReactDOMClientShimSource(), key: "reactDomClient" },
    { name: "_jsx-runtime", source: generateJsxRuntimeShimSource(), key: "jsxRuntime" },
    { name: "_jsx-dev-runtime", source: generateJsxDevRuntimeShimSource(), key: "jsxDevRuntime" },
  ];

  for (const shim of shims) {
    const srcPath = path.join(outDir, `${shim.name}.src.js`);
    const outputName = `${shim.name}.js`;

    try {
      await Bun.write(srcPath, shim.source);

      // _react.js와 jsx-runtime들은 완전히 번들링 (external 없음)
      // _react-dom*, jsx-runtime은 react를 external로 처리하여 동일한 React 인스턴스 공유
      // jsx-runtime은 Fragment를 react에서 가져오므로 react만 external
      let shimExternal: string[] = [];
      if (shim.name === "_react-dom" || shim.name === "_react-dom-client") {
        shimExternal = ["react"];
      } else if (shim.name === "_jsx-runtime" || shim.name === "_jsx-dev-runtime") {
        // jsx-runtime은 react를 external로 (Fragment 때문에),
        // 하지만 react/jsx-runtime은 번들링되어야 함
        shimExternal = ["react"];
      }
      // _react.js는 external 없이 React 전체를 번들링

      const result = await Bun.build({
        entrypoints: [srcPath],
        outdir: outDir,
        naming: outputName,
        minify: options.minify ?? process.env.NODE_ENV === "production",
        sourcemap: options.sourcemap ? "external" : "none",
        target: "browser",
        external: shimExternal,
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
    jsxRuntime: results.jsxRuntime,
    jsxDevRuntime: results.jsxDevRuntime,
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
  routerPath: string,
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
      router: routerPath, // Client-side Router
    },
    importMap: {
      imports: {
        "react": vendorResult.react,
        "react-dom": vendorResult.reactDom,
        "react-dom/client": vendorResult.reactDomClient,
        "react/jsx-runtime": vendorResult.jsxRuntime,
        "react/jsx-dev-runtime": vendorResult.jsxDevRuntime,
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

  // 3.5. Client-side Router 런타임 빌드
  const routerResult = await buildRouterRuntime(outDir, options);
  if (!routerResult.success) {
    errors.push(...routerResult.errors.map((e) => `[Router] ${e}`));
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
    routerResult.outputPath,
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
