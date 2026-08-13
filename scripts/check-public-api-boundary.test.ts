import { describe, expect, test } from "bun:test";
import {
  checkPublicApiBoundary,
  classifyCoreExport,
  findRootStarExports,
  V1_CORE_EXPORTS,
} from "./check-public-api-boundary";

describe("check-public-api-boundary", () => {
  test("classifies the v1 surface and compatibility namespace", () => {
    expect(classifyCoreExport(".")).toBe("stable");
    expect(classifyCoreExport("./contract")).toBe("stable");
    expect(classifyCoreExport("./compat/*")).toBe("compatibility");
    expect(classifyCoreExport("./contract/rpc")).toBeNull();
    expect(classifyCoreExport("./a11y")).toBeNull();
    expect(classifyCoreExport("./unknown")).toBeNull();
  });

  test("current @mandujs/core export map has no unclassified subpaths", () => {
    const result = checkPublicApiBoundary();
    expect(result.issues).toEqual([]);
    expect(result.classified.stable).toEqual([...V1_CORE_EXPORTS].sort());
    expect(result.classified.compatibility).toEqual(["./compat/*"]);
    expect(result.classified.experimental).toEqual([]);
    expect(result.classified.internal).toEqual([]);
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
