# Mandu documentation

Mandu is an Agent-Safe Fullstack Framework for Bun, React, and supervised AI
development. Its product contract is a focused runtime plus architecture,
contract, build-state, and agent-change safety.

[한국어](./README.ko.md)

## Golden Path

```text
create -> dev -> page/API -> agent change -> verify -> build -> start
```

```bash
bunx @mandujs/cli create my-app --yes
cd my-app
bun install
bun run dev
```

The official top-level CLI surface is exactly:

```text
create  dev  build  start  check  agent
```

Older commands remain compatibility or Labs routes during v0, but do not
define the v1 product. `deploy` and `deploy:plan` are retired: Mandu produces
a verified artifact and leaves provider operations to provider tooling.

## Read in this order

1. [Agent-Safe product strategy](./product/03_agent_safe_refoundation_strategy.md)
2. [Agent workflow](./guides/07_agent_workflow.md)
3. [Typed apply contract](./guides/08_typed_apply.md)
4. [Configuration](./guides/01_configuration.md)
5. [Core public API boundary](./architect/public-api-boundary.md)
6. [Reference app contracts](./architect/reference-apps.md)
7. [Core v1 migration](./migration/core-v1-surface.md)
8. [Production artifact contract](./deploy/artifact-contract.md)

## Agent surface

The default MCP profile exposes six `mandu.agent.*` actions and two docs
actions. The six official skills cover the shared workflow, routes, contracts,
hydration, Guard, and testing. CLI, MCP, and skills are adapters around the
same action model; they must not reimplement product logic independently.

Typed apply is implemented behind an explicit execution opt-in. It binds exact
scope, base revision and content hashes, writes a touched-file snapshot,
includes verification in a shared CLI/MCP receipt, and supports conflict-safe
rollback. Intent-only plans remain read-only compatibility previews.

## Stability

- Stable Core imports: `@mandujs/core` plus ten documented subpaths.
- Compatibility: `@mandujs/core/compat/*`, temporary during v0 migration.
- Labs: ATE, Kitchen, Playground, Edge, desktop, design, and AI brain.
- External: cloud deployment execution and credential management.

Historical plans and retired skill catalogs live under `docs/archive/` and do
not describe the active product contract.
