import { describe, expect, test } from "bun:test";
import {
  checkPublicApiBoundary,
  classifyCoreExport,
  findRootStarExports,
} from "./check-public-api-boundary";

describe("check-public-api-boundary", () => {
  test("classifies representative stable, experimental, and internal exports", () => {
    expect(classifyCoreExport(".")).toBe("stable");
    expect(classifyCoreExport("./contract/rpc")).toBe("stable");
    expect(classifyCoreExport("./a11y")).toBe("experimental");
    expect(classifyCoreExport("./brain")).toBe("experimental");
    expect(classifyCoreExport("./experimental")).toBe("experimental");
    expect(classifyCoreExport("./change")).toBe("internal");
    expect(classifyCoreExport("./generator")).toBe("internal");
    expect(classifyCoreExport("./internal")).toBe("internal");
    expect(classifyCoreExport("./lockfile")).toBe("internal");
    expect(classifyCoreExport("./paths")).toBe("internal");
    expect(classifyCoreExport("./runtime/server")).toBe("internal");
    expect(classifyCoreExport("./watcher")).toBe("internal");
    expect(classifyCoreExport("./unknown")).toBeNull();
  });

  test("current @mandujs/core export map has no unclassified subpaths", () => {
    const result = checkPublicApiBoundary();
    expect(result.issues).toEqual([]);
    expect(result.classified.stable.length).toBeGreaterThan(0);
    expect(result.classified.experimental.length).toBeGreaterThan(0);
    expect(result.classified.internal.length).toBeGreaterThan(0);
  });

  test("root export star surface only includes stable modules", () => {
    const rootExports = findRootStarExports(`
      export * from "./runtime";
      export * from "./brain";
      export { runHook } from "./plugins";
    `);
    expect(rootExports).toEqual(["./runtime", "./brain"]);

    const result = checkPublicApiBoundary();
    expect(result.rootStarExports).toContain("./runtime");
    expect(result.rootStarExports).not.toContain("./brain");
    expect(result.rootStarExports).not.toContain("./bundler");
    expect(result.rootStarExports).not.toContain("./change");
    expect(result.rootStarExports).not.toContain("./generator");
    expect(result.rootStarExports).not.toContain("./lockfile");
    expect(result.rootStarExports).not.toContain("./watcher");
  });
});
