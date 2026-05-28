---
"@mandujs/core": patch
---

Fix #324: the in-page Mandu Dev Console showed a green **HEALTHY** badge with **Issues 0** even while island hydration was failing. Island hydration/render failures were only logged to the console (and render-time errors were swallowed by `IslandErrorBoundary`, never reaching the global error listener), so they never reached the DevTools state. The hydration runtime now emits an `error` event to the DevTools hook (`window.__MANDU_DEVTOOLS_HOOK__`) from both the load/hydrate `catch` and the island error boundary's `componentDidCatch`. These flow through `handleEvent → addError`, so the Issues counter and health badge now reflect hydration failures instead of falsely reporting HEALTHY.
