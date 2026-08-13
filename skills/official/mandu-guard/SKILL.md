---
name: mandu-guard
description: Resolve Mandu architecture violations without weakening policy.
license: MPL-2.0
---

# Mandu Guard

Use when planning or verification reports an import, layer, location, or
generated-artifact violation.

- Fix the dependency direction or file ownership that caused the diagnostic.
- Do not disable a rule or broaden an allowlist unless policy change is the
  explicit task.
- Read generated data through the runtime registry; never import or edit
  `.mandu/generated` artifacts directly.
- Keep fixes inside the plan scope and preserve user changes.

Start with `mandu.agent.verify`, use `mandu.agent.repair` for structured next
actions, and verify again after the repair.
