---
name: mandu-testing
description: Select and run evidence-bearing Bun tests for Mandu changes.
license: MPL-2.0
---

# Mandu Testing

Use after planning identifies the changed behavior or verification recommends
a test.

- Prefer the smallest test that executes the changed contract, then expand to
  the affected package and Golden Path.
- Use `bun test`; do not substitute npm or pnpm runners.
- Test failure paths, scope preservation, and generated-output invariants.
- Do not treat a dry run, fixture string, or missing measurement as successful
  runtime evidence.
- ATE and browser-healing experiments are Labs and not part of stable testing.

Finish with `mandu.agent.verify --changed --json --write`.
