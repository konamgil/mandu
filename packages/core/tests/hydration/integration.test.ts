/**
 * Mandu Hydration Integration Tests
 * 실제 React와의 통합 테스트
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { setupHappyDom } from "../setup";

setupHappyDom();
import React from "react";

// Island 함수 시뮬레이션 (실제 island() 함수와 동일한 구조)
interface IslandDefinition<T, S> {
  setup: (serverData: T) => S;
  render: (state: S) => React.ReactNode;
}

function island<T = unknown, S = unknown>(
  definition: IslandDefinition<T, S>
): { __mandu_island: true; definition: IslandDefinition<T, S> } {
  if (typeof definition.setup !== "function") {
    throw new Error("[Mandu Island] setup must be a function");
  }
  if (typeof definition.render !== "function") {
    throw new Error("[Mandu Island] render must be a function");
  }
  return {
    definition,
    __mandu_island: true,
  };
}

function cleanup() {
  document.body.innerHTML = "";
  (window as any).__MANDU_DATA__ = {};
}

describe("Integration - Island Factory", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("island() 함수가 올바른 구조를 반환", () => {
    const testIsland = island({
      setup: (data: { count: number }) => ({ value: data.count * 2 }),
      render: (state) => React.createElement("div", null, `Value: ${state.value}`),
    });

    expect(testIsland.__mandu_island).toBe(true);
    expect(typeof testIsland.definition.setup).toBe("function");
    expect(typeof testIsland.definition.render).toBe("function");
  });

  test("setup 없이 island() 호출시 에러", () => {
    expect(() => {
      island({
        render: () => null,
      } as any);
    }).toThrow("[Mandu Island] setup must be a function");
  });

  test("render 없이 island() 호출시 에러", () => {
    expect(() => {
      island({
        setup: () => ({}),
      } as any);
    }).toThrow("[Mandu Island] render must be a function");
  });
});

describe("Integration - React Elements", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("React.createElement로 요소 생성", () => {
    const element = React.createElement("div", { className: "test" }, "Hello");

    expect(element.type).toBe("div");
    expect(element.props.className).toBe("test");
    expect(element.props.children).toBe("Hello");
  });

  test("Island render가 React 요소 반환", () => {
    const testIsland = island({
      setup: () => ({ message: "Hello World" }),
      render: (state) => React.createElement("span", null, state.message),
    });

    const state = testIsland.definition.setup({});
    const element = testIsland.definition.render(state);

    expect(React.isValidElement(element)).toBe(true);
    expect((element as any).props.children).toBe("Hello World");
  });

  test("중첩된 React 요소 생성", () => {
    const testIsland = island({
      setup: (data: { items: string[] }) => ({ items: data.items }),
      render: (state) =>
        React.createElement(
          "ul",
          null,
          state.items.map((item, i) => React.createElement("li", { key: i }, item))
        ),
    });

    const state = testIsland.definition.setup({ items: ["a", "b", "c"] });
    const element = testIsland.definition.render(state);

    expect((element as any).type).toBe("ul");
    expect((element as any).props.children.length).toBe(3);
  });
});

describe("Integration - State Management", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("setup에서 복잡한 상태 초기화", () => {
    interface ServerData {
      user: { id: number; name: string };
      posts: { id: number; title: string }[];
    }

    interface State {
      userName: string;
      postCount: number;
      isLoading: boolean;
    }

    const testIsland = island<ServerData, State>({
      setup: (data) => ({
        userName: data.user.name,
        postCount: data.posts.length,
        isLoading: false,
      }),
      render: (state) =>
        React.createElement(
          "div",
          null,
          `${state.userName} has ${state.postCount} posts`
        ),
    });

    const serverData: ServerData = {
      user: { id: 1, name: "John" },
      posts: [
        { id: 1, title: "First" },
        { id: 2, title: "Second" },
      ],
    };

    const state = testIsland.definition.setup(serverData);

    expect(state.userName).toBe("John");
    expect(state.postCount).toBe(2);
    expect(state.isLoading).toBe(false);
  });

  test("useState 훅 시뮬레이션 (setup 패턴)", () => {
    // Mandu Island는 setup에서 상태를 초기화하고 render에서 사용
    // 실제 React hooks는 Island 내부에서 사용됨 - 여기서는 객체 참조로 시뮬레이션
    const testIsland = island({
      setup: (data: { initialCount: number }) => {
        // 상태 객체 (참조로 업데이트 가능)
        const state = { count: data.initialCount };
        const increment = () => {
          state.count++;
        };
        return { state, increment };
      },
      render: (s) =>
        React.createElement("button", { onClick: s.increment }, `Count: ${s.state.count}`),
    });

    const result = testIsland.definition.setup({ initialCount: 5 });
    expect(result.state.count).toBe(5);

    result.increment();
    expect(result.state.count).toBe(6);
  });
});

describe("Integration - Server Data Flow", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("window.__MANDU_DATA__에서 데이터 로드", () => {
    // 서버에서 전달된 데이터 시뮬레이션
    (window as any).__MANDU_DATA__ = {
      "user-profile": {
        serverData: {
          id: 123,
          name: "Test User",
          email: "test@example.com",
        },
        timestamp: Date.now(),
      },
    };

    const testIsland = island({
      setup: (data: { id: number; name: string; email: string }) => ({
        displayName: data.name,
        contactEmail: data.email,
      }),
      render: (state) =>
        React.createElement("div", null, `${state.displayName} <${state.contactEmail}>`),
    });

    const serverData = (window as any).__MANDU_DATA__["user-profile"].serverData;
    const state = testIsland.definition.setup(serverData);

    expect(state.displayName).toBe("Test User");
    expect(state.contactEmail).toBe("test@example.com");
  });

  test("서버 데이터 직렬화/역직렬화 일관성", () => {
    const originalData = {
      date: new Date().toISOString(),
      numbers: [1, 2, 3],
      nested: { a: { b: { c: "deep" } } },
      nullValue: null,
      booleans: { t: true, f: false },
    };

    // JSON 직렬화/역직렬화 (서버 → 클라이언트 전송 시뮬레이션)
    const serialized = JSON.stringify(originalData);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.date).toBe(originalData.date);
    expect(deserialized.numbers).toEqual([1, 2, 3]);
    expect(deserialized.nested.a.b.c).toBe("deep");
    expect(deserialized.nullValue).toBeNull();
    expect(deserialized.booleans.t).toBe(true);
    expect(deserialized.booleans.f).toBe(false);
  });
});

describe("Integration - Error Boundaries", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("setup 에러 캐치", () => {
    const testIsland = island({
      setup: () => {
        throw new Error("Setup failed!");
      },
      render: () => null,
    });

    let error: Error | null = null;
    try {
      testIsland.definition.setup({});
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toBe("Setup failed!");
  });

  test("render 에러 캐치", () => {
    const testIsland = island({
      setup: () => ({ shouldFail: true }),
      render: (state) => {
        if (state.shouldFail) {
          throw new Error("Render failed!");
        }
        return null;
      },
    });

    const state = testIsland.definition.setup({});

    let error: Error | null = null;
    try {
      testIsland.definition.render(state);
    } catch (e) {
      error = e as Error;
    }

    expect(error).not.toBeNull();
    expect(error?.message).toBe("Render failed!");
  });

  test("graceful degradation 패턴", () => {
    const testIsland = island({
      setup: (data: { value?: number }) => ({
        value: data.value ?? 0, // 기본값으로 fallback
        hasData: data.value !== undefined,
      }),
      render: (state) =>
        React.createElement(
          "div",
          null,
          state.hasData ? `Value: ${state.value}` : "No data available"
        ),
    });

    // 데이터 없이 호출
    const stateNoData = testIsland.definition.setup({});
    expect(stateNoData.value).toBe(0);
    expect(stateNoData.hasData).toBe(false);

    // 데이터와 함께 호출
    const stateWithData = testIsland.definition.setup({ value: 42 });
    expect(stateWithData.value).toBe(42);
    expect(stateWithData.hasData).toBe(true);
  });
});

describe("Integration - Performance Marks", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("하이드레이션 성능 측정", () => {
    const marks: string[] = [];
    const measures: { name: string; duration: number }[] = [];

    performance.mark = ((name: string) => marks.push(name)) as any;
    performance.measure = ((name: string, start: string, end: string) => {
      measures.push({ name, duration: 0 });
    }) as any;

    // 하이드레이션 시작/완료 마킹
    performance.mark("mandu-hydrate-start-test");

    const testIsland = island({
      setup: () => ({ ready: true }),
      render: (state) => React.createElement("div", null, "Ready"),
    });

    testIsland.definition.setup({});
    performance.mark("mandu-hydrate-end-test");

    expect(marks).toContain("mandu-hydrate-start-test");
    expect(marks).toContain("mandu-hydrate-end-test");
  });
});
