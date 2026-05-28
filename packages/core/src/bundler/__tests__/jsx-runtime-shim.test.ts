/**
 * Regression guard for issue #322 — dev island hydration broke because the
 * generated `_jsx-dev-runtime` shim imported `jsxDEV` from bare `"react"`.
 * React's main entry does NOT export `jsxDEV` (it lives in
 * `react/jsx-dev-runtime`), so `jsxDEV` resolved to `undefined` and every
 * island threw `TypeError: jsxDEV is not a function` in dev mode.
 *
 * These tests assert the generated shim sources reference the correct React
 * subpaths and never pull JSX runtime functions from bare `"react"`.
 */
import { describe, expect, test } from "bun:test";
import {
  _testOnly_generateJsxDevRuntimeShimSource,
  _testOnly_generateJsxRuntimeShimSource,
} from "../build";

describe("JSX runtime shim sources (issue #322)", () => {
  test("dev shim imports jsxDEV/Fragment from react/jsx-dev-runtime", () => {
    const source = _testOnly_generateJsxDevRuntimeShimSource();

    // The fix: jsxDEV + Fragment must come from the real subpath.
    expect(source).toContain("react/jsx-dev-runtime");
    expect(source).toMatch(
      /import\s*\{\s*jsxDEV\s*,\s*Fragment\s*\}\s*from\s*['"]react\/jsx-dev-runtime['"]/,
    );

    // Regression: must NOT import jsxDEV from bare "react".
    expect(source).not.toMatch(
      /import\s*\{[^}]*jsxDEV[^}]*\}\s*from\s*['"]react['"]/,
    );

    // Shim still re-exports what the import map expects.
    expect(source).toContain("export { jsxDEV, Fragment }");
  });

  test("prod shim imports jsx/jsxs/Fragment from react/jsx-runtime", () => {
    const source = _testOnly_generateJsxRuntimeShimSource();

    expect(source).toContain("react/jsx-runtime");
    expect(source).toMatch(
      /import\s*\{\s*jsx\s*,\s*jsxs\s*,\s*Fragment\s*\}\s*from\s*['"]react\/jsx-runtime['"]/,
    );

    // Regression: must NOT import jsx/jsxs from bare "react".
    expect(source).not.toMatch(
      /import\s*\{[^}]*\bjsx\b[^}]*\}\s*from\s*['"]react['"]/,
    );

    expect(source).toContain("export { jsx, jsxs, Fragment }");
  });
});
