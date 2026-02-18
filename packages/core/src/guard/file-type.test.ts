import { describe, it, expect } from "bun:test";
import { validateFileAnalysis } from "./validator";
import { fsdPreset } from "./presets/fsd";
import type { FileAnalysis, GuardConfig } from "./types";

describe("TypeScript-only rule", () => {
  const layers = fsdPreset.layers;
  const config: GuardConfig = {
    preset: "fsd",
    severity: { fileType: "error" },
  };

  it("should flag .jsx files", () => {
    const analysis: FileAnalysis = {
      filePath: "src/pages/home.jsx",
      layer: "pages",
      imports: [],
      analyzedAt: Date.now(),
    };

    const violations = validateFileAnalysis(analysis, layers, config);
    expect(violations.some((v) => v.type === "file-type")).toBe(true);
  });
});
