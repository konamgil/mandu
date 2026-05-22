# F42 Auto Client Boundary Transform Plan

Last updated: 2026-05-23

## Status

| Area | Status | Notes |
| --- | --- | --- |
| F39 route data hydration hardening | Done | Related issue: #309 |
| F40 hydration/release guard hardening | Done | Related issue: #310 |
| F41 inline client props SSR capture | Done | Related issue: #311 |
| F42 compiler-owned client boundary | Done | Direct, route-owned server-wrapper, production/prerender SSR import, streaming SSR, route manifest, boundary bundles, duplicate-id guard, release guardrails, and dogfood validation are implemented |
| F43 benchmark/build graph/incremental cache | Planned | Required for measurable framework performance |
| F44 hydration scheduler/streaming payload strategy | Planned | Required for real user-perceived performance |
| F45 guardrails/MCP/agent diagnostics | In progress | Boundary transform diagnostics, server-only import checks, duplicate boundary-id checks, diagnose manifest consistency checks, route boundary inspection, and pre-publish guardrails exist; diagnostic examples remain planned |

## Problem

Mandu currently has several layers that can each infer part of the server-to-client boundary:

- scanner and manifest generation
- bundler client entry generation
- SSR runtime prepass
- client hydration runtime
- route-level data fallback

The recent hydration bugs appeared because this boundary contract was not owned by one deterministic layer. In particular, #311 showed that a client component can be discovered by the bundler while SSR still fails to emit its inline props when the component is hidden behind a sync server wrapper or page component.

The current runtime prepass is useful as a compatibility fallback, but it should not remain the primary source of truth. Runtime tree inference is fragile because React elements can be wrapped, returned from sync or async components, hidden behind default exports, or mixed with server-only logic.

## Recommendation

Build a compiler-owned client boundary transform.

Users should keep writing normal React-like JSX:

```tsx
<CommentsSection initialComments={comments} />
```

Mandu should compile server-rendered modules into an internal boundary representation:

```tsx
<__ManduClientBoundary
  routeId="pledges-$id"
  module="src/client/widgets/comments-section/CommentsSection.client.tsx"
  exportName="CommentsSection"
  props={{ initialComments: comments }}
  hydrate="visible"
/>
```

This makes the server/client contract explicit before runtime. SSR no longer needs to guess whether a returned element is a client island, and the server does not need to execute client modules to discover props.

## Strategic Scope

F42 is necessary, but it is not sufficient by itself.

F42 fixes the architectural root cause behind repeated hydration bugs: the server/client boundary must be a compiler-owned contract, not a runtime guess. That gives Mandu a much stronger foundation. However, high framework performance also needs benchmark discipline, build graph caching, hydration scheduling, streaming payload strategy, and first-class diagnostics.

Recommended sequence:

1. F42: make the boundary deterministic.
2. F43: measure and cache the framework pipeline.
3. F44: schedule hydration and payload delivery for real user performance.
4. F45: make guardrails and agent diagnostics first-class.

Checklist:

- [x] Treat F42 as the architecture foundation, not the final performance story.
- [x] Do not claim performance wins without benchmark numbers.
- [ ] Add F43 before making broad performance claims.
- [ ] Add F44 before claiming best-in-class hydration UX.
- [ ] Add F45 before claiming agent-native maintainability at scale.

## What F42 Solves

- [x] Removes runtime guessing from the primary direct-import and route-owned wrapper client boundary paths.
- [x] Prevents directly imported `.client` component execution during SSR boundary discovery.
- [x] Makes inline client props deterministic for direct `.client` JSX boundaries, including route-owned server wrappers.
- [x] Gives the manifest a source-of-truth boundary record.
- [x] Makes #309, #310, and #311 style regressions easier to prevent with fixtures.
- [x] Gives MCP and agents a concrete boundary object to inspect.

## What F42 Does Not Solve Alone

- [ ] It does not automatically reduce all client JavaScript.
- [ ] It does not automatically make cold builds faster.
- [ ] It does not automatically optimize island hydration priority.
- [x] It defines the initial F42 streaming SSR contract for immediate boundary props, manifest context, and boundary chunk preloads.
- [ ] It does not fully define out-of-order streaming payload scheduling by itself.
- [ ] It does not provide a benchmark system.
- [ ] It does not fully protect app authors from all server/client misuse beyond the implemented guardrails.

## Goals

- [x] Compiler owns the direct-import and route-owned server-wrapper server-to-client boundary contract.
- [x] User DX stays React-like for direct route-owned imports: importing and rendering `.client` components remains enough.
- [x] Server rendering never executes directly imported `.client` component functions for boundary discovery.
- [x] Every direct or route-owned wrapper client boundary gets a deterministic module, export name, boundary id, and serialized props payload.
- [x] SSR output includes stable `data-mandu-props` for inline client boundaries.
- [x] Hydration resolves props from boundary-local payloads before falling back to route-level data.
- [x] Tests validate the contract from source transform through SSR output and client hydration.
- [x] Agent and MCP tooling can inspect boundary metadata directly.

## Non-Goals

