import { getRenderToString } from "./react-renderer";
import { serializeProps } from "../client/serialize";
import { createRequire } from "module";
import type { ReactElement } from "react";
import type { BundleManifest } from "../bundler/types";
import type { HydrationConfig, HydrationPriority } from "../spec/schema";
import { PORTS, TIMEOUTS } from "../constants";
import { escapeHtmlAttr, escapeHtmlText, escapeJsonForInlineScript } from "./escape";
import { REACT_INTERNALS_SHIM_SCRIPT } from "./shims";

// Re-export streaming SSR utilities
export {
  renderToStream,
  renderStreamingResponse,
  renderWithDeferredData,
  SuspenseIsland,
  DeferredData,
  createStreamingLoader,
  defer,
  type StreamingSSROptions,
  type StreamingLoaderResult,
  type StreamingError,
  type StreamingMetrics,
} from "./streaming-ssr";

export interface SSROptions {
  title?: string;
  lang?: string;
  /** 서버에서 로드한 데이터 (클라이언트로 전달) */
  serverData?: Record<string, unknown>;
  /** Hydration 설정 */
  hydration?: HydrationConfig;
  /** 번들 매니페스트 */
  bundleManifest?: BundleManifest;
  /** 라우트 ID (island 식별용) */
  routeId?: string;
  /** 추가 head 태그 */
  headTags?: string;
  /** 추가 body 끝 태그 */
  bodyEndTags?: string;
  /** 개발 모드 여부 */
  isDev?: boolean;
  /** HMR 포트 (개발 모드에서 사용) */
  hmrPort?: number;
  /** Client-side Routing 활성화 여부 */
  enableClientRouter?: boolean;
  /** 라우트 패턴 (Client-side Routing용) */
  routePattern?: string;
  /** CSS 파일 경로 (자동 주입, 기본: /.mandu/client/globals.css) */
  cssPath?: string | false;
}

let projectRenderToString: ((element: ReactElement) => string) | null | undefined;

function loadProjectRenderToString(): ((element: ReactElement) => string) | null {
  if (projectRenderToString !== undefined) {
    return projectRenderToString;
  }

  try {
    const projectRequire = createRequire(`${process.cwd()}/package.json`);
    const module = projectRequire("react-dom/server") as {
      renderToString?: (element: ReactElement) => string;
      default?: { renderToString?: (element: ReactElement) => string };
    };
    const renderToString = module.renderToString ?? module.default?.renderToString;
    if (typeof renderToString === "function") {
      projectRenderToString = renderToString;
      return projectRenderToString;
    }
  } catch {
    // fallback below
  }

  projectRenderToString = null;
  return null;
}

/**
 * SSR 데이터를 안전하게 직렬화 (Fresh 스타일 고급 직렬화)
 * Date, Map, Set, URL, RegExp, BigInt, 순환참조 지원
 */
function serializeServerData(data: Record<string, unknown>): string {
  // serializeProps로 고급 직렬화 (Date, Map, Set 등 지원)
  const json = escapeJsonForInlineScript(serializeProps(data));

  return `<script id="__MANDU_DATA__" type="application/json">${json}</script>
<script>window.__MANDU_DATA_RAW__ = document.getElementById('__MANDU_DATA__').textContent;</script>`;
}

/**
 * Import map 생성 (bare specifier 해결용)
 */
function generateImportMap(manifest: BundleManifest): string {
  if (!manifest.importMap || Object.keys(manifest.importMap.imports).length === 0) {
    return "";
  }

  const importMapJson = escapeJsonForInlineScript(JSON.stringify(manifest.importMap, null, 2));
  return `<script type="importmap">${importMapJson}</script>`;
}

/**
 * Hydration 스크립트 태그 생성
 * v0.9.0: vendor, runtime 모두 modulepreload로 성능 최적화
 */
