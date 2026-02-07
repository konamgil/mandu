import { describe, test, expect } from "bun:test";
import { resolveGeneratedPaths, GENERATED_RELATIVE_PATHS } from "./paths";
import path from "path";

describe("resolveGeneratedPaths", () => {
  test("should return .mandu/generated based paths", () => {
    const rootDir = "/project";
    const paths = resolveGeneratedPaths(rootDir);

    expect(paths.serverRoutesDir).toBe(
      path.join("/project", ".mandu/generated/server/routes")
    );
    expect(paths.webRoutesDir).toBe(
      path.join("/project", ".mandu/generated/web/routes")
    );
    expect(paths.typesDir).toBe(
      path.join("/project", ".mandu/generated/server/types")
    );
    expect(paths.mapDir).toBe(
      path.join("/project", ".mandu/generated")
    );
  });

  test("should handle Windows-style root paths", () => {
    const rootDir = "C:\\Users\\User\\project";
    const paths = resolveGeneratedPaths(rootDir);

    expect(paths.serverRoutesDir).toContain(".mandu");
    expect(paths.serverRoutesDir).toContain("server");
    expect(paths.serverRoutesDir).toContain("routes");
  });
});

describe("GENERATED_RELATIVE_PATHS", () => {
  test("should not contain apps/ prefix", () => {
    expect(GENERATED_RELATIVE_PATHS.serverRoutes).not.toContain("apps/");
    expect(GENERATED_RELATIVE_PATHS.webRoutes).not.toContain("apps/");
    expect(GENERATED_RELATIVE_PATHS.types).not.toContain("apps/");
  });

  test("should use .mandu/generated prefix", () => {
    expect(GENERATED_RELATIVE_PATHS.serverRoutes).toStartWith(".mandu/generated");
    expect(GENERATED_RELATIVE_PATHS.webRoutes).toStartWith(".mandu/generated");
    expect(GENERATED_RELATIVE_PATHS.types).toStartWith(".mandu/generated");
    expect(GENERATED_RELATIVE_PATHS.map).toStartWith(".mandu/generated");
  });
});
