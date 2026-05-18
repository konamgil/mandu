---
name: mandu-agent-workflow
description: |
  Canonical Mandu agent workflow. Use first in Mandu projects before direct
  source edits so Codex, Claude Code, Gemini CLI, and other agents follow the
  same context -> plan -> apply -> verify -> repair loop.
license: MIT
metadata:
  author: mandu
  version: "1.0.0"
---

# Mandu Agent Workflow

Mandu is an agent-native fullstack framework. Agents should not begin by
guessing file structure or calling low-level tools directly. Start with the
official agent surface, then use domain tools only when the plan identifies a
specific domain.

## When to Use

Use this skill for every Mandu project task that may inspect, create, modify, or
verify application code, framework configuration, contracts, slots, islands, or
deployment artifacts.

## Canonical Workflow

Always follow this loop:

```text
context -> plan -> apply -> verify -> repair
```

1. `context`: read the project map.
2. `plan`: convert the user request into domains, files, risks, and checks.
3. `apply`: prefer intent-level MCP/domain tools; direct edits must be grounded
   in the plan.
4. `verify`: run the single agent-facing verification report.
5. `repair`: convert failures into next actions, then verify again.

## Preferred MCP Tools

Use these first when MCP is available:

| Step | Tool | Purpose |
|------|------|---------|
| context | `mandu.agent.context` | Project map, routes, APIs, slots, contracts, guard, diagnostics. |
| plan | `mandu.agent.plan` | Deterministic task plan with domains, files, tools, risks. |
| apply | `mandu.agent.apply` | Ordered action preview from `.mandu/agent-plan.json`. |
| verify | `mandu.agent.verify` | Unified post-change guard/diagnose/contract report. |
| repair | `mandu.agent.repair` | Structured next actions from `.mandu/agent-verify.json`. |

If MCP is unavailable, use the CLI equivalents:

```bash
mandu agent context --json
mandu agent plan "<task>" --json --write
mandu agent apply --from .mandu/agent-plan.json --json
mandu agent verify --changed --json --write
mandu agent repair --from .mandu/agent-verify.json --json
```

## Allowed File Edits

Direct file edits are allowed only after `plan` identifies the relevant domain
and the agent has inspected the local pattern. Prefer MCP/domain generation for:

- pages, layouts, and API routes
- contracts and OpenAPI-related files
- slots and fillings
- islands, partials, and hydration boundaries
- deploy intent and provider artifacts

Do not use destructive cleanup, cache removal, deploy execution, or broad
refactors without an explicit plan and verification path.

## Domain Skill Escalation

Read the matching domain skill when `mandu.agent.plan` includes that domain:

| Domain | Skill |
|--------|-------|
| route/api | `mandu-fs-routes` |
| hydration/island/partial | `mandu-hydration` |
| slot/filling | `mandu-slot` |
| guard/import boundary | `mandu-guard` |
| test/e2e/ATE | `mandu-testing` |
| deploy | `mandu-deployment` |
| security/auth/session | `mandu-security` |
| styling/ui/design | `mandu-styling`, `mandu-ui`, `mandu-composition` |
| performance | `mandu-performance` |

Domain skills are addenda. They must not replace the canonical workflow.

## Verification Command

Every code-changing task should end with:

```bash
mandu agent verify --changed --json --write
```

Run additional commands listed in the plan or verify report, usually
`bun run typecheck` and targeted `bun test` commands.

## Repair Path

When verify fails:

```bash
mandu agent repair --from .mandu/agent-verify.json --json
```

Apply only actions that are explicitly safe and scoped. After any repair, run
`mandu agent verify --changed --json --write` again.

## Common Failures

- Skipping context and editing the wrong route or contract path.
- Calling low-level Guard, Doctor, Fix, ATE, or deploy tools before a plan.
- Treating a domain skill as the full workflow.
- Ending a task after tests without writing or reading the agent verify report.
- Applying broad file changes when `agent.apply` only produced a dry-run action
  report.
