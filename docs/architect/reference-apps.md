# Reference Apps

Status: Current

Audience: maintainers, release reviewers, AI agents

Mandu has three stable reference workflows. They are product contracts, not a
gallery: framework changes must preserve their build, Guard, production boot,
and observable HTTP behavior.

| Workflow | Backing app | Contract |
|---|---|---|
| SaaS dashboard | `demo/auth-starter` | dynamic auth pages, anonymous `/dashboard` redirect, sessions/CSRF, production SSR |
| Contract CRUD | `demo/todo-app` | hydrated CRUD UI, Filling APIs, contract/resource artifacts, JSON todo endpoint |
| Interactive realtime | generated `realtime-chat` template | fresh template install, hydrated chat client, health/messages/SSE API surface |

Run the shared gate from the repository root:

```bash
bun install --frozen-lockfile
bun run test:reference-apps
```

For each workflow the gate uses an isolated directory and runs:

```text
stage -> build -> check -> start -> HTTP assertions
```

The realtime workflow is created through the public CLI template path and gets
a fresh third-party dependency install. Workspace demos are copied without
`.env`, databases, generated output, or local reports; local secrets must never
enter the fixture.

## Release Contract

- `bun run test:smoke` owns first-create generation and dev/build/start.
- `bun run test:reference-apps` owns the three real application workflows.
- CI runs both after `bun install --frozen-lockfile` on Linux, Windows, and
  macOS. Test retries are disabled on the stable suites so flakiness is visible.
- `bun run check:product-release` includes the reference gate.
- `ai-chat`, Edge, desktop, and other experiments are Labs/supporting demos;
  they do not define the stable product contract.

Change this document, the gate, and the affected app/template together when a
route or expected response changes.