- [ ] Do not implement full React Flight/RSC in this phase.
- [ ] Do not remove the current explicit island APIs.
- [ ] Do not support function, class instance, symbol, DOM node, or arbitrary non-serializable props.
- [ ] Do not make runtime prepass the long-term correctness layer.
- [ ] Do not introduce a user-facing boundary component unless a later design explicitly needs it.

## Architecture

### 1. Detection

Detect client component imports inside server-rendered files.

Examples:

```tsx
import { CommentsSection } from "../client/CommentsSection.client";
import ClientProfile from "../client/Profile.client";
import * as ClientWidgets from "../client/widgets.client";
```

The detector should produce a map:

```ts
{
  CommentsSection: {
    module: "../client/CommentsSection.client",
    exportName: "CommentsSection",
    localName: "CommentsSection"
  },
  ClientProfile: {
    module: "../client/Profile.client",
    exportName: "default",
    localName: "ClientProfile"
  },
  "ClientWidgets.ActivityFeed": {
    module: "../client/widgets.client",
    exportName: "ActivityFeed",
    localName: "ClientWidgets.ActivityFeed"
  }
}
```

Checklist:

- [x] Detect named imports from `.client`, `.island`, or configured client suffix modules.
- [x] Detect default imports from client modules.
- [x] Detect namespace imports from client modules.
- [ ] Detect re-exported client modules only after an explicit barrel support decision.
- [x] Record source file and source location for diagnostics.
- [x] Reuse existing client import resolution where possible instead of duplicating path rules.

### 2. Transform

Replace JSX usages of detected client identifiers with an internal boundary component.

Input:

```tsx
import { CommentsSection } from "../client/CommentsSection.client";

export default async function PledgePage({ params }) {
  const comments = await loadComments(params.id);
  return <CommentsSection initialComments={comments} />;
}
```

Output concept:

```tsx
import { __ManduClientBoundary } from "@mandujs/core/internal/client-boundary";

export default async function PledgePage({ params }) {
  const comments = await loadComments(params.id);
  return (
    <__ManduClientBoundary
      routeId="pledges-$id"
      module="../client/CommentsSection.client"
      exportName="CommentsSection"
      props={{ initialComments: comments }}
      hydrate="visible"
    />
  );
}
```

Checklist:

- [x] Create `packages/core/src/bundler/client-boundary-transform.ts`.
- [x] Use a structured parser or bundler AST hook; do not use regex-based JSX rewriting.
- [x] Transform `<ClientComponent />` usages.
- [x] Transform `<ClientComponent prop={value} />` usages.
- [x] Transform `<Namespace.Component />` usages.
- [x] Preserve `key` without serializing it as a user prop.
- [x] Emit diagnostics for unsupported non-empty children.
- [x] Preserve source maps enough for diagnostics.
- [x] Avoid changing unrelated imports or server-only JSX.
- [x] Ensure transformed code still typechecks where Mandu's build pipeline typechecks transformed sources.

### 3. Children Policy

Client components with children require an explicit policy because React children can contain server elements, functions, or non-serializable values.

Recommended initial policy:

- F42 rejects all non-empty `children` on transformed client boundaries, including text, expressions, and JSX.
- Plain JSX children are not automatically serialized across the boundary in F42.
- If children are passed to a client component, emit a hard build/dev diagnostic with file and line information.
- A later feature can add named server slots or RSC/Flight support.

Checklist:

- [x] Decide whether text children are allowed in F42.
- [x] Reject function-as-children across client boundaries.
- [x] Reject server JSX children across client boundaries unless explicitly supported.
- [x] Add tests for rejected children cases.
- [x] Document the children policy in user docs.

### 4. Internal Boundary Runtime

`__ManduClientBoundary` should be internal. It should render a stable SSR placeholder plus props payload.

Expected SSR shape:

```html
<div
  data-mandu-island="CommentsSection"
  data-mandu-boundary-id="pledges-$id--0"
  data-mandu-client-module="src/client/CommentsSection.client.tsx"
  data-mandu-client-export="CommentsSection"
></div>
<script
  type="application/json"
  data-mandu-props="pledges-$id--0"
>{"initialComments":[]}</script>
```

Checklist:

- [x] Create an internal boundary runtime module.
- [x] Generate deterministic boundary ids.
- [x] Render boundary-local `data-mandu-props`.
- [x] Escape JSON safely for HTML script contexts.
- [x] Serialize props with the same serializer used by route data.
- [x] Emit clear dev diagnostics for unsupported inline function props and refs.
- [ ] Keep production diagnostics small and actionable.

### 5. Manifest Integration

The build manifest should include boundary records.

Example:

```json
{
  "routeId": "pledges-$id",
  "boundaries": [
    {
      "id": "pledges-$id--0",
      "module": "src/client/CommentsSection.client.tsx",
      "exportName": "CommentsSection",
      "hydrate": "visible",
      "source": "src/routes/pledges/$id.tsx:42"
    }
  ]
}
```

Checklist:

