/**
 * Guard Validator Tests
 */

import { describe, it, expect } from "vitest";
import {
  validateLayerDependency,
  validateFileAnalysis,
  createViolation,
} from "../../src/guard/validator";
import { fsdPreset } from "../../src/guard/presets/fsd";
import type { FileAnalysis, ImportInfo, GuardConfig } from "../../src/guard/types";

const layers = fsdPreset.layers;

describe("validateLayerDependency", () => {
  it("should allow valid dependencies (FSD)", () => {
    // app can import everything except itself
    expect(validateLayerDependency("app", "pages", layers)).toBe(true);
    expect(validateLayerDependency("app", "widgets", layers)).toBe(true);
    expect(validateLayerDependency("app", "features", layers)).toBe(true);
    expect(validateLayerDependency("app", "entities", layers)).toBe(true);
    expect(validateLayerDependency("app", "shared", layers)).toBe(true);

    // features can import entities and shared
    expect(validateLayerDependency("features", "entities", layers)).toBe(true);
    expect(validateLayerDependency("features", "shared", layers)).toBe(true);

    // shared cannot import anything
    expect(validateLayerDependency("entities", "shared", layers)).toBe(true);
  });

  it("should reject invalid dependencies (FSD)", () => {
    // features cannot import widgets
    expect(validateLayerDependency("features", "widgets", layers)).toBe(false);
    expect(validateLayerDependency("features", "pages", layers)).toBe(false);
    expect(validateLayerDependency("features", "app", layers)).toBe(false);

    // entities cannot import features
    expect(validateLayerDependency("entities", "features", layers)).toBe(false);

    // shared cannot import anything
    expect(validateLayerDependency("shared", "features", layers)).toBe(false);
    expect(validateLayerDependency("shared", "entities", layers)).toBe(false);
  });

  it("should allow unknown layers", () => {
    expect(validateLayerDependency("unknown", "features", layers)).toBe(true);
  });
});

