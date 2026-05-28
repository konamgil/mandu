/**
 * Regression guard for issues #322 / #323 — dev island hydration broke with
 * `TypeError: jsxDEV is not a function`.
 *
 * #322: the shim imported `jsxDEV` from bare `"react"`, which (via the import
 * map → `_react.js`) only worked if `_react.js` re-exported jsxDEV.
 * #323: the "fix" changed the import to `"react/jsx-dev-runtime"`, but the
 * import map maps `react/jsx-dev-runtime` to THIS shim — a circular
 * self-import, so jsxDEV stayed `undefined`.
 *
 * The correct source: import JSX runtime functions from bare `"react"`, which
 * the import map resolves to the self-contained `_react.js` vendor bundle
 * (built with no `external`, so the real jsx/jsxs/jsxDEV/Fragment are inlined
 * and re-exported). The shim must NEVER import from the import-map-aliased
 * subpath that points back at itself.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  _testOnly_generateJsxDevRuntimeShimSource,
  _testOnly_generateJsxRuntimeShimSource,
} from "../build";

describe("JSX runtime shim sources (issues #322 / #323)", () => {
  test("dev shim imports jsxDEV/Fragment from bare 'react', never the self-aliased subpath", () => {
    const source = _testOnly_generateJsxDevRuntimeShimSource();

    // #323: must NOT import from 'react/jsx-dev-runtime' — that is this shim's
    // own import-map alias, which would be a circular self-import. (Targets
    // the import statement, not comment mentions of the path.)
    expect(source).not.toMatch(/from\s*['"]react\/jsx-dev-runtime['"]/);

    // Correct: jsxDEV + Fragment come from bare 'react' (→ _react.js).
    expect(source).toMatch(
      /import\s*\{\s*jsxDEV\s*,\s*Fragment\s*\}\s*from\s*['"]react['"]/,
    );

    // Shim still re-exports what the import map expects.
    expect(source).toContain("export { jsxDEV, Fragment }");
  });

  test("prod shim imports jsx/jsxs/Fragment from bare 'react', never the self-aliased subpath", () => {
    const source = _testOnly_generateJsxRuntimeShimSource();

    // #323: must NOT import from 'react/jsx-runtime' (this shim's own alias).
    expect(source).not.toMatch(/from\s*['"]react\/jsx-runtime['"]/);

    expect(source).toMatch(
      /import\s*\{\s*jsx\s*,\s*jsxs\s*,\s*Fragment\s*\}\s*from\s*['"]react['"]/,
    );

    expect(source).toContain("export { jsx, jsxs, Fragment }");
  });

  // #323 build-level guard: the SOURCE test alone missed the real bug because
  // the broken 0.54.24 build still emitted `from "react/jsx-dev-runtime"` in
  // the OUTPUT (the import-map alias pointing back at this shim). Build the
  // shim the same way buildVendorShims does (external: ["react"]) and assert
  // the emitted module never self-imports the alias.
  test("built dev shim never self-imports react/jsx-dev-runtime", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mandu-jsx-shim-"));
    try {
      const srcPath = path.join(dir, "_jsx-dev-runtime.js");
      await writeFile(srcPath, _testOnly_generateJsxDevRuntimeShimSource(), "utf-8");

      const result = await Bun.build({
        entrypoints: [srcPath],
        external: ["react"],
        target: "browser",
      });

      expect(result.success).toBe(true);
      const out = await result.outputs[0]!.text();

      // The emitted shim must source jsxDEV from bare 'react' (→ _react.js),
      // NOT from the import-map alias that resolves back to itself.
      expect(out).not.toMatch(/from\s*["']react\/jsx-dev-runtime["']/);
      expect(out).toMatch(/from\s*["']react["']/);
      expect(out).toContain("jsxDEV");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
