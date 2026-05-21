# Reference Apps

Status: Current
Audience: maintainers, release reviewers, AI agents

Mandu keeps three reference app paths so framework changes are judged against real user workflows, not only unit tests.

| Reference app | Backing project | What it proves | Gate |
|---|---|---|---|
| Hello SSR | generated temp app from `bunx @mandujs/cli create` and `demo/starter` perf scenario | first page, pure SSR, build/start lifecycle | `bun run test:smoke`, `hello-ssr-home` in `tests/perf/perf-baseline.json` |
| Blog CRUD + Contract | `demo/todo-app` plus generated `post` resource in smoke | page/API/resource generation, contract artifact, slot artifact, CRUD-style domain load | `bun run test:smoke`, `blog-crud-contract-list` perf scenario, `demo/todo-app` E2E |
| Dashboard + Island | `demo/ai-chat` and HMR hybrid benchmark | hydrated island, interactive dashboard-style shell, API + SSE path, island HMR latency | `demo/ai-chat` Playwright E2E, `auth-starter-hmr-island` manual perf scenario |

## Release Expectations

- `bun run test:smoke` must pass before release. It covers create, page, API, resource/contract, dev, build, and start in one temporary app.
- `bun run test:edge:build` must pass before release. It builds `demo/edge-workers-starter` with `mandu build --target=workers` and checks the generated Worker bundle for target-unsafe optional dependency leaks.
- `bun run perf:ci` must leave `.perf/latest/summary.json`, `.perf/latest/report.md`, and `.perf/latest/budget-check.md`.
- Host-sensitive manual performance gates use `bun run perf:expanded`.

## Ownership

Reference app drift is release-blocking when it invalidates a published quickstart or CI gate. Update this file in the same PR that changes a reference app command, route, or expected artifact.