function generateHydrationScripts(
  routeId: string,
  manifest: BundleManifest
): string {
  const scripts: string[] = [];

  // Import map 먼저 (반드시 module scripts 전에 위치해야 함)
  const importMap = generateImportMap(manifest);
  if (importMap) {
    scripts.push(importMap);
  }

  // Vendor modulepreload (React, ReactDOM 등 - 캐시 효율 극대화)
  if (manifest.shared.vendor) {
    scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(manifest.shared.vendor)}">`);
  }
  if (manifest.importMap?.imports) {
    const imports = manifest.importMap.imports;
    // react-dom, react-dom/client 등 추가 preload
    if (imports["react-dom"] && imports["react-dom"] !== manifest.shared.vendor) {
      scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(imports["react-dom"])}">`);
    }
    if (imports["react-dom/client"]) {
      scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(imports["react-dom/client"])}">`);
    }
  }

  // Runtime modulepreload (hydration 실행 전 미리 로드)
  if (manifest.shared.runtime) {
    scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(manifest.shared.runtime)}">`);
  }

  // Island 번들 modulepreload (성능 최적화 - prefetch only)
  const bundle = manifest.bundles[routeId];
  if (bundle) {
    scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(bundle.js)}">`);
  }

  // Runtime 로드 (hydrateIslands 실행 - dynamic import 사용)
  if (manifest.shared.runtime) {
    scripts.push(`<script type="module" src="${escapeHtmlAttr(manifest.shared.runtime)}"></script>`);
  }

  return scripts.join("\n");
}

/**
 * Island 래퍼로 컨텐츠 감싸기
 * v0.8.0: data-mandu-src 속성 추가 (Runtime이 dynamic import로 로드)
 */
export function wrapWithIsland(
  content: string,
  routeId: string,
  priority: HydrationPriority = "visible",
  bundleSrc?: string
): string {
  const srcAttr = bundleSrc ? ` data-mandu-src="${escapeHtmlAttr(bundleSrc)}"` : "";
  return `<div data-mandu-island="${escapeHtmlAttr(routeId)}"${srcAttr} data-mandu-priority="${escapeHtmlAttr(priority)}">${content}</div>`;
}

export function renderToHTML(element: ReactElement, options: SSROptions = {}): string {
  const {
    title = "Mandu App",
    lang = "ko",
    serverData,
    hydration,
    bundleManifest,
    routeId,
    headTags = "",
    bodyEndTags = "",
    isDev = false,
    hmrPort,
    enableClientRouter = false,
    routePattern,
    cssPath,
  } = options;

  // CSS 링크 태그 생성
  // - cssPath가 string이면 해당 경로 사용
  // - cssPath가 false 또는 undefined이면 링크 미삽입 (404 방지)
  const cssLinkTag = cssPath && cssPath !== false
    ? `<link rel="stylesheet" href="${escapeHtmlAttr(`${cssPath}${isDev ? `?t=${Date.now()}` : ""}`)}">`
    : "";

  const renderToString = getRenderToString();
  let content = renderToString(element);

  // Island 래퍼 적용 (hydration 필요 시)
  const needsHydration =
    hydration && hydration.strategy !== "none" && routeId && bundleManifest;

  if (needsHydration) {
    // v0.8.0: bundleSrc를 data-mandu-src 속성으로 전달 (Runtime이 dynamic import로 로드)
    const bundle = bundleManifest.bundles[routeId];
    const bundleSrc = bundle?.js;
    content = wrapWithIsland(content, routeId, hydration.priority, bundleSrc);
  }

  // 서버 데이터 스크립트
  let dataScript = "";
  if (serverData && routeId) {
    const wrappedData = {
      [routeId]: {
        serverData,
        timestamp: Date.now(),
      },
    };
    dataScript = serializeServerData(wrappedData);
  }

  // Client-side Routing: 라우트 정보 주입
  let routeScript = "";
  if (enableClientRouter && routeId) {
    routeScript = generateRouteScript(routeId, routePattern || "", serverData);
  }

  // Hydration 스크립트
  let hydrationScripts = "";
  if (needsHydration && bundleManifest) {
    hydrationScripts = generateHydrationScripts(routeId, bundleManifest);
  }

  // Client-side Router 스크립트
  let routerScript = "";
  if (enableClientRouter && bundleManifest) {
    routerScript = generateClientRouterScript(bundleManifest);
  }

  // HMR 스크립트 (개발 모드)
  let hmrScript = "";
  if (isDev && hmrPort) {
    hmrScript = generateHMRScript(hmrPort);
  }

  // DevTools 번들 로드 (개발 모드)
  let devtoolsScript = "";
  if (isDev) {
    devtoolsScript = generateDevtoolsScript();
  }

  return `<!doctype html>
<html lang="${escapeHtmlAttr(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlText(title)}</title>
  ${cssLinkTag}
  ${headTags}
</head>
<body>
  <div id="root">${content}</div>
  ${dataScript}
  ${routeScript}
  ${hydrationScripts}
  ${needsHydration ? REACT_INTERNALS_SHIM_SCRIPT : ""}
  ${routerScript}
  ${hmrScript}
  ${devtoolsScript}
  ${bodyEndTags}
</body>
</html>`;
}

