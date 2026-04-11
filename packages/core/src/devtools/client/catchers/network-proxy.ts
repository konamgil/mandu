/**
 * Mandu Kitchen DevTools - Network Proxy
 * @version 1.0.4
 *
 * Fetch/XHR 요청을 인터셉트하여 DevTools로 전달
 *
 * FIXED (v1.0.4): Streaming response handling no longer clones the response.
 * The previous approach used response.clone() + a parallel reader loop, which
 * caused two critical issues:
 *   1. Tee'd ReadableStream backpressure: clone() creates a tee — if one
 *      branch is read faster than the other, the browser buffers data
 *      internally, eventually stalling both streams.
 *   2. Microtask starvation: the tight `while(true) { await reader.read() }`
 *      loop resolved as microtasks. With fast SSE token streams, the loop
 *      never yielded to the macrotask queue, blocking page.evaluate(),
 *      user interactions, and all macrotask-scheduled work — effectively
 *      freezing the main thread.
 *
 * New approach: wrap the original response body with a TransformStream that
 * passthrough-observes each chunk without consuming or buffering it separately.
 * The consumer (island component) drives the read pace; the proxy merely
 * piggybacks on each chunk as it flows through.
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

    const interceptedFetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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

    // Bun's fetch type includes `preconnect`, use Object.assign to preserve it
    Object.assign(interceptedFetch, { preconnect: window.fetch.preconnect });
    window.fetch = interceptedFetch as typeof fetch;
  }

  // --------------------------------------------------------------------------
  // Streaming Response Handler
  // --------------------------------------------------------------------------

  /**
   * Handle streaming (SSE/NDJSON) responses by wrapping the body with a
   * passthrough TransformStream that observes chunks without cloning.
   *
   * This avoids:
   * - response.clone() tee backpressure that stalls both streams
   * - Separate reader loop that causes microtask starvation
   *
   * The consumer (island component) remains in full control of read pacing.
   */
  private handleStreamingResponse(requestId: string, response: Response): Response {
    const trackedRequest = this.trackedRequests.get(requestId);
    if (trackedRequest) {
      trackedRequest.isStreaming = true;
      trackedRequest.chunkCount = 0;
    }

    // If there is no body (e.g., 204), just emit the response event and return
    if (!response.body) {
      const responseEvent = createNetworkResponseEvent(requestId, response.status);
      getOrCreateHook().emit(responseEvent);
      return response;
    }

    let chunkIndex = 0;
    const self = this;

    // Create a passthrough TransformStream that observes each chunk as it
    // flows from the network to the consumer. No cloning, no buffering.
    const observerTransform = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Pass the chunk through immediately — zero copy
        controller.enqueue(chunk);

        // Emit tracking event (lightweight, non-blocking)
        if (trackedRequest) {
          trackedRequest.chunkCount = (trackedRequest.chunkCount ?? 0) + 1;
        }

        getOrCreateHook().emit({
          type: 'network:chunk',
          timestamp: Date.now(),
          data: {
            id: requestId,
            chunkIndex: chunkIndex++,
            size: chunk?.length ?? 0,
          },
        });
      },

      flush() {
        // Stream completed — emit response event
        const responseEvent = createNetworkResponseEvent(requestId, response.status);
        getOrCreateHook().emit(responseEvent);
        self.trackedRequests.delete(requestId);
      },
    });

    // Pipe the original body through the observer
    const observedBody = response.body.pipeThrough(observerTransform);

    // Construct a new Response with the observed body but identical headers/status
    return new Response(observedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
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
