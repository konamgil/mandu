/**
 * Guard Suggestions Tests
 */

import { describe, it, expect } from "vitest";
import {
  getDocumentationLink,
  generateSmartSuggestions,
  toAgentFormat,
} from "../../src/guard/suggestions";
import type { Violation, ViolationType } from "../../src/guard/types";
import { fsdPreset } from "../../src/guard/presets/fsd";

describe("getDocumentationLink", () => {
  it("should return FSD docs for fsd preset", () => {
    const link = getDocumentationLink("fsd", "layers");
    expect(link).toContain("feature-sliced.design");
  });

  it("should return Clean Architecture docs for clean preset", () => {
    const link = getDocumentationLink("clean", "layers");
    expect(link).toContain("cleancoder.com");
  });

  it("should return default docs for unknown preset", () => {
    const link = getDocumentationLink(undefined);
    expect(link).toContain("mandujs");
  });
});

describe("generateSmartSuggestions", () => {
  const layers = fsdPreset.layers;

  it("should generate layer violation suggestions", () => {
    const suggestions = generateSmartSuggestions({
      type: "layer-violation",
      fromLayer: "features",
      toLayer: "widgets",
      importPath: "@/widgets/header",
      allowedLayers: ["entities", "shared"],
      layers,
      preset: "fsd",
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.includes("@/shared"))).toBe(true);
  });

  it("should generate circular dependency suggestions", () => {
    const suggestions = generateSmartSuggestions({
      type: "circular-dependency",
      fromLayer: "features",
      toLayer: "entities",
      importPath: "@/entities/user",
      allowedLayers: ["entities", "shared"],
      layers,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.includes("shared"))).toBe(true);
  });

  it("should generate cross-slice suggestions", () => {
    const suggestions = generateSmartSuggestions({
      type: "cross-slice",
      fromLayer: "features",
      toLayer: "features",
      importPath: "@/features/payment",
      allowedLayers: ["entities", "shared"],
      layers,
      slice: "auth",
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.includes("cross-slice") || s.includes("shared"))).toBe(true);
  });

  it("should generate deep nesting suggestions", () => {
    const suggestions = generateSmartSuggestions({
      type: "deep-nesting",
      fromLayer: "features",
      toLayer: "shared",
      importPath: "@/shared/ui/components/button/styles",
      allowedLayers: ["entities", "shared"],
      layers,
    });

    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.includes("index.ts") || s.includes("PUBLIC API"))).toBe(true);
  });
});

describe("toAgentFormat", () => {
  it("should convert violation to agent format", () => {
    const violation: Violation = {
      type: "layer-violation",
      filePath: "src/features/auth/login.tsx",
      line: 1,
      column: 1,
      importStatement: "import { Header } from '@/widgets/header'",
      importPath: "@/widgets/header",
      fromLayer: "features",
      toLayer: "widgets",
      ruleName: "Layer Dependency",
      ruleDescription: '"features" cannot import from "widgets"',
      severity: "error",
      allowedLayers: ["entities", "shared"],
      suggestions: ["Move to @/shared"],
    };

    const agentFormat = toAgentFormat(violation, "fsd");

    expect(agentFormat.id).toContain("guard-layer-violation");
    expect(agentFormat.severity).toBe("error");
    expect(agentFormat.location.file).toBe("src/features/auth/login.tsx");
    expect(agentFormat.location.line).toBe(1);
    expect(agentFormat.violation.fromLayer).toBe("features");
    expect(agentFormat.violation.toLayer).toBe("widgets");
    expect(agentFormat.fix.primary).toBe("Move to @/shared");
    expect(agentFormat.allowed).toContain("@/entities/*");
    expect(agentFormat.allowed).toContain("@/shared/*");
    expect(agentFormat.rule.documentation).toContain("feature-sliced.design");
  });

  it("should include code change for shared-allowed layers", () => {
    const violation: Violation = {
      type: "layer-violation",
      filePath: "src/features/auth/login.tsx",
      line: 1,
      column: 1,
      importStatement: "import { Header } from '@/widgets/header'",
      importPath: "@/widgets/header",
      fromLayer: "features",
      toLayer: "widgets",
      ruleName: "Layer Dependency",
      ruleDescription: '"features" cannot import from "widgets"',
      severity: "error",
      allowedLayers: ["entities", "shared"],
      suggestions: ["Move to @/shared"],
    };

    const agentFormat = toAgentFormat(violation);

    expect(agentFormat.fix.codeChange).toBeDefined();
    expect(agentFormat.fix.codeChange?.before).toContain("@/widgets/header");
    expect(agentFormat.fix.codeChange?.after).toContain("@/shared");
  });
});