/**
 * Client-side Routing: 현재 라우트 정보 스크립트 생성
 */
function generateRouteScript(
  routeId: string,
  pattern: string,
  serverData?: Record<string, unknown>
): string {
  const routeInfo = {
    id: routeId,
    pattern,
    params: extractParamsFromUrl(pattern),
  };

  const json = escapeJsonForInlineScript(JSON.stringify(routeInfo));

  return `<script>window.__MANDU_ROUTE__ = ${json};</script>`;
}

/**
 * URL 패턴에서 파라미터 추출 (클라이언트에서 사용)
 */
function extractParamsFromUrl(pattern: string): Record<string, string> {
  // 서버에서는 실제 params를 전달받으므로 빈 객체 반환
  // 실제 params는 serverData나 별도 전달
  return {};
}

/**
 * Client-side Router 스크립트 로드
 */
function generateClientRouterScript(manifest: BundleManifest): string {
  // Import map 먼저 (이미 hydration에서 추가되었을 수 있음)
  const scripts: string[] = [];

  // 라우터 번들이 있으면 로드
  if (manifest.shared?.router) {
    scripts.push(`<script type="module" src="${escapeHtmlAttr(manifest.shared.router)}"></script>`);
  }

  return scripts.join("\n");
}

/**
 * HMR 스크립트 생성
 */
function generateHMRScript(port: number): string {
  const hmrPort = port + PORTS.HMR_OFFSET;
  return `<script>
window.__MANDU_HMR_PORT__ = ${hmrPort};
(function() {
  var ws = null;
  var reconnectAttempts = 0;
  var maxReconnectAttempts = ${TIMEOUTS.HMR_MAX_RECONNECT};
  var baseDelay = ${TIMEOUTS.HMR_RECONNECT_DELAY};

  function scheduleReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      var delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), 30000);
      setTimeout(connect, delay);
    }
  }

  function connect() {
    try {
      ws = new WebSocket('ws://localhost:${hmrPort}');
      ws.onopen = function() {
        console.log('[Mandu HMR] Connected');
        reconnectAttempts = 0;
      };
      ws.onmessage = function(e) {
        try {
          var msg = JSON.parse(e.data);
          if (msg.type === 'reload' || msg.type === 'island-update') {
            console.log('[Mandu HMR] Reloading...');
            location.reload();
          } else if (msg.type === 'css-update') {
            var cssPath = (msg.data && msg.data.cssPath) || '/.mandu/client/globals.css';
            var links = document.querySelectorAll('link[rel="stylesheet"]');
            var updated = false;
            for (var i = 0; i < links.length; i++) {
              var href = links[i].getAttribute('href') || '';
              var base = href.split('?')[0];
              if (base === cssPath || href.includes('globals.css') || href.includes('.mandu/client')) {
                links[i].setAttribute('href', base + '?t=' + Date.now());
                updated = true;
              }
            }
            if (!updated) location.reload();
          } else if (msg.type === 'error') {
            console.error('[Mandu HMR] Build error:', msg.data && msg.data.message);
          }
        } catch(err) {}
      };
      ws.onclose = function() { scheduleReconnect(); };
    } catch(err) {
      scheduleReconnect();
    }
  }
  connect();
})();
</script>`;
}

/**
 * DevTools 번들 로드 스크립트 생성 (개발 모드 전용)
 * _devtools.js 번들이 자체적으로 initManduKitchen()을 호출
 */
function generateDevtoolsScript(): string {
  return `<script type="module" src="/.mandu/client/_devtools.js"></script>`;
}

export function createHTMLResponse(html: string, status: number = 200): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

export function renderSSR(element: ReactElement, options: SSROptions = {}): Response {
  const html = renderToHTML(element, options);
  return createHTMLResponse(html);
}

/**
 * Hydration이 포함된 SSR 렌더링
 *
 * @example
 * ```typescript
 * const response = await renderWithHydration(
 *   <TodoList todos={todos} />,
 *   {
 *     title: "할일 목록",
 *     routeId: "todos",
 *     serverData: { todos },
 *     hydration: { strategy: "island", priority: "visible" },
 *     bundleManifest,
 *   }
 * );
 * ```
 */
export async function renderWithHydration(
  element: ReactElement,
  options: SSROptions & {
    routeId: string;
    serverData: Record<string, unknown>;
    hydration: HydrationConfig;
    bundleManifest: BundleManifest;
  }
): Promise<Response> {
  const html = renderToHTML(element, options);
  return createHTMLResponse(html);
}
