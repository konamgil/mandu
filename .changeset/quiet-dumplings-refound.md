---
"@mandujs/core": minor
"@mandujs/cli": minor
"@mandujs/mcp": minor
"@mandujs/skills": minor
---

Establish the stable Mandu product boundary around Core, CLI, MCP, and generated skills. Enforce reachable package imports and Core runtime/safety/actions ownership, remove CLI and MCP runtime coupling to Labs packages, split product verification and publishing from Labs release trains, and make generated-artifact Guard checks precise and AST-based. Converge the public surface to six official CLI commands, twelve Core exports including a compatibility shim and codemod, eight default MCP actions, and six official skills generated from one canonical source. Retire provider deployment execution in favor of a provider-neutral production artifact contract. Add executable typed agent plans with exact scope, SHA-256/base-revision preconditions, idempotent receipts, built-in verification, touched-file snapshots, automatic failure rollback, and conflict-safe explicit rollback shared by CLI and MCP. Establish three release-blocking reference workflows for SaaS auth, contract CRUD, and realtime interactivity across Linux, Windows, and macOS install rehearsals, and make production handler/prerender failures fail closed.
