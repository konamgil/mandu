# 01) Compiler and Quality Baseline

## tsconfig baseline (production)

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`
- `useUnknownInCatchVariables: true`
- `verbatimModuleSyntax: true`
- `isolatedModules: true`
- `noEmit: true` (for CI/typecheck stage)

## Project policy

- Type-only imports: `import type { X } from '...'`
- Avoid `any`; require explicit justification for unavoidable usage.
- Avoid broad `as` casting; prefer source typing + guards.
- Require explicit public/protected/private on class members when classes are used.

## PR gate

1. `tsc --noEmit`
2. lint pass
3. test pass
4. no unresolved `TODO(any)` in changed files
