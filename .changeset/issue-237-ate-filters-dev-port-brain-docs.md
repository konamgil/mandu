---
"@mandujs/ate": patch
"@mandujs/mcp": minor
---

#237 — mandu.ate.run / mandu_ate_run scope filters (onlyFiles, onlyRoutes, grep),
mandu.dev.start TCP port polling against server.port from mandu.config.ts (fallback 3333),
and mandu.brain.status suggestions[] pointing at the current tier's LLM invocation paths.
Tool descriptions for mandu.ate.heal and mandu.brain.doctor clarify their LLM-call
behaviour. No new runtime dependencies; TCP probe uses node:net.