describe("validateFileAnalysis", () => {
  const config: GuardConfig = {
    preset: "fsd",
    severity: {
      layerViolation: "error",
      crossSliceDependency: "warn",
    },
  };

  it("should detect layer violations", () => {
    const analysis: FileAnalysis = {
      filePath: "src/features/auth/login.tsx",
      layer: "features",
      slice: "auth",
      imports: [
        {
          statement: "import { Header } from '@/widgets/header'",
          path: "@/widgets/header",
          line: 1,
          column: 1,
          type: "static",
        },
      ],
      analyzedAt: Date.now(),
    };

    const violations = validateFileAnalysis(analysis, layers, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("layer-violation");
    expect(violations[0].fromLayer).toBe("features");
    expect(violations[0].toLayer).toBe("widgets");
  });

  it("should allow valid imports", () => {
    const analysis: FileAnalysis = {
      filePath: "src/features/auth/login.tsx",
      layer: "features",
      slice: "auth",
      imports: [
        {
          statement: "import { User } from '@/entities/user'",
          path: "@/entities/user",
          line: 1,
          column: 1,
          type: "static",
        },
        {
          statement: "import { Button } from '@/shared/ui'",
          path: "@/shared/ui",
          line: 2,
          column: 1,
          type: "static",
        },
      ],
      analyzedAt: Date.now(),
    };

    const violations = validateFileAnalysis(analysis, layers, config);
    expect(violations).toHaveLength(0);
  });

  it("should ignore external module imports", () => {
    const analysis: FileAnalysis = {
      filePath: "src/features/auth/login.tsx",
      layer: "features",
      slice: "auth",
      imports: [
        {
          statement: "import { useState } from 'react'",
          path: "react",
          line: 1,
          column: 1,
          type: "static",
        },
      ],
      analyzedAt: Date.now(),
    };

    const violations = validateFileAnalysis(analysis, layers, config);
    expect(violations).toHaveLength(0);
  });

  it("should skip files not in any layer", () => {
    const analysis: FileAnalysis = {
      filePath: "lib/utils.ts",
      layer: null,
      imports: [
        {
          statement: "import { X } from '@/features/x'",
          path: "@/features/x",
          line: 1,
          column: 1,
          type: "static",
        },
      ],
      analyzedAt: Date.now(),
    };

    const violations = validateFileAnalysis(analysis, layers, config);
    expect(violations).toHaveLength(0);
  });

  it("should detect cross-slice dependencies", () => {
    const analysis: FileAnalysis = {
      filePath: "src/features/auth/login.tsx",
      layer: "features",
      slice: "auth",
      imports: [
        {
          statement: "import { something } from '@/features/payment'",
          path: "@/features/payment",
          line: 1,
          column: 1,
          type: "static",
        },
      ],
      analyzedAt: Date.now(),
    };

    const violations = validateFileAnalysis(analysis, layers, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("cross-slice");
  });

  it("should allow same-slice imports", () => {
    const analysis: FileAnalysis = {
      filePath: "src/features/auth/login.tsx",
      layer: "features",
      slice: "auth",
      imports: [
        {
          statement: "import { authApi } from '@/features/auth/api'",
          path: "@/features/auth/api",
          line: 1,
          column: 1,
          type: "static",
        },
      ],
      analyzedAt: Date.now(),
    };

    const violations = validateFileAnalysis(analysis, layers, config);
    expect(violations).toHaveLength(0);
  });

  it("should detect layer violations via relative imports", () => {
    const analysis: FileAnalysis = {
      filePath: "/project/src/features/auth/ui/login.tsx",
      rootDir: "/project",
      layer: "features",
      slice: "auth",
      imports: [
        {
          statement: "import { Header } from '../../../widgets/header'",
          path: "../../../widgets/header",
          line: 1,
          column: 1,
          type: "static",
        },
      ],
      analyzedAt: Date.now(),
    };

    const violations = validateFileAnalysis(analysis, layers, config);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("layer-violation");
    expect(violations[0].fromLayer).toBe("features");
    expect(violations[0].toLayer).toBe("widgets");
  });

  it("should enforce fsRoutes rules inside app/ page files", () => {
    const fsConfig: GuardConfig = {
      preset: "fsd",
      fsRoutes: {
        noPageToPage: true,
        pageCanImport: ["shared"],
      },
    };

    const analysis: FileAnalysis = {
      filePath: "/project/app/page.tsx",
      rootDir: "/project",
      layer: null,
      imports: [
        {
          statement: "import OtherPage from './about/page'",
          path: "./about/page",
          line: 1,
          column: 1,
          type: "static",
        },
        {
          statement: "import { Feature } from '@/features/auth'",
          path: "@/features/auth",
          line: 2,
          column: 1,
          type: "static",
        },
      ],
      analyzedAt: Date.now(),
    };

    const violations = validateFileAnalysis(analysis, layers, fsConfig);
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.some((v) => v.ruleName.includes("FS Routes"))).toBe(true);
  });
});

describe("createViolation", () => {
  it("should create violation with suggestions", () => {
    const analysis: FileAnalysis = {
      filePath: "src/features/auth/login.tsx",
      layer: "features",
      slice: "auth",
      imports: [],
      analyzedAt: Date.now(),
    };

    const importInfo: ImportInfo = {
      statement: "import { Header } from '@/widgets/header'",
      path: "@/widgets/header",
      line: 1,
      column: 1,
      type: "static",
    };

    const violation = createViolation(
      "layer-violation",
      analysis,
      importInfo,
      "features",
      "widgets",
      layers,
      { layerViolation: "error" }
    );

    expect(violation.type).toBe("layer-violation");
    expect(violation.severity).toBe("error");
    expect(violation.allowedLayers).toEqual(["entities", "shared"]);
    expect(violation.suggestions.length).toBeGreaterThan(0);
  });
});
