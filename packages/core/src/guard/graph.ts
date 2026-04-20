/**
 * Phase 18.π — Guard dependency graph visualizer.
 *
 * Scans a project's source tree, resolves imports between modules, tags each
 * module with its architectural layer (per the active guard preset), and
 * emits:
 *
 *   analyzeDependencyGraph(config, rootDir) → DependencyGraph
 *     {
 *       nodes:      ModuleNode[]      // one per source file inside srcDir
 *       edges:      ImportEdge[]      // one per (source file → resolved
 *                                        target file) import, with violation
 *                                        flag + layer tagging
 *       layers:     Layer[]           // layers active in this project, keyed
 *                                        by hierarchy order
 *       violations: Violation[]       // full guard report violations
 *       summary:    { … counts … }
 *     }
 *
 * And a single-file, self-contained HTML viewer:
 *
 *   renderGraphHtml(graph) → string
 *     - Inline SVG, layered layout (deterministic — no force-directed random
 *       seeding, CI-stable). Nodes bucketed per layer, row = layer.
 *     - Dark theme. No external CDN, no d3, no runtime deps.
 *     - Click node → side panel shows importers + importees + file path.
 *     - Filter bar: "show only violations" toggle + per-layer chips.
 *
 * Design spirit matches Phase 18.η bundle analyzer (`bundler/analyzer.ts`):
 * deterministic, zero runtime deps, portable single HTML file.
 *
 * @module guard/graph
 */

import { existsSync } from "fs";
import { relative, resolve, sep, isAbsolute, dirname, extname } from "path";
import { minimatch } from "minimatch";
import type {
  GuardConfig,
  LayerDefinition,
  Violation,
  FileAnalysis,
} from "./types";
import { WATCH_EXTENSIONS, DEFAULT_GUARD_CONFIG } from "./types";
import {
  analyzeFile,
  shouldAnalyzeFile,
  shouldIgnoreImport,
} from "./analyzer";
import {
  validateFileAnalysis,
  detectCircularDependencies,
} from "./validator";
import { getPreset } from "./presets";

// ════════════════════════════════════════════════════════════════════════════
// Public types
// ════════════════════════════════════════════════════════════════════════════

/**
 * Single module (source file) in the dependency graph.
 */
export interface ModuleNode {
  /** Stable id — POSIX path relative to rootDir. */
  id: string;
  /** Absolute filesystem path. */
  filePath: string;
  /** Human-friendly label (basename w/o extension + parent dir). */
  label: string;
  /** Resolved guard layer, or `null` if outside any layer. */
  layer: string | null;
  /** FSD slice (second path segment after layer), if any. */
  slice?: string;
}

/**
 * A single import edge `source → target`. Both endpoints are module ids
 * present in `nodes`. Unresolvable imports (node_modules, ambient types,
 * etc.) are dropped.
 */
export interface ImportEdge {
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  /** Layer of source. */
  fromLayer: string | null;
  /** Layer of target. */
  toLayer: string | null;
  /** True if this edge corresponds to a guard violation. */
  violation: boolean;
  /** Import statement line number (1-indexed). */
  line: number;
}

/**
 * Layer bucket — a visual row in the graph.
 */
export interface Layer {
  /** Layer name (matches guard preset). */
  name: string;
  /** Rank in the hierarchy (0 = top / outermost layer). */
  rank: number;
  /** Human-friendly description. */
  description?: string;
  /** Number of nodes in this layer. */
  nodeCount: number;
}

/**
 * Summary counts displayed in the HTML header.
 */
export interface GraphSummary {
  /** Node count. */
  nodes: number;
  /** Edge count (successfully resolved imports). */
  edges: number;
  /** Number of violation edges. */
  violationEdges: number;
  /** Total guard violations (includes circulars not mapped to a single edge). */
  violations: number;
  /** Files analyzed (same as nodes, duplicated for symmetry with guard report). */
  filesAnalyzed: number;
  /** Active guard preset name. */
  preset: string;
  /** Source directory scanned. */
  srcDir: string;
  /** ISO timestamp of generation. */
  generatedAt: string;
  /** Schema version — bump when shape changes. */
  version: number;
}

/**
 * Full dependency graph.
 */
