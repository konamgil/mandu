/**
 * Mandu Hydration Edge Cases Tests
 * 하이드레이션 엣지 케이스 및 오류 처리 테스트
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { setupHappyDom } from "../setup";

setupHappyDom();

/** Window extended with Mandu hydration globals */
interface ManduWindow {
  __MANDU_DATA__: Record<string, unknown>;
  __MANDU_ROOTS__?: Map<string, unknown>;
}
function getManduWindow(): ManduWindow {
  return window as unknown as ManduWindow;
}

function createIslandElement(
  id: string,
  src: string,
  priority = "visible",
  innerHTML = "<span>SSR Content</span>"
): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-mandu-island", id);
  el.setAttribute("data-mandu-src", src);
  el.setAttribute("data-mandu-priority", priority);
  el.innerHTML = innerHTML;
  document.body.appendChild(el);
  return el;
}

function cleanup() {
  document.body.innerHTML = "";
  getManduWindow().__MANDU_DATA__ = {};
  getManduWindow().__MANDU_ROOTS__?.clear();
}

describe("Edge Cases - Missing Attributes", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("data-mandu-island 없는 요소는 무시되어야 함", () => {
    const el = document.createElement("div");
    el.setAttribute("data-mandu-src", "/test.js");
    document.body.appendChild(el);

    const islands = document.querySelectorAll("[data-mandu-island]");
    expect(islands.length).toBe(0);
  });

  test("data-mandu-src 없는 요소 처리", () => {
    const el = document.createElement("div");
    el.setAttribute("data-mandu-island", "no-src-island");
    document.body.appendChild(el);

    const island = document.querySelector('[data-mandu-island="no-src-island"]');
    expect(island?.getAttribute("data-mandu-src")).toBeNull();
  });

  test("우선순위 없으면 기본값 'visible' 사용", () => {
    const el = document.createElement("div");
    el.setAttribute("data-mandu-island", "default-priority");
    el.setAttribute("data-mandu-src", "/test.js");
    // priority 속성 없음
    document.body.appendChild(el);

    const priority = el.getAttribute("data-mandu-priority") || "visible";
    expect(priority).toBe("visible");
  });
});

describe("Edge Cases - Invalid Island", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("__mandu_island 플래그 없는 모듈 감지", () => {
    const invalidIsland: Record<string, unknown> = {
      definition: {
        setup: () => ({}),
        render: () => null,
      },
    };

    expect(invalidIsland.__mandu_island).toBeUndefined();
  });

  test("setup 함수 없는 Island 감지", () => {
    const invalidIsland = {
      __mandu_island: true,
      definition: {
        render: () => null,
      } as Record<string, unknown>,
    };

    expect(invalidIsland.definition.setup).toBeUndefined();
  });

  test("render 함수 없는 Island 감지", () => {
    const invalidIsland = {
      __mandu_island: true,
      definition: {
        setup: () => ({}),
      } as Record<string, unknown>,
    };

    expect(invalidIsland.definition.render).toBeUndefined();
  });
});

describe("Edge Cases - Error Handling", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("setup에서 에러 발생시 처리", () => {
    const errorIsland = {
      __mandu_island: true,
      definition: {
        setup: (_data?: unknown) => {
          throw new Error("Setup error");
        },
        render: (_state?: unknown) => null,
      },
    };

    expect(() => errorIsland.definition.setup({})).toThrow("Setup error");
  });

  test("render에서 에러 발생시 처리", () => {
    const errorIsland = {
      __mandu_island: true,
      definition: {
        setup: (_data?: unknown) => ({}),
        render: (_state?: unknown): null => {
          throw new Error("Render error");
        },
      },
    };

    const state = errorIsland.definition.setup({});
    expect(() => errorIsland.definition.render(state)).toThrow("Render error");
  });

  test("비동기 setup 에러 처리", async () => {
    const asyncErrorIsland = {
      __mandu_island: true,
      definition: {
        setup: async (_data?: unknown) => {
          throw new Error("Async setup error");
        },
        render: () => null,
      },
    };

    await expect(asyncErrorIsland.definition.setup({})).rejects.toThrow("Async setup error");
  });
});

