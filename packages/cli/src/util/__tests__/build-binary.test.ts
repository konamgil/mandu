import { describe, expect, test } from "bun:test";
import { toWindowsVersion } from "../../../scripts/build-binary";

describe("build-binary Windows metadata", () => {
  test("removes SemVer prerelease labels", () => {
    expect(toWindowsVersion("0.45.0-beta.0")).toBe("0.45.0.0");
  });

  test("preserves an explicit numeric fourth component", () => {
    expect(toWindowsVersion("1.2.3.4")).toBe("1.2.3.4");
  });

  test("falls back safely for malformed package versions", () => {
    expect(toWindowsVersion("development")).toBe("0.0.0.0");
  });
});
