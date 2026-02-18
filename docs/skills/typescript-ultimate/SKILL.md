---
name: typescript-ultimate
description: End-to-end TypeScript engineering skill for designing, implementing, reviewing, and refactoring production-grade TS codebases. Use when tasks involve TypeScript architecture, advanced typing, strict safety, API/schema typing, React/Node/Nest/Express/Fastify patterns, testing, linting, migration, or code review in .ts/.tsx projects.
---

# TypeScript Ultimate

Execute TypeScript work with maximum safety, clarity, and maintainability.

## Workflow

1. Identify context first
   - Determine runtime: Node / Browser / React / Next / Nest / Express / Fastify / Deno / RN.
   - Determine strictness target: incremental vs strict-by-default.
   - Determine risk class: API contract, persistence, auth, payments, migrations are high-risk.

2. Lock quality baseline before coding
   - Apply strict compiler profile from `references/01-compiler-and-quality-baseline.md`.
   - Apply lint and ordering rules from `references/07-code-review-and-standards.md`.
   - Define typed boundaries for IO and external systems.

3. Model domain types first
   - Design discriminated unions for state and protocol variants.
   - Use utility/mapped/conditional/template-literal types where they reduce duplication.
   - Keep types readable; split deeply complex helpers into named aliases.

4. Implement with type-safe boundaries
   - Parse unknown inputs to validated domain types.
   - Keep `any` out of core paths.
   - Encode API request/response contracts in types.

5. Verify behavior + type contracts
   - Add runtime tests + type tests (`tsc --noEmit`, or expect-type style checks).
   - Add edge-case checks for nullability, narrowing, and exhaustive handling.

6. Review against production checklist
   - Use `references/07-code-review-and-standards.md` review rubric.
   - Prefer smallest safe change that improves type confidence.

## Mandatory Rules

- Prefer `unknown` over `any`.
- Prefer narrowing/type guards over assertions (`as`).
- Use discriminated unions for state machines and branching models.
- Keep imports organized and type-only imports explicit (`import type`).
- Use `const` by default; avoid mutation when practical.
- Use exhaustive checks (`never`) for union switches.
- Keep compiler+lint green before completion.

## Reference Map

- Compiler/strict baseline: `references/01-compiler-and-quality-baseline.md`
- Type system patterns: `references/02-advanced-type-system.md`
- API/schema/contracts: `references/03-api-and-schema-typing.md`
- Framework-specific patterns: `references/04-framework-playbooks.md`
- Data/persistence/runtime boundaries: `references/05-data-and-runtime-boundaries.md`
- Testing strategy: `references/06-testing-types-and-behavior.md`
- Code review standards: `references/07-code-review-and-standards.md`
- Source corpus index (downloaded posts): `references/source-corpus-index.md`

## Execution Guidance

- For small fixes: apply minimal patch + enforce local invariants.
- For medium changes: establish/repair types first, then implementation.
- For large migrations: convert module-by-module, maintain compatibility adapters, and increase strictness in stages.
- If runtime/library constraints conflict with strict typing, document trade-offs and isolate unsafe edges.
