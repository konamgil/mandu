import { describe, expect, test } from "bun:test";
import { resolveNpmDistTag } from "./publish";

describe("resolveNpmDistTag", () => {
  test("uses latest for stable versions", () => {
    expect(resolveNpmDistTag("1.2.3")).toBe("latest");
  });

  test("derives the channel from prerelease versions", () => {
    expect(resolveNpmDistTag("1.2.3-beta.0")).toBe("beta");
    expect(resolveNpmDistTag("1.2.3-rc.2")).toBe("rc");
  });

  test("allows an explicit channel override", () => {
    expect(resolveNpmDistTag("1.2.3-beta.0", "next")).toBe("next");
  });

  test("rejects unsafe dist-tags", () => {
    expect(() => resolveNpmDistTag("1.2.3", "beta latest")).toThrow("Invalid npm dist-tag");
  });
});
