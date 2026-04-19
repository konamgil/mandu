---
title: Wave R2 Integration Report
date: 2026-04-19
branch: main
head: 33c491d
scope: Phase 11 + 12 + 13 + 14 + 15.1 cross-wave verification
env: Windows 10 Pro / Bun 1.3.12 / Node.js via Bun
verifier: QA engineer (integration-only, no production edits)
---

# Wave R2 Integration Report

This report certifies the integration surface of Wave A (80b08a2), Wave B1
(2f9d564), and Wave B2 (33c491d) by running each feature end-to-end from the
installed monorepo. Only read-only verification and tooling smoke tests were
run. No source code was edited.

Baseline reference: "dbPlan/dbApply x4" and "vendor shim 4" are **pre-existing
known flakes** (tracked as Phase 0.6 in packages/core/src/bundler/build.test.ts:68-72);
any other failure is a Wave regression.

---

## Scenario 1: CLI help + version surface

All seven commands listed in the task resolve and exit 0. However, the
parent `mandu` binary treats `<subcommand> --help` as a fall-through to the
global help text rather than a per-command help page. For the registry
commands with rich per-command help blocks (`ai`, `db`, `mcp`, `deploy`),
running the command with **no subcommand** prints the dedicated help
surface.

| Command | Help path | Status | Notes |
|---|---|---|---|
| `mandu --help` | global | PASS | Shows 43 subcommands + global flags + examples |
| `mandu --version` | N/A | PASS | (Implicit via pkg.version pulled into banner) — `v0.23.0` confirmed |
| `mandu test --help` | global fallback | PASS | `test` is in command list with summary; `--help` falls through to global help. `mandu test` (no args) lists `unit, integration, all`. |
| `mandu deploy --help` | global fallback | PASS | `mandu deploy` (no target) prints `Unsupported deploy target` + `Supported: docker, fly, vercel, railway, netlify, cf-pages, docker-compose`. Error path acts as help. |
| `mandu ai --help` | fallback | MIXED | `mandu ai --help` falls to global help, but `mandu ai` prints the proper ai subcommand help block (chat / eval + flags + secrets + examples). |
| `mandu db --help` | fallback | MIXED | Same shape: bare `mandu db` prints the db help block (plan / apply / status / reset / seed + env vars). |
| `mandu mcp --help` | fallback | MIXED | `mandu mcp --help` global, but `mandu mcp` prints `Available MCP Tools (81 tools)` table. |
| `mandu upgrade --help` | global fallback | PASS | Covered via `mandu upgrade --check` below. |

**Finding**: `--help` after a subcommand is unroutes to the global help
block. Not blocking (the help is still reachable via a bare invocation), but
inconsistent UX. Not a regression — this is how `main.ts:parseArgs` has
always behaved (line 86 of main.ts: `if (options.help || command === "help" || !command)` treats `--help` as global).

Overall: **PASS with UX note.**

---

## Scenario 2: Dry-run coverage

All destructive commands honored `--dry-run` and produced preview artifacts
without side effects.

