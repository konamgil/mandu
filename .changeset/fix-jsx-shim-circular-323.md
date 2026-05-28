---
"@mandujs/core": patch
---

Fix #323 (critical, follow-up to #322): the dev `_jsx-dev-runtime` shim imported `jsxDEV` from `react/jsx-dev-runtime`, but the import map maps that specifier back to the shim itself — a circular self-import that left `jsxDEV` `undefined`, so every dev island still threw `TypeError: jsxDEV is not a function`. Both the dev and prod JSX shims now import from bare `react`, which the import map resolves to the self-contained `_react.js` vendor bundle (built with no `external`, so the real `jsx`/`jsxs`/`jsxDEV`/`Fragment` are inlined and re-exported). Adds a build-level regression guard asserting the emitted shim never self-imports the alias.
