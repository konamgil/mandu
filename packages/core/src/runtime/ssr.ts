import { renderToString } from "react-dom/server";
import { serializeProps } from "../client/serialize";
import type { ReactElement } from "react";
import type { BundleManifest } from "../bundler/types";
import type { HydrationConfig, HydrationPriority } from "../spec/schema";

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
}

/**
 * SSR 데이터를 안전하게 직렬화 (Fresh 스타일 고급 직렬화)
 * Date, Map, Set, URL, RegExp, BigInt, 순환참조 지원
 */
function serializeServerData(data: Record<string, unknown>): string {
  // serializeProps로 고급 직렬화 (Date, Map, Set 등 지원)
  const json = serializeProps(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/'/g, "\\u0027");

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

  const importMapJson = JSON.stringify(manifest.importMap, null, 2);
  return `<script type="importmap">${importMapJson}</script>`;
}

/**
 * Hydration 스크립트 태그 생성
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

  // Runtime 로드
  if (manifest.shared.runtime) {
    scripts.push(`<script type="module" src="${manifest.shared.runtime}"></script>`);
  }

  // Island 번들 로드
  const bundle = manifest.bundles[routeId];
  if (bundle) {
    // Preload (선택적)
    scripts.push(`<link rel="modulepreload" href="${bundle.js}">`);
    scripts.push(`<script type="module" src="${bundle.js}"></script>`);
  }

  return scripts.join("\n");
}

/**
 * Island 래퍼로 컨텐츠 감싸기
 */
export function wrapWithIsland(
  content: string,
  routeId: string,
  priority: HydrationPriority = "visible"
): string {
  return `<div data-mandu-island="${routeId}" data-mandu-priority="${priority}">${content}</div>`;
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
  } = options;

  let content = renderToString(element);

  // Island 래퍼 적용 (hydration 필요 시)
  const needsHydration =
    hydration && hydration.strategy !== "none" && routeId && bundleManifest;

  if (needsHydration) {
    content = wrapWithIsland(content, routeId, hydration.priority);
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

  return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  ${headTags}
</head>
<body>
  <div id="root">${content}</div>
  ${dataScript}
  ${routeScript}
  ${hydrationScripts}
  ${routerScript}
  ${hmrScript}
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

  const json = JSON.stringify(routeInfo)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");

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
    scripts.push(`<script type="module" src="${manifest.shared.router}"></script>`);
  }

  return scripts.join("\n");
}

/**
 * HMR 스크립트 생성
 */
function generateHMRScript(port: number): string {
  const hmrPort = port + 1;
  return `<script>
(function() {
  var ws = null;
  var reconnectAttempts = 0;
  var maxReconnectAttempts = 10;

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
          } else if (msg.type === 'error') {
            console.error('[Mandu HMR] Build error:', msg.data?.message);
          }
        } catch(err) {}
      };
      ws.onclose = function() {
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          setTimeout(connect, 1000 * reconnectAttempts);
        }
      };
    } catch(err) {
      setTimeout(connect, 1000);
    }
  }
  connect();
})();
</script>`;
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
