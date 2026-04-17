/**
 * Mandu Streaming SSR
 * React 18 renderToReadableStream 기반 점진적 HTML 스트리밍
 *
 * 특징:
 * - TTFB 최소화 (Shell 즉시 전송)
 * - Suspense 경계에서 fallback → 실제 컨텐츠 스트리밍
 * - Critical/Deferred 데이터 분리
 * - Island Architecture와 완벽 통합
 */

import { getRenderToReadableStream } from "./react-renderer";
import type { ReactElement, ReactNode } from "react";
import React, { Suspense } from "react";
import type { BundleManifest } from "../bundler/types";
import type { HydrationConfig, HydrationPriority } from "../spec/schema";
import { serializeProps } from "../client/serialize";
import type { Metadata, MetadataItem } from "../seo/types";
import { injectSEOIntoOptions, resolveSEO, type SEOOptions } from "../seo/integration/ssr";
import { PORTS, TIMEOUTS } from "../constants";
import { escapeHtmlAttr, escapeHtmlText, escapeJsonForInlineScript, escapeJsString } from "./escape";
import { REACT_INTERNALS_SHIM_SCRIPT } from "./shims";
import { getRenderToString } from "./react-renderer";
import { mark, measure } from "../perf";

// ========== Types ==========

/**
 * Streaming SSR 에러 타입
 *
 * 에러 정책 (Error Policy):
 * 1. Stream 생성 실패 (renderToReadableStream throws)
 *    → renderStreamingResponse에서 catch → 500 Response 반환
 *    → 이 경우 StreamingError는 생성되지 않음
 *
 * 2. Shell 전 React 렌더링 에러 (onError called, shellSent=false)
 *    → isShellError: true, recoverable: false
 *    → onShellError 콜백 호출
 *    → 스트림은 계속 진행 (빈 컨텐츠 or 부분 렌더링)
 *
 * 3. Shell 후 스트리밍 에러 (onError called, shellSent=true)
 *    → isShellError: false, recoverable: true
 *    → onStreamError 콜백 호출
 *    → 에러 스크립트가 HTML에 삽입됨
 */
export interface StreamingError {
  error: Error;
  /**
   * Shell 전송 전 에러인지 여부
   * - true: React 초기 렌더링 중 에러 (Shell 전송 전)
   * - false: 스트리밍 중 에러 (Shell 이미 전송됨)
   */
  isShellError: boolean;
  /**
   * 복구 가능 여부
   * - true: Shell 이후 에러 - 에러 스크립트 삽입으로 클라이언트 알림
   * - false: Shell 전 에러 - 사용자에게 불완전한 UI 표시될 수 있음
   */
  recoverable: boolean;
  /** 타임스탬프 */
  timestamp: number;
}

/**
 * Streaming SSR 메트릭
 */
export interface StreamingMetrics {
  /** Shell ready까지 걸린 시간 (ms) */
  shellReadyTime: number;
  /** All ready까지 걸린 시간 (ms) */
  allReadyTime: number;
  /** Deferred chunk 개수 */
  deferredChunkCount: number;
  /** 에러 발생 여부 */
  hasError: boolean;
  /** 시작 시간 */
  startTime: number;
}

export interface StreamingSSROptions {
  /** 페이지 타이틀 (SEO metadata 사용 시 자동 설정됨) */
  title?: string;
  /** HTML lang 속성 */
  lang?: string;
  /** 라우트 ID */
  routeId?: string;
  /** 라우트 패턴 */
  routePattern?: string;
  /** Critical 데이터 (Shell과 함께 즉시 전송) - JSON-serializable object만 허용 */
  criticalData?: Record<string, unknown>;
  // Note: deferredData는 renderWithDeferredData의 deferredPromises로 대체됨
  /** Hydration 설정 */
  hydration?: HydrationConfig;
  /** 번들 매니페스트 */
  bundleManifest?: BundleManifest;
  /** 추가 head 태그 (SEO metadata와 병합됨) */
  headTags?: string;
  /**
   * SEO 메타데이터 (Layout 체인 또는 단일 객체)
   * - 배열: [rootLayout, ...nestedLayouts, page] 순서로 병합
   * - 객체: 단일 정적 메타데이터
   */
  metadata?: MetadataItem[] | Metadata;
  /** 라우트 파라미터 (동적 메타데이터용) */
  routeParams?: Record<string, string>;
  /** 쿼리 파라미터 (동적 메타데이터용) */
  searchParams?: Record<string, string>;
  /** 개발 모드 여부 */
  isDev?: boolean;
  /** HMR 포트 */
  hmrPort?: number;
  /** Client-side Router 활성화 */
  enableClientRouter?: boolean;
  /** Streaming 타임아웃 (ms) - 전체 스트림 최대 시간 */
  streamTimeout?: number;
  /** Shell 렌더링 후 콜백 (TTFB 측정 시점) */
  onShellReady?: () => void;
  /** 모든 컨텐츠 렌더링 후 콜백 */
  onAllReady?: () => void;
  /**
   * Shell 전 에러 콜백
   * - React 초기 렌더링 중 에러 발생 시 호출
   * - 이 시점에서는 이미 스트림이 시작됨 (500 반환 불가)
   * - 로깅/모니터링 용도
   */
  onShellError?: (error: StreamingError) => void;
  /**
   * 스트리밍 중 에러 콜백
   * - Shell 전송 후 에러 발생 시 호출
   * - 에러 스크립트가 HTML에 자동 삽입됨
   * - 클라이언트에서 mandu:streaming-error 이벤트로 감지 가능
   */
  onStreamError?: (error: StreamingError) => void;
  /** 에러 콜백 (deprecated - onShellError/onStreamError 사용 권장) */
  onError?: (error: Error) => void;
  /** 메트릭 콜백 (observability) */
  onMetrics?: (metrics: StreamingMetrics) => void;
  /**
   * HTML 닫기 태그 생략 여부 (내부용)
   * true이면 </body></html>을 생략하여 deferred 스크립트 삽입 지점 확보
   */
  _skipHtmlClose?: boolean;
  /** CSS 파일 경로 (자동 주입, 기본: /.mandu/client/globals.css) */
  cssPath?: string | false;
}

