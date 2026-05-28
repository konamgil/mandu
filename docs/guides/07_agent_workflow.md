# Mandu Agent Workflow

Status: Current  
Audience: AI coding agents, supervisors, and tool authors  
Related: `@mandujs/mcp`, `@mandujs/skills`, Guard, ATE, Kitchen

---

## 0. Goal

Mandu agents should not "just edit files". They should use the installed Mandu MCP tools and Mandu skills when those tools match the task.

The official loop:

```text
classify -> select skill/tool -> inspect -> plan -> change -> guard/contract/test -> report
```

If an MCP tool or skill is unavailable, the agent may fall back to direct file edits, but it must say which official path was unavailable.

---

## 1. Preflight

Before changing files, every agent should do this:

1. Read `AGENTS.md` or the project-specific agent instruction file.
2. Identify the task domain: route, API, contract, slot, island, guard, debug, deploy, release, docs.
3. Check whether a Mandu skill applies.
4. Check whether a Mandu MCP tool applies.
5. Choose the narrowest safe edit path.
6. State the validation commands that will prove the work.

Minimum preflight report:

```text
Task domain:
Selected skill:
Selected MCP tools:
Fallbacks:
Validation:
```

---

## 2. Tool Router

Use this table before editing.

| Task | First choice | Skill | MCP tools | CLI fallback |
|---|---|---|---|---|
| Add page or route | MCP route/scaffold flow | `mandu-fs-routes`, `mandu-create-feature` | `mandu_check_location`, `mandu_add_route`, `mandu_generate_scaffold`, `mandu_validate_manifest` | `bun run mandu -- ...`, then edit `app/` |
| Add API | Contract/API flow | `mandu-create-api`, `mandu-slot` | `mandu_add_route`, `mandu_create_contract`, `mandu_update_route_contract`, `mandu_validate_contracts` | edit `app/api/**/route.ts`, run contract checks |
| Add or modify slot/filling | Slot flow | `mandu-slot` | `mandu_read_slot`, `mandu_write_slot`, `mandu_validate_slot` | edit slot/filling file, run typecheck/tests |
| Fix architecture/import issue | Guard flow | `mandu-guard-guide` | `mandu_guard_check`, `mandu_check_import`, `mandu_check_location`, `mandu_explain_rule` | `bun run mandu -- guard-check` |
| Hydration/island/client boundary issue | Hydration boundary flow | `mandu-hydration` | `mandu.route.boundaries` (`includeBundle: true` after build), `mandu.pageClientMount.list`, `mandu.route.get`, `mandu.hydration.set`, `mandu.build`, `mandu.build.status` | `mandu agent context --json`, `mandu agent manifest --write`, `bun run check:hydration`, `bun run test:hydration-boundary`, `bun run test:hydration-e2e` |
| Runtime/debug failure | Diagnose flow | `mandu-debug` | `mandu_doctor`, `mandu_analyze_error`, `mandu_get_runtime_config` | targeted test + source inspection |
| Deployment | Deploy flow | `mandu-deploy` | runtime/build/deploy tools where available | `bun run build`, target deploy command |
| Test generation | ATE flow | ATE prompts/skills when available | MCP project/route/contract inspection | `bun run test:*`, add focused tests |
| Release | Release flow | release docs | MCP status tools if available | `bun changeset status`, `bun run check:publish` |
| Docs drift | Docs sync flow | documentation skill if available | docs/search tools if available | `bun run check:docs-drift` |

Rule of thumb:

- If the task changes framework structure, use Guard/MCP first.
- If the task changes a contract/API boundary, use Contract/MCP first.
- If the task changes interactive UI or hydration, use Hydration skill/checks first.
- If the task is simple prose or docs, direct edit is fine.

---

## 3. Required Use Cases

### 3.1 Structural Changes

When creating, moving, or deleting files under `app/`, `src/`, `spec/`, or generated Mandu areas:

