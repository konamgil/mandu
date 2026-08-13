import { describe, expect, test } from "bun:test";
import {
  isTemplateArtifactDirectory,
  normalizeEmbeddedText,
} from "../../../scripts/generate-template-manifest";

describe("template manifest generation", () => {
  test("excludes runtime and install artifacts from published templates", () => {
    for (const name of [".mandu", "coverage", "dist", "node_modules", "test-results"]) {
      expect(isTemplateArtifactDirectory(name)).toBe(true);
    }
  });

  test("keeps source directories, including dotfile configuration", () => {
    for (const name of ["app", "public", "src", ".claude"]) {
      expect(isTemplateArtifactDirectory(name)).toBe(false);
    }
  });

  test("normalizes embedded text across operating systems", () => {
    expect(normalizeEmbeddedText("one\r\ntwo\rthree\n")).toBe("one\ntwo\nthree\n");
  });
});