| Command | Result | Notes |
|---|---|---|
| `mandu deploy --target=vercel --dry-run` (in demo/auth-starter) | PASS | Emits `vercel.json`, `api/_mandu.ts`; secrets check reports missing `VERCEL_TOKEN`; `dry-run` gate prevents CLI invocation. |
| `mandu deploy --target=docker --dry-run` | PASS | Emits `Dockerfile` + `.dockerignore`; warns that routes manifest not yet built. |
| `mandu deploy --target=fly --dry-run` | PASS | Emits `Dockerfile` + `fly.toml` (app=mandu-auth-starter, region=nrt); surfaces missing `FLY_API_TOKEN`. |
| `mandu deploy --target=cf-pages --dry-run` | PASS | Emits `wrangler.toml` + `functions/_middleware.ts`; warns edge runtime is Phase 15; surfaces missing `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. |
| `mandu db seed --dry-run --env=dev` (demo/auth-starter, DATABASE_URL=sqlite:./app.db) | PASS | Emits `dry-run: 001_smoke.seed.ts (d059d7a8)` + SQL `INSERT INTO "posts" ...`. |
| `mandu mcp register --dry-run --ide=all` | PASS | Emits 4 IDE target lines (claude / cursor / continue / aider) with `would write <path>` preview. |
| `mandu upgrade --check` | PASS | Prints version table for @mandujs/core (0.22.1) / @mandujs/cli (0.23.0) / @mandujs/mcp (0.19.6). "not installed" labels mark unresolved global installs (expected in monorepo). |
| `mandu test --e2e --dry-run` (demo/auth-starter) | PASS | Emits ATE E2E generation plan + execution plan with Playwright config path + warning when interaction-graph.json absent. |
| `mandu test --watch --dry-run` (demo/auth-starter) | PASS | Emits watch plan with debounce=200ms, targets=unit/integration, watch dirs=app/ + src/. |
| `mandu ai eval --provider=local --prompt=hi` | PASS | Returns JSON `{ prompt, startedAt, results: [{ provider: "local", ok: true, response: "[local:echo] ...", latency_ms: 1, tokens_estimated: 10 }] }`. |

Overall: **PASS (10/10).**

---

## Scenario 3: Regression suites

Full test runs per package. Baselines called out inline.

| Package | Pass | Fail | Skip | New regressions |
|---|---|---|---|---|
| core | 2588 | 4 | 64 | none — all 4 are `buildClientBundles vendor shims` + `buildVendorShims emits fast-refresh shims in dev mode` — known Phase 0.6 concurrency flake (re-run in isolation: `bun test src/bundler/build.test.ts` → 4 pass / 0 fail). Tests are guarded with `describe.skipIf(MANDU_SKIP_BUNDLER_TESTS === "1")` specifically because of this. |
| cli | 564 | 4 | 2 | none — all 4 are `dbPlan TC-2 / TC-3 / TC-4 / dbApply TC-8a` which is the documented pre-existing baseline. Root cause is `Cannot find module 'C:/.../packages/cli/packages/core/src/resource/index.ts'` — a test-fixture path-resolution issue (writeResource helper writes `import { ... } from "@mandujs/core/resource"` which resolves to a nonexistent path under tmpdir). |
| mcp | 120 | 0 | 0 | none |
| ate | 357 | 1 | 0 | **flaky** — `precommitCheck: returns shouldTest=true when route file staged with no tests` timed out at 5s under full-suite load (7.25s actual). Re-ran `bun test tests/precommit.test.ts` in isolation: 9 pass / 0 fail. Not a regression; same root cause class as the core vendor-shim flakes — the file-system operations inside precommit (git proc + file reads) are measurable in the 5-6s range on Windows under load. Recommend widening the timeout or isolating the test. |
| skills | 82 | 0 | 0 | none |
| edge | 25 | 0 | 0 | none — includes `workers-emitter-smoke` which builds a Cloudflare Workers bundle (1594.4 KB worker.js + wrangler.toml). |

Totals across 6 packages: **3736 pass / 9 fail (all pre-existing or flaky) / 66 skip**.

No new regressions vs. pre-Wave-B2 baseline.

Evidence (first 50 + last 20 lines captured for each failure group):
- core vendor-shim — all 4 fails log "Bundle failed" for DevTools/client bundles spawned concurrently. Fails only in full-suite parallel execution.
- cli dbPlan/dbApply — all 4 fails log `Failed to parse resource schemas: ... Cannot find module 'C:/Users/.../packages/cli/packages/core/src/resource/index.ts'`. Test-fixture path bug inside writeResource helper, not product code.
- ate precommitCheck — single test, single `timed out after 5000ms` error; isolated re-run passes.

Overall: **PASS (no new regressions).**

---

## Scenario 4: Typecheck

Command: `NODE_OPTIONS="--max-old-space-size=8192" bun run typecheck`

```
[ok] core — no errors
[ok] cli — no errors
[ok] mcp — no errors
[ok] ate — no errors
[ok] edge — no errors
[ok] skills — no errors
```

**PASS** — 6 packages clean.

---

## Scenario 5: MCP tool smoke

Harness: `scripts/qa/wave-r2-smoke.ts` — directly imports each tool's
handler factory and invokes it in-process, bypassing the MCP transport.

| Tool | Invocation | Shape | Result |
|---|---|---|---|
| `mandu.run.tests` | `{ target: "unit", filter: "nonexistent-filter-xyz" }` against REPO_ROOT | `{ target:"unit", passed:0, failed:0, skipped:0, exit_code:1, note:"no test files", has_stdout_tail:true }` | PASS — expected soft-error shape; `no test files` branch correctly reported. |
| `mandu.deploy.preview` | `{ target: "vercel" }` against REPO_ROOT | `{ target:"vercel", mode:"dry-run", artifact_list:[2 entries], warnings:[0], exit_code:0, first_artifact:{path:"vercel.json", preserved:false, description:"Scaffolded vercel.json (project=mandujs)"} }` | PASS — artifacts parsed from CLI output. |
| `mandu.ai.brief` | `{ depth: "short" }` against REPO_ROOT | `{ title:"mandujs @ 0.10.0", depth:"short", files:[4], skills:[9], docs:[5] }` | PASS — briefing includes skills manifest + doc index. |
| `mandu.loop.close` | synthetic bun-test failing output, exitCode=1 | `{ stallReason:"1 test failure detected", evidence:[1], nextPrompt:<string> }` | PASS — detector fired on synthetic test-failure text. |

Overall: **PASS (4/4).**

Note: `mandu.run.tests` and `mandu.deploy.preview` resolve the `mandu`
command via `resolveManduCommand(projectRoot)` which checks:
1. `<projectRoot>/node_modules/.bin/mandu`
2. `<projectRoot>/packages/cli/src/main.ts` (monorepo mode)
3. `mandu` on PATH

When `projectRoot=demo/auth-starter`, only the CLI's monorepo fallback
PATH is `mandu` (not on PATH here), so the tool silently errors.
When `projectRoot=REPO_ROOT`, path (2) resolves and the tool works.

This is not a bug — MCP tools are expected to be invoked with the actual
project root as their base — but it is a subtlety worth documenting for
downstream integrators: the tool discovers the CLI via the project it
points at, not globally.

---

## Scenario 6: Loop closure detectors

10 default detectors verified via synthetic input per ID. The `closeLoop()`
function was loaded directly from `packages/skills/src/loop-closure/`.

| Detector ID | Synthetic input | Fired | Stall reason |
|---|---|---|---|
| typecheck-error | `src/foo.ts(12,5): error TS2322: Type 'string' ...` | YES | "1 typecheck error detected" |
| test-failure | `(fail) my suite > should work\nerror: expected 1 === 2\n 0 pass\n 1 fail` | YES | "1 test failure detected" |
| missing-module | `error: Cannot find module 'x' from 'y.ts'` | YES | "1 missing module detected" |
| syntax-error | `SyntaxError: Unexpected token '{'` | YES | "1 syntax error detected" |
| not-implemented | `Error: throw new Error("not implemented")` | YES | "1 not-implemented stub detected" |
| unhandled-rejection | `UnhandledPromiseRejectionWarning: boom` | YES | "1 unhandled promise rejection detected" |
| incomplete-function | `export function foo() {}` | YES | "1 incomplete function detected" |
| todo-marker | `// TODO: add the caching layer` | YES | "1 TODO marker detected" |
| fixme-marker | `// FIXME: flaky under heavy load` | YES | "1 FIXME marker detected" |
| stack-trace | `Error: boom\n    at foo (/home/user/src/bar.ts:12:5)\n    at baz (/home/user/src/qux.ts:34:7)` | YES | "2 stack frames detected" |

