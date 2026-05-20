import { describe, expect, test } from "bun:test";
import type { RouteSpec } from "../spec/schema";
import { generatePageComponent } from "./templates";

describe("generatePageComponent", () => {
  test("refuses to emit a placeholder for hydrating routes without a clientModule", () => {
    const route: RouteSpec = {
      id: "login",
      kind: "page",
      pattern: "/login",
      module: "app/login/page.tsx",
      componentModule: "app/login/page.tsx",
      hydration: {
        strategy: "full",
        priority: "immediate",
        preload: false,
      },
    };

    expect(() => generatePageComponent(route)).toThrow("no clientModule");
  });

  test("still emits placeholders for static routes without hydration", () => {
    const route: RouteSpec = {
      id: "about",
      kind: "page",
      pattern: "/about",
      module: "app/about/page.tsx",
      componentModule: "app/about/page.tsx",
    };

    expect(generatePageComponent(route)).toContain("About Page");
  });
});
