/**
 * AST Analyzer Tests
 */

import { describe, it, expect } from "vitest";
import {
  extractImportsAST,
  extractExportsAST,
  analyzeModuleAST,
} from "../../src/guard/ast-analyzer";

describe("extractImportsAST", () => {
  it("should extract static imports", () => {
    const content = `
import { useState, useEffect } from 'react';
import Button from '@/shared/ui/button';
import * as utils from '@/shared/utils';
    `;

    const imports = extractImportsAST(content);
    expect(imports).toHaveLength(3);

    expect(imports[0].path).toBe("react");
    expect(imports[0].type).toBe("static");
    expect(imports[0].namedImports).toEqual(["useState", "useEffect"]);

    expect(imports[1].path).toBe("@/shared/ui/button");
    expect(imports[1].defaultImport).toBe("Button");

    expect(imports[2].path).toBe("@/shared/utils");
  });

  it("should extract dynamic imports", () => {
    const content = `
const Module = await import('./module');
import('./lazy').then(m => m.default);
    `;

    const imports = extractImportsAST(content);
    const dynamicImports = imports.filter((i) => i.type === "dynamic");
    expect(dynamicImports).toHaveLength(2);
  });

  it("should extract require statements", () => {
    const content = `
const fs = require('fs');
const path = require('path');
    `;

    const imports = extractImportsAST(content);
    expect(imports).toHaveLength(2);
    expect(imports[0].type).toBe("require");
    expect(imports[0].path).toBe("fs");
  });

  it("should ignore imports in comments", () => {
    const content = `
// import { X } from 'commented';
/* import { Y } from 'multi-line-commented'; */
import { Z } from 'real';
    `;

    const imports = extractImportsAST(content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe("real");
  });

  it("should ignore imports in strings", () => {
    const content = `
const str = "import { X } from 'not-real'";
const template = \`import { Y } from 'also-not-real'\`;
import { Z } from 'real';
    `;

    const imports = extractImportsAST(content);
    expect(imports).toHaveLength(1);
    expect(imports[0].path).toBe("real");
  });

  it("should handle side-effect imports", () => {
    const content = `
import './styles.css';
import '@/shared/polyfills';
    `;

    const imports = extractImportsAST(content);
    expect(imports).toHaveLength(2);
    expect(imports[0].path).toBe("./styles.css");
  });

  it("should handle aliased named imports", () => {
    const content = `
import { useState as state, useEffect as effect } from 'react';
    `;

    const imports = extractImportsAST(content);
    expect(imports).toHaveLength(1);
    expect(imports[0].namedImports).toEqual(["useState", "useEffect"]);
  });

  it("should handle mixed default and named imports", () => {
    const content = `
import React, { useState, useEffect } from 'react';
    `;

    const imports = extractImportsAST(content);
    expect(imports).toHaveLength(1);
    expect(imports[0].defaultImport).toBe("React");
    expect(imports[0].namedImports).toEqual(["useState", "useEffect"]);
  });
});

describe("extractExportsAST", () => {
  it("should extract named exports", () => {
    const content = `
export const foo = 1;
export function bar() {}
export class Baz {}
    `;

    const exports = extractExportsAST(content);
    expect(exports).toHaveLength(3);
    expect(exports.map((e) => e.name)).toEqual(["foo", "bar", "Baz"]);
  });

  it("should extract default export", () => {
    const content = `
export default function Component() {}
    `;

    const exports = extractExportsAST(content);
    expect(exports).toHaveLength(1);
    expect(exports[0].type).toBe("default");
  });

  it("should extract re-exports", () => {
    const content = `
export { foo, bar } from './module';
export * from './all';
    `;

    const exports = extractExportsAST(content);
    expect(exports.length).toBeGreaterThanOrEqual(2);

    const namedExports = exports.filter((e) => e.type === "named");
    expect(namedExports.some((e) => e.from === "./module")).toBe(true);

    const allExports = exports.filter((e) => e.type === "all");
    expect(allExports.some((e) => e.from === "./all")).toBe(true);
  });

  it("should extract type exports", () => {
    const content = `
export type { Foo, Bar } from './types';
    `;

    const exports = extractExportsAST(content);
    const typeExports = exports.filter((e) => e.type === "type");
    expect(typeExports.length).toBeGreaterThan(0);
  });
});

describe("analyzeModuleAST", () => {
  it("should identify public API files", () => {
    const content = `
export { Button } from './button';
export { Input } from './input';
    `;

    const analysis = analyzeModuleAST(content, "src/shared/ui/index.ts");
    expect(analysis.isPublicAPI).toBe(true);
  });

  it("should identify non-public API files", () => {
    const content = `
export function Button() { return <button />; }
    `;

    const analysis = analyzeModuleAST(content, "src/shared/ui/button.tsx");
    expect(analysis.isPublicAPI).toBe(false);
  });

  it("should include both imports and exports", () => {
    const content = `
import { useState } from 'react';
export function Component() {
  const [state] = useState(0);
  return <div>{state}</div>;
}
    `;

    const analysis = analyzeModuleAST(content, "src/components/Component.tsx");
    expect(analysis.imports.length).toBeGreaterThan(0);
    expect(analysis.exports.length).toBeGreaterThan(0);
  });
});