export interface StreamingLoaderResult<T = unknown> {
  /** 즉시 로드할 Critical 데이터 */
  critical?: T;
  /** 지연 로드할 Deferred 데이터 (Promise) */
  deferred?: Promise<T>;
}

// ========== Serialization Guards ==========

/**
 * 값이 JSON-serializable인지 검증
 * Date, Map, Set, BigInt 등은 serializeProps에서 처리되지만
 * 함수, Symbol, undefined는 문제가 됨
 */
function isJSONSerializable(value: unknown, path: string = "root", isDev: boolean = false): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const seen = new WeakSet<object>();

  function check(val: unknown, currentPath: string): void {
    if (val === undefined) {
      issues.push(`${currentPath}: undefined는 JSON으로 직렬화할 수 없습니다`);
      return;
    }

    if (val === null) return;

    const type = typeof val;

    if (type === "function") {
      issues.push(`${currentPath}: function은 JSON으로 직렬화할 수 없습니다`);
      return;
    }

    if (type === "symbol") {
      issues.push(`${currentPath}: symbol은 JSON으로 직렬화할 수 없습니다`);
      return;
    }

    if (type === "bigint") {
      // serializeProps에서 처리됨 - 경고만
      if (isDev) {
        console.warn(`[Mandu Streaming] ${currentPath}: BigInt가 감지됨 - 문자열로 변환됩니다`);
      }
      return;
    }

    if (val instanceof Date || val instanceof Map || val instanceof Set || val instanceof URL || val instanceof RegExp) {
      // serializeProps에서 처리됨
      return;
    }

    if (Array.isArray(val)) {
      val.forEach((item, index) => check(item, `${currentPath}[${index}]`));
      return;
    }

    if (type === "object") {
      // 순환 참조 감지 — 무한 재귀 방지
      if (seen.has(val as object)) {
        issues.push(`${currentPath}: 순환 참조가 감지되었습니다 (JSON 직렬화 불가)`);
        return;
      }
      seen.add(val as object);
      for (const [key, v] of Object.entries(val as Record<string, unknown>)) {
        check(v, `${currentPath}.${key}`);
      }
      return;
    }

    // string, number, boolean은 OK
  }

  check(value, path);

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * criticalData 검증 및 경고
 * 개발 모드에서는 throw, 프로덕션에서는 경고만
 */
function validateCriticalData(data: Record<string, unknown> | undefined, isDev: boolean): void {
  if (!data) return;

  const result = isJSONSerializable(data, "criticalData", isDev);

  if (!result.valid) {
    const message = `[Mandu Streaming] criticalData 직렬화 문제:\n${result.issues.join("\n")}`;

    if (isDev) {
      throw new Error(message);
    } else {
      console.error(message);
    }
  }
}

// ========== Streaming Warnings ==========

/**
 * Streaming 경고 상태 (module-level, globalThis as any 제거)
 */
const streamingWarnings = {
  _warned: false,
  markWarned() { this._warned = true; },
  hasWarned() { return this._warned; },
};

/**
 * 프록시/버퍼링 관련 경고 (개발 모드)
 */
function warnStreamingCaveats(isDev: boolean): void {
  if (!isDev) return;

  console.log(`[Mandu Streaming] 💡 Streaming SSR 주의사항:
  - nginx/cloudflare 등 reverse proxy 사용 시 버퍼링 비활성화 필요
    (nginx: proxy_buffering off; X-Accel-Buffering: no)
  - compression 미들웨어가 chunk를 모으면 스트리밍 이점 사라짐
  - Transfer-Encoding: chunked 헤더가 유지되어야 함`);
}

// ========== Error HTML Generation ==========

/**
 * 스트리밍 중 에러 시 삽입할 에러 스크립트 생성
 * Shell 이후 에러는 이 방식으로 클라이언트에 전달
 */
function generateErrorScript(error: Error, routeId: string): string {
  const safeMessage = escapeJsString(error.message);
  const safeRouteId = escapeJsString(routeId);

  return `<script>
(function() {
  window.__MANDU_STREAMING_ERROR__ = {
    routeId: "${safeRouteId}",
    message: "${safeMessage}",
    timestamp: ${Date.now()}
  };
  console.error("[Mandu Streaming] 렌더링 중 에러:", "${safeMessage}");
  window.dispatchEvent(new CustomEvent('mandu:streaming-error', {
    detail: window.__MANDU_STREAMING_ERROR__
  }));
})();
</script>`;
}

