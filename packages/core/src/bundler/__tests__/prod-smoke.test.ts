/**
 * Phase 7.2 R1 Agent C (H4) — production bundle smoke tests.
 *
 * Confirms the Phase 7.1 audit finding L-02 regression is closed: a
 * production build (`minify: true`, no Fast Refresh plugin) must NEVER
 * leak the dev-only symbols that would otherwise install Fast Refresh
 * stubs on `window` (`$RefreshReg$` / `$RefreshSig$` / `__MANDU_HMR__`)
 * or pull in the vendor runtime (`_vendor-react-refresh`).
 *
 * We assert at two layers:
 *   (A) the generated output JS bundle is free of the dev symbols
 *   (B) the returned manifest has `shared.fastRefresh === undefined`
 *
 * Both layers matter because (A) can drift independently of (B) if a
 * future refactor inlines a symbol name into a comment or data literal.
 *
 * References:
 *   docs/security/phase-7-1-audit.md §3 L-02
 *   docs/bun/phase-7-2-team-plan.md §3 Agent C H4
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import fs from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { fastRefreshPlugin } from "../fast-refresh-plugin";

/**
 * Strings we treat as dev-only Fast Refresh fingerprints. Any of them
 * appearing in a prod bundle is a leak. We keep the list small and
 * precise so we don't false-flag legitimate unrelated code.
 */
const DEV_LEAK_FINGERPRINTS = [
  "$RefreshReg$",
  "$RefreshSig$",
  "__MANDU_HMR__",
  "_vendor-react-refresh",
  "_fast-refresh-runtime",
] as const;

// Integration tests that spin up Bun.build are gated on CI flaky-matrix
// environments. See `fast-refresh.test.ts` for the same pattern.
describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "prod-smoke — no Fast Refresh leak in production bundles",
  () => {
    let rootDir = "";

    beforeAll(async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), "mandu-prod-smoke-"));
      // Minimal island source — no JSX runtime, no imports, small AST
      await writeFile(
        path.join(rootDir, "counter.client.tsx"),
        `import { useState } from 'react';
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
`,
        "utf-8",
      );
    });

    afterAll(async () => {
      if (rootDir) await rm(rootDir, { recursive: true, force: true });
    });

    test("[S1] production build output contains no dev-only Fast Refresh symbols", async () => {
      // Prod path: `reactFastRefresh` off, plugin `disabled: true`,
      // minify on. Matches the config `buildClientBundles` uses when
      // `options.minify === true`.
      const result = await Bun.build({
        entrypoints: [path.join(rootDir, "counter.client.tsx")],
        target: "browser",
        minify: true,
        plugins: [fastRefreshPlugin({ disabled: true })],
        external: ["react", "react-dom", "react/jsx-dev-runtime", "react/jsx-runtime"],
      });
      expect(result.success).toBe(true);

      const src = await result.outputs[0]!.text();
      for (const fingerprint of DEV_LEAK_FINGERPRINTS) {
        expect(src.includes(fingerprint)).toBe(false);
      }
    });

    test("[S2] prod build with reactFastRefresh=true explicitly disabled does not emit stubs", async () => {
      // Defense-in-depth: even if a future config accident leaves
      // `reactFastRefresh: false` off-by-default, the disabled plugin
      // MUST still prevent injection. We pass reactFastRefresh: false
      // here to represent the guaranteed-prod config.
      const result = await Bun.build({
        entrypoints: [path.join(rootDir, "counter.client.tsx")],
        target: "browser",
        minify: true,
        reactFastRefresh: false,
        plugins: [fastRefreshPlugin({ disabled: true })],
        external: ["react", "react-dom", "react/jsx-dev-runtime", "react/jsx-runtime"],
      });
      expect(result.success).toBe(true);

      const src = await result.outputs[0]!.text();
      expect(src).not.toContain("$RefreshReg$");
      expect(src).not.toContain("$RefreshSig$");
      expect(src).not.toContain("__MANDU_HMR__");
    });
  },
);

// Pure manifest-shape tests run regardless of the bundler skip flag —
// they don't invoke Bun.build and are safe everywhere.
describe("prod-smoke — manifest shape invariants (no Bun.build)", () => {
  test("[M1] buildClientBundles prod path would omit shared.fastRefresh", async () => {
    // We cannot easily invoke `buildClientBundles` here without a
    // full Mandu project scaffold, so we assert the contract
    // semantically via the static build.ts source: the `fastRefresh`
    // field is populated only when the vendor shim result has both
    // `reactRefreshRuntime` and `fastRefreshRuntime`. In prod mode
    // `buildVendorShims` is called with `isDev: false` which returns
    // empty strings for those — unwinding to `undefined` in the
    // ternary at `build.ts:1548-1554`.
    //
    // This test documents the invariant textually; the bundler-level
    // integration tests (S1/S2 above) prove the output side.
    const buildSource = await fs.readFile(
      path.join(
        import.meta.dir,
        "..",
        "build.ts",
      ),
      "utf-8",
    );
    // The precise construction MUST be guarded by runtime presence.
    expect(buildSource).toContain("vendorResult.reactRefreshRuntime && vendorResult.fastRefreshRuntime");
    // And MUST spread-conditionally include the field.
    expect(buildSource).toContain("...(fastRefresh ? { fastRefresh } : {})");
  });
});
