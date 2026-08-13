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

const describeBundler = describe.skipIf(
  process.env.MANDU_SKIP_BUNDLER_TESTS === "1",
);

describeBundler("JSX runtime shim sources (issues #322 / #323)", () => {
  test("dev shim imports jsxDEV/Fragment from bare 'react', never the self-aliased subpath", () => {
    const source = _testOnly_generateJsxDevRuntimeShimSource();

    // #323: must NOT import from 'react/jsx-dev-runtime' — that is this shim's
    // own import-map alias, which would be a circular self-import. (Targets
    // the import statement, not comment mentions of the path.)
    expect(source).not.toMatch(/from\s*['"]react\/jsx-dev-runtime['"]/);

    // Correct: jsxDEV (+ jsx/jsxs fallback inputs) come from bare 'react'
    // (→ _react.js). Import includes jsxDEV and resolves from "react".
    expect(source).toMatch(/import\s*\{[^}]*\bjsxDEV\b[^}]*\}\s*from\s*['"]react['"]/);

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

  // #323 re-regression (0.54.30): a SOURCE/static check passed but at RUNTIME
  // `_react.js`'s jsxDEV was `undefined` (jsxDEV is a React dev-only export;
  // a production-built _react.js drops it while keeping jsx/jsxs). The shim
  // re-exported that undefined → "jsxDEV is not a function". Guard the VALUE:
  // build the dev shim against a `react` stub whose jsxDEV is undefined (the
  // exact failing condition) and assert the shim still exposes a callable
  // jsxDEV via its jsx/jsxs fallback.
  test("dev shim exposes a callable jsxDEV even when react.jsxDEV is undefined (runtime value)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mandu-jsx-shim-rt-"));
    try {
      // Stub for bare 'react' = a production-built _react.js: jsx/jsxs are real
      // functions, jsxDEV is missing.
      const reactStub = path.join(dir, "react-stub.js");
      await writeFile(
        reactStub,
        [
          "export const jsx = (type) => ({ type, runtime: 'jsx' });",
          "export const jsxs = (type) => ({ type, runtime: 'jsxs' });",
          "export const Fragment = Symbol.for('react.fragment');",
          "export const jsxDEV = undefined;",
        ].join("\n"),
        "utf-8",
      );

      // Generate the real shim source, but resolve its bare `react` import to
      // the stub so we can drive the undefined-jsxDEV condition.
      const shimSource = _testOnly_generateJsxDevRuntimeShimSource().replace(
        /from\s*['"]react['"]/g,
        `from ${JSON.stringify(reactStub.replace(/\\/g, "/"))}`,
      );
      const shimSrc = path.join(dir, "_jsx-dev-runtime.src.js");
      await writeFile(shimSrc, shimSource, "utf-8");

      const result = await Bun.build({
        entrypoints: [shimSrc],
        target: "browser",
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
      });
      expect(result.success).toBe(true);

      const outPath = path.join(dir, "_jsx-dev-runtime.built.js");
      await writeFile(outPath, await result.outputs[0]!.text(), "utf-8");

      // Import through a relative specifier in a fresh Bun process. This
      // exercises the public export while avoiding Bun 1.3's unreliable
      // in-process resolution of temporary absolute file URLs on macOS.
      const probePath = path.join(dir, "probe.js");
      await writeFile(
        probePath,
        [
          "import * as runtime from './_jsx-dev-runtime.built.js';",
          "console.log(JSON.stringify({",
          "  type: typeof runtime.jsxDEV,",
          "  single: runtime.jsxDEV('div', {}, undefined, false).runtime,",
          "  multi: runtime.jsxDEV('div', {}, undefined, true).runtime,",
          "}));",
        ].join("\n"),
        "utf-8",
      );

      const proc = Bun.spawn([process.execPath, "run", probePath], {
        cwd: dir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        throw new Error(`Built JSX runtime probe failed (${exitCode}): ${stderr}`);
      }
      const probe = JSON.parse(stdout.trim()) as {
        type: string;
        single: string;
        multi: string;
      };

      // The whole point of #323's re-regression: jsxDEV must be CALLABLE.
      expect(probe.type).toBe("function");
      // Fallback routes static-children to jsxs, otherwise jsx.
      expect(probe.single).toBe("jsx");
      expect(probe.multi).toBe("jsxs");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
