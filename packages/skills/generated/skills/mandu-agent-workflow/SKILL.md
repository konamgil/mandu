---
name: mandu-agent-workflow
description: Canonical Mandu workflow for safe agent-driven application changes.
license: MPL-2.0
---

# Mandu Agent Workflow

Use this skill before changing a Mandu project. The canonical loop is:

```text
context -> plan -> apply -> verify -> repair
```

Prefer the official MCP tools when available:

- `mandu.agent.context`
- `mandu.agent.plan`
- `mandu.agent.apply`
- `mandu.agent.verify`
- `mandu.agent.repair`
- `mandu.agent.sync`

The CLI equivalents use `mandu agent <step>`. Domain skills are addenda and
must not replace this workflow. Do not edit `.mandu/generated` artifacts,
write outside the planned scope, or invoke deployment providers.

For writes, pass explicit typed operations to `mandu.agent.plan`. Preview is
the default. Execute only the resulting bound plan with `mandu.agent.apply`
using `dryRun=false`. CLI fallback:

```bash
mandu agent plan "<task>" --operations typed-operations.json --write --json
mandu agent apply --from .mandu/agent-plan.json --json
mandu agent apply --from .mandu/agent-plan.json --execute --write --json
```

Never weaken or remove `baseRevision`, content-hash, scope, permission,
idempotency, verification, or rollback fields. An intent-only plan is a
compatibility preview and must not be represented as an executed change.
If a completed receipt must be reverted, use
`mandu agent repair --rollback <rollbackId> --apply`.

End code-changing work with:

```bash
mandu agent verify --changed --json --write
```