// ========== Suspense Wrappers ==========

/**
 * Island를 Suspense로 감싸는 래퍼
 * Streaming SSR에서 Island별 점진적 렌더링 지원
 */
export function SuspenseIsland({
  children,
  fallback,
  routeId,
  priority = "visible",
  bundleSrc,
}: {
  children: ReactNode;
  fallback?: ReactNode;
  routeId: string;
  priority?: HydrationPriority;
  bundleSrc?: string;
}): ReactElement {
  const defaultFallback = React.createElement("div", {
    "data-mandu-island": routeId,
    "data-mandu-priority": priority,
    "data-mandu-src": bundleSrc ? `${bundleSrc}${bundleSrc.includes('?') ? '&' : '?'}t=${Date.now()}` : bundleSrc,
    "data-mandu-loading": "true",
    style: { display: "contents", minHeight: "50px" },
  }, React.createElement("div", {
    className: "mandu-loading-skeleton",
    style: {
      background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
      backgroundSize: "200% 100%",
      animation: "mandu-shimmer 1.5s infinite",
      height: "100%",
      minHeight: "50px",
      borderRadius: "4px",
    },
  }));

  return React.createElement(
    Suspense,
    { fallback: fallback || defaultFallback },
    React.createElement("div", {
      "data-mandu-island": routeId,
      "data-mandu-priority": priority,
      "data-mandu-src": bundleSrc ? `${bundleSrc}${bundleSrc.includes('?') ? '&' : '?'}t=${Date.now()}` : bundleSrc,
      style: { display: "contents" },
    }, children)
  );
}

/**
 * Deferred 데이터를 위한 Suspense 컴포넌트
 * 데이터가 준비되면 children 렌더링
 */
export function DeferredData<T>({
  promise,
  children,
  fallback,
}: {
  promise: Promise<T>;
  children: (data: T) => ReactNode;
  fallback?: ReactNode;
}): ReactElement {
  // React 18 use() 훅 대신 Suspense + throw promise 패턴 사용
  const AsyncComponent = React.lazy(async () => {
    const data = await promise;
    return {
      default: () => React.createElement(React.Fragment, null, children(data)),
    };
  });

  return React.createElement(
    Suspense,
    { fallback: fallback || React.createElement("span", null, "Loading...") },
    React.createElement(AsyncComponent, null)
  );
}

// ========== HTML Generation ==========

/**
 * Streaming용 HTML Shell 생성 (<!DOCTYPE> ~ <div id="root">)
 */
function generateHTMLShell(options: StreamingSSROptions): string {
  const {
    title = "Mandu App",
    lang = "ko",
    headTags = "",
    bundleManifest,
    routeId,
    hydration,
    cssPath,
    isDev = false,
  } = options;

  // CSS 링크 태그 생성
  // - cssPath가 string이면 해당 경로 사용
  // - cssPath가 false 또는 undefined이면 링크 미삽입 (404 방지)
  const cssLinkTag = cssPath
    ? `<link rel="stylesheet" href="${escapeHtmlAttr(`${cssPath}${isDev ? `?t=${Date.now()}` : ""}`)}">`
    : "";

  // Island wrapper (hydration이 필요한 경우)
  const needsHydration = hydration && hydration.strategy !== "none" && routeId && bundleManifest;

  // Import map (module scripts 전에 위치해야 함 — hydration 필요 시에만)
  let importMapScript = "";
  if (needsHydration && bundleManifest.importMap && Object.keys(bundleManifest.importMap.imports).length > 0) {
    const importMapJson = escapeJsonForInlineScript(JSON.stringify(bundleManifest.importMap, null, 2));
    importMapScript = `<script type="importmap">${importMapJson}</script>`;
  }

  // Loading skeleton 애니메이션 스타일 (hydration 필요 시에만)
  const loadingStyles = !needsHydration ? "" : `
<style>
@keyframes mandu-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.mandu-loading-skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 200% 100%;
  animation: mandu-shimmer 1.5s infinite;
}
.mandu-stream-pending {
  opacity: 0;
  transition: opacity 0.3s ease-in;
}
.mandu-stream-ready {
  opacity: 1;
}
</style>`;

  let islandOpenTag = "";
  if (needsHydration) {
    const bundle = bundleManifest.bundles[routeId];
    const bundleSrc = bundle?.js ? `${bundle.js}?t=${Date.now()}` : "";
    const priority = hydration.priority || "visible";
    islandOpenTag = `<div data-mandu-island="${escapeHtmlAttr(routeId)}" data-mandu-src="${escapeHtmlAttr(bundleSrc)}" data-mandu-priority="${escapeHtmlAttr(priority)}" style="display:contents">`;
  }

  // Import map은 module 스크립트보다 먼저 정의되어야 bare specifier 해석 가능
  return `<!DOCTYPE html>
<html lang="${escapeHtmlAttr(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlText(title)}</title>
  ${cssLinkTag}
  ${loadingStyles}
  ${importMapScript}
  ${headTags}
</head>
<body>
  <div id="root">${islandOpenTag}`;
}

