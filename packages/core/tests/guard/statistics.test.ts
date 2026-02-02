/**
 * Statistics Tests
 */

import { describe, it, expect } from "vitest";
import {
  createScanRecord,
  calculateLayerStatistics,
  analyzeTrend,
  generateMarkdownReport,
} from "../../src/guard/statistics";
import type { ViolationReport, Violation, ScanRecord } from "../../src/guard/types";

describe("createScanRecord", () => {
  it("should create scan record from report", () => {
    const report: ViolationReport = {
      totalViolations: 3,
      bySeverity: { error: 2, warn: 1, info: 0 },
      byType: {
        "layer-violation": 2,
        "circular-dependency": 1,
        "cross-slice": 0,
        "deep-nesting": 0,
      },
      violations: [
        createMockViolation("features", "widgets", "src/features/auth/login.tsx"),
        createMockViolation("features", "widgets", "src/features/auth/signup.tsx"),
        createMockViolation("entities", "features", "src/entities/user/model.ts"),
      ],
      filesAnalyzed: 10,
      analysisTime: 100,
    };

    const record = createScanRecord(report, "fsd");

    expect(record.totalViolations).toBe(3);
    expect(record.preset).toBe("fsd");
    expect(record.filesAnalyzed).toBe(10);
    expect(record.byLayer.features).toBe(2);
    expect(record.byLayer.entities).toBe(1);
    expect(record.hotspots.length).toBeGreaterThan(0);
  });

  it("should identify hotspots correctly", () => {
    const report: ViolationReport = {
      totalViolations: 5,
      bySeverity: { error: 5, warn: 0, info: 0 },
      byType: {
        "layer-violation": 5,
        "circular-dependency": 0,
        "cross-slice": 0,
        "deep-nesting": 0,
      },
      violations: [
        createMockViolation("features", "widgets", "src/features/auth/login.tsx"),
        createMockViolation("features", "widgets", "src/features/auth/login.tsx"),
        createMockViolation("features", "widgets", "src/features/auth/login.tsx"),
        createMockViolation("features", "widgets", "src/features/user/profile.tsx"),
        createMockViolation("features", "widgets", "src/features/user/profile.tsx"),
      ],
      filesAnalyzed: 10,
      analysisTime: 100,
    };

    const record = createScanRecord(report);

    expect(record.hotspots[0].file).toBe("src/features/auth/login.tsx");
    expect(record.hotspots[0].count).toBe(3);
    expect(record.hotspots[1].file).toBe("src/features/user/profile.tsx");
    expect(record.hotspots[1].count).toBe(2);
  });
});

describe("calculateLayerStatistics", () => {
  const layers = ["app", "pages", "widgets", "features", "entities", "shared"];

  it("should calculate layer statistics", () => {
    const violations: Violation[] = [
      createMockViolation("features", "widgets", "file1.ts"),
      createMockViolation("features", "widgets", "file2.ts"),
      createMockViolation("entities", "features", "file3.ts"),
    ];

    const stats = calculateLayerStatistics(violations, layers);

    const featuresStat = stats.find((s) => s.name === "features");
    expect(featuresStat?.asSource).toBe(2);
    expect(featuresStat?.topTargets[0]?.layer).toBe("widgets");

    const entitiesStat = stats.find((s) => s.name === "entities");
    expect(entitiesStat?.asSource).toBe(1);
  });

  it("should calculate health scores", () => {
    const violations: Violation[] = [];
    const stats = calculateLayerStatistics(violations, layers);

    // No violations = 100% health
    for (const stat of stats) {
      expect(stat.healthScore).toBe(100);
    }
  });

  it("should lower health score with more violations", () => {
    const violations: Violation[] = Array(10)
      .fill(null)
      .map(() => createMockViolation("features", "widgets", "file.ts"));

    const stats = calculateLayerStatistics(violations, layers);
    const featuresStat = stats.find((s) => s.name === "features");

    expect(featuresStat?.healthScore).toBeLessThan(100);
    expect(featuresStat?.healthScore).toBeGreaterThan(0);
  });
});