- [x] Add boundary records to the route manifest.
- [ ] Keep repeated module/export entries deduped for bundle generation.
- [x] Keep per-instance ids unique for props lookup.
- [x] Replay manifest-owned ids during SSR transforms so manifest and HTML cannot drift.
- [x] Include source location for agent/debug tooling.
- [x] Make manifest shape stable enough for snapshot tests.
- [x] Verify publish tarballs include all internal runtime modules.

### 6. Hydration Runtime

Client hydration should resolve boundary-local props first.

Resolution order:

1. `script[data-mandu-props="<boundary-id>"]`
2. route-level `__MANDU_DATA__` fallback
3. empty props with dev warning

Checklist:

- [x] Read boundary-local props by `boundaryId`.
- [x] Support named exports.
- [x] Support default exports.
- [x] Keep explicit export metadata ahead of generated-entry fallback.
- [x] Avoid double hydration for boundary-owned direct imports by suppressing legacy route-level client ownership.
- [x] Add clear warning when route-level fallback is used for a transformed boundary.
- [x] Add regression coverage for #311 so this path cannot break silently.

### 7. Runtime Fallback Cleanup

The #311 sync prepass fix should remain as a legacy fallback, not the main correctness model.

Checklist:

- [ ] Mark runtime prepass as compatibility fallback in code comments.
- [ ] Add dev warning when runtime inference captures a boundary that transform should have captured.
- [ ] Keep hook-safe behavior: never execute components that look like hookful client components.
- [ ] Keep route-level wrapper fallback for older builds.
- [ ] Add tests proving transformed boundaries do not depend on runtime prepass.

### 8. Guardrails

Mandu should fail early for impossible or ambiguous client boundary cases.

Checklist:

- [x] Guard against importing server-only modules from `.client` components.
- [x] Guard against statically visible non-serializable prop values and dynamic SSR boundary props crossing the boundary.
- [x] Guard against inline function props crossing the boundary.
- [x] Guard against unsupported client component children.
- [x] Guard against unresolved named exports.
- [x] Guard against directly imported client component modules being executed during SSR boundary discovery.
- [x] Add actionable diagnostics with file path and line number for implemented boundary transform guardrails.

### 9. MCP and Agent Workflow

Mandu is agent-native, so boundary metadata should be inspectable by tools.

Checklist:

- [x] Add MCP output for route boundary list.
- [x] Include module, export, source file, boundary id, and hydration mode.
- [x] Add a diagnose/check command that reports boundary manifest consistency issues.
- [x] Update `docs/guides/07_agent_workflow.md` with the F42 workflow.
- [x] Add an agent checklist for route/API/contract/slot/island work.

### 10. Test Harness

Tests should prove the boundary contract end to end.

Checklist:

- [x] Add transform snapshot test for named export client component.
- [x] Add transform snapshot test for default export client component.
- [x] Add transform snapshot test for namespace import client component.
- [x] Add SSR test for inline `data-mandu-props`.
- [x] Add SSR test where client component is hidden behind a sync server wrapper.
- [x] Add SSR test where client component is returned from an async page.
- [x] Add hydration test that receives props for named exports.
- [x] Add hydration test that receives props for default exports.
- [x] Add test that hookful client component is not executed during SSR.
- [x] Add test for multiple client components with stable boundary ordering.
- [x] Add test for repeated same module/export with different props.
- [x] Add test for unsupported function prop diagnostic.
- [x] Add test for unsupported JSX children diagnostic.
- [x] Add manifest snapshot test.
- [x] Add bundler test for boundary bundle manifest entries.
- [x] Add bundler tests for boundary-only `targetRouteIds` and `skipFrameworkBundles` rebuild paths.
- [x] Add bundler test for manifest-generated boundary records from route-owned server wrappers.
- [x] Add CLI SSR bundled import test proving `.client` module does not execute during SSR transform.

### 11. Dogfooding Targets

Use real Mandu apps to validate the design before release.

Checklist:

- [x] Test `party-pledge-mandu` `/pledges/:id`.
- [x] Test `party-pledge-mandu` `/me`.
- [x] Test `party-pledge-mandu` `/notifications`.
- [x] Test `party-pledge-mandu` `/pledges/new`.
- [x] Test `party-pledge-mandu` `/search`.
- [x] Inspect SSR HTML for boundary-local `data-mandu-props`.
- [x] Verify client hydration does not throw `TypeError` for missing props.
- [x] Verify server logs do not contain invalid hook call warnings.

### 12. Release Gates

Checklist:

- [x] `bun test`
- [x] `bun run test:core`
- [x] `bun run test:packages`
- [x] `bun run typecheck`
- [x] `bun run lint`
- [x] `bun run check:publish`
- [x] `bun run check:public-api`
- [x] `bun run check:target-boundaries`
- [x] Targeted F42/F45 regression suite passes.
- [x] `git diff --check`
- [x] Changeset added for affected packages.
- [x] Version updated.
- [x] Publish dry checks pass.
- [x] npm publish completed.
- [ ] GitHub issue comment explains the architectural fix and validation.
- [ ] Related issue closed.

Validation log:

- [x] 2026-05-23: Focused F42/F45 suite passed: 207 tests across transform, router, generator, manifest schema, bundler, runtime SSR, CLI SSR import, Workers smoke, MCP boundary tools, agent context, diagnose, and public API scripts.
- [x] 2026-05-23: `bun run typecheck` passed across core, cli, mcp, ate, edge, skills, and playground-runner.
- [x] 2026-05-23: `bun run lint` exited 0 with one pre-existing warning in `packages/core/src/bundler/build.test.ts`.
- [x] 2026-05-23: `bun run check:public-api`, `bun run check:target-boundaries`, `bun run check:publish`, and `git diff --check` passed. `git diff --check` printed only CRLF conversion warnings.
- [x] 2026-05-23: HMR matrix and rapid-fire watcher regressions passed without requiring an external `NODE_PATH`; temporary fixture projects now link workspace `node_modules` during skeleton setup.
- [x] 2026-05-23: Full `bun test --timeout 180000` passed: 6338 pass, 68 skip, 0 fail, 17200 assertions across 6406 tests and 487 files.
- [x] 2026-05-23: `bun run test:packages` passed, including `test:core`, CLI, MCP, ATE, Edge, Skills, and Playground Runner package gates.
- [x] 2026-05-23: `party-pledge-mandu` at `D:\workspace\party-pledge-mandu` built with local Mandu sources and verified `/pledges/:id`, `/me`, `/notifications`, `/pledges/new`, and `/search`: boundary count matched props count, `.boundary.js` sources were present, and legacy route `.island.js` wrappers were absent.
- [x] 2026-05-23: `bun run publish:dry` passed; current published versions already exist on npm, so real publish requires `bun run version` before `bun run publish`.
- [x] 2026-05-23: `bun run version` applied the changeset, then `bun run publish` published `@mandujs/core@0.54.18`, `@mandujs/mcp@0.38.10`, `@mandujs/edge@0.4.66`, and `@mandujs/cli@0.44.21` to npm; release tags and `main` were pushed.

## F43 Benchmark, Build Graph, and Incremental Cache

F43 turns performance work from opinion into measurement.

F42 makes the boundary correct. F43 should make the framework pipeline measurable and cacheable. Without this phase, Mandu can have a cleaner architecture while still being unable to prove build-time, SSR-time, or bundle-size improvements.

### F43 Goals

- [ ] Establish repeatable benchmark fixtures.
- [ ] Track cold build, warm build, route rebuild, SSR render, and hydration timings.
- [ ] Build a route-level dependency graph.
- [ ] Cache client boundary analysis.
- [ ] Cache route manifest generation.
- [ ] Recompute only routes affected by changed files.
- [ ] Add benchmark output that can be compared across commits.

### F43 Benchmark Fixtures

Create fixed apps or fixtures that represent real Mandu usage:

- [ ] `minimal-static`: one route, no client islands.
- [ ] `minimal-island`: one route, one `.client` component.
- [ ] `nested-layouts`: root layout, nested layout, page, client island.
- [ ] `many-islands`: one route with 10, 50, and 100 boundaries.
- [ ] `large-routes`: 100, 500, and 1000 routes.
- [ ] `mixed-data`: route data, inline props, and route-level fallback.
- [ ] `party-pledge-realistic`: real-world app flow based on current dogfooding target.

### F43 Metrics

| Metric | Why it matters | Target behavior |
| --- | --- | --- |
| Cold build time | First install or CI cost | Stable baseline with regression threshold |
| Warm build time | Local developer loop | Only changed graph nodes rebuild |
| Single route rebuild time | App scale behavior | Route-local changes stay route-local |
| SSR p50/p95 render time | Server performance | Boundary transform should not add runtime discovery cost |
| Client JS per route | User payload cost | Boundaries should not pull unrelated route code |
| Hydration start time | Perceived interactivity | Measured before F44 scheduler work |
| Hydration completion time | Interactive readiness | Measured per island count |
| Manifest generation time | Build overhead | Cacheable by route and dependency graph |

Checklist:

- [ ] Add a benchmark command, for example `bun run bench`.
- [ ] Store benchmark scripts under a stable repo path.
- [ ] Print JSON output for CI comparison.
- [ ] Print human-readable summaries for local debugging.
- [ ] Add regression thresholds for core metrics.
- [ ] Track bundle size per route.
- [ ] Track number of generated client entries per route.
- [ ] Track number of boundary records per route.

### F43 Build Graph

The build graph should answer:

- Which route imports this file?
- Which client boundary belongs to which route?
- Which manifest records are invalidated by this change?
- Which client bundles must be regenerated?
- Which SSR modules must be rebuilt?

Checklist:

- [ ] Define route graph node shape.
- [ ] Define client module graph node shape.
- [ ] Define boundary graph edge shape.
- [ ] Track server-to-client boundary edges separately from normal imports.
- [ ] Track route-to-layout dependencies.
- [ ] Track route-to-contract dependencies if contracts affect generated code.
- [ ] Track config files that invalidate the whole graph.
- [ ] Persist graph metadata in a cache directory.
- [ ] Add cache versioning so old cache data is invalidated safely.

### F43 Cache Layers

Recommended cache layers:

1. Source parse cache.
2. Client boundary detection cache.
3. Boundary transform output cache.
4. Route manifest cache.
5. Client entry generation cache.
6. Bundle output cache where supported by the bundler.

