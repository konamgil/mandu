# Engineering Governance

작성일: 2026-05-21

이 문서는 Mandu를 외부 사용자가 의존할 수 있는 프레임워크로 유지하기 위한 운영 기준이다. 기능 목록보다 중요한 기준은 `main`이 항상 배포 가능하고, red test와 docs drift가 새 기능보다 먼저 닫히는 것이다.

## Main Branch Policy

- `main`은 항상 release candidate로 간주한다.
- `main`에 들어가는 변경은 최소한 `bun run typecheck`, `bun run lint`, package tests, smoke tests, public API check, target-boundary check, docs drift check를 통과해야 한다.
- release 또는 publish 전에는 `docs/releases/*-quality-gates.md`에 해당 릴리스에서 확인한 명령과 예외를 남긴다.
- 실패한 게이트가 있으면 merge 대신 fix-forward 또는 revert PR을 우선한다.

## Red Test Policy

- red test가 있는 상태에서는 새 기능 merge를 중단한다.
- 신규 기능 PR이 기존 red test를 발견하면, PR 본문에 원인 분류를 남긴다: product bug, flaky infra, sandbox-only, docs drift.
- product bug와 docs drift는 같은 release train에서 먼저 닫는다.
- sandbox-only 실패는 실제 승인 실행 결과와 재현 조건을 문서화해야 한다.

## Technical Debt Backlog

| Area | Backlog file or source | Current priority |
|---|---|---|
| runtime | `docs/plans/19_code_quality_upgrade_plan.md`, `docs/architect/runtime-server-inventory.md` | shrink server entry, isolate optional feature wiring |
| cli | `docs/guides/golden-path.md`, CLI tests | keep help, scaffold, errors aligned with docs |
| mcp | MCP tool registry tests, `docs/guides/07_agent_workflow.md` | keep tool descriptions non-overlapping and outputs action-oriented |
| edge | `scripts/check-target-boundaries.ts`, `scripts/edge-build-smoke.ts` | prevent Node/Bun/optional peer leaks in edge bundles |
| ate | ATE report tests and summaries | keep quality score and before/after comparison usable by agents |

Each area owner updates the backlog when a TODO becomes user-visible risk, a flaky test is introduced, or a release gate is skipped.

## Quarterly OKR Inputs

Track these every quarter before changing external readiness language:

| Metric | Source |
|---|---|
| Red tests | package test runs and CI |
| Docs drift | `bun run check:docs-drift` |
| Public API drift | `bun run check:public-api` |
| Target boundary leaks | `bun run check:target-boundaries`, `bun run test:edge:build` |
| Performance regression | `.perf/latest/summary.json`, `.perf/latest/budget-check.md` |
| Agent loop quality | ATE `quality.score`, Guard output, MCP activity report |

## External Ready Criteria

Mandu can be described as externally ready only when:

- all release gate commands in `docs/releases/0.10.1-quality-gates.md` are green or have a documented platform-only exception;
- benchmark artifacts are available for SSR latency, route bundle size, HMR, cold start, and zero-JS routes;
- public API changes have release notes and migration notes;
- edge build smoke passes without optional dependency leaks;
- the agent workflow can produce a report with changed files, reasons, Guard/ATE/test results, and next actions.

Until then, public language should say "developer preview" or "v0 quality gate in progress" instead of top-tier or production-ready.
