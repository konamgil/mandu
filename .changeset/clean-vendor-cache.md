---
"@mandujs/cli": patch
---

`mandu clean` now also removes `.mandu/vendor-cache/` (the cached React vendor shims: `_react.js`, `_jsx-dev-runtime.js`, …). Previously it only wiped `.mandu/client/` and `.mandu/static/`, so a stale or broken vendor bundle survived a clean and was restored on the next dev build — meaning `mandu clean && mandu dev` could not actually recover from a bad `_react.js` (a contributing factor to the #322/#323 "fix didn't take effect after upgrade" reports).