describe("analyzeTrend", () => {
  it("should return null for insufficient records", () => {
    const records: ScanRecord[] = [createMockScanRecord(5)];
    const trend = analyzeTrend(records);
    expect(trend).toBeNull();
  });

  it("should detect improving trend", () => {
    const now = Date.now();
    const records: ScanRecord[] = [
      createMockScanRecord(10, now - 6 * 24 * 60 * 60 * 1000),
      createMockScanRecord(5, now - 3 * 24 * 60 * 60 * 1000),
      createMockScanRecord(2, now),
    ];

    const trend = analyzeTrend(records, 7);

    expect(trend).not.toBeNull();
    expect(trend?.trend).toBe("improving");
    expect(trend?.violationDelta).toBe(-8);
  });

  it("should detect degrading trend", () => {
    const now = Date.now();
    const records: ScanRecord[] = [
      createMockScanRecord(2, now - 6 * 24 * 60 * 60 * 1000),
      createMockScanRecord(5, now - 3 * 24 * 60 * 60 * 1000),
      createMockScanRecord(10, now),
    ];

    const trend = analyzeTrend(records, 7);

    expect(trend).not.toBeNull();
    expect(trend?.trend).toBe("degrading");
    expect(trend?.violationDelta).toBe(8);
  });

  it("should detect stable trend", () => {
    const now = Date.now();
    const records: ScanRecord[] = [
      createMockScanRecord(5, now - 6 * 24 * 60 * 60 * 1000),
      createMockScanRecord(5, now - 3 * 24 * 60 * 60 * 1000),
      createMockScanRecord(6, now),
    ];

    const trend = analyzeTrend(records, 7);

    expect(trend).not.toBeNull();
    expect(trend?.trend).toBe("stable");
  });

  it("should generate recommendations for degrading trend", () => {
    const now = Date.now();
    const records: ScanRecord[] = [
      createMockScanRecord(2, now - 6 * 24 * 60 * 60 * 1000),
      createMockScanRecord(10, now),
    ];

    const trend = analyzeTrend(records, 7);

    expect(trend?.recommendations.length).toBeGreaterThan(0);
    expect(trend?.recommendations.some((r) => r.includes("증가"))).toBe(true);
  });
});

describe("generateMarkdownReport", () => {
  it("should generate markdown report", () => {
    const report: ViolationReport = {
      totalViolations: 2,
      bySeverity: { error: 1, warn: 1, info: 0 },
      byType: {
        "layer-violation": 2,
        "circular-dependency": 0,
        "cross-slice": 0,
        "deep-nesting": 0,
      },
      violations: [
        createMockViolation("features", "widgets", "src/features/auth/login.tsx"),
        createMockViolation("entities", "features", "src/entities/user/model.ts"),
      ],
      filesAnalyzed: 10,
      analysisTime: 100,
    };

    const markdown = generateMarkdownReport(report);

    expect(markdown).toContain("# 🛡️ Mandu Guard Report");
    expect(markdown).toContain("Files Analyzed | 10");
    expect(markdown).toContain("Total Violations | 2");
    expect(markdown).toContain("Layer Violations");
  });

  it("should show success message when no violations", () => {
    const report: ViolationReport = {
      totalViolations: 0,
      bySeverity: { error: 0, warn: 0, info: 0 },
      byType: {
        "layer-violation": 0,
        "circular-dependency": 0,
        "cross-slice": 0,
        "deep-nesting": 0,
      },
      violations: [],
      filesAnalyzed: 10,
      analysisTime: 100,
    };

    const markdown = generateMarkdownReport(report);

    expect(markdown).toContain("All clear");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════

function createMockViolation(
  fromLayer: string,
  toLayer: string,
  filePath: string
): Violation {
  return {
    type: "layer-violation",
    filePath,
    line: 1,
    column: 1,
    importStatement: `import { X } from '@/${toLayer}'`,
    importPath: `@/${toLayer}`,
    fromLayer,
    toLayer,
    ruleName: "Layer Dependency",
    ruleDescription: `"${fromLayer}" cannot import from "${toLayer}"`,
    severity: "error",
    allowedLayers: ["shared"],
    suggestions: ["Move to shared"],
  };
}

function createMockScanRecord(violations: number, timestamp?: number): ScanRecord {
  return {
    id: `scan-${Date.now()}`,
    timestamp: timestamp ?? Date.now(),
    preset: "fsd",
    filesAnalyzed: 10,
    totalViolations: violations,
    bySeverity: { error: violations, warn: 0, info: 0 },
    byType: {
      "layer-violation": violations,
      "circular-dependency": 0,
      "cross-slice": 0,
      "deep-nesting": 0,
    },
    byLayer: { features: violations },
    hotspots: [{ file: "test.ts", count: violations }],
  };
}
