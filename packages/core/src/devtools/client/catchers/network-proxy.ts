/**
 * Mandu Kitchen DevTools - Network Proxy
 * @version 1.0.3
 *
 * Fetch/XHR 요청을 인터셉트하여 DevTools로 전달
 */

import type { NetworkRequest, NetworkBodyPolicy } from '../../types';
import { getOrCreateHook } from '../../hook';
import { createNetworkRequestEvent, createNetworkResponseEvent, ALLOWED_HEADERS, BLOCKED_HEADERS } from '../../protocol';

// ============================================================================
// Types
// ============================================================================

interface NetworkProxyOptions {
  /** Network body 수집 정책 */
  bodyPolicy?: NetworkBodyPolicy;
  /** 무시할 URL 패턴 */
  ignorePatterns?: (string | RegExp)[];
  /** 최대 추적 요청 수 */
  maxTrackedRequests?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<NetworkProxyOptions> = {
  bodyPolicy: {
    collectBody: false,
    optInPolicy: {
      maxBytes: 10_000,
      applyPIIFilter: true,
      applySecretFilter: true,
      allowedContentTypes: ['application/json', 'text/plain', 'text/event-stream'],
    },
  },
  ignorePatterns: [
    // DevTools 자체 요청
    /__mandu/,
    // HMR
    /__vite/,
    /\.hot-update\./,
    // Source maps
    /\.map$/,
    // Chrome extensions
    /^chrome-extension:/,
  ],
  maxTrackedRequests: 200,
};

// ============================================================================
// Helper Functions
// ============================================================================

let requestIdCounter = 0;

function generateRequestId(): string {
  return `req-${Date.now()}-${++requestIdCounter}`;
}

function shouldIgnore(url: string, patterns: (string | RegExp)[]): boolean {
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      if (url.includes(pattern)) return true;
    } else {
      if (pattern.test(url)) return true;
    }
  }
  return false;
}

function extractSafeHeaders(headers: Headers | Record<string, string>): {
  safeHeaders: Record<string, string>;
  redactedHeaders: string[];
} {
  const safeHeaders: Record<string, string> = {};
  const redactedHeaders: string[] = [];

  const entries = headers instanceof Headers
    ? Array.from(headers.entries())
    : Object.entries(headers);

  for (const [key, value] of entries) {
    const lowerKey = key.toLowerCase();

    if (BLOCKED_HEADERS.has(lowerKey)) {
      redactedHeaders.push(key);
    } else if (ALLOWED_HEADERS.has(lowerKey)) {
      safeHeaders[key] = value;
    } else {
      // 커스텀 헤더: 키만 표시
      safeHeaders[key] = '[...]';
    }
  }

  return { safeHeaders, redactedHeaders };
}

function isStreamingResponse(contentType: string | null): boolean {
  if (!contentType) return false;
  return (
    contentType.includes('text/event-stream') ||
    contentType.includes('application/x-ndjson')
  );
}

// ============================================================================
// Network Proxy Class
// ============================================================================

export class NetworkProxy {
  private options: Required<NetworkProxyOptions>;
  private isAttached = false;
  private originalFetch?: typeof fetch;
  private trackedRequests = new Map<string, NetworkRequest>();

  constructor(options?: NetworkProxyOptions) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      bodyPolicy: {
        ...DEFAULT_OPTIONS.bodyPolicy,
        ...options?.bodyPolicy,
      },
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  attach(): void {
    if (this.isAttached || typeof window === 'undefined') return;

    this.attachFetch();
    this.isAttached = true;
  }

  detach(): void {
    if (!this.isAttached || typeof window === 'undefined') return;

    if (this.originalFetch) {
      window.fetch = this.originalFetch;
    }

    this.trackedRequests.clear();
    this.isAttached = false;
  }

  // --------------------------------------------------------------------------
  // Fetch Interceptor
  // --------------------------------------------------------------------------