/**
 * Streaming용 HTML Tail 스크립트 생성 (</div id="root"> ~ 스크립트들)
 * `</body></html>`은 포함하지 않음 - deferred 스크립트 삽입 지점 확보
 */
function generateHTMLTailContent(options: StreamingSSROptions): string {
  const {
    routeId,
    routePattern,
    criticalData,
    bundleManifest,
    isDev = false,
    hmrPort,
    enableClientRouter = false,
    hydration,
  } = options;

  const scripts: string[] = [];

  // Zero-JS 모드 판정: island이 없는 페이지에서는 클라이언트 번들을 전송하지 않음
  const needsHydration = hydration && hydration.strategy !== "none" && routeId && bundleManifest;

  // 1~8: hydration이 필요한 경우에만 클라이언트 JS 관련 스크립트 삽입
  if (needsHydration) {
    // 1. Critical 데이터 스크립트 (즉시 사용 가능)
    if (criticalData && routeId) {
      const wrappedData = {
        [routeId]: {
          serverData: criticalData,
          timestamp: Date.now(),
          streaming: true,
        },
      };
      const json = escapeJsonForInlineScript(serializeProps(wrappedData));
      scripts.push(`<script id="__MANDU_DATA__" type="application/json">${json}</script>`);
      scripts.push(`<script>window.__MANDU_DATA_RAW__ = document.getElementById('__MANDU_DATA__').textContent;</script>`);
    }

    // 2. 라우트 정보 스크립트
    if (enableClientRouter && routeId) {
      const routeInfo = {
        id: routeId,
        pattern: routePattern || "",
        params: {},
        streaming: true,
      };
      const json = escapeJsonForInlineScript(JSON.stringify(routeInfo));
      scripts.push(`<script>window.__MANDU_ROUTE__ = ${json};</script>`);
    }

    // 3. Streaming 완료 마커 (클라이언트 hydration에서 감지용)
    scripts.push(`<script>window.__MANDU_STREAMING_SHELL_READY__ = true;</script>`);

    // 4. Vendor modulepreload (React, ReactDOM 등 - 캐시 효율 극대화)
    if (bundleManifest.shared.vendor) {
      scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(bundleManifest.shared.vendor)}">`);
    }
    if (bundleManifest.importMap?.imports) {
      const imports = bundleManifest.importMap.imports;
      if (imports["react-dom"] && imports["react-dom"] !== bundleManifest.shared.vendor) {
        scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(imports["react-dom"])}">`);
      }
      if (imports["react-dom/client"]) {
        scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(imports["react-dom/client"])}">`);
      }
    }

    // 5. Runtime modulepreload (hydration 실행 전 미리 로드)
    if (bundleManifest.shared.runtime) {
      scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(bundleManifest.shared.runtime)}">`);
    }

    // 6. Island modulepreload
    const bundle = bundleManifest.bundles[routeId];
    if (bundle) {
      const cacheBust = `${bundle.js}${bundle.js.includes('?') ? '&' : '?'}v=${Date.now()}`;
      scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(cacheBust)}">`);
    }

    // 7. Runtime 로드
    if (bundleManifest.shared.runtime) {
      scripts.push(`<script type="module" src="${escapeHtmlAttr(bundleManifest.shared.runtime)}"></script>`);
    }

    // 7.5 React internals shim (must run before react-dom/client runs)
    scripts.push(REACT_INTERNALS_SHIM_SCRIPT);

    // 8. Router 스크립트
    if (enableClientRouter && bundleManifest.shared?.router) {
      scripts.push(`<script type="module" src="${escapeHtmlAttr(bundleManifest.shared.router)}"></script>`);
    }
  }

  // 9. #179: body 내 <link> 태그를 <head>로 호이스팅 (외부 폰트/스타일시트 지원)
  scripts.push(`<script>document.querySelectorAll('#root link[rel="stylesheet"],#root link[rel="preconnect"],#root link[rel="preload"],#root link[rel="icon"],#root link[rel="dns-prefetch"]').forEach(function(l){document.head.appendChild(l)})</script>`);

  // 10. HMR 스크립트 (개발 모드 — Zero-JS 페이지에서도 CSS 핫리로드 지원)
  if (isDev && hmrPort) {
    scripts.push(generateHMRScript(hmrPort));
  }

  // 11. DevTools 번들 로드 (개발 모드)
  if (isDev) {
    scripts.push(`<script type="module" src="/.mandu/client/_devtools.js"></script>`);
  }

  // Island wrapper 닫기 (hydration이 필요한 경우)
  const islandCloseTag = needsHydration ? "</div>" : "";

  return `${islandCloseTag}</div>
  ${scripts.join("\n  ")}`;
}

/**
 * HTML 문서 닫기 태그
 * Deferred 스크립트 삽입 후 호출
 */
function generateHTMLClose(): string {
  return `
</body>
</html>`;
}

/**
 * Streaming용 HTML Tail 생성 (</div id="root"> ~ </html>)
 * 하위 호환성 유지 - 내부적으로 generateHTMLTailContent + generateHTMLClose 사용
 */
function generateHTMLTail(options: StreamingSSROptions): string {
  return generateHTMLTailContent(options) + generateHTMLClose();
}

