/**
 * Mandu Hydration Stress Tests
 * 하이드레이션 스트레스 및 성능 테스트
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupHappyDom } from "../setup";

setupHappyDom();

function createIslandElement(id: string, src: string, priority = "visible"): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-mandu-island", id);
  el.setAttribute("data-mandu-src", src);
  el.setAttribute("data-mandu-priority", priority);
  el.innerHTML = `<span>SSR: ${id}</span>`;
  document.body.appendChild(el);
  return el;
}

function cleanup() {
  document.body.innerHTML = "";
  (window as any).__MANDU_DATA__ = {};
  (window as any).__MANDU_ROOTS__?.clear();
}

describe("Stress Test - Large Number of Islands", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("50개 Island 생성", () => {
    const count = 50;
    const start = performance.now();

    for (let i = 0; i < count; i++) {
      createIslandElement(`island-${i}`, `/island-${i}.js`, "immediate");
    }

    const elapsed = performance.now() - start;
    const islands = document.querySelectorAll("[data-mandu-island]");

    expect(islands.length).toBe(count);
    expect(elapsed).toBeLessThan(100); // 100ms 이내
    console.log(`50개 Island 생성: ${elapsed.toFixed(2)}ms`);
  });

  test("100개 Island 생성", () => {
    const count = 100;
    const start = performance.now();

    for (let i = 0; i < count; i++) {
      createIslandElement(`island-${i}`, `/island-${i}.js`, "immediate");
    }

    const elapsed = performance.now() - start;
    const islands = document.querySelectorAll("[data-mandu-island]");

    expect(islands.length).toBe(count);
    expect(elapsed).toBeLessThan(200); // 200ms 이내
    console.log(`100개 Island 생성: ${elapsed.toFixed(2)}ms`);
  });
});

describe("Stress Test - Large Server Data", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("큰 배열 데이터 처리", () => {
    const largeArray = Array.from({ length: 10000 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      value: Math.random(),
    }));

    (window as any).__MANDU_DATA__ = {
      "large-array-island": {
        serverData: { items: largeArray },
        timestamp: Date.now(),
      },
    };

    const data = (window as any).__MANDU_DATA__["large-array-island"].serverData;
    expect(data.items.length).toBe(10000);
  });

  test("깊이 중첩된 객체 처리", () => {
    const createDeepObject = (depth: number): any => {
      if (depth === 0) return { value: "leaf" };
      return { nested: createDeepObject(depth - 1) };
    };

    const deepData = createDeepObject(50);

    (window as any).__MANDU_DATA__ = {
      "deep-island": {
        serverData: deepData,
        timestamp: Date.now(),
      },
    };

    // 50단계 깊이까지 접근
    let current = (window as any).__MANDU_DATA__["deep-island"].serverData;
    for (let i = 0; i < 50; i++) {
      current = current.nested;
    }
    expect(current.value).toBe("leaf");
  });

  test("큰 문자열 데이터 처리", () => {
    const largeString = "x".repeat(1_000_000); // 1MB 문자열

    (window as any).__MANDU_DATA__ = {
      "large-string-island": {
        serverData: { content: largeString },
        timestamp: Date.now(),
      },
    };

    const data = (window as any).__MANDU_DATA__["large-string-island"].serverData;
    expect(data.content.length).toBe(1_000_000);
  });
});

describe("Stress Test - Rapid Mount/Unmount", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("빠른 mount/unmount 반복", () => {
    const roots = new Map<string, { unmount: () => void }>();
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      const id = `rapid-${i}`;
      const el = createIslandElement(id, `/test.js`);

      // Mount 시뮬레이션
      roots.set(id, {
        unmount: () => {
          el.remove();
        },
      });

      // Unmount 시뮬레이션
      const root = roots.get(id);
      root?.unmount();
      roots.delete(id);
    }

    expect(roots.size).toBe(0);
    expect(document.querySelectorAll("[data-mandu-island]").length).toBe(0);
  });

  test("메모리 누수 없이 반복 생성/삭제", () => {
    const initialMemory = process.memoryUsage().heapUsed;

    for (let cycle = 0; cycle < 10; cycle++) {
      // 100개 생성
      for (let i = 0; i < 100; i++) {
        createIslandElement(`cycle-${cycle}-${i}`, `/test.js`);
      }
      // 전체 삭제
      document.body.innerHTML = "";
    }

    // GC 힌트
    if (global.gc) global.gc();

    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024;

    console.log(`메모리 증가: ${memoryIncrease.toFixed(2)}MB`);
    // 10MB 이상 증가하면 누수 의심
    expect(memoryIncrease).toBeLessThan(10);
  });
});

describe("Stress Test - Priority Mix", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("혼합된 우선순위 Island 처리", () => {
    const priorities = ["immediate", "visible", "idle", "interaction"];
    const count = 100;

    for (let i = 0; i < count; i++) {
      const priority = priorities[i % priorities.length];
      createIslandElement(`mixed-${i}`, `/island-${i}.js`, priority);
    }

    const immediateCount = document.querySelectorAll('[data-mandu-priority="immediate"]').length;
    const visibleCount = document.querySelectorAll('[data-mandu-priority="visible"]').length;
    const idleCount = document.querySelectorAll('[data-mandu-priority="idle"]').length;
    const interactionCount = document.querySelectorAll('[data-mandu-priority="interaction"]').length;

    expect(immediateCount).toBe(25);
    expect(visibleCount).toBe(25);
    expect(idleCount).toBe(25);
    expect(interactionCount).toBe(25);
  });
});

describe("Stress Test - Concurrent Events", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("동시 이벤트 처리", () => {
    const events: string[] = [];
    const count = 50;

    for (let i = 0; i < count; i++) {
      const el = createIslandElement(`event-${i}`, `/test.js`);
      el.addEventListener("mandu:hydrated", () => {
        events.push(`hydrated-${i}`);
      });
    }

    // 모든 이벤트 동시 발송
    document.querySelectorAll("[data-mandu-island]").forEach((el, i) => {
      el.dispatchEvent(
        new CustomEvent("mandu:hydrated", {
          bubbles: true,
          detail: { id: `event-${i}` },
        })
      );
    });

    expect(events.length).toBe(count);
  });
});

describe("Stress Test - Complex Island Definitions", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("복잡한 setup 로직 처리", () => {
    const complexSetup = (data: any) => {
      // 복잡한 계산 시뮬레이션
      const result: any = {};
      for (let i = 0; i < 1000; i++) {
        result[`key${i}`] = Math.sqrt(i) * (data.multiplier || 1);
      }
      return result;
    };

    const start = performance.now();
    const state = complexSetup({ multiplier: 2 });
    const elapsed = performance.now() - start;

    expect(Object.keys(state).length).toBe(1000);
    expect(elapsed).toBeLessThan(50); // 50ms 이내
    console.log(`복잡한 setup: ${elapsed.toFixed(2)}ms`);
  });

  test("중첩 컴포넌트 구조 처리", () => {
    interface VNode {
      type: string;
      props: { children?: VNode | VNode[] | string };
    }

    const createNestedVNode = (depth: number): VNode => {
      if (depth === 0) {
        return { type: "span", props: { children: "leaf" } };
      }
      return {
        type: "div",
        props: {
          children: Array.from({ length: 3 }, () => createNestedVNode(depth - 1)),
        },
      };
    };

    const start = performance.now();
    const vnode = createNestedVNode(5); // 3^5 = 243 노드
    const elapsed = performance.now() - start;

    expect(vnode.type).toBe("div");
    expect(elapsed).toBeLessThan(50);
    console.log(`중첩 VNode 생성: ${elapsed.toFixed(2)}ms`);
  });
});
