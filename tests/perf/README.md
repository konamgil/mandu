# Performance Baseline

This directory defines the first fixed contract for Mandu performance tracking.

## Official Metrics

- `ssr_ttfb_p95_ms`
- `hydration_p95_ms`
- `initial_js_bundle_kb`
- `cold_start_p95_ms`
- `streaming_ssr_ttfb_p95_ms`
- `hmr_latency_p95_ms`
- `route_scan_p95_ms`
- `resource_generation_p95_ms`

## Current Status

- `tests/perf/perf-baseline.json` is the source of truth for metric names, scenarios, and budgets.
- Active scenarios point at real reference demos: `demo/todo-app` and `demo/starter`.
- HTTP, route-scan, resource-generation, and initial-JS baselines are frozen for the active scenarios that can measure them locally.
- `hydration_p95_ms` baselines are fixed from the latest local browser run. If browser launch is unavailable, the run leaves a `browser-error.txt` artifact and the active scenario fails measurement validity instead of treating a missing sample as a pass.
- Every scenario that measures initial JavaScript or hydration declares whether that signal is required or intentionally absent. A zero value is valid only for an explicit `zero`/`none` expectation backed by asset and island evidence.
- Manual scenarios are runnable by id for host-sensitive checks such as HMR; they are excluded from default `perf:ci`.

## Freeze Snapshot

Last freeze: 2026-05-01, local Windows run.

Command:

```bash
bun run perf:run -- --runs 3 --warmup 1
```

Frozen active baselines:

| Scenario | Metric | Baseline | Notes |
|---|---|---:|---|
| `todo-app-home-dev` | `ssr_ttfb_p95_ms` | 74.5 | HTTP metric |
| `todo-app-home-dev` | `initial_js_bundle_kb` | 1124.4 | Dev bundle includes unminified dev/HMR payload |
| `todo-app-home-prod` | `ssr_ttfb_p95_ms` | 2.2 | HTTP metric |
| `todo-app-home-prod` | `initial_js_bundle_kb` | 0.0 | Home route ships no initial JS in prod; budget is fixed at `0 KB` |
| `hello-ssr-home` | `ssr_ttfb_p95_ms` | 2.0 | `demo/starter` promoted as hello SSR reference |
| `hello-ssr-home` | `initial_js_bundle_kb` | 1043.7 | Starter currently ships framework/client payload |
| `blog-crud-contract-list` | `ssr_ttfb_p95_ms` | 1.7 | `demo/todo-app` CRUD page |
| `blog-crud-contract-list` | `initial_js_bundle_kb` | 1041.9 | CRUD page client payload |
| `blog-crud-contract-list` | `route_scan_p95_ms` | 35.1 | FS route scan + manifest write path |
| `blog-crud-contract-list` | `resource_generation_p95_ms` | 168.1 | Resource artifacts only; slots are not overwritten |
| `auth-starter-hmr-island` | `hmr_latency_p95_ms` | 24.2 | Manual `perf:expanded` gate |
| `auth-starter-cold-start` | `cold_start_p95_ms` | 547.0 | Manual `perf:expanded` gate; host-sensitive process spawn timing |
| `streaming-ssr-async-shell` | `streaming_ssr_ttfb_p95_ms` | 5.0 | Manual `perf:expanded` gate; synthetic async Suspense shell |
| `todo-app-home-dev` | `hydration_p95_ms` | 0.0 | No islands hydrated on this route |
| `todo-app-home-prod` | `hydration_p95_ms` | 0.0 | Zero-JS route, no islands hydrated |
| `hello-ssr-home` | `hydration_p95_ms` | 10.9 | Local Windows browser run on 2026-05-21 |
| `blog-crud-contract-list` | `hydration_p95_ms` | 11.3 | Local Windows browser run on 2026-05-21 |

## Commands

```bash
bun run perf:baseline:check
bun run perf:run
bun run perf:budget:check -- --summary .perf/latest/summary.json
bun run perf:ci
bun run perf:expanded
bun run perf:streaming
bun run perf:hydration -- http://localhost:3333/ 5 none
```

Optional JSON capture:

```bash
bun run perf:hydration -- http://localhost:3333/ 5 none --json-out tests/perf/latest/todo-list-home-dev.json
```

## Current Rule

- Budgets define the ceiling we do not want to exceed.
- Baselines define the historical number we compare against later.
- CI validates schema, runs active scenarios, writes measured artifacts, and enforces any `fail` verdict in `.perf/latest/summary.json`.
- Any measured value more than 10% above a non-zero baseline is marked `warn` before budget enforcement runs, so PRs get an annotation without turning host-noisy latency samples into hard failures.
- `perf:expanded` runs manual scenarios that are valuable but host-sensitive, including HMR island latency, dev-server cold start, and the synthetic streaming SSR shell benchmark.
- Local scenario runs write their artifacts to `.perf/latest/` and do not modify tracked baseline files.
- `perf:budget:check` is soft by default for local triage. `perf:ci` and `perf:expanded` pass `--enforce`.
- Perf runs set `MANDU_LOCK_BYPASS=1` for spawned demo servers so stale local `.mandu/lockfile.json` files do not block measurement of rendering performance.
- Browser launch failure is cached per `perf:run`; after the first failure, later hydration attempts stop immediately with matching artifacts. Active scenarios then fail the missing-evidence validity gate.

## Updating Baselines

Baseline changes should be isolated from unrelated runtime or bundler changes.

1. Run `bun run perf:baseline:check`.
2. Run `bun run perf:run -- --runs 3 --warmup 1`.
3. Inspect `.perf/latest/report.md`, `.perf/latest/summary.json`, and any `browser-error.txt`.
4. Update only active scenario baseline values that were actually measured.
5. Leave unsupported browser metrics as `baseline: null` and document the reason.
6. Run `bun run perf:ci` before opening or merging the change.

Do not relax a budget in the same change as a runtime performance regression unless the PR explicitly documents why the ceiling changed.
