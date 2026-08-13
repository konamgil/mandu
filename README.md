<p align="center">
  <img src="https://raw.githubusercontent.com/konamgil/mandu/main/mandu_only_simbol.png" alt="Mandu logo" width="160" />
</p>

<h1 align="center">Mandu</h1>

<p align="center">
  <strong>The agent-safe fullstack framework for Bun and React.</strong><br/>
  Keep architecture, contracts, and build state safe while AI agents change code.
</p>

<p align="center">
  <a href="https://mandujs.com">Website</a> |
  <a href="https://mandujs.com/docs">Docs</a> |
  <a href="./README.ko.md">한국어</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@mandujs/core"><img src="https://img.shields.io/npm/v/@mandujs/core?label=core" alt="npm core version" /></a>
  <a href="https://www.npmjs.com/package/@mandujs/cli"><img src="https://img.shields.io/npm/v/@mandujs/cli?label=cli" alt="npm cli version" /></a>
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun runtime" />
  <img src="https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/license-MPL--2.0-blue" alt="MPL-2.0 license" />
</p>

---

> **Refoundation status:** Mandu v0.x is an early beta. The Agent-Safe product contract is the accepted v1 direction; typed apply and the full reliability gates are still being implemented. See the [strategy](./docs/product/03_agent_safe_refoundation_strategy.md) and [execution plan](./docs/plans/22_mandu_refoundation_execution_plan.md).

## Why Mandu?

AI can write code fast. The hard part is keeping the app understandable after many changes.

Mandu combines a focused fullstack runtime with contracts, architecture guardrails, and a controlled agent workflow so people and agents can change code without losing a valid project state.

| You want | Mandu gives you |
|----------|-----------------|
| A fullstack React app | File-based pages and API routes |
| Less client JavaScript | Island hydration and server rendering |
| Safer API changes | Zod contracts, typed handlers, and OpenAPI output |
| Cleaner AI-generated code | Guard rules, MCP tools, and Mandu-aware skills |
| A fast local workflow | Bun-native dev, build, and test commands |

The short version: Mandu is for developers who delegate real changes to AI agents but still own architecture and release quality.

## Start in One Minute

```bash
bunx @mandujs/cli create my-app --yes
cd my-app
bun install
bun run dev
```

Open `http://localhost:3333`.

Want the realtime chat starter?

```bash
bunx @mandujs/cli create my-chat --template realtime-chat --yes
```

Prefer installing a reusable `mandu` command first?

```bash
# Linux / macOS
curl -fsSL https://raw.githubusercontent.com/konamgil/mandu/main/install.sh | sh

# Windows PowerShell
iwr https://raw.githubusercontent.com/konamgil/mandu/main/install.ps1 -useb | iex
```

Then run `mandu create my-app --yes`.

## Make a Page

Create `app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main>
      <h1>Hello from Mandu</h1>
      <p>Edit this file and the page updates instantly.</p>
    </main>
  );
}
```

## Make an API Route

Create `app/api/hello/route.ts`:

```ts
export function GET() {
  return Response.json({ message: "Hello from Mandu" });
}
```

Visit `http://localhost:3333/api/hello`.

## Project Shape

```text
my-app/
|-- app/          # Pages, layouts, and API routes
|-- src/
|   |-- client/  # Browser-side code
|   |-- server/  # Server-side code
|   `-- shared/  # Contracts, types, and shared utilities
|-- spec/         # Contracts, slots, and architecture metadata
`-- .mandu/       # Generated output
```

You can start simple with just `app/`. Add contracts, slots, and guard rules when the app grows.

## Built for Agents

Mandu is designed for codebases that AI agents will actively edit.

- The CLI can scaffold routes, APIs, contracts, and project structure.
- Guard rules catch architecture drift before it spreads.
- MCP tools and Mandu skills give agents project-aware actions instead of blind text edits.
- Release checks help keep generated code reviewable.

For the full agent workflow, read [Mandu Agent Workflow](./docs/guides/07_agent_workflow.md).

## Learn More

- [Agent-Safe Product Strategy](./docs/product/03_agent_safe_refoundation_strategy.md)
- [Documentation](https://mandujs.com/docs)
- [Local docs index](./docs/README.md)
- [CLI reference](./packages/cli/README.md)
- [Core package](./packages/core/README.md)
- [Install guide](./docs/install.md)

## Requirements

- Bun `>= 1.3.12`
- TypeScript
- React 19

## License

Mandu is licensed under [MPL-2.0](./LICENSE).
