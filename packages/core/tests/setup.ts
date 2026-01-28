/**
 * Mandu Hydration Test Setup
 * 브라우저 환경 시뮬레이션
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Happy-DOM 등록 (브라우저 API 시뮬레이션)
GlobalRegistrator.register();

// window.__MANDU_DATA__ 초기화
(globalThis as any).window.__MANDU_DATA__ = {};
(globalThis as any).window.__MANDU_ROOTS__ = new Map();

// IntersectionObserver Mock
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  elements: Set<Element> = new Set();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    this.elements.add(element);
    // 즉시 visible로 처리 (테스트용)
    setTimeout(() => {
      this.callback(
        [{ isIntersecting: true, target: element } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver
      );
    }, 0);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
  }
}

(globalThis as any).IntersectionObserver = MockIntersectionObserver;

// requestIdleCallback Mock
(globalThis as any).requestIdleCallback = (cb: () => void) => {
  return setTimeout(cb, 0);
};

// performance.mark Mock
if (!globalThis.performance) {
  (globalThis as any).performance = {};
}
(globalThis as any).performance.mark = (name: string) => {
  console.log(`[Performance] Mark: ${name}`);
};

export { MockIntersectionObserver };