Checklist:

- [ ] Cache by content hash, not only by mtime.
- [ ] Include Mandu version in cache key.
- [ ] Include transform version in cache key.
- [ ] Include relevant config in cache key.
- [ ] Invalidate dependents when a client module changes.
- [ ] Invalidate all affected routes when a layout changes.
- [ ] Add debug output that explains why a cache entry missed.
- [ ] Add tests for cache hit, cache miss, and invalidation.

### F43 Acceptance Criteria

- [ ] Benchmark command exists and runs locally.
- [ ] Benchmark results are stable enough to compare commits.
- [ ] Route graph records route, layout, client boundary, and manifest dependencies.
- [ ] Touching one client island does not force unrelated routes to regenerate.
- [ ] Touching a shared layout invalidates dependent routes.
- [ ] Cache misses are explainable in debug output.
- [ ] Performance claims in release notes cite benchmark numbers.

## F44 Hydration Scheduler and Streaming Payload Strategy

F44 turns a correct boundary into a fast user experience.

F42 ensures props arrive. F44 decides when and how each island hydrates. This is where Mandu can move from "it works" to "it feels fast."

### F44 Goals

- [ ] Add first-class hydration modes.
- [ ] Prevent low-priority islands from blocking critical interaction.
- [ ] Preload client chunks when they are likely to be needed.
- [ ] Avoid double hydration.
- [ ] Support streaming-safe boundary payload delivery.
- [ ] Measure hydration work per island.

### Hydration Modes

Recommended initial modes:

| Mode | Behavior | Use case |
| --- | --- | --- |
| `eager` | Hydrate as soon as possible | Above-the-fold interactive controls |
| `visible` | Hydrate when island enters viewport | Comments, feeds, secondary panels |
| `idle` | Hydrate during browser idle time | Non-critical widgets |
| `interaction` | Hydrate on click, focus, pointer enter, or configured event | Expensive widgets that may not be used |
| `manual` | App or framework API triggers hydration | Advanced cases |

Checklist:

- [ ] Define hydration mode syntax.
- [ ] Add default mode selection.
- [ ] Emit hydration mode into boundary manifest.
- [ ] Emit hydration mode into SSR attributes.
- [ ] Implement `visible` with `IntersectionObserver`.
- [ ] Implement `idle` with `requestIdleCallback` fallback.
- [ ] Implement `interaction` with configured DOM events.
- [ ] Implement dedupe so the same boundary hydrates once.
- [ ] Add tests for every hydration mode.

### Chunk Loading Strategy

Checklist:

- [ ] Map boundary records to generated client chunks.
- [ ] Preload `eager` chunks in SSR output.
- [ ] Prefetch `visible` chunks near viewport when possible.
- [ ] Delay `idle` chunks until after critical route work.
- [ ] Avoid loading chunks for `interaction` islands before needed unless configured.
- [ ] Add diagnostics for missing chunks.
- [ ] Add bundle-size reporting per hydration mode.

### Streaming Payload Strategy

Streaming SSR needs explicit rules for where boundary props appear and when hydration may start.

Recommended initial stance:

- F42 can support buffered SSR first.
- F44 should define streaming behavior before broad streaming support.
- Boundary props must be available before the corresponding island hydrates.
- Hydration scheduler must tolerate props arriving after placeholder markup.

Checklist:

- [ ] Define whether props script appears immediately after each boundary or in a final payload block.
- [ ] Define how streamed boundaries are registered before props arrive.
- [ ] Define hydration delay behavior when props are missing.
- [ ] Add timeout or diagnostic for missing streamed props.
- [ ] Add tests for streamed boundary before props.
- [ ] Add tests for props before client chunk.
- [ ] Add tests for client chunk before props.
- [ ] Add tests for out-of-order streamed boundaries.

### F44 Acceptance Criteria

- [ ] Above-the-fold eager islands hydrate first.
- [ ] Below-the-fold visible islands do not hydrate until needed.
- [ ] Idle islands do not block initial interactivity.
- [ ] Interaction islands do not load or hydrate until interaction unless prefetch is configured.
- [ ] Streaming SSR does not create missing-props hydration failures.
- [ ] Hydration timings are reported by benchmark tooling.

## F45 Guardrails, MCP, and Agent Diagnostics

F45 makes the architecture maintainable by humans and agents.

Mandu's strategic advantage is not only that it can render apps. It should be able to explain its own architecture to agents and block invalid app shapes before they become production bugs.

### F45 Goals

- [x] Make implemented server/client boundary errors actionable.
- [x] Give MCP tools direct access to route boundary metadata.
- [x] Give agents stable diagnostics with file, line, reason, and suggested fix for implemented boundary guardrails.
- [x] Add `diagnose` checks for boundary manifest consistency mistakes.
- [x] Ensure release gates fail on invalid boundaries.

### Diagnostic Schema

Recommended diagnostic shape:

```ts
type ManduDiagnostic = {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  file?: string;
  line?: number;
  column?: number;
  routeId?: string;
  boundaryId?: string;
  module?: string;
  exportName?: string;
  suggestion?: string;
};
```