/**
 * Deferred 데이터 인라인 스크립트 생성
 * Streaming 중에 데이터 도착 시 DOM에 주입
 */
function generateDeferredDataScript(routeId: string, key: string, data: unknown): string {
  const json = escapeJsonForInlineScript(serializeProps({ [key]: data }));
  const safeRouteId = escapeJsString(routeId);
  const safeKey = escapeJsString(key);

  return `<script>
(function() {
  window.__MANDU_DEFERRED__ = window.__MANDU_DEFERRED__ || {};
  window.__MANDU_DEFERRED__["${safeRouteId}"] = window.__MANDU_DEFERRED__["${safeRouteId}"] || {};
  Object.assign(window.__MANDU_DEFERRED__["${safeRouteId}"], ${json});
  window.dispatchEvent(new CustomEvent('mandu:deferred-data', { detail: { routeId: "${safeRouteId}", key: "${safeKey}" } }));
})();
</script>`;
}

/**
 * HMR 스크립트 생성
 * ssr.ts의 generateHMRScript와 동일한 구현을 유지해야 함 (#114)
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
      ws = new WebSocket('ws://' + window.location.hostname + ':${hmrPort}');
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

// ========== Main Streaming Functions ==========

/**
 * React 컴포넌트를 ReadableStream으로 렌더링
 * Bun/Web Streams API 기반
 *
 * 핵심 원칙:
 * - Shell은 즉시 전송 (TTFB 최소화)
 * - allReady는 메트릭용으로만 사용 (대기 안 함)
 * - Shell 전 에러는 throw → Response 레이어에서 500 처리
 * - Shell 후 에러는 에러 스크립트 삽입
 */
