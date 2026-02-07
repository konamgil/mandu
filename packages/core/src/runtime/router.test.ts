/**
 * Router v5 Tests
 *
 * Test cases:
 * 1. Static vs Dynamic Priority
 * 2. Parameter Matching
 * 3. Wildcard Matching
 * 4. Security (URI encoding)
 * 5. Validation Errors
 */

import { describe, test, expect } from "bun:test";
import {
  Router,
  RouterError,
  createRouter,
  WILDCARD_PARAM_KEY,
} from "./router";
import type { RouteSpec } from "../spec/schema";

// ═══════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════

function makeRoute(id: string, pattern: string, kind: "page" | "api" = "api"): RouteSpec {
  return {
    id,
    pattern,
    kind,
    module: `generated/${id}.route.ts`,
    ...(kind === "page" ? { componentModule: `generated/${id}.route.tsx` } : {}),
  } as RouteSpec;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Static vs Dynamic Priority
// ═══════════════════════════════════════════════════════════════════════════

describe("Static vs Dynamic Priority", () => {
  test("static route takes precedence over param route", () => {
    const router = createRouter([
      makeRoute("todos-item", "/api/todos/:id"),
      makeRoute("todos-stats", "/api/todos/stats"),
    ]);

    const result = router.match("/api/todos/stats");

    expect(result).not.toBeNull();
    expect(result!.route.id).toBe("todos-stats");
    expect(result!.params).toEqual({});
  });

  test("static route precedence regardless of registration order", () => {
    // Register static AFTER dynamic
    const router = createRouter([
      makeRoute("users-item", "/users/:id"),
      makeRoute("users-me", "/users/me"),
    ]);

    expect(router.match("/users/me")!.route.id).toBe("users-me");
    expect(router.match("/users/123")!.route.id).toBe("users-item");
  });

  test("root path matching", () => {
    const router = createRouter([
      makeRoute("home", "/", "page"),
      makeRoute("api", "/api"),
    ]);

    expect(router.match("/")!.route.id).toBe("home");
    expect(router.match("/api")!.route.id).toBe("api");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Parameter Matching
// ═══════════════════════════════════════════════════════════════════════════

describe("Parameter Matching", () => {
  test("extracts single param correctly", () => {
    const router = createRouter([
      makeRoute("todos-item", "/api/todos/:id"),
    ]);

    const result = router.match("/api/todos/123");

    expect(result).not.toBeNull();
    expect(result!.route.id).toBe("todos-item");
    expect(result!.params).toEqual({ id: "123" });
  });

  test("extracts multiple params correctly", () => {
    const router = createRouter([
      makeRoute("user-post", "/users/:userId/posts/:postId"),
    ]);

    const result = router.match("/users/42/posts/99");

    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ userId: "42", postId: "99" });
  });

  test("decodes UTF-8 encoded params", () => {
    const router = createRouter([
      makeRoute("user", "/user/:name"),
    ]);

    // café encoded as caf%C3%A9
    const result = router.match("/user/caf%C3%A9");

    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ name: "café" });
  });

  test("handles non-ASCII static routes", () => {
    const router = createRouter([
      makeRoute("cafe", "/café", "page"),
    ]);

    expect(router.match("/café")!.route.id).toBe("cafe");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Wildcard Matching
// ═══════════════════════════════════════════════════════════════════════════

describe("Wildcard Matching", () => {
  test("matches wildcard with remaining path", () => {
    const router = createRouter([
      makeRoute("files", "/files/*"),
    ]);

    const result = router.match("/files/a/b/c");

    expect(result).not.toBeNull();
    expect(result!.route.id).toBe("files");
    expect(result!.params).toEqual({ [WILDCARD_PARAM_KEY]: "a/b/c" });
  });

  test("matches named wildcard with remaining path", () => {
    const router = createRouter([
      makeRoute("docs", "/docs/:path*"),
    ]);

    const result = router.match("/docs/a/b/c");

    expect(result).not.toBeNull();
    expect(result!.route.id).toBe("docs");
    expect(result!.params).toEqual({ path: "a/b/c" });
  });

  test("optional wildcard matches base path without param", () => {
    const router = createRouter([
      makeRoute("docs", "/docs/:path*?"),
    ]);

    const result = router.match("/docs");

    expect(result).not.toBeNull();
    expect(result!.route.id).toBe("docs");
    expect(result!.params).toEqual({});
  });

  test("optional wildcard matches with remaining path", () => {
    const router = createRouter([
      makeRoute("docs", "/docs/:path*?"),
    ]);

    const result = router.match("/docs/intro");

    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ path: "intro" });
  });

  test("wildcard with single segment", () => {
    const router = createRouter([
      makeRoute("docs", "/docs/*"),
    ]);

    const result = router.match("/docs/readme");

    expect(result!.params).toEqual({ [WILDCARD_PARAM_KEY]: "readme" });
  });

  test("Policy A: wildcard does NOT match base path", () => {
    const router = createRouter([
      makeRoute("files", "/files/*"),
    ]);

    // /files/* should NOT match /files
    expect(router.match("/files")).toBeNull();
    expect(router.match("/files/")).toBeNull(); // normalized to /files
  });

  test("static route takes precedence over wildcard", () => {
    const router = createRouter([
      makeRoute("files-wildcard", "/files/*"),
      makeRoute("files-readme", "/files/readme"),
    ]);

    expect(router.match("/files/readme")!.route.id).toBe("files-readme");
    expect(router.match("/files/other")!.route.id).toBe("files-wildcard");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Security (URI Encoding)
// ═══════════════════════════════════════════════════════════════════════════

describe("Security", () => {
  test("blocks %2F (encoded slash) in path segments", () => {
    const router = createRouter([
      makeRoute("user", "/user/:name"),
    ]);

    // a%2Fb = a/b encoded
    const result = router.match("/user/a%2Fb");

    expect(result).toBeNull();
  });

  test("blocks double-encoded slash (%252F)", () => {
    const router = createRouter([
      makeRoute("user", "/user/:name"),
    ]);

    // %252F decodes to %2F
    const result = router.match("/user/%252F");

    expect(result).toBeNull();
  });

  test("blocks malformed UTF-8 encoding", () => {
    const router = createRouter([
      makeRoute("user", "/user/:name"),
    ]);

    // Invalid UTF-8 sequence
    const result = router.match("/user/%C0%AE");

    expect(result).toBeNull();
  });

  test("allows valid percent-encoded characters", () => {
    const router = createRouter([
      makeRoute("search", "/search/:query"),
    ]);

    // hello%20world = "hello world"
    const result = router.match("/search/hello%20world");

    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ query: "hello world" });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Validation Errors
// ═══════════════════════════════════════════════════════════════════════════

describe("Validation Errors", () => {
  test("throws DUPLICATE_PATTERN for same pattern", () => {
    expect(() => {
      createRouter([
        makeRoute("route1", "/api/users"),
        makeRoute("route2", "/api/users"),
      ]);
    }).toThrow(RouterError);

    try {
      createRouter([
        makeRoute("route1", "/api/users"),
        makeRoute("route2", "/api/users"),
      ]);
    } catch (e) {
      expect(e).toBeInstanceOf(RouterError);
      expect((e as RouterError).code).toBe("DUPLICATE_PATTERN");
      expect((e as RouterError).routeId).toBe("route2");
      expect((e as RouterError).conflictsWith).toBe("route1");
    }
  });

  test("throws DUPLICATE_PATTERN for normalized duplicates (trailing slash)", () => {
    expect(() => {
      createRouter([
        makeRoute("route1", "/api/users"),
        makeRoute("route2", "/api/users/"),
      ]);
    }).toThrow(RouterError);

    try {
      createRouter([
        makeRoute("route1", "/api/users"),
        makeRoute("route2", "/api/users/"),
      ]);
    } catch (e) {
      expect((e as RouterError).code).toBe("DUPLICATE_PATTERN");
    }
  });

  test("throws PARAM_NAME_CONFLICT for same-depth param mismatch", () => {
    expect(() => {
      createRouter([
        makeRoute("users", "/users/:id"),
        makeRoute("users-by-name", "/users/:name"),
      ]);
    }).toThrow(RouterError);

    try {
      createRouter([
        makeRoute("users", "/users/:id"),
        makeRoute("users-by-name", "/users/:name"),
      ]);
    } catch (e) {
      expect((e as RouterError).code).toBe("PARAM_NAME_CONFLICT");
    }
  });

  test("allows same param name across different paths", () => {
    // These should NOT conflict - different parent paths
    const router = createRouter([
      makeRoute("users", "/users/:id"),
      makeRoute("posts", "/posts/:id"),
    ]);

    expect(router.match("/users/1")!.params).toEqual({ id: "1" });
    expect(router.match("/posts/2")!.params).toEqual({ id: "2" });
  });

  test("throws WILDCARD_NOT_LAST for non-terminal wildcard", () => {
    expect(() => {
      createRouter([
        makeRoute("invalid", "/files/*/more"),
      ]);
    }).toThrow(RouterError);

    try {
      createRouter([
        makeRoute("invalid", "/files/*/more"),
      ]);
    } catch (e) {
      expect((e as RouterError).code).toBe("WILDCARD_NOT_LAST");
    }
  });

  test("throws ROUTE_CONFLICT for wildcard conflicts", () => {
    expect(() => {
      createRouter([
        makeRoute("files-legacy", "/files/*"),
        makeRoute("files-named", "/files/:path*"),
      ]);
    }).toThrow(RouterError);

    try {
      createRouter([
        makeRoute("files-legacy", "/files/*"),
        makeRoute("files-named", "/files/:path*"),
      ]);
    } catch (e) {
      expect((e as RouterError).code).toBe("ROUTE_CONFLICT");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Router API
// ═══════════════════════════════════════════════════════════════════════════

describe("Router API", () => {
  test("getStats returns correct counts", () => {
    const router = createRouter([
      makeRoute("home", "/"),
      makeRoute("health", "/api/health"),
      makeRoute("todos-item", "/api/todos/:id"),
      makeRoute("files", "/files/*"),
    ]);

    const stats = router.getStats();

    expect(stats.staticCount).toBe(2); // / and /api/health
    expect(stats.dynamicCount).toBe(2); // /api/todos/:id and /files/*
    expect(stats.totalRoutes).toBe(4);
  });

  test("getRoutes returns all registered routes", () => {
    const routes = [
      makeRoute("home", "/"),
      makeRoute("users", "/users/:id"),
    ];
    const router = createRouter(routes);

    const retrieved = router.getRoutes();

    expect(retrieved.length).toBe(2);
    expect(retrieved.map((r) => r.id).sort()).toEqual(["home", "users"]);
  });

  test("addRoute adds route to existing router", () => {
    const router = createRouter([
      makeRoute("home", "/"),
    ]);

    router.addRoute(makeRoute("about", "/about"));

    expect(router.match("/about")).not.toBeNull();
    expect(router.getStats().totalRoutes).toBe(2);
  });

  test("addRoute validates against existing routes", () => {
    const router = createRouter([
      makeRoute("home", "/"),
    ]);

    expect(() => {
      router.addRoute(makeRoute("home2", "/"));
    }).toThrow(RouterError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe("Edge Cases", () => {
  test("empty routes", () => {
    const router = createRouter([]);

    expect(router.match("/")).toBeNull();
    expect(router.getStats().totalRoutes).toBe(0);
  });

  test("deep nested paths", () => {
    const router = createRouter([
      makeRoute("deep", "/a/b/c/d/e/:id"),
    ]);

    const result = router.match("/a/b/c/d/e/123");

    expect(result!.params).toEqual({ id: "123" });
  });

  test("consecutive params", () => {
    const router = createRouter([
      makeRoute("date", "/calendar/:year/:month/:day"),
    ]);

    const result = router.match("/calendar/2025/01/30");

    expect(result!.params).toEqual({
      year: "2025",
      month: "01",
      day: "30",
    });
  });

  test("param followed by static", () => {
    const router = createRouter([
      makeRoute("user-posts", "/users/:id/posts"),
    ]);

    const result = router.match("/users/42/posts");

    expect(result!.route.id).toBe("user-posts");
    expect(result!.params).toEqual({ id: "42" });
  });

  test("trailing slash normalization", () => {
    const router = createRouter([
      makeRoute("api", "/api"),
    ]);

    expect(router.match("/api")).not.toBeNull();
    expect(router.match("/api/")).not.toBeNull(); // normalized to /api
  });
});
