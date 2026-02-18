/**
 * Mandu Hydration Test Setup
 * 브라우저 환경 시뮬레이션
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { beforeAll, afterAll } from "bun:test";

const happyDomStateKey = Symbol.for("mandu.happyDomState");
type HappyDomState = { count: number; registered: boolean };
const globalRecord = globalThis as unknown as Record<symbol, unknown>;
const happyDomState: HappyDomState =
  (globalRecord[happyDomStateKey] as HappyDomState) ?? { count: 0, registered: false };
globalRecord[happyDomStateKey] = happyDomState;

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
    const g = globalThis as unknown as Record<string, unknown>;
    if (g.window) {
      const w = g.window as Record<string, unknown>;
      w.__MANDU_DATA__ = {};
      w.__MANDU_ROOTS__ = new Map();
    }

    g.IntersectionObserver = MockIntersectionObserver;

    // requestIdleCallback Mock
    g.requestIdleCallback = (cb: () => void) => {
      return setTimeout(cb, 0);
    };

    // performance.mark Mock
    if (!globalThis.performance) {
      g.performance = {};
    }
    (g.performance as Record<string, unknown>).mark = (name: string) => {
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
