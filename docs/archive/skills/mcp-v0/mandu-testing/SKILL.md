---
name: mandu-testing
description: |
  Testing patterns for Mandu applications. Use when writing unit tests,
  integration tests, or E2E tests. Triggers on test, spec, Bun test,
  Playwright, or testing tasks.
license: MIT
metadata:
  author: mandu
  version: "1.0.0"
---

# Mandu Testing

Mandu 애플리케이션의 테스트 패턴 가이드. Bun test를 활용한 단위 테스트, slot 테스트, Island 컴포넌트 테스트, Playwright E2E 테스트를 다룹니다.

## Agent Workflow Contract

This skill is a Domain addendum. It must not replace `mandu-agent-workflow`.
Use it only after `mandu.agent.plan` selects testing or `mandu.agent.verify` asks for targeted test coverage.

Canonical workflow step: `verify -> repair`.

Preferred MCP tools:

| Step | Tools |
|------|-------|
| plan | `mandu.agent.plan` |
| verify | `mandu.agent.verify`, `mandu.run.tests`, `mandu.ate.generate`, `mandu.ate.run` |
| repair | `mandu.agent.repair`, `mandu.ate.heal` |

Allowed file edits:

- Co-located `*.test.ts` / `*.test.tsx` files
- `tests/e2e/**/*.spec.ts`
- Test fixtures and mocks scoped to the planned domain

Verification command:

```bash
mandu agent verify --changed --json --write
```

Common failures:

- Running broad watch-mode tests as an agent default
- Adding tests that bypass the route/slot/contract path under change
- Applying ATE healing before reading the verify report

Repair path:

```bash
mandu agent repair --from .mandu/agent-verify.json --json
```

## When to Apply

Reference these guidelines when:
- Writing unit tests for slots
- Testing Island components
- Setting up E2E tests with Playwright
- Mocking external dependencies
- Testing authentication flows

## Rule Categories by Priority

| Priority | Category | Impact | Prefix |
|----------|----------|--------|--------|
| 1 | Slot Testing | HIGH | `test-slot-` |
| 2 | Component Testing | HIGH | `test-component-` |
| 3 | E2E Testing | MEDIUM | `test-e2e-` |
| 4 | Mocking | MEDIUM | `test-mock-` |

## Quick Reference

### 1. Slot Testing (HIGH)

- `test-slot-unit` - Unit test slot handlers
- `test-slot-guard` - Test guard authentication
- `test-slot-integration` - Integration test with database

### 2. Component Testing (HIGH)

- `test-component-island` - Test Island components
- `test-component-render` - Test rendering output
- `test-component-interaction` - Test user interactions

### 3. E2E Testing (MEDIUM)

- `test-e2e-playwright` - Playwright setup and patterns
- `test-e2e-auth` - Test authentication flows
- `test-e2e-navigation` - Test page navigation

### 4. Mocking (MEDIUM)

- `test-mock-fetch` - Mock fetch requests
- `test-mock-database` - Mock database operations

## Low-Level Test Commands

Use these only after `agent plan` or `agent verify` identifies the target:

```bash
mandu agent verify --changed --json --write
bun test src/slots/user.test.ts
bun test --coverage
```

## Test File Convention

```
spec/slots/
├── users.slot.ts
├── users.slot.test.ts    # Slot tests
app/
├── dashboard/
│   ├── client.tsx
│   └── client.test.tsx   # Component tests
tests/
└── e2e/
    └── auth.spec.ts      # E2E tests
```

## How to Use

Read individual rule files for detailed explanations:

```
rules/test-slot-unit.md
rules/test-component-island.md
rules/test-e2e-playwright.md
```
