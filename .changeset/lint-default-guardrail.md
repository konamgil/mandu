---
"@mandujs/cli": minor
"@mandujs/mcp": minor
"@mandujs/skills": minor
---

feat: lint as default guardrail across CLI, MCP, and skills

Positions oxlint as the third guardrail axis alongside `mandu guard`
(architecture) and `tsgo` (types). Every Mandu surface now treats
lint as a first-class default:

- **`mandu check`** — runs oxlint when available, adds the result to
  the health score. Errors flip exit; warnings are reported.
- **`mandu build`** — pre-build lint gate. Errors block the build;
  `--no-lint` opts out for emergency deploys.
- **`mandu init` templates** — `default` / `auth-starter` /
  `realtime-chat` ship `lefthook.yml` (pre-push: typecheck + lint
  in parallel), `lefthook` devDep, and `prepare: "lefthook install"`.
- **MCP tools** — new `mandu.lint` (read-only runner) and
  `mandu.lint.setup` (destructive installer wrapping the CLI
  command). `dryRun: true` previews.
- **Skills** — new `mandu-lint` SKILL.md covering guardrail
  positioning, setup, type-aware, safe-autofix pattern, and
  anti-patterns. `mandu-guard-guide` gains a 3-axis header.
  `mandu-mcp-verify` fast path becomes 4-parallel (lint joins
  ate/guard/doctor) with a new lint drill-down branch.
  `mandu-mcp-safe-change` Step 4 explicitly includes lint.
