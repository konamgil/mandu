/**
 * Small runtime-safe Fast Refresh preamble helper.
 *
 * Keep this separate from `bundler/dev.ts`: SSR runtimes import the helper
 * while edge bundles must not pull the dev bundler, build graph, or TypeScript
 * compiler into production worker output.
 */
export function generateFastRefreshPreamble(
  glueUrl: string,
  runtimeUrl: string,
): string {
  // Both URLs must be non-empty. If either is missing (e.g. vendor
  // shim build failed), the caller should skip this preamble entirely.
  if (!glueUrl || !runtimeUrl) {
    return `<script>/* Mandu Fast Refresh: missing runtime assets, preamble skipped */</script>`;
  }
  // JSON.stringify escapes the URLs safely for inline `<script>`:
  //   - quotes produce a valid JS string literal
  //   - forward-slashes / backslashes are handled
  // We also `split('</')` to avoid a stray `</script>` sequence in the
  // URL bytes breaking the enclosing tag. This is the same defense
  // Vite uses in its own preamble emitter.
  const glueLit = JSON.stringify(glueUrl).split("</").join('<"+"/');
  const runtimeLit = JSON.stringify(runtimeUrl).split("</").join('<"+"/');
  return `<script>
// Phase 7.1 B-3 React Fast Refresh preamble (Mandu dev-only)
(function () {
  if (typeof window === "undefined") return;
  // Install inert stubs so transformed modules that run BEFORE the
  // async runtime upgrade don't hit ReferenceError on $RefreshReg$.
  if (!window.$RefreshReg$) window.$RefreshReg$ = function () {};
  if (!window.$RefreshSig$) window.$RefreshSig$ = function () { return function (t) { return t; }; };
  // Async-load the glue; failures are reported but never throw out of
  // the preamble — a missing runtime degrades to full-reload HMR.
  import(${glueLit})
    .then(function (mod) {
      var runtimeImport = function () { return import(${runtimeLit}); };
      if (mod && typeof mod.installGlobal === "function") {
        return mod.installGlobal({ runtimeImport: runtimeImport });
      }
    })
    .catch(function (err) {
      console.error("[Mandu Fast Refresh] preamble failed:", err);
    });
})();
</script>`;
}
