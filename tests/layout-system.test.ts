/**
 * Layout System Tests
 *
 * FS Routes의 레이아웃 체인 기능 테스트
 */

import { describe, it, expect, beforeEach } from "bun:test";
import React from "react";
import { renderToString } from "react-dom/server";
import {
  ServerRegistry,
  createServerRegistry,
  type LayoutComponent,
} from "../packages/core/src/runtime/server";
import { fsRouteToRouteSpec } from "../packages/core/src/router/fs-routes";
import type { FSRouteConfig } from "../packages/core/src/router/fs-types";

// ═══════════════════════════════════════════════════════════════════════════
// Test Layout Components
// ═══════════════════════════════════════════════════════════════════════════

const RootLayout: LayoutComponent = ({ children }) => {
  return React.createElement(
    "html",
    null,
    React.createElement(
      "body",
      { "data-layout": "root" },
      React.createElement("header", null, "Root Header"),
      React.createElement("main", null, children),
      React.createElement("footer", null, "Root Footer")
    )
  );
};

const BlogLayout: LayoutComponent = ({ children }) => {
  return React.createElement(
    "div",
    { "data-layout": "blog" },
    React.createElement("nav", null, "Blog Nav"),
    children
  );
};

const ArticleLayout: LayoutComponent = ({ children, params }) => {
  return React.createElement(
    "article",
    { "data-layout": "article", "data-slug": params?.slug },
    children
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("Layout System", () => {
  let registry: ServerRegistry;

  beforeEach(() => {
    registry = createServerRegistry();
    registry.settings.rootDir = process.cwd();
  });

  describe("fsRouteToRouteSpec", () => {
    it("should convert layoutChain to RouteSpec", () => {
      const fsRoute: FSRouteConfig = {
        id: "blog-article",
        pattern: "/blog/:slug",
        kind: "page",
        module: "app/blog/[slug]/page.tsx",
        componentModule: "app/blog/[slug]/page.tsx",
        layoutChain: [
          "app/layout.tsx",
          "app/blog/layout.tsx",
          "app/blog/[slug]/layout.tsx",
        ],
        sourceFile: "/project/app/blog/[slug]/page.tsx",
      };

      const routeSpec = fsRouteToRouteSpec(fsRoute);

      expect(routeSpec.layoutChain).toBeDefined();
      expect(routeSpec.layoutChain).toHaveLength(3);
      expect(routeSpec.layoutChain).toEqual([
        "app/layout.tsx",
        "app/blog/layout.tsx",
        "app/blog/[slug]/layout.tsx",
      ]);
    });

    it("should omit empty layoutChain", () => {
      const fsRoute: FSRouteConfig = {
        id: "api-health",
        pattern: "/api/health",
        kind: "api",
        module: "app/api/health/route.ts",
        layoutChain: [],
        sourceFile: "/project/app/api/health/route.ts",
      };

      const routeSpec = fsRouteToRouteSpec(fsRoute);

      expect(routeSpec.layoutChain).toBeUndefined();
    });

    it("should include loadingModule and errorModule", () => {
      const fsRoute: FSRouteConfig = {
        id: "dashboard",
        pattern: "/dashboard",
        kind: "page",
        module: "app/dashboard/page.tsx",
        componentModule: "app/dashboard/page.tsx",
        layoutChain: ["app/layout.tsx"],
        loadingModule: "app/dashboard/loading.tsx",
        errorModule: "app/dashboard/error.tsx",
        sourceFile: "/project/app/dashboard/page.tsx",
      };

      const routeSpec = fsRouteToRouteSpec(fsRoute);

      expect(routeSpec.loadingModule).toBe("app/dashboard/loading.tsx");
      expect(routeSpec.errorModule).toBe("app/dashboard/error.tsx");
    });
  });

  describe("ServerRegistry Layout", () => {
    it("should register and retrieve layout components", async () => {
      // Register layout loader
      registry.registerLayoutLoader("app/layout.tsx", async () => ({
        default: RootLayout,
      }));

      // Get layout component
      const layout = await registry.getLayoutComponent("app/layout.tsx");

      expect(layout).toBe(RootLayout);
    });

    it("should cache layout components", async () => {
      let loadCount = 0;

      registry.registerLayoutLoader("app/blog/layout.tsx", async () => {
        loadCount++;
        return { default: BlogLayout };
      });

      // First load
      await registry.getLayoutComponent("app/blog/layout.tsx");
      expect(loadCount).toBe(1);

      // Second load (should use cache)
      await registry.getLayoutComponent("app/blog/layout.tsx");
      expect(loadCount).toBe(1);
    });

    it("should return null for non-existent layout", async () => {
      const layout = await registry.getLayoutComponent("non/existent/layout.tsx");
      expect(layout).toBeNull();
    });
  });

  describe("Layout Rendering", () => {
    it("should wrap content with single layout", () => {
      const content = React.createElement("p", null, "Page Content");
      const wrapped = React.createElement(RootLayout, {}, content);

      const html = renderToString(wrapped);

      expect(html).toContain("data-layout=\"root\"");
      expect(html).toContain("Root Header");
      expect(html).toContain("Page Content");
      expect(html).toContain("Root Footer");
    });

    it("should wrap content with nested layouts", () => {
      const content = React.createElement("p", null, "Article Content");

      // Nested: Root → Blog → Article (inside-out)
      const withArticle = React.createElement(
        ArticleLayout,
        { params: { slug: "hello-world" } },
        content
      );
      const withBlog = React.createElement(BlogLayout, {}, withArticle);
      const withRoot = React.createElement(RootLayout, {}, withBlog);

      const html = renderToString(withRoot);

      // Verify nesting order
      expect(html).toContain("data-layout=\"root\"");
      expect(html).toContain("data-layout=\"blog\"");
      expect(html).toContain("data-layout=\"article\"");
      expect(html).toContain("data-slug=\"hello-world\"");
      expect(html).toContain("Article Content");

      // Verify order: root > blog > article > content
      const rootIdx = html.indexOf("data-layout=\"root\"");
      const blogIdx = html.indexOf("data-layout=\"blog\"");
      const articleIdx = html.indexOf("data-layout=\"article\"");
      const contentIdx = html.indexOf("Article Content");

      expect(rootIdx).toBeLessThan(blogIdx);
      expect(blogIdx).toBeLessThan(articleIdx);
      expect(articleIdx).toBeLessThan(contentIdx);
    });
  });

  describe("Layout Chain Resolution", () => {
    it("should load layout chain in correct order", async () => {
      const loadOrder: string[] = [];

      registry.registerLayoutLoader("app/layout.tsx", async () => {
        loadOrder.push("root");
        return { default: RootLayout };
      });

      registry.registerLayoutLoader("app/blog/layout.tsx", async () => {
        loadOrder.push("blog");
        return { default: BlogLayout };
      });

      registry.registerLayoutLoader("app/blog/[slug]/layout.tsx", async () => {
        loadOrder.push("article");
        return { default: ArticleLayout };
      });

      const layoutChain = [
        "app/layout.tsx",
        "app/blog/layout.tsx",
        "app/blog/[slug]/layout.tsx",
      ];

      // Load all layouts (parallel)
      await Promise.all(
        layoutChain.map((path) => registry.getLayoutComponent(path))
      );

      // All layouts should be loaded
      expect(loadOrder).toHaveLength(3);
      expect(loadOrder).toContain("root");
      expect(loadOrder).toContain("blog");
      expect(loadOrder).toContain("article");
    });
  });
});
