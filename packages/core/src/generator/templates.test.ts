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

  test("imports the real page module for static routes instead of emitting a placeholder", () => {
    const route: RouteSpec = {
      id: "about",
      kind: "page",
      pattern: "/about",
      module: "app/about/page.tsx",
      componentModule: "app/about/page.tsx",
    };

    const generated = generatePageComponent(route);

    expect(generated).toContain("Page Module: app/about/page.tsx");
    expect(generated).toContain('import pageModule from "../../../../app/about/page.tsx"');
    expect(generated).toContain("React.createElement(pageModule");
    expect(generated).not.toContain("About Page");
    expect(generated).not.toContain('React.createElement("p", null, "Route ID: about")');
  });

  test("imports the real page module for compiler-owned boundary routes without a clientModule", () => {
    const route: RouteSpec = {
      id: "login",
      kind: "page",
      pattern: "/login",
      module: "app/login/page.tsx",
      componentModule: "app/login/page.tsx",
      hydration: {
        strategy: "island",
        priority: "visible",
        preload: false,
      },
      boundaries: [
        {
          id: "login--0",
          routeId: "login",
          module: "src/client/pages/login/LoginPage.client.tsx",
          importSpecifier: "@/client/pages/login/LoginPage.client",
          exportName: "default",
          localName: "LoginPage",
          hydrate: "visible",
          ordinal: 0,
          propsSource: "inline",
          propsKeys: [],
          hasSpreadProps: false,
          source: {
            file: "app/login/page.tsx",
            line: 6,
            column: 10,
          },
        },
      ],
    };

    const generated = generatePageComponent(route);

    expect(generated).toContain("Page Module: app/login/page.tsx");
    expect(generated).toContain('import pageModule from "../../../../app/login/page.tsx"');
    expect(generated).toContain("React.createElement(pageModule");
    expect(generated).not.toContain("Client Module:");
    expect(generated).not.toContain("Login Page");
  });

  test("renders route-level default-imported client components through the page module", () => {
    const route: RouteSpec = {
      id: "login",
      kind: "page",
      pattern: "/login",
      module: "app/login/page.tsx",
      componentModule: "app/login/page.tsx",
      clientModule: "src/client/pages/login/LoginPage.client.tsx",
      hydration: {
        strategy: "island",
        priority: "immediate",
        preload: false,
      },
    };

    const generated = generatePageComponent(route);

    expect(generated).toContain("Client Module: src/client/pages/login/LoginPage.client.tsx");
    expect(generated).toContain("Page Module: app/login/page.tsx");
    expect(generated).toContain('import islandModule from "../../../../src/client/pages/login/LoginPage.client.tsx"');
    expect(generated).toContain('import pageModule from "../../../../app/login/page.tsx"');
    expect(generated).toContain("islandModule.definition.render");
    expect(generated).toContain("React.createElement(pageModule");
    expect(generated).not.toContain("Login Page");
  });
});
