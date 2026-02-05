/**
 * Mandu Hydration Test Setup
 * 브라우저 환경 시뮬레이션
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { beforeAll, afterAll } from "bun:test";

const happyDomStateKey = Symbol.for("mandu.happyDomState");
type HappyDomState = { count: number; registered: boolean };
const happyDomState: HappyDomState =
  (globalThis as any)[happyDomStateKey] ?? { count: 0, registered: false };
(globalThis as any)[happyDomStateKey] = happyDomState;

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

export function setupHappyDom(): void {
  beforeAll(() => {
    if (happyDomState.count === 0) {
      GlobalRegistrator.register();
      happyDomState.registered = true;
    }
    happyDomState.count += 1;

    // window.__MANDU_DATA__ 초기화
    if ((globalThis as any).window) {
      (globalThis as any).window.__MANDU_DATA__ = {};
      (globalThis as any).window.__MANDU_ROOTS__ = new Map();
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
  });

  afterAll(async () => {
    happyDomState.count = Math.max(0, happyDomState.count - 1);
    if (happyDomState.count === 0 && happyDomState.registered) {
      happyDomState.registered = false;
      try {
        await GlobalRegistrator.unregister();
      } catch {
        // Ignore unregister errors to avoid failing unrelated tests.
      }
    }
  });
}

export { MockIntersectionObserver };
