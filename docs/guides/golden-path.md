# Mandu Golden Path

Status: Current
Audience: users, contributors, AI agents

This is the canonical first-run path. README, CLI help, smoke tests, and agent workflow docs should stay aligned with this sequence.

```bash
bunx @mandujs/cli create my-app --yes
cd my-app
bun install
bun run dev
```

Open `http://localhost:3333`.

## Extend The App

```bash
bun run mandu -- generate page /golden-smoke
bun run mandu -- generate api /api/golden-smoke --methods=GET,POST
bun run mandu -- generate resource post --fields=title:string!,body:string? --timestamps --ci
```

Expected artifacts:

- `app/golden-smoke/page.tsx`
- `app/api/golden-smoke/route.ts`
- `spec/resources/post.resource.ts`
- `.mandu/generated/server/contracts/post.contract.ts`
- `spec/slots/post.slot.ts`

## Verify

```bash
bun run typecheck
bun run check:docs-drift
bun run test:smoke
bun run test:reference-apps
```

Reference app coverage is defined in [`docs/architect/reference-apps.md`](../architect/reference-apps.md).

For release work, use:

```bash
bun run lint
bun run check:public-api
bun run check:target-boundaries
bun run test:edge:build
bun run check:publish
```

## Drift Rule

If a command changes here, update all of these in the same PR:

- root README files
- `docs/README.*`
- `packages/cli/README.*`
- `packages/cli/src/commands/registry.ts`
- `scripts/smoke.ts`
- `scripts/reference-app-gate.ts`
- `scripts/check-docs-drift.ts`
