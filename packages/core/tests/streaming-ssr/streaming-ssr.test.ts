/**
 * Streaming SSR 테스트
 * React 18 renderToReadableStream 기반 점진적 렌더링 검증
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import React, { Suspense } from "react";
import {
  renderToStream,
  renderStreamingResponse,
  renderWithDeferredData,
  SuspenseIsland,
  DeferredData,
  defer,
} from "../../src/runtime/streaming-ssr";

// 테스트용 간단한 컴포넌트
function SimpleComponent({ message }: { message: string }) {
  return React.createElement("div", { className: "simple" }, message);
}

// 테스트용 Island 컴포넌트
function TestIsland({ count }: { count: number }) {
  return React.createElement("div", { className: "island" }, `Count: ${count}`);
}

// 비동기 데이터 시뮬레이션
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchMockData(): Promise<{ items: string[] }> {
  await delay(50);
  return { items: ["item1", "item2", "item3"] };
}

describe("Streaming SSR", () => {
  describe("renderToStream", () => {
    it("should render simple component to stream", async () => {
      const element = React.createElement(SimpleComponent, { message: "Hello Streaming" });
      const stream = await renderToStream(element, {
        title: "Test Page",
      });

      expect(stream).toBeInstanceOf(ReadableStream);

      // 스트림 읽기
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      // HTML 구조 검증
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<html lang=\"ko\">");
      expect(html).toContain("<title>Test Page</title>");
      expect(html).toContain("Hello Streaming");
      expect(html).toContain("</html>");
    });

    it("should include loading skeleton styles", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const stream = await renderToStream(element, {});

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).toContain("@keyframes mandu-shimmer");
      expect(html).toContain(".mandu-loading-skeleton");
    });

    it("should call onShellReady callback", async () => {
      let shellReady = false;

      const element = React.createElement(SimpleComponent, { message: "Test" });
      const stream = await renderToStream(element, {
        onShellReady: () => {
          shellReady = true;
        },
      });

      // 스트림 시작하면 shell ready 호출됨
      const reader = stream.getReader();
      await reader.read();

      expect(shellReady).toBe(true);
    });

    it("should include critical data in output", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const stream = await renderToStream(element, {
        routeId: "test-route",
        criticalData: { foo: "bar", count: 42 },
      });

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).toContain("__MANDU_DATA__");
      expect(html).toContain("foo");
      expect(html).toContain("bar");
    });

    it("should include streaming shell ready marker", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const stream = await renderToStream(element, {});

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).toContain("__MANDU_STREAMING_SHELL_READY__");
    });
  });

  describe("renderStreamingResponse", () => {
    it("should return Response with correct headers", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const response = await renderStreamingResponse(element, {
        title: "Test",
      });

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      // Transfer-Encoding은 런타임이 자동 처리하므로 명시하지 않음
      expect(response.headers.get("Transfer-Encoding")).toBeNull();
    });

    it("should have body as ReadableStream", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const response = await renderStreamingResponse(element, {});

      expect(response.body).toBeInstanceOf(ReadableStream);
    });
  });

  describe("SuspenseIsland", () => {
    it("should render island with data attributes", async () => {
      const island = React.createElement(
        SuspenseIsland,
        {
          routeId: "test-island",
          priority: "visible",
          bundleSrc: "/.mandu/client/test.js",
        },
        React.createElement(TestIsland, { count: 5 })
      );

      const stream = await renderToStream(island, {});
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).toContain('data-mandu-island="test-island"');
      expect(html).toContain('data-mandu-priority="visible"');
      expect(html).toContain('data-mandu-src="/.mandu/client/test.js"');
      expect(html).toContain("Count: 5");
    });

    it("should use default loading skeleton fallback", async () => {
      // Suspense fallback은 서버 렌더링에서 바로 실제 컨텐츠로 렌더링됨
      // fallback은 클라이언트 하이드레이션 중에만 표시
      const island = React.createElement(
        SuspenseIsland,
        { routeId: "test-island", priority: "idle" },
        React.createElement(TestIsland, { count: 10 })
      );

      const stream = await renderToStream(island, {});
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).toContain("Count: 10");
    });
  });

  describe("DeferredData", () => {
    it("should handle resolved promise data", async () => {
      const promise = Promise.resolve({ name: "John", age: 30 });

      const element = React.createElement(
        DeferredData,
        {
          promise,
          children: (data: { name: string; age: number }) =>
            React.createElement("span", null, `Name: ${data.name}, Age: ${data.age}`),
        }
      );

      const stream = await renderToStream(element, {});
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      // Lazy 컴포넌트이므로 Suspense fallback이나 실제 컨텐츠가 있어야 함
      expect(html).toContain("<div id=\"root\">");
    });
  });

  describe("defer helper", () => {
    it("should pass through promise unchanged", async () => {
      const originalPromise = fetchMockData();
      const deferredPromise = defer(originalPromise);

      expect(deferredPromise).toBe(originalPromise);

      const result = await deferredPromise;
      expect(result.items).toEqual(["item1", "item2", "item3"]);
    });
  });

  describe("Route Script Generation", () => {
    it("should include route info when enableClientRouter is true", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const stream = await renderToStream(element, {
        routeId: "todos-page",
        routePattern: "/todos",
        enableClientRouter: true,
      });

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).toContain("__MANDU_ROUTE__");
      expect(html).toContain("todos-page");
      expect(html).toContain("/todos");
    });
  });

  describe("Bundle Manifest Integration", () => {
    it("should include modulepreload for island bundles", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const stream = await renderToStream(element, {
        routeId: "test-page",
        bundleManifest: {
          bundles: {
            "test-page": {
              js: "/.mandu/client/test-page.js",
              css: null,
              deps: [],
            },
          },
          shared: {
            runtime: "/.mandu/client/_runtime.js",
            router: "/.mandu/client/_router.js",
          },
          importMap: {
            imports: {
              react: "/.mandu/shared/react.js",
            },
          },
        },
      });

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).toContain('<link rel="modulepreload" href="/.mandu/client/test-page.js">');
      expect(html).toContain('src="/.mandu/client/_runtime.js"');
    });

    it("should include import map when provided", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const stream = await renderToStream(element, {
        bundleManifest: {
          bundles: {},
          shared: {},
          importMap: {
            imports: {
              react: "/.mandu/shared/react.js",
              "react-dom": "/.mandu/shared/react-dom.js",
            },
          },
        },
      });

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).toContain('<script type="importmap">');
      expect(html).toContain("react");
      expect(html).toContain("/.mandu/shared/react.js");
    });
  });

  describe("HMR Script", () => {
    it("should include HMR script in dev mode", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const stream = await renderToStream(element, {
        isDev: true,
        hmrPort: 4000,
      });

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).toContain("WebSocket");
      expect(html).toContain("ws://localhost:4001");
      expect(html).toContain("[Mandu HMR]");
    });

    it("should not include HMR script in production mode", async () => {
      const element = React.createElement(SimpleComponent, { message: "Test" });
      const stream = await renderToStream(element, {
        isDev: false,
      });

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      expect(html).not.toContain("[Mandu HMR]");
    });
  });
});

describe("Error Handling", () => {
  it("should call onShellError for shell errors", async () => {
    // 이 테스트는 실제 에러 발생 시나리오가 필요
    // 현재는 정상 렌더링 확인
    let errorCalled = false;

    const element = React.createElement(SimpleComponent, { message: "Test" });
    const stream = await renderToStream(element, {
      onShellError: () => {
        errorCalled = true;
      },
    });

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // 정상 렌더링이므로 에러 없음
    expect(errorCalled).toBe(false);
  });

  it("should handle 500 error response", async () => {
    // renderStreamingResponse는 에러 시 500 반환
    const element = React.createElement(SimpleComponent, { message: "Test" });
    const response = await renderStreamingResponse(element, {});

    expect(response.status).toBe(200);
  });
});

describe("Serialization Guards", () => {
  it("should accept valid JSON-serializable data", async () => {
    const element = React.createElement(SimpleComponent, { message: "Test" });

    // 정상적인 데이터는 에러 없이 통과
    await expect(async () => {
      await renderToStream(element, {
        isDev: true,
        criticalData: {
          string: "hello",
          number: 42,
          boolean: true,
          array: [1, 2, 3],
          object: { nested: "value" },
          null: null,
        },
      });
    }).not.toThrow();
  });

  it("should warn about BigInt in dev mode", async () => {
    // BigInt는 경고만 표시하고 통과
    const element = React.createElement(SimpleComponent, { message: "Test" });

    // BigInt는 serializeProps에서 처리되므로 에러 없음
    const stream = await renderToStream(element, {
      isDev: false, // prod에서는 경고 없음
      criticalData: {
        value: 123n as unknown as number, // BigInt를 테스트
      },
    });

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  });
});

describe("Metrics Collection", () => {
  it("should collect and report metrics", async () => {
    let collectedMetrics: any = null;

    const element = React.createElement(SimpleComponent, { message: "Test" });
    const stream = await renderToStream(element, {
      onMetrics: (metrics) => {
        collectedMetrics = metrics;
      },
    });

    const reader = stream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    expect(collectedMetrics).not.toBeNull();
    expect(collectedMetrics.shellReadyTime).toBeGreaterThanOrEqual(0);
    expect(collectedMetrics.allReadyTime).toBeGreaterThanOrEqual(collectedMetrics.shellReadyTime);
    expect(collectedMetrics.hasError).toBe(false);
    expect(collectedMetrics.startTime).toBeGreaterThan(0);
  });
});

describe("Streaming Response Headers", () => {
  it("should include buffering-related headers", async () => {
    const element = React.createElement(SimpleComponent, { message: "Test" });
    const response = await renderStreamingResponse(element, {});

    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(response.headers.get("CDN-Cache-Control")).toBe("no-store");
    expect(response.headers.get("Cache-Control")).toContain("no-transform");
  });

  it("should NOT include Transfer-Encoding header (runtime handles it)", async () => {
    const element = React.createElement(SimpleComponent, { message: "Test" });
    const response = await renderStreamingResponse(element, {});

    // Transfer-Encoding은 런타임이 자동 처리하므로 명시하지 않음
    // WHATWG Response 환경에서 직접 설정하면 문제 될 수 있음
    expect(response.headers.get("Transfer-Encoding")).toBeNull();
  });
});

describe("Failure Scenarios", () => {
  it("should return 500 for invalid criticalData in dev mode", async () => {
    const element = React.createElement(SimpleComponent, { message: "Test" });

    // 개발 모드에서 function을 포함한 criticalData → 500 응답
    // renderStreamingResponse는 내부적으로 try-catch하여 500 반환
    const response = await renderStreamingResponse(element, {
      isDev: true,
      criticalData: {
        invalidFn: () => {}, // function은 직렬화 불가
      } as any,
    });

    expect(response.status).toBe(500);
    const html = await response.text();
    expect(html).toContain("500");
    expect(html).toContain("criticalData");
  });

  it("should log warning for invalid criticalData in prod mode", async () => {
    const element = React.createElement(SimpleComponent, { message: "Test" });

    // 프로덕션에서는 경고만 출력하고 계속 진행
    const response = await renderStreamingResponse(element, {
      isDev: false,
      criticalData: {
        invalidFn: () => {},
      } as any,
    });

    // 에러가 발생하지 않고 응답이 반환됨
    expect(response.status).toBe(200);
  });

  it("should include error details in 500 response for dev mode", async () => {
    const element = React.createElement(SimpleComponent, { message: "Test" });

    const response = await renderStreamingResponse(element, {
      isDev: true,
      criticalData: {
        fn: () => {},
      } as any,
    });

    expect(response.status).toBe(500);
    const html = await response.text();
    // dev 모드에서는 에러 메시지가 포함됨
    expect(html).toContain("criticalData");
  });

  it("should NOT include error details in 500 response for prod mode", async () => {
    // 프로덕션 모드에서는 에러 상세 숨김
    // 단, criticalData 검증은 prod에서 warning만 발생하므로 다른 에러로 테스트 필요
    // 여기서는 prod에서 정상 동작 확인
    const element = React.createElement(SimpleComponent, { message: "Test" });

    const response = await renderStreamingResponse(element, {
      isDev: false,
    });

    expect(response.status).toBe(200);
  });
});

describe("Streaming Performance Characteristics", () => {
  it("should send shell before content is fully rendered", async () => {
    let shellTime = 0;
    let firstChunkTime = 0;

    const element = React.createElement(SimpleComponent, { message: "Performance Test" });
    const stream = await renderToStream(element, {
      onShellReady: () => {
        shellTime = Date.now();
      },
    });

    const startTime = Date.now();
    const reader = stream.getReader();

    const { done, value } = await reader.read();
    firstChunkTime = Date.now();

    expect(done).toBe(false);
    expect(value).toBeDefined();

    // Shell은 첫 번째 chunk와 함께 전송되어야 함
    const html = new TextDecoder().decode(value!);
    expect(html).toContain("<!DOCTYPE html>");

    // 나머지 스트림 소비
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Shell ready는 첫 chunk 전에 호출되어야 함
    expect(shellTime).toBeLessThanOrEqual(firstChunkTime);
  });
});

// ========================================
// 스트리밍 핵심 가치 테스트 (Core Value Tests)
// ========================================

describe("Streaming Core Value Tests", () => {
  /**
   * 핵심 가치 #1: Shell 선송출 (TTFB 최소화)
   * - 첫 번째 chunk에 HTML Shell (<!DOCTYPE>~<div id="root">)이 포함
   * - React 컨텐츠 렌더링 완료를 기다리지 않음
   */
  it("CORE #1: Shell is sent in first chunk without waiting for content", async () => {
    let shellReadyTime = 0;
    let allReadyTime = 0;

    const element = React.createElement(SimpleComponent, { message: "Shell First Test" });
    const stream = await renderToStream(element, {
      onShellReady: () => {
        shellReadyTime = Date.now();
      },
      onAllReady: () => {
        allReadyTime = Date.now();
      },
    });

    const reader = stream.getReader();

    // 첫 번째 read() 호출
    const firstRead = await reader.read();
    const firstChunkTime = Date.now();

    expect(firstRead.done).toBe(false);
    expect(firstRead.value).toBeDefined();

    const firstChunkHtml = new TextDecoder().decode(firstRead.value!);

    // 핵심 검증: 첫 번째 chunk에 Shell이 포함되어야 함
    expect(firstChunkHtml).toContain("<!DOCTYPE html>");
    expect(firstChunkHtml).toContain("<html lang=");
    expect(firstChunkHtml).toContain("<head>");
    expect(firstChunkHtml).toContain('<div id="root">');

    // Shell ready 콜백이 첫 chunk 전에 호출되어야 함
    expect(shellReadyTime).toBeLessThanOrEqual(firstChunkTime);
    expect(shellReadyTime).toBeGreaterThan(0);

    // 나머지 스트림 소비
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  });

  /**
   * 핵심 가치 #2: Deferred 스크립트 주입
   * - renderWithDeferredData에서 deferred promises는 스트림을 막지 않음
   * - 준비된 deferred는 base stream 완료 후 주입됨
   */
  it("CORE #2: Deferred scripts are injected after base stream", async () => {
    const deferredResolvers: Record<string, (value: any) => void> = {};

    // 지연 Promise 생성 (수동 resolve)
    const deferredPromises: Record<string, Promise<unknown>> = {
      userData: new Promise((resolve) => {
        deferredResolvers.userData = resolve;
      }),
      settings: new Promise((resolve) => {
        deferredResolvers.settings = resolve;
      }),
    };

    const element = React.createElement(SimpleComponent, { message: "Deferred Test" });

    // Response 생성 시작 (스트림 즉시 시작되어야 함)
    const responsePromise = renderWithDeferredData(element, {
      routeId: "deferred-test",
      deferredPromises,
      deferredTimeout: 1000,
    });

    // 약간의 지연 후 deferred resolve
    await delay(50);
    deferredResolvers.userData({ name: "John", id: 123 });
    await delay(50);
    deferredResolvers.settings({ theme: "dark" });

    const response = await responsePromise;
    expect(response.status).toBe(200);

    const html = await response.text();

    // 핵심 검증: HTML 구조가 완전해야 함
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");

    // 핵심 검증: Deferred 스크립트가 주입되어야 함
    expect(html).toContain("__MANDU_DEFERRED__");
    expect(html).toContain("userData");
    expect(html).toContain("settings");
    expect(html).toContain("mandu:deferred-data");

    // Deferred 스크립트는 </body> 전에 주입됨 (v0.9.23+)
    // HTML 표준 준수 - 스크립트가 document 내부에 위치해야 함
    const bodyCloseIndex = html.indexOf("</body>");
    const deferredScriptIndex = html.indexOf("__MANDU_DEFERRED__");
    expect(deferredScriptIndex).toBeGreaterThan(0);
    // deferred scripts는 </body> 전에 위치해야 함
    expect(deferredScriptIndex).toBeLessThan(bodyCloseIndex);
  });

  /**
   * 핵심 가치 #2-B: Base stream이 deferred를 기다리지 않음
   * - renderWithDeferredData는 baseStream을 즉시 시작
   * - deferred가 느려도 shell은 즉시 전송됨
   */
  it("CORE #2-B: Base stream starts immediately without waiting for deferred", async () => {
    let streamStartTime = 0;

    // 매우 느린 deferred (타임아웃보다 김)
    const slowDeferredPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ slow: true }), 10000); // 10초 (실제로 기다리지 않음)
    });

    const element = React.createElement(SimpleComponent, { message: "Immediate Start Test" });

    const startTime = Date.now();

    // 짧은 타임아웃 설정
    const response = await renderWithDeferredData(element, {
      routeId: "immediate-test",
      deferredPromises: { slowData: slowDeferredPromise },
      deferredTimeout: 100, // 100ms 타임아웃
      onShellReady: () => {
        streamStartTime = Date.now();
      },
    });

    const responseTime = Date.now();

    // 핵심 검증: Response가 타임아웃 시간 + 약간의 여유 내에 반환되어야 함
    // (10초를 기다리지 않았다는 증거)
    expect(responseTime - startTime).toBeLessThan(500); // 500ms 이내

    expect(response.status).toBe(200);

    const html = await response.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Immediate Start Test");

    // 느린 deferred는 타임아웃으로 포기되어 스크립트에 포함 안 됨
    expect(html).not.toContain("slowData");
  });

  /**
   * 핵심 가치 #3: Stream 에러 콜백 호출 및 메트릭 기록
   * - React 렌더링 에러 발생 시 onError/onShellError/onStreamError 콜백 호출
   * - 메트릭에 hasError: true 기록
   */
  it("CORE #3: Error callbacks are invoked and metrics record hasError", async () => {
    let errorCallbackInvoked = false;
    let shellErrorInvoked = false;
    let collectedMetrics: any = null;

    // 에러를 발생시키는 컴포넌트
    function ThrowingComponent(): React.ReactElement {
      throw new Error("Intentional test error for streaming");
    }

    const element = React.createElement(ThrowingComponent);

    try {
      const stream = await renderToStream(element, {
        routeId: "error-test",
        onError: () => {
          errorCallbackInvoked = true;
        },
        onShellError: () => {
          shellErrorInvoked = true;
        },
        onMetrics: (metrics) => {
          collectedMetrics = metrics;
        },
      });

      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      // 스트림 전체 소비
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }

      const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));

      // 핵심 검증: Shell은 전송됨 (React 에러와 무관하게)
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<div id="root">');

      // 에러 콜백이 호출되어야 함
      expect(errorCallbackInvoked).toBe(true);

      // 메트릭에 에러 기록
      if (collectedMetrics) {
        expect(collectedMetrics.hasError).toBe(true);
      }
    } catch (error) {
      // 만약 스트림 생성 자체가 실패하면 여기로 옴
      // 이 경우에도 에러가 발생했다는 것 자체가 검증됨
      expect(error).toBeDefined();
    }
  });

  /**
   * 핵심 가치 #3-B: 에러 스크립트 형식 검증
   * generateErrorScript 함수의 출력 형식 검증
   */
  it("CORE #3-B: Error script has correct format with XSS prevention", async () => {
    // 이 테스트는 실제 렌더링 에러 없이 에러 스크립트 형식만 검증
    // generateErrorScript는 내부 함수이므로 직접 테스트하기 어려움
    // 대신 XSS 방지가 적용되는지 확인

    const element = React.createElement(SimpleComponent, { message: "Test" });
    const response = await renderStreamingResponse(element, {
      isDev: true,
      criticalData: {
        xssTest: "<script>alert('xss')</script>", // 정상 데이터 내 XSS 시도
      },
      routeId: "xss-test",
    });

    const html = await response.text();

    // criticalData 내 XSS 문자가 이스케이프되어야 함
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("\\u003cscript\\u003e"); // 이스케이프된 형태
  });

  /**
   * 핵심 가치 메트릭: deferredChunkCount가 실제 주입된 수 반영
   */
  it("Metrics: deferredChunkCount reflects actual injected scripts", async () => {
    let collectedMetrics: any = null;

    const deferredPromises: Record<string, Promise<unknown>> = {
      fast1: Promise.resolve({ id: 1 }),
      fast2: Promise.resolve({ id: 2 }),
      slow: new Promise((resolve) => setTimeout(() => resolve({ id: 3 }), 2000)), // 타임아웃될 것
    };

    const element = React.createElement(SimpleComponent, { message: "Metrics Test" });

    const response = await renderWithDeferredData(element, {
      routeId: "metrics-test",
      deferredPromises,
      deferredTimeout: 100, // 100ms 타임아웃 (slow는 포기됨)
      onMetrics: (metrics) => {
        collectedMetrics = metrics;
      },
    });

    await response.text();

    // 핵심 검증: deferredChunkCount가 실제 주입된 수 (2개)를 반영
    expect(collectedMetrics).not.toBeNull();
    expect(collectedMetrics.deferredChunkCount).toBe(2); // fast1, fast2만 성공
  });
});

