---
"@mandujs/core": patch
---

Fix two more correctness bugs:

- **#321**: `Mandu.filling()` 405 responses now include a spec-required `Allow` header (RFC 7231 §6.5.5) listing every registered method — previously the methods were only in the JSON body, so the `Allow` header was missing (notably for multi-method routes). HEAD is implied when GET is registered.
- **#322** (critical): the dev `_jsx-dev-runtime` shim imported `jsxDEV`/`Fragment` from bare `"react"`, which does not export them — breaking every island's dev hydration with `TypeError: jsxDEV is not a function`. The shim now imports from `react/jsx-dev-runtime` (and the prod `jsx-runtime` shim from `react/jsx-runtime`).