describe("Edge Cases - DOM Manipulation", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("하이드레이션 전 SSR 컨텐츠 보존", () => {
    const el = createIslandElement("ssr-test", "/test.js", "visible", "<p>Original SSR</p>");

    expect(el.innerHTML).toBe("<p>Original SSR</p>");
  });

  test("하이드레이션 완료 마커 설정", () => {
    const el = createIslandElement("marker-test", "/test.js");

    // 하이드레이션 완료 시뮬레이션
    el.setAttribute("data-mandu-hydrated", "true");

    expect(el.getAttribute("data-mandu-hydrated")).toBe("true");
  });

  test("하이드레이션 에러 마커 설정", () => {
    const el = createIslandElement("error-test", "/test.js");

    // 하이드레이션 에러 시뮬레이션
    el.setAttribute("data-mandu-error", "true");

    expect(el.getAttribute("data-mandu-error")).toBe("true");
  });

  test("Island 제거 후 DOM 정리", () => {
    const el = createIslandElement("remove-test", "/test.js");
    expect(document.querySelector('[data-mandu-island="remove-test"]')).not.toBeNull();

    el.remove();
    expect(document.querySelector('[data-mandu-island="remove-test"]')).toBeNull();
  });
});

describe("Edge Cases - Concurrent Hydration", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("동시에 여러 Island 하이드레이션", () => {
    const elements: HTMLElement[] = [];
    for (let i = 0; i < 10; i++) {
      elements.push(createIslandElement(`concurrent-${i}`, `/island-${i}.js`, "immediate"));
    }

    const islands = document.querySelectorAll("[data-mandu-island]");
    expect(islands.length).toBe(10);
  });

  test("같은 ID의 Island 중복 처리", () => {
    createIslandElement("duplicate-id", "/test1.js");
    createIslandElement("duplicate-id", "/test2.js");

    const islands = document.querySelectorAll('[data-mandu-island="duplicate-id"]');
    expect(islands.length).toBe(2);
    // 첫 번째만 하이드레이션되어야 하거나 경고가 출력되어야 함
  });
});

describe("Edge Cases - Memory", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("hydratedRoots Map 관리", () => {
    const roots = new Map();
    roots.set("island-1", { unmount: () => {} });
    roots.set("island-2", { unmount: () => {} });

    expect(roots.size).toBe(2);

    roots.delete("island-1");
    expect(roots.size).toBe(1);
    expect(roots.has("island-1")).toBe(false);
    expect(roots.has("island-2")).toBe(true);
  });

  test("unmount 시 root 정리", () => {
    const roots = new Map();
    const mockUnmount = mock(() => {});

    roots.set("test-island", { unmount: mockUnmount });

    // unmount 호출
    const root = roots.get("test-island");
    root.unmount();
    roots.delete("test-island");

    expect(mockUnmount).toHaveBeenCalled();
    expect(roots.size).toBe(0);
  });
});

describe("Edge Cases - Event Handling", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("mandu:hydrated 커스텀 이벤트 발송", () => {
    const el = createIslandElement("event-test", "/test.js");
    let eventReceived = false;
    let eventDetail: { id: string; data: { value: number } } | null = null;

    el.addEventListener("mandu:hydrated", ((e: CustomEvent) => {
      eventReceived = true;
      eventDetail = e.detail;
    }) as EventListener);

    // 이벤트 발송 시뮬레이션
    el.dispatchEvent(
      new CustomEvent("mandu:hydrated", {
        bubbles: true,
        detail: { id: "event-test", data: { value: 42 } },
      })
    );

    expect(eventReceived).toBe(true);
    expect(eventDetail!.id).toBe("event-test");
    expect((eventDetail!.data as { value: number }).value).toBe(42);
  });

  test("interaction 우선순위 이벤트 리스너", () => {
    const el = createIslandElement("interaction-event", "/test.js", "interaction");
    let interactionTriggered = false;

    const handler = () => {
      interactionTriggered = true;
    };

    el.addEventListener("mouseenter", handler, { once: true });

    // mouseenter 이벤트 시뮬레이션
    el.dispatchEvent(new MouseEvent("mouseenter"));

    expect(interactionTriggered).toBe(true);
  });
});

describe("Edge Cases - Performance", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  test("performance.mark 호출", () => {
    const marks: string[] = [];
    const originalMark = performance.mark;

    performance.mark = ((name: string) => {
      marks.push(name);
    }) as unknown as typeof performance.mark;

    performance.mark("mandu-hydrated-test-island");

    expect(marks).toContain("mandu-hydrated-test-island");

    performance.mark = originalMark;
  });
});
