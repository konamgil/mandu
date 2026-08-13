---
status: retired
date: 2026-08-13
---

# Deployment boundary

`mandu deploy` and `mandu deploy:plan` are retired from the stable Mandu
product. Provider credentials, provider configuration, remote execution, and
rollout state belong to the selected hosting platform.

The supported path is:

```bash
bunx mandu check
bunx mandu build
bunx mandu start
```

Then deploy the verified project with a provider CLI or container platform.
The exact files, runtime inputs, environment rules, and Docker example are in
the [production artifact contract](./artifact-contract.md).

The former provider adapters remain temporarily as unreachable compatibility
source during the v0 migration. They are not registered by the stable CLI,
shown in global help, or covered by the product release promise.
