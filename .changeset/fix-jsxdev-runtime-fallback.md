---
"@mandujs/core": patch
---

Fix #323 re-regression (0.54.30): every dev island still crashed with `TypeError: jsxDEV is not a function`. Root cause: `jsxDEV` is a React **dev-only** export, so when the shared `_react.js` vendor bundle is built in production `NODE_ENV` (`react/jsx-dev-runtime` resolves to its production variant) `jsxDEV` is `undefined` while `jsx`/`jsxs` stay real. The dev `_jsx-dev-runtime` shim re-exported that `undefined`. The shim now falls back to `jsx`/`jsxs` (routing static children to `jsxs`) whenever `react.jsxDEV` is not a function, so `jsxDEV` is always callable regardless of how `_react.js` was built. Adds a **runtime-value** regression guard that builds the shim against a `react` stub with `jsxDEV: undefined` and asserts the built shim still exposes a callable `jsxDEV` — the gap every prior source-only guard missed.
