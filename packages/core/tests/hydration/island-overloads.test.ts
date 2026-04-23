/**
 * Mandu Island Overloads Tests
 * island() 함수의 두 가지 패턴 (선언적 + setup/render) 테스트
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  island,
  isIsland,
  getAllIslands,
  type IslandComponent,
  type CompiledClientIsland,
  type ClientIslandDefinition,
} from "../../src/island";

describe("island() - Declarative Pattern", () => {
  test("creates island with strategy string", () => {
    const Component = ({ name }: { name: string }) => null;
    const result = island("visible", Component);

    expect(result.__island).toBe(true);
    expect(result.__hydrate).toBe("visible");
    expect(isIsland(result)).toBe(true);
  });

  test("creates island with options object", () => {
    const Component = ({ count }: { count: number }) => null;
    const result = island(
      { hydrate: "idle", name: "test-island" },
      Component
    );

    expect(result.__island).toBe(true);
    expect(result.__hydrate).toBe("idle");
    expect(result.__name).toBe("test-island");
  });

  test("registers island in global registry", () => {
    const Component = ({ id }: { id: string }) => null;
    const result = island(
      { hydrate: "load", name: "registry-test" },
      Component
    );

    const registry = getAllIslands();
    expect(registry.get("registry-test")).toBe(result);
  });
});

describe("island() - Setup/Render Pattern (Client Island)", () => {
  test("creates compiled client island from definition", () => {
    const definition: ClientIslandDefinition<{ items: string[] }, { items: string[]; count: number }> = {
      setup: (serverData) => ({
        items: serverData.items,
        count: serverData.items.length,
      }),
      render: ({ items, count }) => null,
    };

    const result = island(definition);

    expect(result.__mandu_island).toBe(true);
    expect(result.definition).toBe(definition);
    expect(result.definition.setup).toBeFunction();
    expect(result.definition.render).toBeFunction();
  });

  test("setup function receives server data and returns setup result", () => {
    const result = island({
      setup: (data: { name: string }) => ({
        greeting: `Hello ${data.name}`,
      }),
      render: ({ greeting }) => null,
    });

    const setupResult = result.definition.setup({ name: "Mandu" });
    expect(setupResult.greeting).toBe("Hello Mandu");
  });

  test("supports optional errorBoundary and loading", () => {
    const result = island({
      setup: (data: { value: number }) => ({ doubled: data.value * 2 }),
      render: ({ doubled }) => null,
      errorBoundary: (error, reset) => null,
      loading: () => null,
    });

    expect(result.definition.errorBoundary).toBeFunction();
    expect(result.definition.loading).toBeFunction();
  });

  test("works with generic type parameter for server data", () => {
    interface TodoData {
      todos: { id: string; title: string; completed: boolean }[];
    }

    const result = island<TodoData, { todos: TodoData["todos"]; count: number }>({
      setup: (serverData) => {
        return {
          todos: serverData.todos,
          count: serverData.todos.length,
        };
      },
      render: (props) => null,
    });

    const setupResult = result.definition.setup({
      todos: [{ id: "1", title: "Test", completed: false }],
    });
    expect(setupResult.count).toBe(1);
    expect(setupResult.todos).toHaveLength(1);
  });
});

describe("island() - Pattern Detection", () => {
  test("detects setup/render pattern (no Component argument)", () => {
    const result = island({
      setup: (data: {}) => ({}),
      render: () => null,
    });

    // Should be CompiledClientIsland, not IslandComponent
    expect("__mandu_island" in result).toBe(true);
    expect("__island" in result).toBe(false);
  });

  test("detects declarative pattern (strategy + Component)", () => {
    const Component = (_props: Record<string, never>) => null;
    const result = island("visible", Component);

    // Should be IslandComponent, not CompiledClientIsland
    expect("__island" in result).toBe(true);
  });

  test("throws when declarative pattern missing Component", () => {
    expect(() => {
      // @ts-expect-error intentionally testing runtime error
      island("visible");
    }).toThrow("[Mandu Island] Component is required");
  });
});