1. Use `mandu_check_location` if MCP is available.
2. Use the relevant scaffold/add tool if available.
3. Run `mandu_guard_check` or CLI guard fallback.

Do not create new architecture patterns without checking existing conventions.

### 3.2 API and Contract Changes

For API route changes:

1. Inspect existing route/contract shape.
2. Prefer contract tools for schema updates.
3. Keep runtime validation, OpenAPI, tests, and client assumptions aligned.
4. Run contract validation or targeted tests.

### 3.3 Hydration, Island, and Client Boundary Changes

For `*.client.tsx`, `*.island.tsx`, client bundle, or hydration failures:

Official terms:

- `pageClientMount`: route-level `clientModule` hydration for the whole page.
- `clientBoundary`: compiler-discovered nested client component marker recorded on `RouteSpec.boundaries`.
- `partialBoundary`: legacy/runtime partial bundle recorded in `.mandu/manifest.json` `partials`.

Workflow:

1. Use `mandu-hydration` skill.
2. Identify the affected route with `mandu.route.list`, `mandu.route.get`, or `mandu agent context --json`.
3. Inspect compiler-owned route boundary metadata before editing generated code: call `mandu.route.boundaries` with `{ "routeId": "<route-id>" }`.
4. Use `mandu.pageClientMount.list` to separate route-level page client mounts from nested client boundaries and partial boundaries.
5. After a build, use `mandu.route.boundaries` with `{ "routeId": "<route-id>", "includeBundle": true }` when boundary chunk correlation matters.
6. If MCP is unavailable, run `mandu agent context --json` or `mandu agent manifest --write` and inspect `routes[].boundaries` in `.mandu/agent-manifest.json`.
7. Check `module`, `exportName`, `hydrate`, `propsSource`, `propsKeys`, `hasSpreadProps`, and `source` against the intended route/API/contract/slot data flow.
8. Run `bun run test:hydration-boundary` and `bun run test:hydration-e2e` for runtime/router/bundler hydration changes; run `bun run check:publish` before release.
9. Treat `[data-mandu-error]` as a real failure, not a cosmetic issue.

### 3.4 Debugging

For failures:

1. Reproduce the exact symptom.
2. Use `mandu_doctor` or debug skill where available.
3. Read the failing path before broad refactors.
4. Patch the smallest root cause.
5. Add or run the regression gate that would catch it next time.

---

## 4. MCP Profiles

Use the smallest MCP profile that can complete the work.

| Profile | Use |
|---|---|
| `minimal` | read-only inspection, route/architecture discovery |
| `standard` | normal development with guard, contract, route, slot tools |
| `full` | destructive or broad operations, only with explicit supervisor intent |

Recommended default:

```bash
MANDU_MCP_PROFILE=standard bunx mandu-mcp
```

For autonomous agents, start with `minimal` and escalate only when needed.

---

## 5. Skills Protocol

Installed Mandu skills are not passive documentation. They are task routers.

Before doing a matching task, use the matching skill:

| Skill | Use when |
|---|---|
| `mandu-create-api` | Creating or changing API routes |
| `mandu-create-feature` | Creating a feature slice or scaffold |
| `mandu-debug` | Investigating a concrete failure |
| `mandu-deploy` | Preparing production/deploy changes |
| `mandu-explain` | Explaining Mandu concepts or local conventions |
| `mandu-fs-routes` | Working with `app/` routing |
| `mandu-guard-guide` | Fixing or interpreting guard violations |
| `mandu-hydration` | Working with islands/hydration/client bundles |
| `mandu-slot` | Working with slots/filling/data loaders |

If a skill conflicts with current repo code, trust the code and report the drift.

---

## 6. Validation Matrix

Choose validation based on risk.