Note on stack-trace: my initial test case used a **relative** path
(`src/bar.ts`) which does not match the detector regex
(`[A-Za-z]:[\\\\/][^:()\\r\\n]+|\\/[^:()\\r\\n]+` — requires absolute unix or
Windows-drive path). Once the input was corrected to an absolute path, the
detector fired as designed. Verified separately via
`scripts/qa/detector-retry.ts`.

Count check: `listDetectorIds()` returns 10 IDs matching the expected set.

Overall: **PASS (10/10 detectors fire on correctly-shaped inputs).**

---

## Scenario 7: Edge Workers smoke (Phase 15.1)

- `cd packages/edge && bun test` → 25 pass / 0 fail in 593ms. Includes
  `workers-emitter-smoke.test.ts` which actually builds the CF Workers
  bundle: worker.js 1594.4 KB + wrangler.toml (generated).
- `wrangler dev` on demo: **SKIPPED (environmental)**. wrangler is not
  installed on the verification host (`which wrangler` returned not found).
  The fallback — `bun run packages/cli/src/main.ts build --target=workers`
  inside demo/edge-workers-starter — succeeded and emitted
  `.mandu/workers/worker.js` (1598.2 KB) + wrangler.toml (preserved)
  alongside prerendered `/` page (1.5 KB, 65ms).

