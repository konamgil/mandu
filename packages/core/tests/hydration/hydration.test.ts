/**
 * Mandu Hydration Core Tests
 * 하이드레이션 핵심 기능 테스트
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { setupHappyDom } from "../setup";

setupHappyDom();

/** Window extended with Mandu hydration globals */
interface ManduWindow {
  __MANDU_DATA__: Record<string, { serverData: Record<string, unknown>; timestamp: number }>;
  __MANDU_ROOTS__?: Map<string, unknown>;
}
function getManduWindow(): ManduWindow {
  return window as unknown as ManduWindow;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper needs flexible typing
function createMockIsland(setupFn?: (data: any) => any, renderFn?: (state: any) => any) {
  return {
    __mandu_island: true,
    definition: {
      setup: setupFn || ((data: any) => ({ count: data.initialCount || 0 })),
      render: renderFn || ((state: any) => ({ type: "div", props: { children: `Count: ${state.count}` } })),
    },
  };
}

// Island HTML 요소 생성
function createIslandElement(id: string, src: string, priority = "visible"): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-mandu-island", id);
  el.setAttribute("data-mandu-src", src);
  el.setAttribute("data-mandu-priority", priority);
  el.innerHTML = "<span>Server Rendered</span>";
  document.body.appendChild(el);
  return el;
}

// 정리 함수
function cleanup() {
  document.body.innerHTML = "";
  getManduWindow().__MANDU_DATA__ = {};
  getManduWindow().__MANDU_ROOTS__?.clear();
}

describe("Hydration Core", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("Island 요소가 올바른 속성을 가져야 함", () => {
    const el = createIslandElement("test-island", "/test.js");

    expect(el.getAttribute("data-mandu-island")).toBe("test-island");
    expect(el.getAttribute("data-mandu-src")).toBe("/test.js");
    expect(el.getAttribute("data-mandu-priority")).toBe("visible");
  });

  test("서버 데이터가 window.__MANDU_DATA__에 저장되어야 함", () => {
    getManduWindow().__MANDU_DATA__ = {
      "test-island": {
        serverData: { initialCount: 10 },
        timestamp: Date.now(),
      },
    };

    const data = getManduWindow().__MANDU_DATA__["test-island"];
    expect(data.serverData.initialCount).toBe(10);
  });

  test("Island이 __mandu_island 플래그를 가져야 함", () => {
    const island = createMockIsland();
    expect(island.__mandu_island).toBe(true);
  });

  test("Island definition이 setup과 render를 가져야 함", () => {
    const island = createMockIsland();
    expect(typeof island.definition.setup).toBe("function");
    expect(typeof island.definition.render).toBe("function");
  });

  test("setup이 서버 데이터를 받아서 상태를 반환해야 함", () => {
    const island = createMockIsland();
    const state = island.definition.setup({ initialCount: 5 });
    expect(state.count).toBe(5);
  });

  test("render가 상태를 받아서 UI를 반환해야 함", () => {
    const island = createMockIsland();
    const state = { count: 42 };
    const ui = island.definition.render(state);
    expect(ui.props.children).toBe("Count: 42");
  });
});

describe("Hydration Priority", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("immediate 우선순위 요소 생성", () => {
    const el = createIslandElement("immediate-test", "/test.js", "immediate");
    expect(el.getAttribute("data-mandu-priority")).toBe("immediate");
  });

  test("visible 우선순위 요소 생성", () => {
    const el = createIslandElement("visible-test", "/test.js", "visible");
    expect(el.getAttribute("data-mandu-priority")).toBe("visible");
  });

  test("idle 우선순위 요소 생성", () => {
    const el = createIslandElement("idle-test", "/test.js", "idle");
    expect(el.getAttribute("data-mandu-priority")).toBe("idle");
  });

  test("interaction 우선순위 요소 생성", () => {
    const el = createIslandElement("interaction-test", "/test.js", "interaction");
    expect(el.getAttribute("data-mandu-priority")).toBe("interaction");
  });
});

describe("Server Data Handling", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("빈 서버 데이터 처리", () => {
    const island = createMockIsland((data) => ({ count: data.initialCount ?? 0 }));
    const state = island.definition.setup({});
    expect(state.count).toBe(0);
  });

  test("복잡한 서버 데이터 처리", () => {
    const complexData = {
      user: { id: 1, name: "Test" },
      items: [1, 2, 3],
      nested: { deep: { value: 42 } },
    };

    const island = createMockIsland((data) => ({
      userName: data.user?.name,
      itemCount: data.items?.length,
      deepValue: data.nested?.deep?.value,
    }));

    const state = island.definition.setup(complexData);
    expect(state.userName).toBe("Test");
    expect(state.itemCount).toBe(3);
    expect(state.deepValue).toBe(42);
  });

  test("undefined 서버 데이터 처리", () => {
    const island = createMockIsland((data) => ({
      value: data?.missing ?? "default",
    }));

    const state = island.definition.setup(undefined); // intentionally passing undefined to test fallback
    expect(state.value).toBe("default");
  });
});

describe("Multiple Islands", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("여러 Island 요소 생성", () => {
    createIslandElement("island-1", "/island1.js");
    createIslandElement("island-2", "/island2.js");
    createIslandElement("island-3", "/island3.js");

    const islands = document.querySelectorAll("[data-mandu-island]");
    expect(islands.length).toBe(3);
  });

  test("각 Island이 고유한 ID를 가져야 함", () => {
    createIslandElement("unique-1", "/test.js");
    createIslandElement("unique-2", "/test.js");

    const island1 = document.querySelector('[data-mandu-island="unique-1"]');
    const island2 = document.querySelector('[data-mandu-island="unique-2"]');

    expect(island1).not.toBeNull();
    expect(island2).not.toBeNull();
    expect(island1).not.toBe(island2);
  });

  test("각 Island이 독립적인 서버 데이터를 가져야 함", () => {
    getManduWindow().__MANDU_DATA__ = {
      "island-a": { serverData: { value: "A" }, timestamp: Date.now() },
      "island-b": { serverData: { value: "B" }, timestamp: Date.now() },
    };

    expect(getManduWindow().__MANDU_DATA__["island-a"].serverData.value).toBe("A");
    expect(getManduWindow().__MANDU_DATA__["island-b"].serverData.value).toBe("B");
  });
});
