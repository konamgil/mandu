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
  IslandFileEntry,
} from "./types";
import { HYDRATION } from "../constants";
import { safeBuild } from "./safe-build";
import { fastRefreshPlugin } from "./fast-refresh-plugin";
import { mark, measure } from "../perf";
import { HMR_PERF } from "../perf/hmr-markers";
import {
  readVendorCache,
  writeVendorCache,
  restoreVendorCache,
  resolveVendorCacheKeys,
  type VendorCacheKeyInput,
  type VendorCacheWriteEntry,
} from "./vendor-cache";
import path from "path";
import fs from "fs/promises";

/**
 * Scan for *.island.tsx / *.island.ts files across hydrated route directories.
 *
 * Phase 7.1 R1 Agent C — per-island conditional skip defence.
 *
 * Callers (the two `buildClientBundles` paths at L1643 and L1817) feed us
 * `hydratedRoutes` (from `getHydratedRoutes`), which already filters for
 * `route.kind === "page" && route.clientModule && needsHydration(route)`.
 * We re-assert the `needsHydration` predicate here for two reasons:
 *
 *   1. Defence-in-depth — if a future caller forgets the filter, we still
 *      skip routes with `hydration.strategy === "none"`. Each skipped route
 *      saves one `fs.readdir` + O(files) regex matches (~1-2 ms on Windows
 *      NTFS per skipped dir, per diagnostic R0.3).
 *
 *   2. Cold-start regression guard — the R0 → R3 F breakdown attributes
 *      +40-80 ms of cold start to per-island splitting (commit b503c36).
 *      The unit test `per-island-scan-skips-non-hydrated` pins this so a
 *      refactor cannot silently re-introduce the scan overhead for routes
 *      that opt out of hydration.
 */
async function scanIslandFiles(routes: RouteSpec[], rootDir: string): Promise<IslandFileEntry[]> {
  const entries: IslandFileEntry[] = [];
  const seenDirs = new Set<string>();

  for (const route of routes) {
    // Defensive guard — see the block comment above for rationale. Without
    // this, a hypothetical caller passing `manifest.routes` directly would
    // readdir every page route, including pure-SSR ones.
    if (!needsHydration(route)) continue;

    const dir = path.dirname(path.join(rootDir, route.componentModule ?? route.module));
    if (seenDirs.has(dir)) continue;
    seenDirs.add(dir);

    let files: string[];
    try { files = await fs.readdir(dir); } catch { continue; }

    const priority = getRouteHydration(route)?.priority || HYDRATION.DEFAULT_PRIORITY;
    for (const file of files) {
      if (/\.island\.tsx?$/.test(file)) {
        entries.push({
          name: file.replace(/\.island\.tsx?$/, ""),
          filePath: path.join(dir, file),
          routeId: route.id,
          priority,
        });
      }
    }
  }
  return entries;
}

/**
 * Test-only accessor for the island-file scanner. Allows the cold-start
 * test suite (`__tests__/cold-start.test.ts`) to assert the per-island
 * conditional skip without having to spin up a full `buildClientBundles`
 * invocation (which would also run `safeBuild`).
 *
 * @internal
 */
export const _testOnly_scanIslandFiles = scanIslandFiles;

/**
 * Test-only accessor for the hydrated-routes filter. Mirrors the rationale
 * above — lets tests verify that `getHydratedRoutes` really does drop
 * `hydration.strategy: "none"` routes without rebuilding its logic.
 *
 * @internal
 */
export const _testOnly_getHydratedRoutes = getHydratedRoutes;

/** Build a single per-island bundle. */
async function buildPerIslandBundle(
  entry: IslandFileEntry, outDir: string, options: BundlerOptions
): Promise<{ name: string; js: string; route: string; priority: IslandFileEntry["priority"] }> {
  const entryPath = path.join(outDir, `_entry_island_${entry.name}.js`);
  const outputName = `${entry.name}.island.js`;
  // Phase 7.1 B-1/B-4: wire Bun's native React Fast Refresh transform +
  // Mandu's boundary injection plugin — but only in dev. Production
  // bundles stay clean of `$RefreshReg$` / `$RefreshSig$` stubs.
  const isDev = (options.minify ?? process.env.NODE_ENV === "production") === false;
  try {
    await Bun.write(entryPath, generateIslandEntry(entry.name, entry.filePath));
    const result = await safeBuild({
      entrypoints: [entryPath],
      outdir: outDir,
      naming: outputName,
      minify: options.minify ?? process.env.NODE_ENV === "production",
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      ...(isDev ? { reactFastRefresh: true } : {}),
      plugins: isDev ? [fastRefreshPlugin()] : [],
      external: ["react", "react-dom", "react-dom/client", ...(options.external || [])],
      define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"), ...options.define },
    });
    await fs.unlink(entryPath).catch(() => {});
    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      throw new Error(`Island build failed for '${entry.name}' (source: ${entry.filePath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types in this island file.`);
    }
    return { name: entry.name, js: `/.mandu/client/${outputName}`, route: entry.routeId, priority: entry.priority };
  } catch (error) {
    await fs.unlink(entryPath).catch(() => {});
    throw error;
  }
}

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

const REACT_SHIM_EXPORTS = [
  "Activity",
  "Children",
  "Component",
  "Fragment",
  "Profiler",
  "PureComponent",
  "StrictMode",
  "Suspense",
  "__COMPILER_RUNTIME",
  "act",
  "cache",
  "cacheSignal",
  "captureOwnerStack",
  "cloneElement",
  "createContext",
  "createElement",
  "createRef",
  "forwardRef",
  "isValidElement",
  "lazy",
  "memo",
  "startTransition",
  "unstable_useCacheRefresh",
  "use",
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
  "version",
] as const;

const REACT_DOM_SHIM_EXPORTS = [
  "createPortal",
  "flushSync",
  "preconnect",
  "prefetchDNS",
  "preinit",
  "preinitModule",
  "preload",
  "preloadModule",
  "requestFormReset",
  "unstable_batchedUpdates",
  "useFormState",
  "useFormStatus",
  "version",
] as const;

const REACT_DOM_CLIENT_SHIM_EXPORTS = [
  "createRoot",
  "hydrateRoot",
  "version",
] as const;