export async function renderToStream(
  element: ReactElement,
  options: StreamingSSROptions = {}
): Promise<ReadableStream<Uint8Array>> {
  mark("ssr:render");
  const {
    onShellReady,
    onAllReady,
    onShellError,
    onStreamError,
    onError,
    onMetrics,
    isDev = false,
    routeId = "unknown",
    criticalData,
    streamTimeout,
  } = options;

  // 메트릭 수집
  const metrics: StreamingMetrics = {
    shellReadyTime: 0,
    allReadyTime: 0,
    deferredChunkCount: 0,
    hasError: false,
    startTime: Date.now(),
  };

  // criticalData 직렬화 검증 (dev에서는 throw)
  validateCriticalData(criticalData, isDev);

  // 스트리밍 주의사항 경고 (첫 요청 시 1회만)
  if (isDev && !streamingWarnings.hasWarned()) {
    warnStreamingCaveats(isDev);
    streamingWarnings.markWarned();
  }

  const encoder = new TextEncoder();
  const collectedHeadTags = collectStreamingHeadTags(element);
  const resolvedOptions = collectedHeadTags
    ? { ...options, headTags: [options.headTags, collectedHeadTags].filter(Boolean).join("\n") }
    : options;
  const htmlShell = generateHTMLShell(resolvedOptions);

  // Reset SSR head before real render so streaming components push fresh tags
  try {
    const headMod = require("../client/use-head") as { resetSSRHead?: () => void; getSSRHeadTags?: () => string };
    headMod.resetSSRHead?.();
  } catch {}

  // Lazy tail: collect late head tags injected during streaming render
  function buildHtmlTail(): string {
    const baseTail = resolvedOptions._skipHtmlClose
      ? generateHTMLTailContent(resolvedOptions)
      : generateHTMLTail(resolvedOptions);
    try {
      const headMod = require("../client/use-head") as { getSSRHeadTags?: () => string };
      const lateHeadTags = headMod.getSSRHeadTags?.() ?? "";
      if (lateHeadTags) {
        const escaped = escapeJsonForInlineScript(JSON.stringify(lateHeadTags));
        const script = `<script>(function(){var t=${escaped},d=document.createElement('div');d.innerHTML=t;var h=document.head;while(d.firstChild)h.appendChild(d.firstChild);})()</script>`;
        return script + baseTail;
      }
    } catch {}
    return baseTail;
  }

  let shellSent = false;
  let timedOut = false;

  // React renderToReadableStream 호출
  // 실패 시 throw → renderStreamingResponse에서 500 처리
  const renderToReadableStream = getRenderToReadableStream();
  const reactStream = await renderToReadableStream(element, {
    onError: (error: Error) => {
      if (timedOut) return;

      metrics.hasError = true;
      const streamingError: StreamingError = {
        error,
        isShellError: !shellSent,
        recoverable: shellSent,
        timestamp: Date.now(),
      };

      console.error("[Mandu Streaming] React render error:", error);

      if (!shellSent) {
        // Shell 전 에러 - 콜백만 호출 (throw는 하지 않음, 이미 스트림 시작됨)
        onShellError?.(streamingError);
      } else {
        // Shell 후 에러 - 스트림에 에러 스크립트 삽입됨
        onStreamError?.(streamingError);
      }

      onError?.(error);
    },
  });

  // allReady는 백그라운드에서 메트릭용으로만 사용 (대기 안 함!)
  reactStream.allReady.then(() => {
    metrics.allReadyTime = Date.now() - metrics.startTime;
    if (isDev) {
      console.log(`[Mandu Streaming] All ready: ${routeId} (${metrics.allReadyTime}ms)`);
    }
  }).catch(() => {
    // 에러는 onError에서 이미 처리됨
  });

  // Custom stream으로 래핑 (Shell + React Content + Tail)
  let tailSent = false;
  const reader = reactStream.getReader();
  const deadline = streamTimeout && streamTimeout > 0
    ? metrics.startTime + streamTimeout
    : null;

  async function readWithTimeout(): Promise<ReadableStreamReadResult<Uint8Array> | null> {
    if (!deadline) {
      return reader.read() as Promise<ReadableStreamReadResult<Uint8Array>>;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return null;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ kind: "timeout" }), remaining);
    });

    const readPromise = reader
      .read()
      .then((result) => ({ kind: "read" as const, result: result as ReadableStreamReadResult<Uint8Array> }))
      .catch((error: unknown) => ({ kind: "error" as const, error }));

    const result = await Promise.race([readPromise, timeoutPromise]);

    if (result.kind === "timeout") {
      return null;
    }

    if (timeoutId) clearTimeout(timeoutId);

    if (result.kind === "error") {
      throw result.error;
    }

    return result.result;
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // Shell 즉시 전송 (TTFB 최소화의 핵심!)
      controller.enqueue(encoder.encode(htmlShell));
      shellSent = true;
      metrics.shellReadyTime = Date.now() - metrics.startTime;
      measure("ssr:render", "ssr:render");
      onShellReady?.();
    },

    async pull(controller) {
      try {
        const readResult = await readWithTimeout();

        // 타임아웃 발생
        if (!readResult) {
          const timeoutError = new Error(`Stream timeout: exceeded ${streamTimeout}ms`);
          metrics.hasError = true;
          timedOut = true;
          if (isDev) {
            console.warn(`[Mandu Streaming] Stream timeout after ${streamTimeout}ms`);
          }

          const streamingError: StreamingError = {
            error: timeoutError,
            isShellError: false,
            recoverable: true,
            timestamp: Date.now(),
          };
          onStreamError?.(streamingError);

          controller.enqueue(encoder.encode(generateErrorScript(timeoutError, routeId)));

          if (!tailSent) {
            controller.enqueue(encoder.encode(buildHtmlTail()));
            tailSent = true;
            metrics.allReadyTime = Date.now() - metrics.startTime;
            onMetrics?.(metrics);
          }
          controller.close();
          try {
            const cancelPromise = reader.cancel();
            if (cancelPromise) {
              cancelPromise.catch(() => {});
            }
          } catch {}
          return;
        }

        const { done, value } = readResult;

        if (done) {
          if (!tailSent) {
            controller.enqueue(encoder.encode(buildHtmlTail()));
            tailSent = true;
            // allReady가 아직 안 끝났을 수 있으므로 현재 시점으로 기록
            if (metrics.allReadyTime === 0) {
              metrics.allReadyTime = Date.now() - metrics.startTime;
            }
            onAllReady?.();
            onMetrics?.(metrics);
          }
          controller.close();
          return;
        }

        // React 컨텐츠를 그대로 스트리밍
        controller.enqueue(value);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        metrics.hasError = true;

        console.error("[Mandu Streaming] Pull error:", err);

        // Shell 후 에러 - 에러 스크립트 삽입
        const streamingError: StreamingError = {
          error: err,
          isShellError: false,
          recoverable: true,
          timestamp: Date.now(),
        };
        onStreamError?.(streamingError);

        controller.enqueue(encoder.encode(generateErrorScript(err, routeId)));

        if (!tailSent) {
          controller.enqueue(encoder.encode(buildHtmlTail()));
          tailSent = true;
          metrics.allReadyTime = Date.now() - metrics.startTime;
          onMetrics?.(metrics);
        }
        controller.close();
      }
    },

    cancel() {
      try {
        const cancelPromise = reader.cancel();
        if (cancelPromise) {
          cancelPromise.catch(() => {});
        }
      } catch {}
    },
  });
}

function collectStreamingHeadTags(element: ReactElement): string {
  try {
    const mod = require("../client/use-head") as {
      resetSSRHead?: () => void;
      getSSRHeadTags?: () => string;
    };
    mod.resetSSRHead?.();
    const renderToString = getRenderToString();
    renderToString(element);
    return mod.getSSRHeadTags?.() ?? "";
  } catch {
    return "";
  }
}

/**
 * Streaming SSR Response 생성
 *
 * 헤더 설명:
 * - X-Accel-Buffering: no - nginx 버퍼링 비활성화
 * - Cache-Control: no-transform - 중간 프록시 변환 방지
 *
 * 주의: Transfer-Encoding은 설정하지 않음
 * - WHATWG Response 환경에서 런타임이 자동 처리
 * - 명시적 설정은 오히려 문제 될 수 있음
 *
 * 에러 정책:
 * - renderToReadableStream 자체가 throw (stream 생성 실패)
 *   → 여기서 catch → 500 Response 반환 (유일한 500 케이스)
 * - React onError 콜백 호출 (렌더링 중 에러)
 *   → StreamingError로 래핑 → 콜백 호출
 *   → 스트림은 계속 진행 (부분 렌더링 or 에러 스크립트 삽입)
 */
