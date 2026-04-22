---
"@mandujs/core": minor
"@mandujs/ate": minor
"@mandujs/mcp": minor
---

feat(ate,mcp): stream run events to eventBus — activity monitor sees ATE flow

ATE runner now emits six structured events per `mandu.ate.run`
invocation (`run_start`, `spec_progress`, `spec_done`,
`failure_captured`, `artifact_saved`, `run_end`) on the
`@mandujs/core/observability` singleton eventBus. Activity monitor
subscribes to `type: "ate"` and renders per-spec pass/fail lines,
`failure.v1` kind summaries, and artifact directory paths in pretty
mode; JSON mode streams each event verbatim to
`.mandu/mcp-activity.jsonl` for agent consumption.

Eliminates the black-box problem where `mandu.ate.run` looked like a
single opaque tool call in the monitor — agents and humans can now see
which spec is running, which failed, what kind of failure (selector
drift / contract mismatch / hydration timeout / ...), and where the
`trace.zip` landed.

Also resolves #238 end-to-end:

- `mandu.ate.run` / `mandu_ate_run` MCP handlers pipe `spec_done`
  events through `notifications/progress` so long runs no longer look
  hung. Accepts an optional `progressToken` from the client;
  gracefully falls back to the ATE `runId` when unset.
- Timeout / cancel paths now persist a partial `results.json` under
  `.mandu/reports/run-<runId>/` (completed specs + captured failures +
  runId) so `mandu.ate.heal` stays reachable even when Playwright hit
  the 10-min watchdog.

Core changes:

- `EventType` union gains `"ate"` as a first-class category so
  observability consumers (SQLite store, Prometheus exporters) can
  scope queries.

ATE changes:

- `runSpec()` emits the canonical six-event lifecycle.
- `artifact-store`'s `writeTextArtifact` / `stageArtifact` emit
  `artifact_saved` on each write.
- New `AteMonitorEvent` discriminated union exported from
  `@mandujs/ate`.
- New `emitAteEvent` + typed wrappers (`emitRunStart`, ...) exported
  for downstream emitters.

MCP changes:

- `ActivityMonitor` subscribes to `eventBus.on("ate")`, renders pretty
  rows (start / per-spec pass-fail / end + inlined failure kind) and
  emits verbatim JSON lines to `activity.jsonl`.
- New `ATE-RUN` / `ATE-PASS` / `ATE-FAIL` display tokens in
  `TOOL_ICONS`.
- `ateRunTools` / `ateTools` accept an optional `Server` instance so
  `notifications/progress` flow through the MCP transport; tests that
  boot without a server gracefully no-op.
- New `createAteProgressTracker` + `writePartialResults` exports for
  downstream reuse and testing.

No new runtime dependencies. Typecheck clean across all 7 packages.
18 new tests (ate: 5, mcp activity-monitor: 3, mcp progress: 5, plus
existing regression coverage).
