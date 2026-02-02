---
title: Test Island Components
impact: HIGH
impactDescription: Ensures UI correctness
tags: testing, component, island, react
---

## Test Island Components

**Impact: HIGH (Ensures UI correctness)**

Island 컴포넌트의 렌더링과 인터랙션을 테스트하세요.

**기본 컴포넌트 테스트:**

```typescript
// app/counter/client.test.tsx
import { describe, it, expect } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { CounterIsland } from "./client";

describe("CounterIsland", () => {
  it("should render initial count", () => {
    render(<CounterIsland initial={5} />);

    expect(screen.getByText("Count: 5")).toBeDefined();
  });

  it("should increment on button click", async () => {
    render(<CounterIsland initial={0} />);

    const button = screen.getByRole("button", { name: /increment/i });
    fireEvent.click(button);

    expect(screen.getByText("Count: 1")).toBeDefined();
  });

  it("should decrement on button click", async () => {
    render(<CounterIsland initial={10} />);

    const button = screen.getByRole("button", { name: /decrement/i });
    fireEvent.click(button);

    expect(screen.getByText("Count: 9")).toBeDefined();
  });
});
```

## 비동기 동작 테스트

```typescript
// app/search/client.test.tsx
import { describe, it, expect, mock } from "bun:test";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SearchIsland } from "./client";

// fetch 모킹
global.fetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ results: [{ id: 1, name: "Test" }] }),
  })
);

describe("SearchIsland", () => {
  it("should fetch and display results", async () => {
    render(<SearchIsland />);

    const input = screen.getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "test" } });

    // 비동기 결과 대기
    await waitFor(() => {
      expect(screen.getByText("Test")).toBeDefined();
    });
  });

  it("should show loading state", async () => {
    render(<SearchIsland />);

    const input = screen.getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "test" } });

    // 로딩 상태 확인
    expect(screen.getByText("Loading...")).toBeDefined();
  });
});
```

## 컴파운드 Island 테스트

```typescript
// app/form/client.test.tsx
import { describe, it, expect } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { Form } from "./client";

describe("Form Island", () => {
  it("should submit form data", async () => {
    const onSubmit = mock(() => {});

    render(
      <Form.Provider onSubmit={onSubmit}>
        <Form.Frame>
          <Form.Input name="email" />
          <Form.Submit>Submit</Form.Submit>
        </Form.Frame>
      </Form.Provider>
    );

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test@example.com" } });

    const button = screen.getByRole("button", { name: /submit/i });
    fireEvent.click(button);

    expect(onSubmit).toHaveBeenCalledWith({
      email: "test@example.com",
    });
  });
});
```

## useIslandEvent 테스트

```typescript
import { describe, it, expect } from "bun:test";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { useIslandEvent } from "@mandujs/core/client";

describe("useIslandEvent", () => {
  it("should emit and receive events", () => {
    const received: number[] = [];

    // 리스너 설정
    const { result: listener } = renderHook(() =>
      useIslandEvent<{ count: number }>("test-event", (data) => {
        received.push(data.count);
      })
    );

    // 이벤트 발송
    const { result: emitter } = renderHook(() =>
      useIslandEvent<{ count: number }>("test-event")
    );

    act(() => {
      emitter.current.emit({ count: 42 });
    });

    expect(received).toContain(42);
  });
});
```

## 스냅샷 테스트

```typescript
import { describe, it, expect } from "bun:test";
import { render } from "@testing-library/react";
import { CardIsland } from "./client";

describe("CardIsland", () => {
  it("should match snapshot", () => {
    const { container } = render(
      <CardIsland title="Test" description="Description" />
    );

    expect(container.innerHTML).toMatchSnapshot();
  });
});
```

## 테스트 설정

```typescript
// test/setup.ts
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "bun:test";

// 각 테스트 후 정리
afterEach(() => {
  cleanup();
});
```

```json
// bunfig.toml
[test]
preload = ["./test/setup.ts"]
```

Reference: [Testing Library React](https://testing-library.com/docs/react-testing-library/intro)
