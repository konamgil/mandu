# Module Ownership

Status: Current
Audience: maintainers, release reviewers, AI agents

Mandu is split by package, but release risk is owned by module boundary. Use this table when assigning reviews or deciding validation scope.

| Area | Owner Lens | Primary Files | Required Gates |
|---|---|---|---|
| Runtime | request lifecycle, SSR, static assets, devtools, observability | `packages/core/src/runtime/**` | `bun run typecheck`, core runtime tests, `bun run test:smoke` |
| Runtime Contracts | loader/action/filling/contract responsibility boundaries | `packages/core/src/filling/**`, `packages/core/src/contract/**`, `docs/architect/runtime-contracts.md` | `bun run typecheck`, contract/filling targeted tests |
| Router | FS Routes scanning, route conventions, manifest shape | `packages/core/src/router/**`, `packages/core/src/spec/**` | router/spec tests, guard tests |
| Public API | stable exports, subpath exports, release compatibility | `packages/core/src/index.ts`, `packages/core/package.json` | `bun run check:public-api`, `bun run check:publish` |
| Target Boundaries | edge/browser/node import safety, optional peers | `packages/core/src/**`, `packages/edge/**`, `demo/edge-workers-starter/**` | `bun run check:target-boundaries`, `bun run test:edge`, `bun run test:edge:build` |
| CLI | command routing, scaffold UX, error output | `packages/cli/src/**`, `packages/cli/templates/**` | CLI tests, `bun run check:docs-drift` |
| MCP | tool schemas, response contracts, transaction safety | `packages/mcp/src/**` | MCP tests, transaction tests |
| Agent Loop | context/plan/apply/verify/repair reports | `packages/core/src/agent/**`, `packages/mcp/src/tools/agent.ts` | agent tests, MCP response tests |
| Performance | baseline JSON, bundle budget, perf artifacts | `tests/perf/**`, `scripts/perf-*.ts`, `.github/workflows/ci.yml` | `bun run perf:baseline:check`, `bun run perf:ci` |
| Reference Apps | golden path, CRUD/contract, dashboard/island | `scripts/smoke.ts`, `demo/todo-app/**`, `demo/ai-chat/**`, `docs/architect/reference-apps.md` | `bun run test:smoke`, demo E2E, `bun run perf:expanded` when relevant |
| Engineering Governance | main branch policy, red-test policy, debt backlog, external-ready criteria | `docs/architect/engineering-governance.md`, `docs/releases/**` | release gate checklist, CI status |
| Docs | official commands, ports, release process | `README*`, `docs/**`, `packages/*/README*` | `bun run check:docs-drift` |

## Internal API Rule

Files under `packages/core/src/runtime`, `bundler`, `server`, `guard`, `spec`, `router`, and `internal` are framework internals. Direct edits are allowed for framework work, but agent verify must flag them and require boundary checks.

```bash
bun run check:public-api
bun run check:target-boundaries
```

## Release Reviewer Rule

Any PR that touches package metadata, public exports, CLI command help, MCP tool schemas, or docs quickstarts must include a note explaining:

1. What user-facing behavior changed.
2. Which compatibility gate caught the change.
3. Whether a changeset or migration note is required.