Checklist:

- [x] Define diagnostic codes for boundary transform errors.
- [x] Define initial diagnostic codes for boundary serialization errors.
- [x] Define diagnostic codes for server-only import errors.
- [x] Define diagnostic codes for unresolved client boundary export errors.
- [x] Define a diagnose rule for hydration/boundary manifest consistency errors.
- [x] Ensure implemented boundary transform diagnostics are stable enough for agents to parse.
- [x] Include suggested fix text for implemented boundary transform cases.

### Guard Categories

| Guard | Example | Result |
| --- | --- | --- |
| Server-only import in client | `.client.tsx` imports `fs` | Build error |
| Non-serializable prop | `<Widget onSave={() => {}} />` | Build/dev error |
| Unsupported children | `<Client><ServerThing /></Client>` | Build/dev error |
| Missing export | Manifest references missing named export | Build error |
| SSR client execution | Client hook runs during SSR discovery | Test failure/build diagnostic |
| Duplicate boundary id | Two records share same id | Build error |

Checklist:

- [x] Add server-only import guard.
- [ ] Add client-only import guard for server modules where applicable.
- [x] Add non-serializable props guard for statically visible prop values and dynamic runtime props.
- [x] Add unsupported children guard.
- [x] Add missing export guard.
- [x] Add duplicate boundary id guard.
- [x] Add SSR client execution guard test.

### MCP and Agent Output

MCP route inspection should expose:

```json
{
  "routeId": "pledges-$id",
  "file": "src/routes/pledges/$id.tsx",
  "boundaries": [
    {
      "id": "pledges-$id--0",
      "module": "src/client/CommentsSection.client.tsx",
      "exportName": "CommentsSection",
      "hydrate": "visible",
      "propsSource": "inline",
      "source": "src/routes/pledges/$id.tsx:42"
    }
  ],
  "diagnostics": []
}
```

Checklist:

- [x] Add MCP route boundary inspection.
- [x] Add MCP hydration manifest inspection for boundary chunk records via `includeBundle`.
- [x] Add MCP diagnostics output for missing boundary bundle manifests/entries when `includeBundle` is requested.
- [x] Add CLI/agent manifest equivalent for non-MCP environments.
- [x] Update agent workflow docs with exact commands/tools.
- [ ] Add examples for fixing each diagnostic class.

### F45 Acceptance Criteria

- [x] Invalid boundaries fail before publish.
- [x] Agents can inspect route boundaries without reading generated code manually.
- [x] Boundary transform diagnostics include stable code, file, line, route, and suggested fix for implemented guardrails.
- [x] `diagnose` output can distinguish fatal errors from optimization warnings.
- [x] Release checklist includes guard and diagnostics validation.

## Framework-Level Success Metrics

These metrics define when Mandu can honestly claim a stronger architecture and performance story.

### Correctness Metrics

- [x] Zero missing inline prop regressions across current boundary fixtures.
- [x] Zero SSR invalid hook call warnings from current client boundary discovery fixtures.
- [x] Named/default/namespace client exports all covered by tests.
- [x] Serialization failures are deterministic and actionable for implemented static and runtime prop cases.
- [x] Manifest snapshot tests cover boundary metadata.

### Performance Metrics

- [ ] Cold build baseline recorded.
- [ ] Warm build baseline recorded.
- [ ] Single-route rebuild baseline recorded.
- [ ] SSR p50 and p95 baseline recorded.
- [ ] Hydration start and completion baseline recorded.
- [ ] Client JS per route baseline recorded.
- [ ] Bundle chunk count per route baseline recorded.
- [ ] Benchmark regression threshold defined.

### Architecture Metrics

- [x] Runtime prepass is no longer the primary boundary correctness layer for direct imports and route-owned static server wrappers.
- [x] Client boundary metadata is compiler-generated for implemented F42 paths.
- [ ] Route graph can explain why a file invalidates a route.
- [ ] Hydration scheduler can prioritize islands independently.
- [ ] Guardrails catch invalid boundary usage before npm publish.

### Agent-Native Metrics

- [x] MCP can list route boundaries.
- [x] MCP can list route boundary bundle diagnostics for missing correlated manifest entries.
- [x] CLI/agent manifest can expose equivalent route boundary metadata without MCP.
- [x] Boundary diagnostics include suggested fixes.
- [x] Agent workflow docs map each domain to a preferred tool.

## Implementation Sequence

### Phase 0: Contract Freeze

- [x] Choose boundary id format.
- [x] Choose client module suffix rules.
- [x] Choose named/default export resolution order.
- [x] Choose children serialization policy.
- [x] Choose streaming SSR behavior for F42.
- [x] Document exact SSR HTML contract.

Exit criteria:

- [x] This file has checked decisions for id, export, children, and streaming behavior.
- [x] Tests can be written without guessing the target behavior.

### Phase 1: Test Harness First

- [ ] Add source fixtures.
- [x] Add transform snapshot tests.
- [x] Add SSR output tests.
- [x] Add hydration props tests.
- [x] Add manifest and bundle metadata regression tests.

Exit criteria:

- [x] At least one regression test exists for each major contract: transform, SSR props, hydration props, and manifest/bundle metadata.

### Phase 2: Compiler Transform

- [x] Implement import detection.
- [x] Implement JSX element rewrite.
- [x] Implement metadata collection.
- [x] Wire transform into the server route build pipeline for direct route modules and route-owned static server imports.
- [x] Keep existing builds working when there are no client component imports.

Exit criteria:

- [x] Transform tests pass.
- [x] Existing targeted server route tests still pass.

### Phase 3: Runtime and Manifest

- [x] Implement internal boundary component.
- [x] Emit stable props payload.
- [x] Write route boundary metadata to manifest.
- [x] Update generated client entries to consume manifest boundary records.

Exit criteria:

- [x] SSR tests pass.
- [x] Manifest and bundle metadata tests pass.

### Phase 4: Hydration Integration

- [x] Update hydration runtime to read boundary-local props.
- [x] Keep route-level fallback.
- [x] Add warnings for fallback-only paths.
- [x] Verify named/default export resolution.

Exit criteria:

- [x] Hydration tests pass.
- [x] #311 regression test passes without relying on runtime prepass for compiler-owned boundaries; legacy sync wrapper fallback remains covered separately.

### Phase 5: Guardrails and Tooling

- [x] Add full serialization diagnostics.
- [x] Add strict runtime serialization failure for dynamic boundary props.
- [x] Add unsupported inline function prop diagnostics.
- [x] Add unsupported children diagnostics.
- [x] Add server-only import diagnostics.
- [x] Add duplicate boundary id diagnostics.
- [x] Add diagnose boundary manifest consistency checks.
- [x] Add MCP boundary inspection output.
- [x] Update agent workflow docs.

Exit criteria:

- [x] Implemented invalid boundary cases fail with clear file and line diagnostics.
- [x] Agents can inspect route boundaries without reading generated internals manually.

### Phase 6: Dogfood and Release

- [x] Test real app routes.
- [x] Run full gates.
- [x] Run focused F42/F45 regression gates.
- [x] Add changeset.
- [x] Version and publish.
- [ ] Comment and close related GitHub issue.

Exit criteria:

- [x] Published package includes F42.
- [x] Real app hydration path is verified.
- [ ] GitHub issue has an explanation of what changed and how it was validated.

## Acceptance Criteria

- [x] A server route can render `<ClientComponent prop={value} />` and SSR emits boundary-local props.
- [x] Direct `.client` component functions are not executed during SSR boundary discovery, including when imported through a route-owned server wrapper.
- [x] Named export client components resolve through explicit export metadata.
- [x] Default export client components resolve through generated entry fallback.
- [x] Multiple boundaries in one route get stable ids.
- [x] Repeated use of the same client module gets separate props payloads.
- [x] Unsupported props fail early with actionable diagnostics for static prop expressions and dynamic SSR boundary props.
- [x] Existing explicit island APIs continue working.
- [x] Current #311 runtime fallback remains compatible for older paths.
- [x] Full release gates pass before npm publish.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| AST transform misses a JSX syntax form | Boundary not generated | Start with explicit fixtures and snapshot tests for named/default/namespace imports |
| Children behavior is ambiguous | Hydration mismatch or serialization failure | Define restrictive F42 children policy, then expand later |
| Re-export barrels hide client modules | Detection misses component | Treat barrel support as an explicit follow-up unless covered by tests |
| Streaming SSR interacts poorly with boundary scripts | Props may arrive out of order | Define initial streaming stance before implementation |
| Runtime fallback masks transform bugs | False confidence | Add tests that assert transformed output and manifest records directly |
| Source maps degrade diagnostics | Agent/debug workflow gets harder | Preserve source location in boundary manifest even if source maps are incomplete |

## Open Risks From Agent Review

- [x] Transitive server wrappers: route-owned static server import graphs are discovered, transformed, and replay manifest-owned ids during SSR import.
- [ ] Dynamic imports, barrel/re-export graphs, and cross-route shared wrapper ownership still need an explicit F43/F45 design before broad support.
- [x] Streaming SSR: streaming has matching boundary manifest context, async server component context retention, boundary-local props, and boundary chunk preload emission for F42 boundaries.
- [ ] Out-of-order streaming payload strategy remains an F44 concern.
- [x] HTML host context safety: transform diagnostics now fail known invalid host contexts for the current sibling `<div>` and `<script>` marker shape.
- [x] Transform diagnostics surfacing: unsupported children, refs, inline function props, and statically visible non-serializable prop values now use stable error diagnostics and fail manifest/SSR transforms instead of silently dropping data.
- [x] Production import caching: `mandu start` and prerender use cached bundled imports keyed by boundary transform metadata, with a dedicated request-local props regression test.

## Decision Log

- [x] Boundary id format:
  - Decision: manifest boundary ids use `<routeId>--<ordinal>`; SSR transform replays the manifest-owned ids exactly; repeated render instances keep the first id and append `--<instanceOrdinal>` for later instances.
- [x] Export resolution:
  - Decision: explicit transform metadata first, generated entry fallback second, runtime inference last.