  private attachFetch(): void {
    this.originalFetch = window.fetch.bind(window);
    const self = this;
    const originalFetch = this.originalFetch;

    (window as any).fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

      // 무시 패턴 체크
      if (shouldIgnore(url, self.options.ignorePatterns)) {
        return originalFetch(input, init);
      }

      const requestId = generateRequestId();
      const method = init?.method ?? 'GET';
      const headers = new Headers(init?.headers);
      const { safeHeaders, redactedHeaders } = extractSafeHeaders(headers);

      // 요청 시작 이벤트
      const request: Omit<NetworkRequest, 'id' | 'startTime'> = {
        method: method.toUpperCase(),
        url,
        safeHeaders,
        redactedHeaders,
        isStreaming: false,
      };

      const event = createNetworkRequestEvent(request);
      const trackedRequest = event.data as NetworkRequest;
      self.trackedRequests.set(requestId, trackedRequest);

      // 최대 추적 수 제한
      if (self.trackedRequests.size > self.options.maxTrackedRequests) {
        const firstKey = self.trackedRequests.keys().next().value;
        if (firstKey) self.trackedRequests.delete(firstKey);
      }

      getOrCreateHook().emit(event);

      try {
        const response = await originalFetch(input, init);

        // 스트리밍 여부 확인
        const contentType = response.headers.get('content-type');
        const isStreaming = isStreamingResponse(contentType);

        if (isStreaming) {
          // SSE/스트리밍 응답 처리
          return self.handleStreamingResponse(requestId, response);
        }

        // 일반 응답 완료 이벤트
        const responseEvent = createNetworkResponseEvent(requestId, response.status);
        getOrCreateHook().emit(responseEvent);

        return response;
      } catch (error) {
        // 네트워크 에러
        getOrCreateHook().emit({
          type: 'network:error',
          timestamp: Date.now(),
          data: {
            id: requestId,
            error: error instanceof Error ? error.message : String(error),
          },
        });

        throw error;
      }
    };
  }

  // --------------------------------------------------------------------------
  // Streaming Response Handler
  // --------------------------------------------------------------------------

  private handleStreamingResponse(requestId: string, response: Response): Response {
    const trackedRequest = this.trackedRequests.get(requestId);
    if (trackedRequest) {
      trackedRequest.isStreaming = true;
      trackedRequest.chunkCount = 0;
    }

    // 응답 복제 (body를 두 번 읽기 위해)
    const clonedResponse = response.clone();
    const reader = clonedResponse.body?.getReader();

    if (reader) {
      this.trackStreamChunks(requestId, reader);
    }

    return response;
  }

  private async trackStreamChunks(
    requestId: string,
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<void> {
    const trackedRequest = this.trackedRequests.get(requestId);
    let chunkIndex = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // 스트림 완료
          const responseEvent = createNetworkResponseEvent(requestId, 200);
          getOrCreateHook().emit(responseEvent);
          break;
        }

        // Chunk 이벤트
        if (trackedRequest) {
          trackedRequest.chunkCount = (trackedRequest.chunkCount ?? 0) + 1;
        }

        getOrCreateHook().emit({
          type: 'network:chunk',
          timestamp: Date.now(),
          data: {
            id: requestId,
            chunkIndex: chunkIndex++,
            size: value?.length ?? 0,
          },
        });
      }
    } catch (error) {
      getOrCreateHook().emit({
        type: 'network:error',
        timestamp: Date.now(),
        data: {
          id: requestId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // --------------------------------------------------------------------------
  // Manual Tracking
  // --------------------------------------------------------------------------

  /**
   * 수동으로 요청 추적 (외부 라이브러리 등)
   */
  trackRequest(
    method: string,
    url: string,
    headers?: Record<string, string>
  ): string {
    const requestId = generateRequestId();
    const { safeHeaders, redactedHeaders } = extractSafeHeaders(headers ?? {});

    const event = createNetworkRequestEvent({
      method: method.toUpperCase(),
      url,
      safeHeaders,
      redactedHeaders,
      isStreaming: false,
    });

    const trackedRequest = event.data as NetworkRequest;
    this.trackedRequests.set(requestId, trackedRequest);
    getOrCreateHook().emit(event);

    return requestId;
  }

  /**
   * 수동으로 응답 완료 알림
   */
  completeRequest(requestId: string, status: number): void {
    const event = createNetworkResponseEvent(requestId, status);
    getOrCreateHook().emit(event);
    this.trackedRequests.delete(requestId);
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalNetworkProxy: NetworkProxy | null = null;

export function getNetworkProxy(options?: NetworkProxyOptions): NetworkProxy {
  if (!globalNetworkProxy) {
    globalNetworkProxy = new NetworkProxy(options);
  }
  return globalNetworkProxy;
}

export function initializeNetworkProxy(options?: NetworkProxyOptions): NetworkProxy {
  const proxy = getNetworkProxy(options);
  proxy.attach();
  return proxy;
}

export function destroyNetworkProxy(): void {
  if (globalNetworkProxy) {
    globalNetworkProxy.detach();
    globalNetworkProxy = null;
  }
}
