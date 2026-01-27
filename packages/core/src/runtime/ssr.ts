import { renderToString } from "react-dom/server";
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
}

/**
 * SSR 데이터를 안전하게 직렬화
 */
function serializeServerData(data: Record<string, unknown>): string {
  // XSS 방지를 위한 이스케이프
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/'/g, "\\u0027");

  return `<script id="__MANDU_DATA__" type="application/json">${json}</script>
<script>window.__MANDU_DATA__ = JSON.parse(document.getElementById('__MANDU_DATA__').textContent);</script>`;
}

/**
 * Hydration 스크립트 태그 생성
 */
function generateHydrationScripts(
  routeId: string,
  manifest: BundleManifest
): string {
  const scripts: string[] = [];

  // Runtime 로드
  if (manifest.shared.runtime) {
    scripts.push(`<script type="module" src="${manifest.shared.runtime}"></script>`);
  }

  // Vendor 로드
  if (manifest.shared.vendor) {
    scripts.push(`<script type="module" src="${manifest.shared.vendor}"></script>`);
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

  // Hydration 스크립트
  let hydrationScripts = "";
  if (needsHydration && bundleManifest) {
    hydrationScripts = generateHydrationScripts(routeId, bundleManifest);
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
  ${hydrationScripts}
  ${hmrScript}
  ${bodyEndTags}
</body>
</html>`;
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