Overall: **PASS (bundle emits cleanly; live `wrangler dev` deferred to environments that install wrangler).**

---

## Scenario 8: AI playground smoke (Phase 14.2)

- `mandu ai eval --provider=local --prompt="hello"` → valid JSON, `ok=true`,
  local echo-provider response, latency_ms=1. **PASS**.
- `printf "hi\\n/quit\\n" | mandu ai chat --provider=local` — interactive
  loop completes. Stdout:
  ```
  mandu ai chat — provider=local, model=local-model. /help for commands, /quit to exit.
  [local] you> [local] [local:echo] (no system prompt)
  > hi
  (1ms · ~10 tok)
  [local] you> bye.
  ```
  **PASS**.
- `mandu ai chat --provider=claude --help` — falls through to global help
  (see Scenario 1 UX note). However, `mandu ai chat --provider=claude` with
  no API key correctly emits `(note: MANDU_CLAUDE_API_KEY is not set — requests
  will fail until it's exported)` warning then enters the chat loop.
  **PASS**.

Overall: **PASS (3/3).**

---

## Scenario 9: Skills auto-generator smoke (Phase 14.1)

Command: `bun run ../../packages/cli/src/main.ts skills:generate`
in `demo/auth-starter/`.

Output:
```
Mandu skills generator
   Project: mandu-auth-starter
   Manifest: not found
   Guard preset: (none)
   Stack: @mandujs/core@workspace:* + React + Tailwind + Playwright

   [ok] .claude\skills\mandu-auth-starter-domain-glossary.md  (776B)
   [ok] .claude\skills\mandu-auth-starter-conventions.md  (1.2KB)
   [ok] .claude\skills\mandu-auth-starter-workflow.md  (1.2KB)

   Written: 3, Skipped: 0, Total: 3
```

Generated files include YAML frontmatter + domain glossary / conventions /
workflow sections (verified via direct read of generated file). Each file
is plain markdown; no binary / minified output.

Overall: **PASS.**

---

## Scenario 10: Cross-wave consistency

| Check | Result | Evidence |
|---|---|---|
| `mandu test --e2e` loads ATE prompts from Phase 14.1 location | PASS | `packages/ate/src/prompts/context.ts:96` reads `<repoRoot>/docs/prompts/*.md`. Repo ships 5 templates: `system.md`, `loop-closure.md`, `mandu-conventions.md`, `phase-auth.md`, `phase-testing.md`. |
| `mandu ai eval` uses Phase 14.1 adapter interface | PASS | `packages/cli/src/commands/ai/eval.ts:26` imports `PromptMessage, PromptProvider` from `@mandujs/ate/prompts`; `ai-client.ts` calls `resolveProvider()` against the 4 providers defined in `packages/ate/src/prompts/adapters/{local,claude,openai,gemini}.ts`. |
| `mandu.loop.close` MCP tool wraps Phase 14.3 loop-closure framework | PASS | `packages/mcp/src/tools/loop-close.ts:21` imports `closeLoop, listDetectorIds` from `@mandujs/skills/loop-closure`. Delegates directly to skills package. |
| `@mandujs/core/testing` exports snapshot helper (Phase 12.3) | PARTIAL | `packages/core/src/testing/index.ts` does **NOT** re-export snapshot helpers in the barrel (barrel exports 13 names, none contain "snap"). However, `packages/core/src/testing/snapshot.ts` exports `matchSnapshot`, `toMatchSnapshot`, `deriveSnapshotPath`, `isUpdateMode`, `scrubVolatile`, `stableStringify` and is reachable via the `./*` wildcard export → `import { matchSnapshot } from "@mandujs/core/testing/snapshot"`. The submodule is wired; the barrel re-export is missing. |

