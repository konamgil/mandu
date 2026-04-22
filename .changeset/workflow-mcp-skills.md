---
"@mandujs/skills": minor
---

feat(skills): #234 workflow-oriented MCP recipe skills

Adds 6 workflow-oriented skills to `@mandujs/skills` that orchestrate
combinations of the 108 MCP tools exposed by `@mandujs/mcp`:

- `mandu-mcp-index` — always-on router + tiered hierarchy + anti-pattern catalog
- `mandu-mcp-orient` — session start / state assessment (ai.brief aggregate)
- `mandu-mcp-create-flow` — spec-first creation (contract before generate)
- `mandu-mcp-verify` — post-edit verification loop (ate.auto_pipeline + guard_check + doctor)
- `mandu-mcp-safe-change` — transactional safety wrapper (history.snapshot + tx.begin)
- `mandu-mcp-deploy` — fail-fast build/deploy pipeline (deploy.check gate)

Complements existing task-shaped skills (`mandu-create-feature`,
`mandu-debug`, `mandu-guard-guide`, etc.) — domain knowledge stays,
tool orchestration is added on top. Each workflow skill codifies
aggregate-first priority (`ate.auto_pipeline` over individual ate tools),
ordering rules (`create_contract` before `generate`), and safety gates
(`history.snapshot` before `refactor_*`). Existing skills gain one-line
"See also" links to the relevant workflow skill.