- [x] Children policy:
  - Decision: F42 rejects all non-empty client boundary children, including text, JSX, and function expressions. App authors should pass serializable props or use an explicit island/slot API until a named server-slot design exists.
- [x] Streaming SSR:
  - Decision: F42 streaming SSR supports transformed boundary placeholders with immediate sibling props scripts, manifest-backed `data-mandu-src`, async server component context retention through a React Provider boundary scope, route-filtered boundary `modulepreload` hints, and no duplicate route wrapper when the route is already island-prewrapped. F44 still owns delayed/out-of-order payload scheduling and hydration wait behavior.
- [ ] Barrel/re-export support:
  - Proposed: direct client imports first; barrel support only after explicit fixture coverage.
- [ ] Benchmark command:
  - Proposed: `bun run bench` with JSON and human-readable output.
- [ ] Build graph cache key:
  - Proposed: content hash plus Mandu version plus transform version plus relevant config hash.
- [x] Default hydration mode:
  - Decision: `visible` for imported client components unless route metadata says otherwise.
- [x] Diagnostic format:
  - Decision: F42 transform diagnostics include stable code, severity, message, file, line, column, route id, boundary id, module, export name, and suggested fix for implemented boundary guardrails.
  - Follow-up: global diagnose/doctor diagnostics should reuse this shape for release checks.
- [x] MCP boundary inspection:
  - Decision: Use `mandu.route.boundaries` as the first F42 inspection surface. Scope with `routeId`; use `includeBundle: true` after `mandu_build` or `bun run build` to correlate boundary chunk records. If MCP is unavailable, use `mandu agent context --json` or `mandu agent manifest --write` and inspect `routes[].boundaries`.

## Priority Matrix

| Priority | Work | Reason |
| --- | --- | --- |
| P0 | F42 contract freeze and tests | Prevent more hydration correctness regressions |
| P0 | F42 transform and boundary runtime | Move correctness out of runtime guessing |
| P1 | F43 benchmark harness | Make performance claims measurable |
| P1 | F43 route graph and cache | Improve large-app developer experience |
| P1 | F45 diagnostics schema | Make errors actionable for agents and humans |
| P2 | F44 hydration scheduler | Improve user-perceived performance after correctness is stable |
| P2 | F44 streaming payload strategy | Required for advanced SSR performance |
| P2 | F45 MCP route inspection | Turns Mandu architecture into agent-readable state |

## Progress Board

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 0 contract freeze | Done | Id, suffix, export, default hydration, F42 streaming, children decisions, and SSR HTML docs are complete for F42 |
| Phase 1 test harness | Done | Transform, route metadata, SSR output, streaming SSR, server-wrapper, bundler manifest, CLI SSR import, production cache, and incremental rebuild tests added |
| Phase 2 compiler transform | Done | Direct route modules and route-owned static server imports are wired into manifest scan and SSR bundled import |
| Phase 3 runtime and manifest | Done | Internal boundary runtime, route metadata, manifest id replay, unique instance ids, streaming boundary context, bundle manifest delivery, and boundary rebuild paths are in place |
| Phase 4 hydration integration | Done | Boundary-local props, route data fallback warning, named/default export resolution, and route-level island suppression are supported in generated runtime |
| Phase 5 guardrails and tooling | In progress | Boundary transform diagnostics now fail unsupported children, refs, inline function props, visible non-serializable prop values, unresolved client exports, server-only client imports, and duplicate boundary ids; runtime boundary props fail strict serialization; MCP boundary inspection and diagnose boundary-manifest checks exist |
| Phase 6 dogfood and release | In progress | Real app routes, full gates, versioning, npm publish, release tags, and main push are complete; GitHub issue comment/close remains |
| F43 benchmark harness | Not started | Add repeatable performance measurements |
| F43 build graph | Not started | Track route/layout/client dependency invalidation |
| F43 incremental cache | Not started | Avoid regenerating unaffected routes and manifests |
| F44 hydration scheduler | Not started | Add eager/visible/idle/interaction/manual modes |
| F44 streaming payload strategy | Not started | F42 has immediate boundary props support; F44 still must define delayed/out-of-order props and chunk ordering |
| F45 diagnostics schema | In progress | F42 transform diagnostics have stable code/severity/file/line/route/boundary/suggestions; diagnose has boundary-manifest severity checks; release-gate integration still open |
| F45 MCP/CLI inspection | In progress | MCP and agent manifest expose route boundaries; diagnose covers route/bundle manifest consistency; examples for every diagnostic class still open |
| F45 release guard integration | Done | `check:publish`, `publish:dry`, full tests, package tests, typecheck, lint, docs drift, public API, target boundaries, and diff checks passed; actual npm publish remains a release operation |

## How To Maintain This Checklist

- Check an item only in the same change set that implements or validates it.
- If an item changes scope, edit the wording before checking it.
- If implementation discovers a new class of risk, add it under `Risks and Mitigations`.
- If a decision is made, fill the corresponding `Decision Log` item and link the commit or issue comment when available.
- Before npm publish, every item in `Release Gates` must be checked or explicitly moved to a follow-up document with a reason.