function formatShimBindings(names: readonly string[], indent = "  "): string {
  return names.map((name) => `${indent}${name},`).join("\n");
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
 * Mandu Hydration Runtime v0.9.0 (Generated)
 * Fresh-style dynamic import architecture
 * + Error Boundary & Loading fallback support
 */

// React 정적 import (Island와 같은 인스턴스 공유)
import React, { useState, useEffect, Component } from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';

// Hydrated roots 추적 (unmount용) - 전역 초기화
window.__MANDU_ROOTS__ = window.__MANDU_ROOTS__ || new Map();
const hydratedRoots = window.__MANDU_ROOTS__;

// 서버 데이터
const getServerData = (id) => (window.__MANDU_DATA__ || {})[id]?.serverData || {};

/**
 * Error Boundary 컴포넌트 (Class Component)
 * Island의 errorBoundary 옵션을 지원
 */
class IslandErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[Mandu] Island error:', this.props.islandId, error, errorInfo);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      // 커스텀 errorBoundary가 있으면 사용
      if (this.props.errorBoundary) {
        return this.props.errorBoundary(this.state.error, this.reset);
      }
      // 기본 에러 UI
      return React.createElement('div', {
        className: 'mandu-island-error',
        style: {
          padding: '16px',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          color: '#dc2626',
        }
      }, [
        React.createElement('strong', { key: 'title' }, '⚠️ 오류 발생'),
        React.createElement('p', { key: 'msg', style: { margin: '8px 0', fontSize: '14px' } },
          this.state.error?.message || '알 수 없는 오류'
        ),
        React.createElement('button', {
          key: 'btn',
          onClick: this.reset,
          style: {
            padding: '6px 12px',
            background: '#dc2626',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }
        }, '다시 시도')
      ]);
    }
    return this.props.children;
  }
}

/**
 * Loading Wrapper 컴포넌트
 * Island의 loading 옵션을 지원
 */
function IslandLoadingWrapper({ children, loading, isReady }) {
  if (!isReady && loading) {
    return loading();
  }
  return children;
}

function resolveHydrationTarget(element) {
  if (!(element instanceof HTMLElement)) {
    return element;
  }

  if (getComputedStyle(element).display !== 'contents') {
    return element;
  }

  const queue = Array.from(element.children);
  while (queue.length > 0) {
    const candidate = queue.shift();
    if (candidate instanceof HTMLElement) {
      return candidate;
    }
    if (candidate) {
      queue.push(...candidate.children);
    }
  }

  return element.parentElement || element;
}

function hasHydratableMarkup(element) {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      return true;
    }

    if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim() !== '') {
      return true;
    }
  }

  return false;
}

function shouldHydrateCompiledIsland(element) {
  return (
    element.getAttribute('data-mandu-loading') !== 'true' &&
    hasHydratableMarkup(element)
  );
}

