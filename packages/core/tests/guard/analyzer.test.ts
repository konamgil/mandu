/**
 * Guard Analyzer Tests
 */

import { describe, it, expect } from "vitest";
import {
  extractImports,
  resolveFileLayer,
  resolveImportLayer,
  extractSlice,
  shouldAnalyzeFile,
  shouldIgnoreImport,
} from "../../src/guard/analyzer";
import { fsdPreset } from "../../src/guard/presets/fsd";
import type { GuardConfig } from "../../src/guard/types";

describe("extractImports", () => {
  it("should extract static imports", () => {
    const content = `
import { useState } from 'react';
import { Button } from '@/shared/ui';
import Header from '@/widgets/header';
    `;

    const imports = extractImports(content);
    expect(imports).toHaveLength(3);
    expect(imports[0].path).toBe("react");
    expect(imports[0].type).toBe("static");
    expect(imports[1].path).toBe("@/shared/ui");
    expect(imports[2].path).toBe("@/widgets/header");
  });

  it("should extract dynamic imports", () => {
    const content = `
const Module = await import('./module');
const Lazy = import('@/features/lazy');
    `;

    const imports = extractImports(content);
    const dynamicImports = imports.filter((i) => i.type === "dynamic");
    expect(dynamicImports).toHaveLength(2);
    expect(dynamicImports[0].path).toBe("./module");
    expect(dynamicImports[1].path).toBe("@/features/lazy");
  });

  it("should extract require statements", () => {
    const content = `
const fs = require('fs');
const utils = require('@/shared/utils');
    `;

    const imports = extractImports(content);
    const requireImports = imports.filter((i) => i.type === "require");
    expect(requireImports).toHaveLength(2);
    expect(requireImports[0].path).toBe("fs");
    expect(requireImports[1].path).toBe("@/shared/utils");
  });

  it("should extract named imports", () => {
    const content = `
import { useState, useEffect } from 'react';
import { Button, Input, Card } from '@/shared/ui';
    `;

    const imports = extractImports(content);
    expect(imports[0].namedImports).toEqual(["useState", "useEffect"]);
    expect(imports[1].namedImports).toEqual(["Button", "Input", "Card"]);
  });

  it("should extract line and column numbers", () => {
    const content = `import { X } from 'module';
import Y from 'other';`;

    const imports = extractImports(content);
    expect(imports[0].line).toBe(1);
    expect(imports[1].line).toBe(2);
  });

  it("should handle side-effect imports", () => {
    const content = `import './styles.css';`;

    const imports = extractImports(content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe("./styles.css");
  });
});

describe("resolveFileLayer", () => {
  const layers = fsdPreset.layers;
  const rootDir = "/project";

  it("should resolve file layer from path", () => {
    expect(resolveFileLayer("/project/src/features/auth/login.tsx", layers, rootDir)).toBe("features");
    expect(resolveFileLayer("/project/src/shared/ui/button.tsx", layers, rootDir)).toBe("shared");
    expect(resolveFileLayer("/project/src/entities/user/model.ts", layers, rootDir)).toBe("entities");
  });

  it("should return null for unmatched paths", () => {
    expect(resolveFileLayer("/project/lib/utils.ts", layers, rootDir)).toBeNull();
    expect(resolveFileLayer("/project/node_modules/react/index.js", layers, rootDir)).toBeNull();
  });
});

describe("resolveImportLayer", () => {
  const layers = fsdPreset.layers;
  const srcDir = "src";

  it("should resolve import layer from alias paths", () => {
    expect(resolveImportLayer("@/features/auth", layers, srcDir)).toBe("features");
    expect(resolveImportLayer("@/shared/ui", layers, srcDir)).toBe("shared");
    expect(resolveImportLayer("~/entities/user", layers, srcDir)).toBe("entities");
  });

  it("should return null for external modules", () => {
    expect(resolveImportLayer("react", layers, srcDir)).toBeNull();
    expect(resolveImportLayer("lodash", layers, srcDir)).toBeNull();
  });

  it("should handle relative paths", () => {
    // Relative paths within same layer are handled separately
    expect(resolveImportLayer("./utils", layers, srcDir)).toBeNull();
  });

  it("should resolve relative paths with context", () => {
    const rootDir = "/project";
    const fromFile = "/project/src/features/auth/ui/login.tsx";

    expect(resolveImportLayer("../model", layers, srcDir, fromFile, rootDir)).toBe("features");
    expect(resolveImportLayer("../../../widgets/header", layers, srcDir, fromFile, rootDir)).toBe("widgets");
  });
});

describe("extractSlice", () => {
  it("should extract slice name from path", () => {
    expect(extractSlice("src/features/auth/login.tsx", "features")).toBe("auth");
    expect(extractSlice("src/entities/user/model.ts", "entities")).toBe("user");
    expect(extractSlice("src/widgets/header/index.tsx", "widgets")).toBe("header");
  });

  it("should return undefined for non-sliced paths", () => {
    expect(extractSlice("src/shared/ui/button.tsx", "shared")).toBe("ui");
    expect(extractSlice("lib/utils.ts", "features")).toBeUndefined();
  });
});

describe("shouldAnalyzeFile", () => {
  const config: GuardConfig = {
    preset: "fsd",
    exclude: ["**/*.test.ts", "**/node_modules/**"],
  };

  it("should include TypeScript files", () => {
    expect(shouldAnalyzeFile("src/features/auth/login.ts", config)).toBe(true);
    expect(shouldAnalyzeFile("src/features/auth/login.tsx", config)).toBe(true);
  });

  it("should include JavaScript files", () => {
    expect(shouldAnalyzeFile("src/utils.js", config)).toBe(true);
    expect(shouldAnalyzeFile("src/utils.jsx", config)).toBe(true);
  });

  it("should exclude test files", () => {
    expect(shouldAnalyzeFile("src/features/auth/login.test.ts", config)).toBe(false);
  });

  it("should exclude test files with absolute paths", () => {
    const rootDir = "/project";
    expect(shouldAnalyzeFile("/project/src/features/auth/login.test.ts", config, rootDir)).toBe(false);
  });

  it("should exclude non-code files", () => {
    expect(shouldAnalyzeFile("src/styles.css", config)).toBe(false);
    expect(shouldAnalyzeFile("src/data.json", config)).toBe(false);
  });
});

describe("shouldIgnoreImport", () => {
  const config: GuardConfig = {
    preset: "fsd",
    ignoreImports: ["@/test/**"],
  };

  it("should ignore external modules", () => {
    expect(shouldIgnoreImport("react", config)).toBe(true);
    expect(shouldIgnoreImport("lodash", config)).toBe(true);
    expect(shouldIgnoreImport("@tanstack/react-query", config)).toBe(true);
  });

  it("should not ignore internal imports", () => {
    expect(shouldIgnoreImport("@/features/auth", config)).toBe(false);
    expect(shouldIgnoreImport("~/shared/ui", config)).toBe(false);
  });

  it("should ignore patterns in ignoreImports", () => {
    expect(shouldIgnoreImport("@/test/utils", config)).toBe(true);
  });
});
