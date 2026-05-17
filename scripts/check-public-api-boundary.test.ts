import { describe, expect, test } from "bun:test";
import {
  checkPublicApiBoundary,
  classifyCoreExport,
} from "./check-public-api-boundary";

describe("check-public-api-boundary", () => {
  test("classifies representative stable, experimental, and internal exports", () => {
    expect(classifyCoreExport(".")).toBe("stable");
    expect(classifyCoreExport("./contract/rpc")).toBe("stable");
    expect(classifyCoreExport("./a11y")).toBe("experimental");
    expect(classifyCoreExport("./runtime/server")).toBe("internal");
    expect(classifyCoreExport("./unknown")).toBeNull();
  });

  test("current @mandujs/core export map has no unclassified subpaths", () => {
    const result = checkPublicApiBoundary();
    expect(result.issues).toEqual([]);
    expect(result.classified.stable.length).toBeGreaterThan(0);
    expect(result.classified.experimental.length).toBeGreaterThan(0);
    expect(result.classified.internal.length).toBeGreaterThan(0);
  });
});