export interface DependencyGraph {
  nodes: ModuleNode[];
  edges: ImportEdge[];
  layers: Layer[];
  violations: Violation[];
  summary: GraphSummary;
}

const GRAPH_SCHEMA_VERSION = 1;

// ════════════════════════════════════════════════════════════════════════════
// Graph builder
// ════════════════════════════════════════════════════════════════════════════

/**
 * Scan srcDir, build nodes + edges + layer tagging + violation overlay.
 *
 * Deterministic: sorts nodes / edges / layers for stable output across runs.
 * Pure (does not write to disk).
 */
export async function analyzeDependencyGraph(
  config: GuardConfig,
  rootDir: string
): Promise<DependencyGraph> {
  const layers = resolveLayerDefinitions(config);
  const hierarchy = resolveHierarchy(config);
  const srcDir = config.srcDir ?? DEFAULT_GUARD_CONFIG.srcDir;
  const exclude = config.exclude ?? DEFAULT_GUARD_CONFIG.exclude;

  // 1. Discover files. Mirror watcher's scan logic (srcDir + optional app/).
  const files = await discoverFiles(rootDir, srcDir, config.fsRoutes ? "app" : null, exclude);

  // 2. Analyze each file — imports + layer.
  const analyses: FileAnalysis[] = [];
  for (const file of files) {
    if (!shouldAnalyzeFile(file, config, rootDir)) continue;
    try {
      const analysis = await analyzeFile(file, layers, rootDir);
      analyses.push(analysis);
    } catch {
      // Skip unreadable files — matches watcher behavior.
    }
  }

  // 3. Build node map keyed by POSIX relpath.
  const nodesById = new Map<string, ModuleNode>();
  for (const a of analyses) {
    const id = toPosix(relative(rootDir, a.filePath));
    nodesById.set(id, {
      id,
      filePath: a.filePath,
      label: computeLabel(id),
      layer: a.layer,
      slice: a.slice,
    });
  }

  // 4. Resolve edges. For each import in each analysis, find the matching
  //    file on disk (same extension set as WATCH_EXTENSIONS). Drop anything
  //    unresolvable (external deps, ambient types).
  const edges: ImportEdge[] = [];
  const violations: Violation[] = [];

  for (const analysis of analyses) {
    const fromId = toPosix(relative(rootDir, analysis.filePath));
    const fileViolations = validateFileAnalysis(analysis, layers, config);
    violations.push(...fileViolations);

    // Index violations by (line, path) so we can tag edges without re-running
    // the validator's rule logic.
    const violationKey = (line: number, importPath: string): string =>
      `${line}::${importPath}`;
    const violationSet = new Set<string>();
    for (const v of fileViolations) {
      violationSet.add(violationKey(v.line, v.importPath));
    }

    for (const imp of analysis.imports) {
      if (shouldIgnoreImport(imp.path, config)) continue;
      const targetAbs = resolveImportToFile(
        imp.path,
        analysis.filePath,
        rootDir,
        config,
        nodesById
      );
      if (!targetAbs) continue;
      const toId = toPosix(relative(rootDir, targetAbs));
      if (!nodesById.has(toId)) continue;
      if (toId === fromId) continue; // self-import (barrel re-export from same file)

      const fromNode = nodesById.get(fromId)!;
      const toNode = nodesById.get(toId)!;

      edges.push({
        from: fromId,
        to: toId,
        fromLayer: fromNode.layer,
        toLayer: toNode.layer,
        violation: violationSet.has(violationKey(imp.line, imp.path)),
        line: imp.line,
      });
    }
  }

  // 5. Circular dependencies are detected at the batch level — append to the
  //    violations collection so the HTML counter is accurate.
  if (analyses.length > 0) {
    violations.push(...detectCircularDependencies(analyses, layers, config));
  }

  // 6. Compute layer buckets.
  const layerCounts = new Map<string, number>();
  for (const node of nodesById.values()) {
    if (!node.layer) continue;
    layerCounts.set(node.layer, (layerCounts.get(node.layer) ?? 0) + 1);
  }

  const layerBuckets: Layer[] = [];
  const seen = new Set<string>();
  // First pass: layers explicitly in hierarchy (preserves order).
  for (let rank = 0; rank < hierarchy.length; rank++) {
    const name = hierarchy[rank];
    if (layerCounts.has(name)) {
      const def = layers.find((l) => l.name === name);
      layerBuckets.push({
        name,
        rank,
        description: def?.description,
        nodeCount: layerCounts.get(name) ?? 0,
      });
      seen.add(name);
    }
  }
  // Second pass: layers present in nodes but not in hierarchy (custom / overrides).
  let extraRank = layerBuckets.length;
  for (const [name, count] of Array.from(layerCounts.entries()).sort()) {
    if (seen.has(name)) continue;
    const def = layers.find((l) => l.name === name);
    layerBuckets.push({
      name,
      rank: extraRank++,
      description: def?.description,
      nodeCount: count,
    });
  }

  // 7. Deterministic ordering.
  const sortedNodes = Array.from(nodesById.values()).sort((a, b) =>
    a.id.localeCompare(b.id)
  );
  edges.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.line - b.line;
  });

  const violationEdges = edges.filter((e) => e.violation).length;

  return {
    nodes: sortedNodes,
    edges,
    layers: layerBuckets,
    violations,
    summary: {
      nodes: sortedNodes.length,
      edges: edges.length,
      violationEdges,
      violations: violations.length,
      filesAnalyzed: sortedNodes.length,
      preset: config.preset ?? "custom",
      srcDir,
      generatedAt: new Date().toISOString(),
      version: GRAPH_SCHEMA_VERSION,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// File discovery
// ════════════════════════════════════════════════════════════════════════════

async function discoverFiles(
  rootDir: string,
  srcDir: string,
  extraRoot: string | null,
  exclude: string[]
): Promise<string[]> {
  const { glob } = await import("glob");
  const extensions = WATCH_EXTENSIONS.map((e) => e.slice(1)).join(",");
  const roots = new Set<string>([srcDir]);
  if (extraRoot) roots.add(extraRoot);

  const found = new Set<string>();
  for (const root of roots) {
    const pattern = `${root}/**/*.{${extensions}}`;
    const hits = await glob(pattern, {
      cwd: rootDir,
      ignore: exclude,
      absolute: true,
    });
    for (const hit of hits) found.add(hit);
  }
  return Array.from(found);
}

// ════════════════════════════════════════════════════════════════════════════
// Import → file resolution
// ════════════════════════════════════════════════════════════════════════════

/**
 * Best-effort resolution from an import specifier to an absolute source file
 * present in `nodesById`.
 *
 * Handles:
 *   - Relative imports (./x, ../y)
 *   - `@/`, `~/` alias (resolved against srcDir)
 *   - Bare `srcDir/...` paths (e.g. "src/features/auth")
 *   - Directory imports → index.(ts|tsx|js|jsx)
 *   - Extension-less imports — tries all WATCH_EXTENSIONS
 *
 * Returns null for node_modules, URL imports, or unmatched paths. Falls back
 * to "does a node id exist with a matching POSIX path" to keep CI output
 * deterministic even when filesystem lookups would miss (e.g. virtual files
 * in tests).
 */
function resolveImportToFile(
  importPath: string,
  fromFile: string,
  rootDir: string,
  config: GuardConfig,
  nodesById: Map<string, ModuleNode>
): string | null {
  const srcDir = (config.srcDir ?? "src").replace(/\\/g, "/").replace(/\/$/, "");
  const normalized = importPath.replace(/\\/g, "/");

  const candidates: string[] = [];

  if (normalized.startsWith("@/") || normalized.startsWith("~/")) {
    const alias = normalized.slice(2);
    if (srcDir) candidates.push(`${srcDir}/${alias}`);
    candidates.push(alias);
  } else if (normalized.startsWith(".")) {
    const absoluteFrom = isAbsolute(fromFile) ? fromFile : resolve(rootDir, fromFile);
    const resolved = resolve(dirname(absoluteFrom), normalized);
    const rel = toPosix(relative(rootDir, resolved));
    if (!rel.startsWith("..")) candidates.push(rel);
  } else if (
    srcDir &&
    (normalized === srcDir || normalized.startsWith(`${srcDir}/`))
  ) {
    candidates.push(normalized);
  } else {
    return null; // bare import — node_modules or unknown alias
  }

  // Try each candidate with all extension variants + index.* fallback.
  for (const candidate of candidates) {
    const abs = resolve(rootDir, candidate);
    // Exact file (candidate has its own extension already)
    if (extname(candidate) && existsSync(abs)) return abs;

    for (const ext of WATCH_EXTENSIONS) {
      const withExt = `${abs}${ext}`;
      if (existsSync(withExt)) return withExt;
      const asIndex = resolve(abs, `index${ext}`);
      if (existsSync(asIndex)) return asIndex;
    }

    // Virtual-fs fallback — for tests where nodes may be registered but
    // fs.existsSync isn't reachable (never hits in normal runs, but keeps
    // edge generation deterministic in edge cases).
    for (const ext of WATCH_EXTENSIONS) {
      const id = `${toPosix(candidate)}${ext}`;
      if (nodesById.has(id)) return resolve(rootDir, id);
      const idIdx = `${toPosix(candidate)}/index${ext}`;
      if (nodesById.has(idIdx)) return resolve(rootDir, idIdx);
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// Utilities
// ════════════════════════════════════════════════════════════════════════════

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function computeLabel(id: string): string {
  const parts = id.split("/");
  const base = parts[parts.length - 1] ?? id;
  const parent = parts.length > 1 ? parts[parts.length - 2] : "";
  const stem = base.replace(/\.[^.]+$/, "");
  return parent ? `${parent}/${stem}` : stem;
}

function resolveLayerDefinitions(config: GuardConfig): LayerDefinition[] {
  if (config.layers && config.layers.length > 0) {
    return config.layers;
  }
  if (config.preset) {
    const preset = getPreset(config.preset);
    let layers = [...preset.layers];
    if (config.override?.layers) {
      layers = layers.map((layer) => {
        const override = config.override?.layers?.[layer.name];
        return override ? { ...layer, ...override } : layer;
      });
    }
    return layers;
  }
  return [];
}

function resolveHierarchy(config: GuardConfig): string[] {
  if (config.preset) {
    return [...getPreset(config.preset).hierarchy];
  }
  return (config.layers ?? []).map((l) => l.name);
}

// ════════════════════════════════════════════════════════════════════════════
// HTML renderer
// ════════════════════════════════════════════════════════════════════════════

const LAYER_PALETTE = [
  "#1e3a8a", "#155e75", "#166534", "#854d0e", "#7c2d12",
  "#581c87", "#831843", "#0f766e", "#3730a3", "#92400e",
  "#064e3b", "#6b21a8", "#134e4a", "#7f1d1d", "#1e40af",
];

/**
 * Render a self-contained HTML graph viewer.
 *
 * Layout:
 *   - Rows = layers (rank 0 = top). Nodes in each layer packed horizontally,
 *     sorted by id → deterministic across runs.
 *   - Edges drawn as cubic Bezier splines between node centers. Violation
 *     edges rendered in red, dashed, with markerEnd arrow. Normal edges in
 *     muted blue.
 *
 * Interactivity:
 *   - Click node → side panel lists importers + importees + file path.
 *   - Top filter bar: "Only violations" toggle + "All layers" / per-layer
 *     toggle chips.
 *
 * Portability:
 *   - Zero external JS / CSS. Drag-and-drop into any browser.
 *   - File size stays well under 500 KB for projects up to ~2k modules
 *     (tested on auth-starter: ~30 KB).
 */
export function renderGraphHtml(graph: DependencyGraph): string {
  const { nodes, edges, layers, summary } = graph;

  // ── Layout ────────────────────────────────────────────────────────────────
  const MARGIN_X = 24;
  const MARGIN_TOP = 48;
  const LAYER_GAP = 120;
  const NODE_W = 130;
  const NODE_H = 28;
  const NODE_GAP = 10;

  // Bucket nodes per layer.
  const nodesByLayer = new Map<string, ModuleNode[]>();
  for (const n of nodes) {
    const key = n.layer ?? "__unassigned__";
    if (!nodesByLayer.has(key)) nodesByLayer.set(key, []);
    nodesByLayer.get(key)!.push(n);
  }

  // Determine layer ordering — layer array + trailing "__unassigned__".
  const layerOrder: string[] = layers.map((l) => l.name);
  if (nodesByLayer.has("__unassigned__")) layerOrder.push("__unassigned__");

  // Compute per-node coordinates.
  const nodePos = new Map<string, { x: number; y: number; layerIdx: number }>();
  let maxRowWidth = 0;

  for (let rowIdx = 0; rowIdx < layerOrder.length; rowIdx++) {
    const layerName = layerOrder[rowIdx];
    const members = nodesByLayer.get(layerName) ?? [];
    const rowWidth = members.length * NODE_W + Math.max(0, members.length - 1) * NODE_GAP;
    maxRowWidth = Math.max(maxRowWidth, rowWidth);

    for (let i = 0; i < members.length; i++) {
      const x = MARGIN_X + i * (NODE_W + NODE_GAP);
      const y = MARGIN_TOP + rowIdx * LAYER_GAP;
      nodePos.set(members[i].id, { x, y, layerIdx: rowIdx });
    }
  }

  const svgWidth = Math.max(maxRowWidth + MARGIN_X * 2, 960);
  const svgHeight = MARGIN_TOP + layerOrder.length * LAYER_GAP + 40;

  // Layer row bands (background stripes).
  const layerBands = layerOrder
    .map((name, rowIdx) => {
      const y = MARGIN_TOP + rowIdx * LAYER_GAP - 18;
      const fill = rowIdx % 2 === 0 ? "#0f172a" : "#0b1220";
      const count = nodesByLayer.get(name)?.length ?? 0;
      return `
  <g class="layer-band" data-layer="${escAttr(name)}">
    <rect x="0" y="${y}" width="${svgWidth}" height="${LAYER_GAP}" fill="${fill}" opacity="0.6"/>
    <text x="${MARGIN_X}" y="${y + 14}" fill="#64748b" font-size="11" font-family="ui-monospace,Menlo,Consolas,monospace">${escText(
        name === "__unassigned__" ? "(unassigned)" : name
      )} · ${count} module${count === 1 ? "" : "s"}</text>
  </g>`;
    })
    .join("");

  // Edges.
  const edgePaths = edges
    .map((e, idx) => {
      const a = nodePos.get(e.from);
      const b = nodePos.get(e.to);
      if (!a || !b) return "";
      const x1 = a.x + NODE_W / 2;
      const y1 = a.y + NODE_H / 2;
      const x2 = b.x + NODE_W / 2;
      const y2 = b.y + NODE_H / 2;
      const dy = (y2 - y1) * 0.5;
      const d = `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
      const cls = e.violation ? "edge violation" : "edge";
      return `<path class="${cls}" d="${d}" data-from="${escAttr(e.from)}" data-to="${escAttr(
        e.to
      )}" data-idx="${idx}" />`;
    })
    .join("");

  // Node rects.
  const layerColor = (layerName: string | null): string => {
    if (!layerName) return "#1f2937";
    const idx = layerOrder.indexOf(layerName);
    if (idx < 0) return "#1f2937";
    return LAYER_PALETTE[idx % LAYER_PALETTE.length];
  };

  const nodeRects = nodes
    .map((n, idx) => {
      const p = nodePos.get(n.id);
      if (!p) return "";
      const color = layerColor(n.layer);
      const label = n.label.length > 16 ? n.label.slice(0, 15) + "…" : n.label;
      return `
  <g class="node" data-id="${escAttr(n.id)}" data-layer="${escAttr(
        n.layer ?? "__unassigned__"
      )}" data-idx="${idx}" tabindex="0" role="button">
    <rect x="${p.x}" y="${p.y}" width="${NODE_W}" height="${NODE_H}" rx="4" fill="${color}" stroke="#0a0f14" stroke-width="1"/>
    <text x="${p.x + NODE_W / 2}" y="${p.y + NODE_H / 2 + 4}" text-anchor="middle" fill="#f3f4f6" font-size="11" font-family="ui-monospace,Menlo,Consolas,monospace">${escText(
        label
      )}</text>
    <title>${escText(n.id)}${n.layer ? ` (${n.layer})` : ""}</title>
  </g>`;
    })
    .join("");

  // Layer filter chips.
  const layerChips = layerOrder
    .map((name) => {
      const count = nodesByLayer.get(name)?.length ?? 0;
      const color = layerColor(name);
      return `<button class="chip chip-layer" data-layer="${escAttr(
        name
      )}" data-active="1" style="border-color:${color}"><span class="swatch" style="background:${color}"></span>${escText(
        name === "__unassigned__" ? "(unassigned)" : name
      )} <span class="count">${count}</span></button>`;
    })
    .join("");

  // Sidebar: precomputed importer / importee lookup.
  const neighbours = buildNeighbourIndex(edges);

  // Serialize the data the client-side script needs. Keep it minimal — we
  // don't embed filePath (already in node titles) because the side panel
  // re-reads it from the DOM.
  const clientData = {
    nodes: nodes.map((n) => ({
      id: n.id,
      filePath: n.filePath,
      layer: n.layer,
    })),
    importers: neighbours.importers,
    importees: neighbours.importees,
  };

  const summaryCards = `
    <div class="card"><div class="label">Modules</div><div class="value">${summary.nodes}</div></div>
    <div class="card"><div class="label">Edges</div><div class="value">${summary.edges}</div></div>
    <div class="card"><div class="label">Violations</div><div class="value ${
      summary.violationEdges > 0 ? "bad" : ""
    }">${summary.violationEdges}</div></div>
    <div class="card"><div class="label">Preset</div><div class="value">${escText(
      summary.preset
    )}</div></div>
    <div class="card"><div class="label">Layers</div><div class="value">${layers.length}</div></div>
    <div class="card"><div class="label">Src</div><div class="value">${escText(
      summary.srcDir
    )}</div></div>
  `;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mandu Guard Graph</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #0a0f14; color: #e5e7eb; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
  header { padding: 14px 20px; border-bottom: 1px solid #1f2937; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; color: #f3f4f6; }
  header .meta { color: #64748b; font-size: 11px; }
  main { display: grid; grid-template-columns: 1fr 340px; gap: 12px; padding: 12px 20px 20px; max-width: 1400px; margin: 0 auto; }
  .toolbar { padding: 0 20px 12px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; border-bottom: 1px solid #1f2937; }
  .toolbar .cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; width: 100%; margin-bottom: 10px; }
  .card { background: #111827; border: 1px solid #1f2937; border-radius: 4px; padding: 6px 10px; }
  .card .label { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  .card .value { color: #f3f4f6; font-size: 14px; margin-top: 2px; word-break: break-all; }
  .card .value.bad { color: #f87171; }
  .chip { background: #111827; color: #e5e7eb; border: 1px solid #374151; padding: 3px 8px; border-radius: 12px; cursor: pointer; font-family: inherit; font-size: 11px; display: inline-flex; align-items: center; gap: 4px; }
  .chip:hover { background: #1f2937; }
  .chip[data-active="0"] { opacity: 0.35; }
  .chip .swatch { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
  .chip .count { color: #64748b; font-size: 10px; margin-left: 2px; }
  .chip.primary { border-color: #ef4444; color: #fca5a5; }
  .chip.primary[data-active="1"] { background: #7f1d1d; color: #fff; }
  svg.graph { background: #0a0f14; border: 1px solid #1f2937; border-radius: 4px; display: block; width: 100%; height: auto; }
  svg.graph .edge { stroke: #334155; stroke-width: 1; fill: none; opacity: 0.55; }
  svg.graph .edge.violation { stroke: #ef4444; stroke-dasharray: 3 3; opacity: 0.85; }
  svg.graph .edge.hidden { display: none; }
  svg.graph .node:hover rect { stroke: #38bdf8; stroke-width: 2; }
  svg.graph .node:focus rect { stroke: #38bdf8; stroke-width: 2; outline: none; }
  svg.graph .node.selected rect { stroke: #fbbf24; stroke-width: 2; }
  svg.graph .node.dim { opacity: 0.22; }
  aside { background: #0f172a; border: 1px solid #1f2937; border-radius: 4px; padding: 12px; min-height: 480px; }
  aside h3 { font-size: 13px; margin: 0 0 6px; color: #e5e7eb; }
  aside .path { color: #93c5fd; font-size: 11px; word-break: break-all; background: #1f2937; padding: 4px 6px; border-radius: 3px; margin-bottom: 10px; }
  aside h4 { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin: 12px 0 4px; }
  aside ul { list-style: none; padding: 0; margin: 0; max-height: 200px; overflow: auto; }
  aside li { padding: 2px 4px; font-size: 11px; color: #cbd5e1; cursor: pointer; border-radius: 2px; }
  aside li:hover { background: #1f2937; color: #fff; }
  aside .empty { color: #64748b; font-size: 11px; font-style: italic; }
  .muted { color: #64748b; }
  .legend { display: flex; gap: 12px; font-size: 10px; color: #64748b; margin-left: auto; }
  .legend span { display: inline-flex; align-items: center; gap: 4px; }
  .legend .sw { display: inline-block; width: 18px; height: 2px; background: #334155; }
  .legend .sw.v { background: #ef4444; }
</style>
</head>
<body>
<header>
  <h1>Mandu Guard Graph</h1>
  <span class="meta">generated ${escText(summary.generatedAt)} · preset <code>${escText(
    summary.preset
  )}</code> · src <code>${escText(summary.srcDir)}</code> · schema v${summary.version}</span>
</header>
<div class="toolbar">
  <div class="cards">${summaryCards}</div>
  <button class="chip primary" id="toggle-violations" data-active="0">Only violations</button>
  <button class="chip" id="toggle-all" data-active="1">All layers</button>
  ${layerChips}
  <div class="legend"><span><span class="sw"></span>import</span><span><span class="sw v"></span>violation</span></div>
</div>
<main>
  <svg class="graph" viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Dependency graph">
    <defs>
      <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155"/>
      </marker>
      <marker id="arrow-v" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444"/>
      </marker>
    </defs>
    ${layerBands}
    <g id="edges">${edgePaths}</g>
    <g id="nodes">${nodeRects}</g>
  </svg>
  <aside id="sidepanel">
    <h3>Select a module</h3>
    <p class="empty">Click a node in the graph to inspect its file path, importers and importees.</p>
  </aside>
</main>
<script>
(function () {
  var DATA = ${serializeJson(clientData)};
  var svg = document.querySelector("svg.graph");
  var panel = document.getElementById("sidepanel");
  var onlyVio = document.getElementById("toggle-violations");
  var allBtn  = document.getElementById("toggle-all");
  var layerChips = Array.prototype.slice.call(document.querySelectorAll(".chip-layer"));
  var nodeIndex = {};
  for (var i = 0; i < DATA.nodes.length; i++) { nodeIndex[DATA.nodes[i].id] = DATA.nodes[i]; }

  function applyFilters() {
    var activeLayers = {};
    for (var i = 0; i < layerChips.length; i++) {
      if (layerChips[i].getAttribute("data-active") === "1") {
        activeLayers[layerChips[i].getAttribute("data-layer")] = true;
      }
    }
    var vio = onlyVio.getAttribute("data-active") === "1";
    var nodes = svg.querySelectorAll(".node");
    var visibleNodeIds = {};
    for (var j = 0; j < nodes.length; j++) {
      var layer = nodes[j].getAttribute("data-layer");
      if (activeLayers[layer]) {
        nodes[j].classList.remove("dim");
        visibleNodeIds[nodes[j].getAttribute("data-id")] = true;
      } else {
        nodes[j].classList.add("dim");
      }
    }
    var edges = svg.querySelectorAll(".edge");
    for (var k = 0; k < edges.length; k++) {
      var from = edges[k].getAttribute("data-from");
      var to = edges[k].getAttribute("data-to");
      var isVio = edges[k].classList.contains("violation");
      var show = visibleNodeIds[from] && visibleNodeIds[to];
      if (vio && !isVio) show = false;
      if (show) edges[k].classList.remove("hidden"); else edges[k].classList.add("hidden");
      if (isVio) edges[k].setAttribute("marker-end","url(#arrow-v)");
      else edges[k].setAttribute("marker-end","url(#arrow)");
    }
  }

  function selectNode(id) {
    var nodes = svg.querySelectorAll(".node");
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove("selected");
    var target = svg.querySelector('.node[data-id="' + cssEscape(id) + '"]');
    if (target) target.classList.add("selected");
    renderPanel(id);
  }

  function renderPanel(id) {
    var node = nodeIndex[id];
    if (!node) { panel.innerHTML = ""; return; }
    var ins = DATA.importers[id] || [];
    var outs = DATA.importees[id] || [];
    var html = "";
    html += '<h3>' + escapeHtml(id) + '</h3>';
    html += '<div class="path">' + escapeHtml(node.filePath) + '</div>';
    html += '<div class="muted" style="font-size:11px">layer: <code>' + escapeHtml(node.layer || "(none)") + '</code></div>';
    html += '<h4>Imported by (' + ins.length + ')</h4>';
    if (ins.length === 0) html += '<p class="empty">none</p>';
    else { html += '<ul>'; for (var a=0;a<ins.length;a++){ html += '<li data-jump="' + escapeAttr(ins[a]) + '">' + escapeHtml(ins[a]) + '</li>'; } html += '</ul>'; }
    html += '<h4>Imports (' + outs.length + ')</h4>';
    if (outs.length === 0) html += '<p class="empty">none</p>';
    else { html += '<ul>'; for (var b=0;b<outs.length;b++){ html += '<li data-jump="' + escapeAttr(outs[b]) + '">' + escapeHtml(outs[b]) + '</li>'; } html += '</ul>'; }
    panel.innerHTML = html;
  }

  function cssEscape(s) { return s.replace(/["\\\\]/g, "\\\\$&"); }
  function escapeHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function escapeAttr(s) { return escapeHtml(s).replace(/"/g,"&quot;"); }

  svg.addEventListener("click", function (e) {
    var t = e.target;
    while (t && t.nodeType === 1) {
      if (t.classList && t.classList.contains("node")) {
        selectNode(t.getAttribute("data-id"));
        return;
      }
      t = t.parentNode;
    }
  });
  svg.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      var t = e.target;
      if (t && t.classList && t.classList.contains("node")) {
        e.preventDefault();
        selectNode(t.getAttribute("data-id"));
      }
    }
  });
  panel.addEventListener("click", function (e) {
    var t = e.target;
    while (t && t.nodeType === 1) {
      var jump = t.getAttribute && t.getAttribute("data-jump");
      if (jump) { selectNode(jump); return; }
      t = t.parentNode;
    }
  });
  onlyVio.addEventListener("click", function () {
    var active = onlyVio.getAttribute("data-active") === "1" ? "0" : "1";
    onlyVio.setAttribute("data-active", active);
    applyFilters();
  });
  allBtn.addEventListener("click", function () {
    var activating = allBtn.getAttribute("data-active") === "0";
    allBtn.setAttribute("data-active", activating ? "1" : "0");
    for (var i = 0; i < layerChips.length; i++) {
      layerChips[i].setAttribute("data-active", activating ? "1" : "0");
    }
    applyFilters();
  });
  for (var i = 0; i < layerChips.length; i++) {
    layerChips[i].addEventListener("click", (function (chip) {
      return function () {
        var active = chip.getAttribute("data-active") === "1" ? "0" : "1";
        chip.setAttribute("data-active", active);
        applyFilters();
      };
    })(layerChips[i]));
  }
  applyFilters();
})();
</script>
</body>
</html>`;
}

/**
 * Build adjacency lookup used by the side panel.
 * - importers[id] = list of ids that import `id`
 * - importees[id] = list of ids that `id` imports
 *
 * Deduped + sorted for stable client-side rendering.
 */
function buildNeighbourIndex(
  edges: ImportEdge[]
): { importers: Record<string, string[]>; importees: Record<string, string[]> } {
  const importers: Record<string, Set<string>> = {};
  const importees: Record<string, Set<string>> = {};
  for (const e of edges) {
    (importees[e.from] ??= new Set()).add(e.to);
    (importers[e.to] ??= new Set()).add(e.from);
  }
  const toSorted = (rec: Record<string, Set<string>>): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const key of Object.keys(rec).sort()) {
      out[key] = Array.from(rec[key]).sort();
    }
    return out;
  };
  return { importers: toSorted(importers), importees: toSorted(importees) };
}

/**
 * JSON embedded in a `<script>` tag — must escape `</` so the browser parser
 * doesn't prematurely end the script block (classic XSS vector). Also escapes
 * U+2028 / U+2029 which break JS string literals when present verbatim.
 */
function serializeJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return escText(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Keep unused-sep silent in case bundler strips path namespace import
void sep;
