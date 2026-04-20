---
title: Guard Graph
description: Interactive dependency graph + violation overlay for the guard architecture checker. Self-contained HTML, zero CDN, CI-friendly JSON.
phase: 18.pi
status: stable
since: "0.29.0"
---

# Guard Graph

Phase 18.π adds an interactive visualization layer on top of the existing
`mandu guard` architecture checker. Instead of a plain-text list of
violations, you get a layered dependency graph where every module is a
node, every import is an edge, and every rule violation is a dashed red
edge you can click into.

## Why

Text reports answer _"what is broken?"_ Graphs answer _"where does this
module sit in the architecture, and what depends on what?"_ That is the
question every architecture review asks — and the answer is easier to
read visually than to chase across multiple `grep` runs.

## Usage

### CLI flag

```bash
mandu guard --graph            # HTML + JSON
mandu guard --graph=json       # JSON only (skip HTML render, for CI)
mandu guard --graph=html       # HTML + JSON (explicit)
```

The scan respects the same `guard.preset` / `guard.srcDir` / `guard.exclude`
config your normal `mandu guard` run uses. The graph branch runs **after**
the violation check — the existing console / JSON / agent output is still
printed, and the CI exit code is unaffected.

### Output

Written to `.mandu/guard/`:

- `graph.html` — single-file HTML. Dark theme, monospace. Inline SVG
  layered graph, zero CDN. Drag-and-drop into any browser.
- `graph.json` — machine-readable. Shape: `{ nodes, edges, layers,
  violations, summary }`. Schema versioned via `summary.version`.

Typical size on a mid-sized project (~500 modules): `graph.html` ~180 KB,
well under the 500 KB ceiling that keeps the file attachment-friendly.

## What you see

### Layered layout

Rows correspond to guard layers in hierarchy order (top = outermost).
Under the `fsd` preset that's:

```
app → pages → widgets → features → entities → shared
```

Each node is colored by layer. Nodes outside any layer land in a
trailing `(unassigned)` row.

### Edges

- **Muted blue** = legal import.
- **Dashed red** = guard violation. Same rules the text report flags.

Both edge types carry arrow markers. Clicking an edge is not interactive
— but clicking either endpoint opens the side panel.

### Side panel

Click any node → the right panel shows:

- File path (absolute)
- Layer assignment
- **Imported by** — every module that pulls this one in
- **Imports** — every module this one pulls in

List entries are clickable, so you can trace edges both directions.

### Filter bar

Top of the viewer:

- **Only violations** — dim every non-violation edge.
- **All layers** — toggle every layer chip in one click.
- **Per-layer chips** — each layer has a swatch chip you can toggle
  individually. Useful when you want to see only `features → entities`
  traffic, for example.

## JSON shape

```ts
interface DependencyGraph {
  nodes: ModuleNode[];         // one per analyzed source file
  edges: ImportEdge[];         // one per resolved import
  layers: Layer[];             // layers active in this project
  violations: Violation[];     // full guard violations (same shape as guard report)
  summary: {
    nodes: number;
    edges: number;
    violationEdges: number;    // edges flagged as violations
    violations: number;        // total violations (includes circulars)
    filesAnalyzed: number;
    preset: string;
    srcDir: string;
    generatedAt: string;       // ISO timestamp
    version: number;           // schema version
  };
}

interface ModuleNode {
  id: string;                  // POSIX path relative to rootDir (stable id)
  filePath: string;            // absolute path
  label: string;               // display label (parent/basename)
  layer: string | null;        // guard layer, or null if unassigned
  slice?: string;              // FSD slice name when applicable
}

interface ImportEdge {
  from: string;                // source node id
  to: string;                  // target node id
  fromLayer: string | null;
  toLayer: string | null;
  violation: boolean;          // true if guard flagged this edge
  line: number;                // import statement line in source
}
```

Nodes and edges are sorted for stable output — diffable in CI.

## CI integration

### Fail the build when violations appear

```bash
mandu guard --graph=json
jq '.summary.violationEdges' .mandu/guard/graph.json | \
  awk '{ if ($1 > 0) exit 1 }'
```

### Attach the graph to PR comments

The `graph.html` file is self-contained (no CDN, no bundler). Commit it
as a CI artifact, then link to it from your PR status check.

```yaml
# .github/workflows/guard.yml
- run: bun x mandu guard --graph
- uses: actions/upload-artifact@v4
  with:
    name: guard-graph
    path: .mandu/guard/graph.html
```

### Track violation count over time

Parse `graph.json` → `summary.violationEdges` → push to your metrics
backend (Datadog / Grafana / Prometheus textfile). Combined with
`mandu guard --save-stats` you can build a trend dashboard.

## Design notes

- **Zero runtime deps.** No `d3`, no `react-flow`, no `viz.js`. The SVG
  layout is hand-rolled, deterministic (no force-directed random
  seeding), so CI artifacts diff cleanly.
- **Single HTML file.** Same spirit as the Phase 18.η bundle analyzer —
  drag-and-drop portable, no CDN, no `<script src>`.
- **XSS-safe.** Module ids / file paths / layer names are HTML-escaped
  before DOM insertion, and the embedded JSON payload escapes `</script`
  / U+2028 / U+2029 so hostile names can't break out of the script
  block.
- **Deterministic.** Nodes sorted by id, edges sorted by (from, to,
  line). Re-running `mandu guard --graph` on an unchanged source tree
  produces byte-identical output — modulo the `generatedAt` timestamp
  (configurable via the JSON — strip it in CI if you want to diff).

## Relationship to other guard outputs

| Command | Output | Best for |
|--|--|--|
| `mandu guard` | stdout report | Quick ad-hoc check, terminal feedback |
| `mandu guard --output=report.md` | Markdown file | PR comment body |
| `mandu guard --output=report.html` | HTML tables (Phase 17) | Shareable summary with stats + trend |
| `mandu guard --graph` | Graph HTML + JSON (this doc) | Visual dependency review, architecture onboarding |

The three modes compose — nothing stops you from running all three in
the same CI job.