export async function renderStreamingResponse(
  element: ReactElement,
  options: StreamingSSROptions = {}
): Promise<Response> {
  try {
    const stream = await renderToStream(element, options);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Transfer-Encoding은 런타임이 자동 처리 (명시 안 함)
        "X-Content-Type-Options": "nosniff",
        // nginx 버퍼링 비활성화 힌트
        "X-Accel-Buffering": "no",
        // 캐시 및 변환 방지 (Streaming은 동적)
        "Cache-Control": "no-store, no-transform",
        // CDN 힌트
        "CDN-Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // renderToStream에서 throw된 에러 → 500 응답 (단일 책임)
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[Mandu Streaming] Render failed:", err);

    // XSS 방지
    const safeMessage = err.message
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    return new Response(
      `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>500 Server Error</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 40px; background: #f5f5f5; }
    .error { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #e53935; margin: 0 0 16px 0; }
    pre { background: #f5f5f5; padding: 12px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="error">
    <h1>500 Server Error</h1>
    <p>렌더링 중 오류가 발생했습니다.</p>
    ${options.isDev ? `<pre>${safeMessage}</pre>` : ""}
  </div>
</body>
</html>`,
      {
        status: 500,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }
    );
  }
}

/**
 * Deferred 데이터와 함께 Streaming SSR 렌더링
 *
 * 핵심 원칙:
 * - base stream은 즉시 시작 (TTFB 최소화)
 * - deferred는 병렬로 처리하되 스트림을 막지 않음
 * - 준비된 deferred만 tail 이후에 스크립트로 주입
 */
