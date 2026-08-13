---
name: mandu-contract
description: Define and preserve typed Mandu API contracts.
license: MPL-2.0
---

# Mandu Contracts

Use after planning selects an API or contract change.

- Keep request, response, method, and status schemas machine-readable.
- Co-locate or link the contract using the surrounding project convention.
- Change handler and contract together; do not weaken validation to silence a
  mismatch.
- Generated clients and OpenAPI artifacts are outputs, not direct-edit inputs.
- Preserve existing consumer behavior unless the plan explicitly authorizes a
  breaking change.

Prefer `mandu.agent.apply` for a typed contract operation. Run targeted tests
and finish with `mandu.agent.verify --changed --json --write`.