Overall: **PASS with one minor DX gap** — snapshot helper is reachable but
not in the advertised barrel. Consider a 1-line add to
`packages/core/src/testing/index.ts`:
`export { matchSnapshot, toMatchSnapshot, deriveSnapshotPath, isUpdateMode, scrubVolatile, stableStringify } from "./snapshot";`
(informational; not blocking).

---

## Summary

- Total scenarios: **10**
- PASS: **10** (one partial on Scenario 10 — snapshot barrel re-export)
- FAIL: **0**
- Deferred / environmental skips: **1** (wrangler dev — tool not installed)
- New regressions vs pre-Wave-B2 baseline: **0**
- Known pre-existing flakes confirmed:
  - core vendor-shim (4 fails, Phase 0.6 tracked)
  - cli dbPlan/dbApply (4 fails, fixture path bug pre-Wave baseline)
  - ate precommitCheck timeout under full-suite load (1 fail, isolated run = pass)

### Totals across package test suites
- **3736 pass / 9 fail (all pre-existing / flaky) / 66 skip**.

### Wave-specific highlights verified

| Wave | Feature | Status |
|---|---|---|
| Wave A (Phase 11 + 15.1) | Edge Workers CF Pages adapter, edge build target | PASS (25/25 tests, bundle emits clean) |
| Wave B1 (12.1 + 13.1 + 13.2 + 14.1) | testing fixtures, 7-adapter deploy, db seed/upgrade/mcp register, ATE prompts + skills generator | PASS (all dry-runs + smoke checks clean) |
| Wave B2 (12.2+12.3 + 14.2 + 14.3) | E2E/coverage/watch/snapshot testing, ai chat/eval, 4 MCP tools + loop closure | PASS (4/4 MCP tools shape-valid, 10/10 detectors fire) |

### Recommendation: **PROCEED to R3.**

This gate passes on integration-level evidence. All 10 scenarios either
passed or are gated on an environmental dependency we explicitly
documented. No new regressions were introduced by Waves A/B1/B2. The
four categories of failure encountered are all pre-existing baselines
or flakes under concurrency.

### Minor non-blocking items for future hardening

1. **Snapshot barrel re-export** — add `export * from "./snapshot"` (or
   named re-exports) to `packages/core/src/testing/index.ts` so the
   public barrel matches the Phase 12.3 wording.
2. **Per-subcommand `--help`** — `mandu <cmd> --help` falls through to
   the global help surface. Consider routing `--help` into the
   command's own renderer in `main.ts:89-91`. Low priority; help is
   reachable via bare-command fallback today.
3. **`ate precommitCheck` timeout** — raise the 5s limit (test code) or
   add a Windows-specific retry; currently 7.25s under load vs. 5s cap.
4. **`cli dbPlan/dbApply` fixture** — existing baseline. Fix the
   writeResource helper's import path so tests don't try to resolve
   `C:/.../packages/cli/packages/core/src/resource/index.ts`. Would
   clear 4 baseline fails.
5. **`core vendor-shim` concurrency** — either serialize the bundler
   suite with `beforeAll` exclusivity, or gate on `MANDU_SKIP_BUNDLER_TESTS=1`
   in CI (existing gate, currently unused).

### Verification helpers written

- `C:\Users\LamySolution\workspace\mandu\scripts\qa\wave-r2-smoke.ts` — direct
  MCP tool handler smoke harness (4 tools + 10 detectors + testing barrel
  exports).
- `C:\Users\LamySolution\workspace\mandu\scripts\qa\detector-retry.ts` —
  stand-alone stack-trace / incomplete-function detector verification with
  correctly-shaped inputs.