function createHydrationOptions(element, id, mode) {
  return {
    onRecoverableError(error) {
      element.setAttribute('data-mandu-recoverable-error', 'true');
      console.warn('[Mandu] Recoverable hydration error:', id, mode, error);
      element.dispatchEvent(new CustomEvent('mandu:recoverable-hydration-error', {
        bubbles: true,
        detail: {
          id,
          mode,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    },
  };
}

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
        const target = resolveHydrationTarget(element);
        observer.observe(target);
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
      const target = resolveHydrationTarget(element);
      const hydrate = () => {
        target.removeEventListener('mouseenter', hydrate);
        target.removeEventListener('focusin', hydrate);
        target.removeEventListener('touchstart', hydrate);
        target.removeEventListener('pointerdown', hydrate);
        target.removeEventListener('keydown', hydrate);
        loadAndHydrate(element, src);
      };
      target.addEventListener('mouseenter', hydrate, { once: true, passive: true });
      target.addEventListener('focusin', hydrate, { once: true });
      target.addEventListener('touchstart', hydrate, { once: true, passive: true });
      target.addEventListener('pointerdown', hydrate, { once: true, passive: true });
      target.addEventListener('keydown', hydrate, { once: true });
      break;
    }
  }
}

/**
 * Island 로드 및 hydrate (핵심 함수)
 * Dynamic import로 Island 모듈 로드 후 렌더링
 * Error Boundary 및 Loading fallback 지원
 */
async function loadAndHydrate(element, src) {
  const id = element.getAttribute('data-mandu-island');
  if (!id) {
    return;
  }

  if (
    hydratedRoots.has(id) ||
    element.hasAttribute('data-mandu-hydrated') ||
    element.getAttribute('data-mandu-hydrating') === 'true'
  ) {
    return;
  }

  element.setAttribute('data-mandu-hydrating', 'true');

  try {
    // Dynamic import - 이 시점에 Island 모듈 로드
    const module = await import(src);
    const island = module.default;
    let data = getServerData(id);

    // Fallback: read data-props from child element if __MANDU_DATA__ is empty
    if (!data || Object.keys(data).length === 0) {
      const propsEl = element.querySelector('[data-props]');
      if (propsEl) {
        try {
          data = JSON.parse(propsEl.getAttribute('data-props'));
        } catch (e) {
          console.warn('[Mandu] Failed to parse data-props fallback:', e);
        }
      }
    }

    // Mandu Island (preferred)
    if (island && island.__mandu_island === true) {
      const { definition } = island;
      const shouldHydrate = shouldHydrateCompiledIsland(element);
      const renderMode = shouldHydrate ? 'hydrate' : 'mount';

      // Island 컴포넌트 (Error Boundary + Loading 지원)
      function IslandComponent({ initialReady }) {
        const [isReady, setIsReady] = useState(initialReady);

        useEffect(() => {
          setIsReady(true);
        }, []);

        // setup 호출 및 render
        const setupResult = definition.setup(data);
        const content = definition.render(setupResult);

        // Loading wrapper 적용
        const wrappedContent = definition.loading
          ? React.createElement(IslandLoadingWrapper, {
              loading: definition.loading,
              isReady,
            }, content)
          : content;

        // Error Boundary 적용
        return React.createElement(IslandErrorBoundary, {
          islandId: id,
          errorBoundary: definition.errorBoundary,
        }, wrappedContent);
      }

      const root = shouldHydrate
        ? hydrateRoot(
            element,
            React.createElement(IslandComponent, { initialReady: true }),
            createHydrationOptions(element, id, renderMode)
          )
        : createRoot(element);

      if (!shouldHydrate) {
        root.render(React.createElement(IslandComponent, { initialReady: false }));
      }

      hydratedRoots.set(id, root);

      // 완료 표시
      element.setAttribute('data-mandu-render-mode', renderMode);
      element.setAttribute('data-mandu-hydrated', 'true');

      // 성능 마커
      if (performance.mark) {
        performance.mark('mandu-hydrated-' + id);
      }

      // 이벤트 발송
      element.dispatchEvent(new CustomEvent('mandu:hydrated', {
        bubbles: true,
        detail: { id, data, mode: renderMode }
      }));

      // Kitchen DevTools에 island 등록
      if (window.__MANDU_DEVTOOLS_HOOK__) {
        const hydrateTime = performance.now ? performance.now() : Date.now();
        window.__MANDU_DEVTOOLS_HOOK__.emit({
          type: 'island:register',
          timestamp: Date.now(),
          data: {
            id,
            name: id,
            strategy: element.getAttribute('data-mandu-priority') || 'visible',
            status: 'hydrated',
            renderMode,
            hydrateStartTime: hydrateTime - 10,
            hydrateEndTime: hydrateTime,
            propsSize: JSON.stringify(data).length,
          },
        });
      }

      console.log('[Mandu] Hydrated:', id, '(' + renderMode + ')');
    }
    // Plain React component fallback (e.g. "use client" pages)
    else if (typeof island === 'function' || React.isValidElement(island)) {
      console.warn('[Mandu] Plain component hydration:', id);
      const renderMode = 'hydrate';

      const root = typeof island === 'function'
        ? hydrateRoot(
            element,
            React.createElement(island, data),
            createHydrationOptions(element, id, renderMode)
          )
        : hydrateRoot(element, island, createHydrationOptions(element, id, renderMode));

      hydratedRoots.set(id, root);

      // 완료 표시
      element.setAttribute('data-mandu-render-mode', renderMode);
      element.setAttribute('data-mandu-hydrated', 'true');

      // 성능 마커
      if (performance.mark) {
        performance.mark('mandu-hydrated-' + id);
      }

      // 이벤트 발송
      element.dispatchEvent(new CustomEvent('mandu:hydrated', {
        bubbles: true,
        detail: { id, data, mode: renderMode }
      }));

      console.log('[Mandu] Plain component hydrated:', id, '(' + renderMode + ')');
    }
    else {
      throw new Error('[Mandu] Invalid module: expected Mandu island or React component: ' + id);
    }
  } catch (error) {
    console.error('[Mandu] Hydration failed for', id, error);
    element.setAttribute('data-mandu-error', 'true');

    // 에러 이벤트 발송
    element.dispatchEvent(new CustomEvent('mandu:hydration-error', {
      bubbles: true,
      detail: { id, error: error.message }
    }));
  } finally {
    element.removeAttribute('data-mandu-hydrating');
  }
}

/**
 * 모든 Island hydrate 시작
 */
function hydrateIslands() {
  const islands = document.querySelectorAll('[data-mandu-island]');
  const seenIds = new Set();

  for (const el of islands) {
    const id = el.getAttribute('data-mandu-island');
    const src = el.getAttribute('data-mandu-src');
    const priority = el.getAttribute('data-mandu-priority') || '${HYDRATION.DEFAULT_PRIORITY}';

    if (!id || !src) {
      console.warn('[Mandu] Island missing id or src:', el);
      continue;
    }

    // 중복 ID 경고
    if (seenIds.has(id)) {
      console.warn('[Mandu] Duplicate island id detected:', id, '- skipping');
      continue;
    }
    seenIds.add(id);

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
${formatShimBindings(REACT_SHIM_EXPORTS)}
} from 'react';

// JSX Runtime functions (JSX 변환에 필요)
import { jsx, jsxs } from 'react/jsx-runtime';
import { jsxDEV } from 'react/jsx-dev-runtime';

// React internals (ReactDOM이 내부적으로 접근 필요)
// React 19+: __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
// React <=18: __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE || {};
const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED =
  React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED || {};

// Null safety for Playwright headless browsers (React 19)
if (__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.S == null) {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.S = function () {};
}

// 전역 React 설정 (모든 모듈에서 동일 인스턴스 공유)
if (typeof window !== 'undefined') {
  window.React = React;
  window.__MANDU_REACT__ = React;
}

// Named exports
export {
${formatShimBindings(REACT_SHIM_EXPORTS)}
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
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
${formatShimBindings(REACT_DOM_SHIM_EXPORTS)}
} from 'react-dom';

// Named exports
export {
${formatShimBindings(REACT_DOM_SHIM_EXPORTS)}
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
import { 
${formatShimBindings(REACT_DOM_CLIENT_SHIM_EXPORTS)}
} from 'react-dom/client';

// Named exports (명시적으로 re-export)
export { 
${formatShimBindings(REACT_DOM_CLIENT_SHIM_EXPORTS)}
};

// Default export
export default { 
${formatShimBindings(REACT_DOM_CLIENT_SHIM_EXPORTS)}
};
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
 * DevTools 번들 빌드 (개발 모드 전용)
 * devtools/init.ts를 브라우저용 번들로 컴파일하여 _devtools.js 생성
 */
async function buildDevtoolsBundle(
  outDir: string,
  options: BundlerOptions
): Promise<{ success: boolean; outputPath: string; errors: string[] }> {
  const srcPath = path.join(outDir, "_devtools.src.js");
  const outputName = "_devtools.js";

  // devtools/init.ts의 절대 경로 (build.ts → ../devtools/init.ts)
  const devtoolsInitPath = path.resolve(
    import.meta.dir, '..', 'devtools', 'init.ts'
  ).replace(/\\/g, '/');

  const source = `
import { initManduKitchen } from "${devtoolsInitPath}";
if (typeof window !== 'undefined') {
  window.__MANDU_DEV_TOOLS__ = true;
  initManduKitchen({ position: 'bottom-right' });
}
`;

  try {
    await Bun.write(srcPath, source);

    const result = await safeBuild({
      entrypoints: [srcPath],
      outdir: outDir,
      naming: outputName,
      minify: false, // dev only
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      // React를 인라인 번들링 (import map 없이도 독립 동작)
      // DevTools는 Shadow DOM 격리 → 앱 React와 충돌 없음
      define: {
        "process.env.NODE_ENV": JSON.stringify("development"),
        ...options.define,
      },
    });

    await fs.unlink(srcPath).catch(() => {});

    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      return {
        success: false,
        outputPath: "",
        errors: [`DevTools client build failed (source: ${srcPath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types.`],
      };
    }

    return {
      success: true,
      outputPath: `/.mandu/client/${outputName}`,
      errors: [],
    };
  } catch (error) {
    await fs.unlink(srcPath).catch(() => {});
    return {
      success: false,
      outputPath: "",
      errors: [`DevTools client build threw an exception (source: ${srcPath}): ${String(error)}`],
    };
  }
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

    const result = await safeBuild({
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
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      return {
        success: false,
        outputPath: "",
        errors: [`Router runtime build failed (source: ${routerPath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types.`],
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
      errors: [`Router runtime build threw an exception (source: ${routerPath}): ${String(error)}`],
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
    const result = await safeBuild({
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

    if (!result.success) {
      // 실패 시 디버깅을 위해 소스 파일을 남겨둠 (_runtime.src.js)
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      return {
        success: false,
        outputPath: "",
        errors: [`Runtime bundle build failed (source: ${runtimePath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types. The source file has been kept for debugging.`],
      };
    }

    // 성공 시에만 소스 파일 정리
    await fs.unlink(runtimePath).catch(() => {});

    return {
      success: true,
      outputPath: `/.mandu/client/${outputName}`,
      errors: [],
    };
  } catch (error: unknown) {
    // 예외 발생 시에도 디버깅을 위해 소스 파일을 남겨둠
    const extra: string[] = [];
    const errObj = error as Record<string, unknown> | null;
    if (errObj && Array.isArray(errObj.errors)) {
      extra.push(...errObj.errors.map((e: unknown) => String((e as Record<string, unknown>)?.message || e)));
    }
    if (errObj && Array.isArray(errObj.logs)) {
      extra.push(...errObj.logs.map((l: unknown) => String((l as Record<string, unknown>)?.message || l)));
    }

    return {
      success: false,
      outputPath: "",
      errors: [`Runtime bundle build threw an exception (source: ${runtimePath}): ${String(error)}`, ...extra].filter(Boolean),
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
  /**
   * Phase 7.1 B-2: bundled `react-refresh/runtime` — emitted ONLY in
   * dev mode. Empty string in production. Consumed by the HTML
   * preamble (`bundler/dev.ts`) via a dynamic import.
   */
  reactRefreshRuntime: string;
  /**
   * Phase 7.1 B-2: Mandu's `__MANDU_HMR__` glue module — also dev-only.
   * Imported once by the HTML preamble which then calls `installGlobal`
   * with the already-loaded refresh runtime.
   */
  fastRefreshRuntime: string;
  errors: string[];
}

/**
 * Phase 7.1 B-2 — source generator for the `react-refresh/runtime` shim.
 *
 * The shim simply re-exports the upstream module under a default export
 * that `fast-refresh-runtime.ts`'s `installGlobal({ runtimeImport })`
 * can consume. Mirrors the pattern Vite uses for its `/@react-refresh`
 * endpoint.
 */
function generateReactRefreshRuntimeShimSource(): string {
  return `
/**
 * Mandu React Refresh Runtime Shim (Generated, dev-only)
 * Re-exports the upstream react-refresh/runtime so the bundler can
 * pre-bundle it without leaking the CommonJS entry into the app graph.
 */
import * as Runtime from 'react-refresh/runtime';
export const injectIntoGlobalHook = Runtime.injectIntoGlobalHook;
export const register = Runtime.register;
export const createSignatureFunctionForTransform = Runtime.createSignatureFunctionForTransform;
export const performReactRefresh = Runtime.performReactRefresh;
export default {
  injectIntoGlobalHook,
  register,
  createSignatureFunctionForTransform,
  performReactRefresh,
};
`;
}

/**
 * Phase 7.1 B-2 — source generator for the Mandu Fast Refresh glue.
 *
 * This re-exports `installGlobal` / `manduHMR` / helpers from
 * `runtime/fast-refresh-runtime.ts`. By routing through a generated
 * shim we keep the absolute path to core resolved once at build time
 * (same pattern as `_devtools.js`).
 */
function generateFastRefreshRuntimeShimSource(): string {
  const runtimePath = path
    .resolve(import.meta.dir, "..", "runtime", "fast-refresh-runtime.ts")
    .replace(/\\/g, "/");
  return `
/**
 * Mandu Fast Refresh Runtime Shim (Generated, dev-only)
 * Wires the react-refresh runtime to window.__MANDU_HMR__.
 */
export * from "${runtimePath}";
import { installGlobal } from "${runtimePath}";
export { installGlobal };
`;
}

/**
 * Vendor shim 번들 빌드
 * React, ReactDOM, ReactDOMClient를 각각의 shim으로 빌드
 *
 * Phase 7.2.S2: caches the built shim outputs on disk under
 * `.mandu/vendor-cache/` keyed by Bun + React + ReactDOM + react-refresh +
 * @mandujs/core versions. Warm boots reuse the cached files instead of
 * re-running Bun.build, eliminating ~80-120 ms from cold start.
 */
async function buildVendorShims(
  rootDir: string,
  outDir: string,
  options: BundlerOptions
): Promise<VendorBuildResult> {
  const errors: string[] = [];
  type VendorShimKey =
    | "react"
    | "reactDom"
    | "reactDomClient"
    | "jsxRuntime"
    | "jsxDevRuntime"
    | "reactRefreshRuntime"
    | "fastRefreshRuntime";
  const results: Record<VendorShimKey, string> = {
    react: "",
    reactDom: "",
    reactDomClient: "",
    jsxRuntime: "",
    jsxDevRuntime: "",
    reactRefreshRuntime: "",
    fastRefreshRuntime: "",
  };

  // Phase 7.1 B-2: dev-only Fast Refresh shims. In production we skip
  // them entirely so `react-refresh/runtime` is never bundled and the
  // attack surface / bundle size regressions stay zero for deploys.
  const isDev =
    (options.minify ?? process.env.NODE_ENV === "production") === false;

  const shims: Array<{ name: string; source: string; key: VendorShimKey; cacheId: string }> = [
    { name: "_react", source: generateReactShimSource(), key: "react", cacheId: "react" },
    { name: "_react-dom", source: generateReactDOMShimSource(), key: "reactDom", cacheId: "react-dom" },
    { name: "_react-dom-client", source: generateReactDOMClientShimSource(), key: "reactDomClient", cacheId: "react-dom-client" },
    { name: "_jsx-runtime", source: generateJsxRuntimeShimSource(), key: "jsxRuntime", cacheId: "jsx-runtime" },
    { name: "_jsx-dev-runtime", source: generateJsxDevRuntimeShimSource(), key: "jsxDevRuntime", cacheId: "jsx-dev-runtime" },
  ];
  if (isDev) {
    shims.push(
      {
        name: "_vendor-react-refresh",
        source: generateReactRefreshRuntimeShimSource(),
        key: "reactRefreshRuntime",
        cacheId: "react-refresh-runtime",
      },
      {
        name: "_fast-refresh-runtime",
        source: generateFastRefreshRuntimeShimSource(),
        key: "fastRefreshRuntime",
        cacheId: "fast-refresh-glue",
      },
    );
  }

  // Phase 7.2.S2 — Tier 2 disk cache consultation. Production builds
  // (non-dev, minified) still rebuild fresh because (a) the shim set is
  // smaller (no fast-refresh) and (b) production is one-shot — there's no
  // warm workflow to amortize the cache cost against. Dev warm restarts
  // are where the cache pays off.
  //
  // `MANDU_VENDOR_CACHE=0` disables the cache (escape hatch for debugging
  // cache-invalidation bugs without touching code).
  const cacheEnabled = isDev && process.env.MANDU_VENDOR_CACHE !== "0";
  let cacheKeys: VendorCacheKeyInput | null = null;

  if (cacheEnabled) {
    try {
      cacheKeys = await resolveVendorCacheKeys(rootDir);
      const hitOrMiss = await readVendorCache(rootDir, cacheKeys);

      if (hitOrMiss.kind === "hit") {
        // Attempt to restore every shim file to outDir.
        const restored = await restoreVendorCache(
          rootDir,
          hitOrMiss.manifest,
          outDir,
        );
        if (restored !== null) {
          // Map the restored files into the result shape. If a shim is
          // not in the manifest (eg. an older cache from before we added
          // fast-refresh) we rebuild just that one — but the simpler
          // policy is to require the manifest to cover every entry the
          // current shim list wants, so we only accept hits that include
          // everything. Otherwise fall through to rebuild.
          const expected = new Set(shims.map((s) => s.cacheId));
          const present = new Set(restored.keys());
          let allPresent = true;
          for (const id of expected) {
            if (!present.has(id)) {
              allPresent = false;
              break;
            }
          }
          if (allPresent) {
            // Populate result + return. Every shim's outputPath references
            // the freshly-restored file in `outDir`.
            for (const shim of shims) {
              const dst = restored.get(shim.cacheId);
              if (dst) {
                const fileName = path.basename(dst);
                results[shim.key] = `/.mandu/client/${fileName}`;
              }
            }
            mark(HMR_PERF.VENDOR_CACHE_HIT);
            measure(HMR_PERF.VENDOR_CACHE_HIT, HMR_PERF.VENDOR_CACHE_HIT);
            return {
              success: true,
              react: results.react,
              reactDom: results.reactDom,
              reactDomClient: results.reactDomClient,
              jsxRuntime: results.jsxRuntime,
              jsxDevRuntime: results.jsxDevRuntime,
              reactRefreshRuntime: results.reactRefreshRuntime,
              fastRefreshRuntime: results.fastRefreshRuntime,
              errors,
            };
          }
          // Restored but missing one of the expected shims — fall through.
        }
        // Restore failed — fall through to rebuild.
      }

      // Miss / failed restore: record the miss marker for perf logs.
      mark(HMR_PERF.VENDOR_CACHE_MISS);
      measure(HMR_PERF.VENDOR_CACHE_MISS, HMR_PERF.VENDOR_CACHE_MISS);
    } catch {
      // Any cache failure falls through to the full rebuild path — cache
      // is strictly an optimisation.
    }
  }

  const buildShim = async (
    shim: { name: string; source: string; key: VendorShimKey; cacheId: string }
  ): Promise<{ key: VendorShimKey; cacheId: string; outputName?: string; outputPath?: string; error?: string }> => {
    const srcPath = path.join(outDir, `${shim.name}.src.js`);
    const outputName = `${shim.name}.js`;

    try {
      await Bun.write(srcPath, shim.source);

      // _react.js는 external 없이 React 전체를 번들링
      // _react-dom*, jsx-runtime은 react를 external로 처리하여 동일한 React 인스턴스 공유
      let shimExternal: string[] = [];
      if (shim.name === "_react-dom" || shim.name === "_react-dom-client") {
        shimExternal = ["react"];
      } else if (shim.name === "_jsx-runtime" || shim.name === "_jsx-dev-runtime") {
        shimExternal = ["react"];
      }
      // `_vendor-react-refresh` and `_fast-refresh-runtime` are
      // self-contained: we WANT react-refresh bundled in so the
      // preamble's single dynamic import pulls the whole graph.

      const result = await safeBuild({
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
        const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
        return {
          key: shim.key,
          cacheId: shim.cacheId,
          error: `Vendor shim '${shim.name}' build failed (source: ${srcPath}):\n${grouped}\n  Hint: Check the import paths and ensure the vendor package is installed.`,
        };
      }

      return {
        key: shim.key,
        cacheId: shim.cacheId,
        outputName,
        outputPath: `/.mandu/client/${outputName}`,
      };
    } catch (error) {
      await fs.unlink(srcPath).catch(() => {});
      return {
        key: shim.key,
        cacheId: shim.cacheId,
        error: `[${shim.name}] ${String(error)}`,
      };
    }
  };

  const buildResults = await Promise.all(shims.map((shim) => buildShim(shim)));
  const writeEntries: VendorCacheWriteEntry[] = [];
  for (const result of buildResults) {
    if (result.error) {
      errors.push(result.error);
    } else if (result.outputPath && result.outputName) {
      results[result.key] = result.outputPath;
      writeEntries.push({
        logicalId: result.cacheId,
        absPath: path.join(outDir, result.outputName),
      });
    }
  }

  // Phase 7.2.S2 — persist freshly-built shims for next boot. Best-effort;
  // a write failure is logged via perf markers (opt-in) but never breaks
  // the build. Only write when every shim succeeded — partial manifests
  // would still satisfy the expected-set check on next boot but we
  // prefer writing only complete manifests.
  if (cacheEnabled && cacheKeys && errors.length === 0 && writeEntries.length > 0) {
    // Fire-and-forget so the fast path isn't blocked on disk. The
    // returned VendorBuildResult does not depend on the write outcome.
    mark(HMR_PERF.VENDOR_CACHE_WRITE);
    void writeVendorCache(rootDir, cacheKeys, writeEntries)
      .then(() => {
        measure(HMR_PERF.VENDOR_CACHE_WRITE, HMR_PERF.VENDOR_CACHE_WRITE);
      })
      .catch(() => {});
  }

  return {
    success: errors.length === 0,
    react: results.react,
    reactDom: results.reactDom,
    reactDomClient: results.reactDomClient,
    jsxRuntime: results.jsxRuntime,
    jsxDevRuntime: results.jsxDevRuntime,
    reactRefreshRuntime: results.reactRefreshRuntime,
    fastRefreshRuntime: results.fastRefreshRuntime,
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

  // Phase 7.1 B-1/B-4: wire native Fast Refresh transform + Mandu's
  // boundary injection plugin. Dev-only; prod bundles remain clean.
  const isDev =
    (options.minify ?? process.env.NODE_ENV === "production") === false;
  try {
    // 엔트리 래퍼 생성
    await Bun.write(entryPath, generateIslandEntry(route.id, clientModulePath));

    // 빌드
    // splitting 옵션: true면 공통 코드를 별도 청크로 추출
    const result = await safeBuild({
      entrypoints: [entryPath],
      outdir: outDir,
      naming: options.splitting ? "[name]-[hash].js" : outputName,
      minify: options.minify ?? process.env.NODE_ENV === "production",
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      splitting: options.splitting ?? (process.env.NODE_ENV === "production"),
      ...(isDev ? { reactFastRefresh: true } : {}),
      plugins: isDev ? [fastRefreshPlugin()] : [],
      external: ["react", "react-dom", "react-dom/client", ...(options.external || [])],
      define: {
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
        ...options.define,
      },
    });

    // 엔트리 파일 정리
    await fs.unlink(entryPath).catch(() => {});

    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      throw new Error(`Island build failed for route '${route.id}' (source: ${clientModulePath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types in this island file.`);
    }

    // 출력 파일 정보
    // splitting 활성화 시 Bun.build 결과에서 실제 출력 파일 찾기
    let actualOutputPath: string;
    let actualOutputName: string;

    if (options.splitting && result.outputs.length > 0) {
      // splitting 모드: 결과에서 엔트리 파일 찾기
      const entryOutput = result.outputs.find(
        (o) => o.kind === "entry-point" || o.path.includes(route.id)
      );
      if (entryOutput) {
        actualOutputPath = entryOutput.path;
        actualOutputName = path.basename(entryOutput.path);
      } else {
        actualOutputPath = result.outputs[0].path;
        actualOutputName = path.basename(result.outputs[0].path);
      }
    } else {
      // 일반 모드: 예상 경로 사용
      actualOutputPath = path.join(outDir, outputName);
      actualOutputName = outputName;
    }

    const outputFile = Bun.file(actualOutputPath);
    const content = await outputFile.text();
    const gzipped = Bun.gzipSync(Buffer.from(content));

    return {
      routeId: route.id,
      entrypoint: route.clientModule!,
      outputPath: `/.mandu/client/${actualOutputName}`,
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
  env: "development" | "production",
  islandBundles?: Array<{ name: string; js: string; route: string; priority: IslandFileEntry["priority"] }>
): BundleManifest {
  const bundles: BundleManifest["bundles"] = {};

  for (const output of outputs) {
    const route = routes.find((r) => r.id === output.routeId);
    const hydration = route ? getRouteHydration(route) : null;

    bundles[output.routeId] = {
      js: output.outputPath,
      dependencies: ["_runtime", "_react"],
      priority: hydration?.priority || HYDRATION.DEFAULT_PRIORITY,
    };
  }

  // Per-island bundles (code splitting)
  let islands: BundleManifest["islands"];
  if (islandBundles && islandBundles.length > 0) {
    islands = {};
    for (const ib of islandBundles) {
      islands[ib.name] = {
        js: ib.js,
        route: ib.route,
        priority: ib.priority,
      };
    }
  }

  // Phase 7.1 B-2: expose Fast Refresh dev bundles so the HTML
  // preamble can inject a dynamic import pointing at them. Only
  // populated when buildVendorShims ran in dev mode.
  const fastRefresh =
    vendorResult.reactRefreshRuntime && vendorResult.fastRefreshRuntime
      ? {
          runtime: vendorResult.reactRefreshRuntime,
          glue: vendorResult.fastRefreshRuntime,
        }
      : undefined;

  return {
    version: 1,
    buildTime: new Date().toISOString(),
    env,
    bundles,
    ...(islands ? { islands } : {}),
    shared: {
      runtime: runtimePath,
      vendor: vendorResult.react, // primary vendor for backwards compatibility
      router: routerPath, // Client-side Router
      ...(fastRefresh ? { fastRefresh } : {}),
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
  mark("bundler:full");
  const startTime = performance.now();
  const outputs: BundleOutput[] = [];
  const errors: string[] = [];
  const env = (process.env.NODE_ENV === "production" ? "production" : "development") as
    | "development"
    | "production";

  // 1. Hydration이 필요한 라우트 필터링
  const hydratedRoutes = getHydratedRoutes(manifest);

  // 2. 출력 디렉토리 생성 (항상 필요 - 매니페스트 저장용)
  const outDir = options.outDir || path.join(rootDir, ".mandu/client");
  await fs.mkdir(outDir, { recursive: true });

  // Hydration 라우트가 없어도 빈 매니페스트를 저장해야 함
  // (이전 빌드의 stale 매니페스트 참조 방지)
  if (hydratedRoutes.length === 0) {
    // #185: skipFrameworkBundles 모드에서는 기존 manifest를 그대로 유지 (devtools 재빌드도 스킵)
    if (options.skipFrameworkBundles) {
      const manifestPath = path.join(rootDir, ".mandu/manifest.json");
      try {
        const manifestRaw = await fs.readFile(manifestPath, "utf-8");
        let existing: BundleManifest;
        try {
          existing = JSON.parse(manifestRaw) as BundleManifest;
        } catch (parseError) {
          // #186 hardening: corrupt JSON이면 silent overwrite 대신 경고 + full build로 fallback
          console.warn(
            `[Mandu] Existing manifest is corrupt, falling back to full build: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          );
          throw parseError;
        }
        // #186 hardening: 필수 필드 검증 (shared / bundles 누락 시 fallback)
        if (!existing || typeof existing !== "object" || !existing.shared || !existing.bundles) {
          console.warn("[Mandu] Existing manifest missing required fields, falling back to full build");
          throw new Error("invalid manifest shape");
        }
        return {
          success: true,
          outputs: [],
          errors: [],
          manifest: existing,
          stats: {
            totalSize: 0,
            totalGzipSize: 0,
            largestBundle: { routeId: "", size: 0 },
            buildTime: 0,
            bundleCount: 0,
          },
        };
      } catch {
        // 기존 manifest 없음/corrupt/invalid → full path로 fallback
      }
    }

    // Dev 모드에서는 DevTools 번들 빌드 (island 없어도 동작해야 함)
    const isDev = env === "development";
    if (isDev) {
      const devtoolsResult = await buildDevtoolsBundle(outDir, options);
      if (!devtoolsResult.success) {
        console.warn("[Mandu] DevTools bundle build failed:", devtoolsResult.errors.join(", "));
      }
    }

    const emptyManifest = createEmptyManifest(env);
    await fs.writeFile(
      path.join(rootDir, ".mandu/manifest.json"),
      JSON.stringify(emptyManifest, null, 2)
    );
    return {
      success: true,
      outputs: [],
      errors: [],
      manifest: emptyManifest,
      stats: {
        totalSize: 0,
        totalGzipSize: 0,
        largestBundle: { routeId: "", size: 0 },
        buildTime: 0,
        bundleCount: 0,
      },
    };
  }

  // 부분 빌드 모드: targetRouteIds가 지정되면 해당 Island만 재빌드 (#122)
  if (options.targetRouteIds && options.targetRouteIds.length > 0) {
    const targetRoutes = hydratedRoutes.filter((r) => options.targetRouteIds!.includes(r.id));

    const targetResults = await Promise.all(
      targetRoutes.map(async (route) => {
        try {
          return { ok: true as const, result: await buildIsland(route, rootDir, outDir, options) };
        } catch (error) {
          return { ok: false as const, routeId: route.id, error: String(error) };
        }
      }),
    );
    for (const r of targetResults) {
      if (r.ok) outputs.push(r.result);
      else errors.push(`[${r.routeId}] ${r.error}`);
    }

    // 기존 매니페스트를 읽어 변경된 Island만 갱신
    let existingManifest: BundleManifest;
    try {
      const manifestData = await fs.readFile(path.join(rootDir, ".mandu/manifest.json"), "utf-8");
      existingManifest = JSON.parse(manifestData) as BundleManifest;
    } catch {
      // 기존 매니페스트 없으면 전체 빌드로 재시도 (targetRouteIds 제거)
      return buildClientBundles(manifest, rootDir, { ...options, targetRouteIds: undefined });
    }

    // Only update manifest with successfully built outputs (#10: preserve previous good manifest on failure)
    if (outputs.length > 0) {
      for (const output of outputs) {
        if (existingManifest.bundles[output.routeId]) {
          existingManifest.bundles[output.routeId].js = output.outputPath;
        } else {
          const route = targetRoutes.find((r) => r.id === output.routeId);
          const hydration = route ? getRouteHydration(route) : null;
          existingManifest.bundles[output.routeId] = {
            js: output.outputPath,
            dependencies: ["_runtime", "_react"],
            priority: hydration?.priority || HYDRATION.DEFAULT_PRIORITY,
          };
        }
      }

      await fs.writeFile(
        path.join(rootDir, ".mandu/manifest.json"),
        JSON.stringify(existingManifest, null, 2)
      );
    }
    // When all builds failed, do NOT overwrite manifest — keep previous good state

    const stats = calculateStats(outputs, startTime);
    return { success: errors.length === 0, outputs, errors, manifest: existingManifest, stats };
  }

  // #185: Framework-internal 번들 스킵 모드
  // 사용자 코드(src/shared 등) 변경 시 runtime/router/vendor/devtools 재빌드는 낭비.
  // 기존 매니페스트를 로드해 framework 출력 경로만 재사용하고 사용자 island만 재빌드.
  if (options.skipFrameworkBundles) {
    let existingManifest: BundleManifest;
    try {
      const manifestData = await fs.readFile(path.join(rootDir, ".mandu/manifest.json"), "utf-8");
      existingManifest = JSON.parse(manifestData) as BundleManifest;
    } catch (parseError) {
      // 기존 매니페스트 없음/corrupt → 경고 후 full build로 fallback
      if (parseError instanceof SyntaxError) {
        console.warn(
          `[Mandu] Existing manifest is corrupt, falling back to full build: ${parseError.message}`,
        );
      }
      return buildClientBundles(manifest, rootDir, { ...options, skipFrameworkBundles: false });
    }

    // #186 hardening: 필수 필드 검증 — 누락 시 full build로 fallback
    if (
      !existingManifest ||
      typeof existingManifest !== "object" ||
      !existingManifest.shared ||
      !existingManifest.bundles
    ) {
      console.warn(
        "[Mandu] Existing manifest missing required fields (shared/bundles), falling back to full build",
      );
      return buildClientBundles(manifest, rootDir, { ...options, skipFrameworkBundles: false });
    }

    // Pre-build validation + 병렬 island 빌드 (framework 번들은 스킵)
    for (const route of hydratedRoutes) {
      if (!route.clientModule) continue;
      const clientModulePath = path.join(rootDir, route.clientModule);
      try {
        const source = await fs.readFile(clientModulePath, "utf-8");
        const wrongImportPattern = /(?:import|from)\s+['"]@mandujs\/core['"]|require\s*\(\s*['"]@mandujs\/core['"]\s*\)/;
        if (wrongImportPattern.test(source)) {
          errors.push(
            `[${route.id}] Island file "${route.clientModule}" imports from "@mandujs/core" which is a server-side module.\n` +
            `  Fix: Change the import to "@mandujs/core/client".`,
          );
        }
      } catch {
        // 파일 읽기 실패는 나중 빌드에서 catch됨
      }
    }

    const islandResults = await Promise.all(
      hydratedRoutes.map(async (route) => {
        try {
          return { ok: true as const, result: await buildIsland(route, rootDir, outDir, options) };
        } catch (error) {
          return { ok: false as const, routeId: route.id, error: String(error) };
        }
      }),
    );
    for (const r of islandResults) {
      if (r.ok) outputs.push(r.result);
      else errors.push(`[${r.routeId}] ${r.error}`);
    }

    // Per-island bundle 재빌드 (이미 병렬)
    const islandFiles = await scanIslandFiles(hydratedRoutes, rootDir);
    const perIslandBundles: Array<{ name: string; js: string; route: string; priority: IslandFileEntry["priority"] }> = [];
    if (islandFiles.length > 0) {
      const perIslandResults = await Promise.all(
        islandFiles.map(async (entry) => {
          try {
            return await buildPerIslandBundle(entry, outDir, options);
          } catch (error) {
            errors.push(`[island:${entry.name}] ${String(error)}`);
            return null;
          }
        }),
      );
      for (const result of perIslandResults) {
        if (result) perIslandBundles.push(result);
      }
    }

    // 기존 manifest를 기반으로 bundles / islands 엔트리만 교체 (framework 경로는 유지)
    for (const output of outputs) {
      if (existingManifest.bundles[output.routeId]) {
        existingManifest.bundles[output.routeId].js = output.outputPath;
      } else {
        const route = hydratedRoutes.find((r) => r.id === output.routeId);
        const hydration = route ? getRouteHydration(route) : null;
        existingManifest.bundles[output.routeId] = {
          js: output.outputPath,
          dependencies: ["_runtime", "_react"],
          priority: hydration?.priority || HYDRATION.DEFAULT_PRIORITY,
        };
      }
    }
    if (perIslandBundles.length > 0) {
      existingManifest.islands = existingManifest.islands || {};
      for (const ib of perIslandBundles) {
        existingManifest.islands[ib.name] = {
          js: ib.js,
          route: ib.route,
          priority: ib.priority,
        };
      }
    }

    await fs.writeFile(
      path.join(rootDir, ".mandu/manifest.json"),
      JSON.stringify(existingManifest, null, 2),
    );

    const stats = calculateStats(outputs, startTime);
    return { success: errors.length === 0, outputs, errors, manifest: existingManifest, stats };
  }

  // 3-4. Runtime, Router, Vendor, DevTools 번들 병렬 빌드 (서로 독립적)
  const isDev = env === "development";
  const runtimePromise = buildRuntime(outDir, options);
  const routerPromise = buildRouterRuntime(outDir, options);
  // Phase 7.2.S2 — `rootDir` is now threaded through so buildVendorShims can
  // consult `.mandu/vendor-cache/` for warm-boot shim reuse.
  const vendorPromise = buildVendorShims(rootDir, outDir, options);
  const devtoolsPromise = isDev ? buildDevtoolsBundle(outDir, options) : null;

  const [runtimeResult, routerResult, vendorResult, devtoolsResult] = await Promise.all([
    runtimePromise,
    routerPromise,
    vendorPromise,
    devtoolsPromise,
  ]);

  if (!runtimeResult.success) {
    errors.push(...runtimeResult.errors.map((e: string) => `[Runtime] ${e}`));
  }
  if (!routerResult.success) {
    errors.push(...routerResult.errors.map((e: string) => `[Router] ${e}`));
  }
  if (!vendorResult.success) {
    errors.push(...vendorResult.errors);
  }
  if (devtoolsResult && !devtoolsResult.success) {
    // DevTools 빌드 실패는 경고만 (개발 중단시키지 않음)
    console.warn("[Mandu] DevTools bundle build failed:", devtoolsResult.errors.join(", "));
  }

  // 4.5. Pre-build validation: detect wrong import paths in island files
  for (const route of hydratedRoutes) {
    if (route.clientModule) {
      const clientModulePath = path.join(rootDir, route.clientModule);
      try {
        const source = await fs.readFile(clientModulePath, "utf-8");
        // Match imports from "@mandujs/core" but NOT "@mandujs/core/client" or other subpaths
        const wrongImportPattern = /(?:import|from)\s+['"]@mandujs\/core['"]|require\s*\(\s*['"]@mandujs\/core['"]\s*\)/;
        if (wrongImportPattern.test(source)) {
          const errMsg =
            `[${route.id}] Island file "${route.clientModule}" imports from "@mandujs/core" which is a server-side module.\n` +
            `  Fix: Change the import to "@mandujs/core/client".\n` +
            `  Client islands cannot use server-side modules.`;
          console.error(`\n\x1b[31mERROR: ${errMsg}\x1b[0m\n`);
          errors.push(errMsg);
        }
      } catch {
        // File read failure will be caught later during build
      }
    }
  }

  // 5. 각 Island 번들 병렬 빌드 (#185: L1631의 per-island와 일관성 확보)
  const fullIslandResults = await Promise.all(
    hydratedRoutes.map(async (route) => {
      try {
        return { ok: true as const, result: await buildIsland(route, rootDir, outDir, options) };
      } catch (error) {
        return { ok: false as const, route, error: String(error) };
      }
    }),
  );
  for (const r of fullIslandResults) {
    if (r.ok) {
      outputs.push(r.result);
    } else {
      const errorStr = r.error;
      if (errorStr.includes("AggregateError") || errorStr.includes("Could not resolve")) {
        const clientModule = r.route.clientModule || "";
        errors.push(
          `[${r.route.id}] ${errorStr}\n` +
          `  💡 Hint: If your island imports from "@mandujs/core", change it to "@mandujs/core/client".\n` +
          `     Client islands cannot use server-side modules. File: ${clientModule}`,
        );
      } else {
        errors.push(`[${r.route.id}] ${errorStr}`);
      }
    }
  }

  // 5.5. Per-island code splitting: scan and build individual island bundles
  const islandFiles = await scanIslandFiles(hydratedRoutes, rootDir);
  const islandBundles: Array<{ name: string; js: string; route: string; priority: IslandFileEntry["priority"] }> = [];

  if (islandFiles.length > 0) {
    const islandResults = await Promise.all(
      islandFiles.map(async (entry) => {
        try {
          return await buildPerIslandBundle(entry, outDir, options);
        } catch (error) {
          errors.push(`[island:${entry.name}] ${String(error)}`);
          return null;
        }
      })
    );
    for (const result of islandResults) {
      if (result) islandBundles.push(result);
    }
  }

  // 6. 번들 매니페스트 생성
  const bundleManifest = createBundleManifest(
    outputs,
    hydratedRoutes,
    runtimeResult.outputPath,
    vendorResult,
    routerResult.outputPath,
    env,
    islandBundles
  );

  await fs.writeFile(
    path.join(rootDir, ".mandu/manifest.json"),
    JSON.stringify(bundleManifest, null, 2)
  );

  // 7. 통계 계산
  const stats = calculateStats(outputs, startTime);

  measure("bundler:full", "bundler:full");
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
