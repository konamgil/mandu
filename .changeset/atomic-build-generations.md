---
"@mandujs/core": patch
"@mandujs/cli": patch
---

Publish client bundles as atomic build generations so failed or concurrent rebuilds cannot expose partial artifacts. Pin SSR, streaming, client-boundary, import-map, and DevTools asset URLs to an immutable generation, preserve the last published manifest after failures, and refresh the live server manifest after HMR or a dev restart.
