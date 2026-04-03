# Performance Baseline

This directory defines the first fixed contract for Mandu performance tracking.

## Official Metrics

- `ssr_ttfb_p95_ms`
- `hydration_p95_ms`
- `initial_js_bundle_kb`
- `hmr_latency_p95_ms`
- `route_scan_p95_ms`
- `resource_generation_p95_ms`

## Current Status

- `tests/perf/perf-baseline.json` is the source of truth for metric names, scenarios, and budgets.
- Active scenarios are allowed to keep `baseline: null` until the first freeze pass.
- Planned scenarios reserve metric scope for upcoming reference apps so the schema does not drift later.

## Commands

```bash
bun run perf:baseline:check
bun run perf:run
bun run perf:budget:check -- --summary .perf/latest/summary.json
bun run perf:ci
bun run perf:hydration -- http://localhost:3333/ 5 none
```

Optional JSON capture:

```bash
bun run perf:hydration -- http://localhost:3333/ 5 none --json-out tests/perf/latest/todo-list-home-dev.json
```

## Current Rule

- Budgets define the ceiling we do not want to exceed.
- Baselines define the historical number we compare against later.
- CI should start by validating schema and budget files before it blocks on measured regressions.
- Local scenario runs write their artifacts to `.perf/latest/` and do not modify tracked baseline files.
- `perf:budget:check` is soft by default. Add `--enforce` only when you are ready to make budget exceedance blocking.