export async function renderWithDeferredData(
  element: ReactElement,
  options: StreamingSSROptions & {
    deferredPromises?: Record<string, Promise<unknown>>;
    /** Deferred 타임아웃 (ms) - 이 시간 안에 resolve되지 않으면 포기 */
    deferredTimeout?: number;
  }
): Promise<Response> {
  const {
    deferredPromises = {},
    deferredTimeout = 5000,
    routeId = "default",
    onMetrics,
    isDev = false,
    ...restOptions
  } = options;
  const streamTimeout = options.streamTimeout;

  const encoder = new TextEncoder();
  const startTime = Date.now();

  // 준비된 deferred 스크립트를 담을 배열 (mutable)
  const readyScripts: string[] = [];
  let deferredChunkCount = 0;
  let allDeferredSettled = false;

  // 1. Deferred promises 병렬 시작 (막지 않음!)
  const deferredEntries = Object.entries(deferredPromises);
  const deferredSettledPromise = deferredEntries.length > 0
    ? Promise.allSettled(
        deferredEntries.map(async ([key, promise]) => {
          try {
            // 타임아웃 적용
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Deferred timeout: ${key}`)), deferredTimeout)
            );
            const data = await Promise.race([promise, timeoutPromise]);

            // 스크립트 생성 및 추가
            const script = generateDeferredDataScript(routeId, key, data);
            readyScripts.push(script);
            deferredChunkCount++;

            if (isDev) {
              console.log(`[Mandu Streaming] Deferred ready: ${key} (${Date.now() - startTime}ms)`);
            }
          } catch (error) {
            console.error(`[Mandu Streaming] Deferred error for ${key}:`, error);
          }
        })
      ).then(() => {
        allDeferredSettled = true;
      })
    : Promise.resolve().then(() => { allDeferredSettled = true; });

  // 2. Base stream 즉시 시작 (TTFB 최소화의 핵심!)
  //    _skipHtmlClose: true로 </body></html> 생략 → deferred 스크립트 삽입 지점 확보
  let baseMetrics: StreamingMetrics | null = null;
  const baseStream = await renderToStream(element, {
    ...restOptions,
    routeId,
    isDev,
    _skipHtmlClose: true, // deferred 스크립트를 </body> 전에 삽입하기 위해
    onMetrics: (metrics) => {
      baseMetrics = metrics;
    },
  });

  // 3. 수동 스트림 파이프라인 (Bun pipeThrough 호환성 문제 해결)
  //    base stream을 읽고 → 변환 후 → 새 스트림으로 출력
  const reader = baseStream.getReader();

  const finalStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (!done && value) {
          // base stream chunk 그대로 전달
          controller.enqueue(value);
          return;
        }

        // base stream 완료 → flush 로직 실행
        // deferred가 아직 안 끝났으면 잠시 대기 (단, deferredTimeout 내에서만)
        if (!allDeferredSettled) {
          const elapsed = Date.now() - startTime;
          let remainingTime = deferredTimeout - elapsed;
          if (streamTimeout && streamTimeout > 0) {
            const remainingStream = streamTimeout - elapsed;
            remainingTime = Math.min(remainingTime, remainingStream);
          }
          remainingTime = Math.max(0, remainingTime);
          if (remainingTime > 0) {
            await Promise.race([
              deferredSettledPromise,
              new Promise(resolve => setTimeout(resolve, remainingTime)),
            ]);
          }
        }

        // 준비된 deferred 스크립트만 주입 (실제 enqueue 기준 카운트)
        let injectedCount = 0;
        for (const script of readyScripts) {
          controller.enqueue(encoder.encode(script));
          injectedCount++;
        }

        if (isDev && injectedCount > 0) {
          console.log(`[Mandu Streaming] Injected ${injectedCount} deferred scripts`);
        }

        // HTML 닫기 태그 추가 (</body></html>)
        controller.enqueue(encoder.encode(generateHTMLClose()));

        // 최종 메트릭 보고 (injectedCount가 실제 메트릭)
        if (onMetrics && baseMetrics) {
          onMetrics({
            ...baseMetrics,
            deferredChunkCount: injectedCount,
            allReadyTime: Date.now() - startTime,
          });
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      reader.cancel();
    },
  });

  return new Response(finalStream, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-store, no-transform",
      "CDN-Cache-Control": "no-store",
    },
  });
}

// ========== Loader Helpers ==========

/**
 * Streaming Loader 헬퍼
 * Critical과 Deferred 데이터를 분리하여 반환
 *
 * @example
 * ```typescript
 * export const loader = createStreamingLoader(async (ctx) => {
 *   return {
 *     critical: await getEssentialData(ctx),
 *     deferred: fetchOptionalData(ctx), // Promise 그대로 전달
 *   };
 * });
 * ```
 */
export function createStreamingLoader<TCritical, TDeferred>(
  loaderFn: (ctx: unknown) => Promise<StreamingLoaderResult<{ critical: TCritical; deferred: TDeferred }>>
) {
  return async (ctx: unknown) => {
    const result = await loaderFn(ctx);
    return {
      critical: result.critical,
      deferred: result.deferred,
    };
  };
}

/**
 * Deferred 데이터 프라미스 래퍼
 * Streaming 중 데이터 준비되면 클라이언트로 전송
 */
export function defer<T>(promise: Promise<T>): Promise<T> {
  return promise;
}

// ========== SEO Integration ==========

/**
 * SEO 메타데이터와 함께 Streaming SSR 렌더링
 *
 * Layout 체인에서 메타데이터를 자동으로 수집하고 병합하여
 * HTML head에 삽입합니다.
 *
 * @example
 * ```typescript
 * // 정적 메타데이터
 * const response = await renderWithSEO(<Page />, {
 *   metadata: {
 *     title: 'Home',
 *     description: 'Welcome to my site',
 *     openGraph: { type: 'website' },
 *   },
 * })
 *
 * // Layout 체인 메타데이터
 * const response = await renderWithSEO(<Page />, {
 *   metadata: [
 *     layoutMetadata,  // { title: { template: '%s | Site' } }
 *     pageMetadata,    // { title: 'Blog Post' }
 *   ],
 *   routeParams: { slug: 'hello' },
 * })
 * // → title: "Blog Post | Site"
 * ```
 */
export async function renderWithSEO(
  element: ReactElement,
  options: StreamingSSROptions = {}
): Promise<Response> {
  const { metadata, routeParams, searchParams, ...restOptions } = options;

  // SEO 메타데이터 처리
  if (metadata) {
    const seoOptions: SEOOptions = {
      routeParams,
      searchParams,
    };

    // 배열이면 Layout 체인, 아니면 단일 메타데이터
    if (Array.isArray(metadata)) {
      seoOptions.metadata = metadata;
    } else {
      seoOptions.staticMetadata = metadata as Metadata;
    }

    // SEO를 옵션에 주입
    const optionsWithSEO = await injectSEOIntoOptions(restOptions, seoOptions);
    return renderStreamingResponse(element, optionsWithSEO);
  }

  // SEO 없이 기본 렌더링
  return renderStreamingResponse(element, restOptions);
}

/**
 * Deferred 데이터 + SEO 메타데이터와 함께 Streaming SSR 렌더링
 *
 * @example
 * ```typescript
 * const response = await renderWithDeferredDataAndSEO(<Page />, {
 *   metadata: {
 *     title: post.title,
 *     openGraph: { images: [post.image] },
 *   },
 *   deferredPromises: {
 *     comments: fetchComments(postId),
 *     related: fetchRelatedPosts(postId),
 *   },
 * })
 * ```
 */
export async function renderWithDeferredDataAndSEO(
  element: ReactElement,
  options: StreamingSSROptions & {
    deferredPromises?: Record<string, Promise<unknown>>;
    deferredTimeout?: number;
  } = {}
): Promise<Response> {
  const { metadata, routeParams, searchParams, ...restOptions } = options;

  // SEO 메타데이터 처리
  if (metadata) {
    const seoOptions: SEOOptions = {
      routeParams,
      searchParams,
    };

    if (Array.isArray(metadata)) {
      seoOptions.metadata = metadata;
    } else {
      seoOptions.staticMetadata = metadata as Metadata;
    }

    const optionsWithSEO = await injectSEOIntoOptions(restOptions, seoOptions);
    return renderWithDeferredData(element, optionsWithSEO);
  }

  return renderWithDeferredData(element, restOptions);
}

// ========== Exports ==========

export {
  generateHTMLShell,
  generateHTMLTail,
  generateDeferredDataScript,
};

// Re-export SEO integration utilities
export { resolveSEO, injectSEOIntoOptions } from "../seo/integration/ssr";
export type { SEOOptions, SEOResult } from "../seo/integration/ssr";