| Change | Minimum validation |
|---|---|
| Docs only | link/path check, `git diff --check` |
| Config/typing | `bun run typecheck` |
| Guard/routing/contract | targeted tests + `bun run typecheck` |
| Runtime/build/hydration | `bun run test:hydration-boundary`, `bun run test:hydration-e2e`, `bun run typecheck` |
| Agent-generated tests | `mandu.run.tests` or `bun run mandu -- test --reporter=json`; inspect structured failing test summary |
| ATE flow | `mandu.ate.run` -> `mandu.ate.report`; compare `summary.quality.score` before/after when a prior run exists |
| Package/release | `bun changeset status`, `bun run check:publish` |
| Broad package change | `bun run lint`, `bun run typecheck`, `bun run test:packages` |

Agents should state which validation they skipped and why.

---

## 7. Transaction Protocol

Destructive MCP write loops should use the transaction tools when available:

1. `mandu.tx.begin` with a session id.
2. Make the scoped change.
3. Run the matching guard/contract/test gate.
4. `mandu.tx.commit` with the returned `lockId` when validation passes.
5. `mandu.tx.rollback` with the returned `lockId` when validation fails.

Commit and rollback must be rejected when a different active lock is held.

---

## 8. Report Artifact

Agent output should include enough structure for a supervisor or another agent to reproduce the work:

```text
Task domain:
Selected skill:
Selected MCP tools:
Fallbacks:
Changed files and reasons:
Validation run:
Validation skipped:
Next action:
```

For code changes, `mandu agent verify` should record `changedFileReasons` and suggested commands.

For ATE changes, `.mandu/reports/<runId>/summary.json` should include:

```text
quality.score:
quality.grade:
quality.signals:
```

When a previous summary exists, compare scores and include the delta in the activity report or PR comment.

---

## 9. Internal API Boundaries

Agents may edit framework internals only when the task requires it. These paths require extra scrutiny:

- `packages/core/src/runtime/**`
- `packages/core/src/bundler/**`
- `packages/core/src/server/**`
- `packages/core/src/guard/**`
- `packages/core/src/spec/**`
- `packages/core/src/router/**`
- `packages/core/src/internal/**`

When these files change, run:

```bash
bun run check:public-api
bun run check:target-boundaries
```

---

## 10. Anti-Patterns

Avoid these:

1. Editing files first, then asking whether a Mandu tool exists.
2. Creating a route manually when MCP route/scaffold tools are available.
3. Fixing a guard violation by weakening the rule without checking intent.
4. Treating hydration errors as benchmark noise.
5. Adding a new pattern because it is common in another framework.
6. Running broad refactors before reproducing a concrete failure.
7. Reporting success without listing selected tools and validation.

---

## 11. Agent Prompt Block

Use this in project prompts or agent instructions:

```text
You are working in a Mandu project.

Before editing:
1. Read AGENTS.md.
2. Classify the task domain.
3. Use installed Mandu skills when a skill matches the task.
4. Use Mandu MCP tools for route, contract, slot, guard, hydration, build, or diagnosis work when available.
5. If an MCP tool/skill is unavailable, say so and use the closest CLI/source fallback.
6. For island/hydration/client boundary work, inspect `mandu.route.boundaries` first. If MCP is unavailable, use `mandu agent context --json` or `mandu agent manifest --write` and read `routes[].boundaries`.
7. For runtime/router/bundler hydration changes, verify with `bun run test:hydration-boundary`, `bun run test:hydration-e2e`, and `bun run check:publish` before release.

After editing:
1. Run the narrowest validation that proves the change.
2. Report selected skill(s), MCP tool(s), fallback(s), changed files, and validation.
3. Do not claim success if guard/typecheck/test/perf gates were skipped without explanation.
```

---

## 12. Supervisor Checklist

When reviewing an agent's work, ask:

1. Did it identify the task domain?
2. Did it use the relevant Mandu skill?
3. Did it use MCP or explain why not?
4. Did it preserve architecture and contracts?
5. Did it run the right validation?
6. Did it leave a changeset when package behavior changed?

If the answer is no, the issue is not intelligence. The issue is missing workflow discipline.

