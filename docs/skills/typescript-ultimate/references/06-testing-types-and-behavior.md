# 06) Testing Types and Behavior

## Minimum quality set

1. Typecheck (`tsc --noEmit`)
2. Runtime unit/integration tests
3. API contract tests (request/response typing + validation behavior)
4. E2E tests for critical flows

## Type testing techniques

- Compile-time assertions for expected inference.
- Exhaustiveness tests for union branches.
- Negative tests for invalid assignments (expect compile failure).

## Runtime testing focus

- Boundary parsing failures
- Null/undefined edge cases
- Serialization round-trips
- Backward compatibility in migrated modules

## Refactor safety

- Snapshot only for stable structural outputs.
- Prefer semantic assertions over broad snapshots.
- Keep typed test factories to reduce fixture drift.