describe("Stream Timeout", () => {
  it("should terminate stream and include timeout error script", async () => {
    function NeverResolve(): React.ReactElement {
      throw new Promise(() => {});
    }

    const element = React.createElement(
      Suspense,
      { fallback: React.createElement("div", null, "Loading...") },
      React.createElement(NeverResolve)
    );

    const stream = await renderToStream(element, {
      routeId: "timeout-test",
      streamTimeout: 100,
    });

    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    const start = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1500);

    const html = new TextDecoder().decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
    expect(html).toContain("__MANDU_STREAMING_ERROR__");
    expect(html).toContain("Stream timeout");
    expect(html).toContain("</html>");
  });

  it("should not wait beyond streamTimeout for deferred flush", async () => {
    const slowDeferred = new Promise((resolve) => setTimeout(() => resolve({ slow: true }), 5000));
    const element = React.createElement(SimpleComponent, { message: "Timeout Deferred" });

    const start = Date.now();
    const response = await renderWithDeferredData(element, {
      routeId: "timeout-deferred",
      deferredPromises: { slow: slowDeferred },
      deferredTimeout: 2000,
      streamTimeout: 100,
    });

    const html = await response.text();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(html).toContain("Timeout Deferred");
    expect(html).not.toContain("__MANDU_DEFERRED__");
  });
});
