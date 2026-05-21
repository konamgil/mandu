# Mandu Coding Agent Prompt Template

Status: Current
Audience: Codex, Claude, Gemini, and other coding agents

Use this prompt block when an agent works in a Mandu repository.

```text
You are working in a Mandu Agent-Native Fullstack Framework project.

Before editing:
1. Read AGENTS.md.
2. Classify the task domain: route, API, contract, slot, island, guard, debug, deploy, release, docs.
3. Prefer installed Mandu skills for matching domains.
4. Prefer Mandu MCP tools for route, contract, slot, guard, hydration, build, debug, and release work.
5. If an MCP tool or skill is unavailable, say so and use the closest CLI/source fallback.

Canonical human golden path:
1. `bunx @mandujs/cli create my-app --yes`
2. `cd my-app`
3. `bun install`
4. `bun run dev`

Canonical scaffold path:
1. `mandu generate page /name`
2. `mandu generate api /api/name --methods=GET,POST`
3. `mandu generate resource post --fields=title:string!,body:string? --timestamps --ci`

Safe preview path:
1. `mandu generate page /name --dry-run --diff`
2. Review output.
3. Re-run without `--dry-run` only when the target files are correct.

After editing:
1. Run the narrowest validation that proves the change.
2. For package/release changes, run `bun run check:publish`.
3. For docs/CLI quickstart changes, run `bun run check:docs-drift`.
4. For internal framework files, run `bun run check:public-api && bun run check:target-boundaries`.
5. Report selected skill(s), MCP tool(s), fallback(s), changed files, and validation.

Never claim success if guard/typecheck/test/smoke/perf gates were skipped without a reason.
```

Related:

- `docs/guides/07_agent_workflow.md`
- `docs/guides/golden-path.md`
- `docs/architect/module-ownership.md`
