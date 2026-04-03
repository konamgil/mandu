# Mandu Demo Index

This index uses three demo labels:

| Label | Meaning | How to use it |
|------|---------|---------------|
| `official` | Current demo aligned with Mandu's active app-based workflow | Safe starting point for users evaluating the framework |
| `experimental` | Useful for feature exploration, internal validation, or contributor workflows | Read the notes before assuming it is a supported reference app |
| `legacy` | Kept for history or comparison with older Mandu workflows | Do not use as the basis for new projects |

The official demo surface is intentionally small until the reference app set is finalized.

---

## Official

### `demo/todo-list-mandu`

The current best demo for Mandu's app-based flow.

- Uses `app/` routing and current `mandu dev` / `mandu build` scripts
- Includes E2E-style automation scripts and test helpers
- Good default demo for validating DX, routing, basic APIs, and UI flow

Run:

```bash
cd demo/todo-list-mandu
bun install
bun run dev
```

Default local URL: `http://localhost:3333`

---

## Experimental

### `demo/ai-chat`

- Explores an AI chat use case
- Uses a mixed structure (`app/` plus `apps/`)
- Useful for contributor experimentation, not yet a reference app

### `demo/ate-integration-test/ate-integration-test`

- Internal verification app for ATE and integration testing
- Useful for framework validation, not positioned as an end-user showcase

### `demo/resource-example`

- Resource-centric add-on workflow example
- Currently documentation/design heavy and not yet a canonical runnable starter
- Treat as exploratory material until the resource workflow is promoted

### `demo/test-app`

- General-purpose internal app for smoke-style checks
- Useful for contributors, but not a polished public-facing reference demo

---

## Legacy

### `demo/island-first`

- Preserves an older manifest/slot-centric workflow
- Contains `spec/routes.manifest.json` and older generation patterns
- Keep for historical comparison only, not for new Mandu projects

---

## Selection Rule

- Use `demo/todo-list-mandu` first if you want to understand current Mandu usage.
- Use `experimental` demos only when you are intentionally validating a feature area.
- Do not point new users to `legacy` demos from official onboarding docs.
