/**
 * Phase 18.η — Bundle analyzer.
 *
 * Post-processes `.mandu/client/` output + the emitted `BundleManifest` into
 * a structured JSON report and a self-contained HTML treemap. Intended for
 * `mandu build --analyze` and for programmatic use from deploy scripts / CI.
 *
 * ── What this module produces ────────────────────────────────────────────────
 *
 *   analyzeBundle(rootDir, manifest) → AnalyzeReport
 *     {
 *       islands: [
 *         {
 *           name:        "home"             // island route id
 *           js:          "/.mandu/client/home.island.js"
 *           totalRaw:    123456
 *           totalGz:     42017
 *           priority:    "visible"
 *           shared:      ["runtime","vendor"]    // chunks referenced
 *           modules:     [ { path, size, gz } ... up to top-20 ]
 *         }
 *       ],
 *       shared: [
 *         {
 *           id:          "vendor"
 *           js:          "/.mandu/client/_vendor.js"
 *           size:        258912
 *           gz:          87120
 *           usedBy:      ["home","dashboard"]
 *         }
 *       ],
 *       summary: {
 *         totalRaw, totalGz,
 *         largestIsland: { name, totalRaw },
 *         heaviestDep:   { path, size }         // heaviest module seen anywhere
 *         islandCount, sharedCount,
 *       }
 *     }
 *
 * ── Module-level breakdown ──────────────────────────────────────────────────
 *
 * When `--sourcemap` was passed to `mandu build`, each JS output gets an
 * external `.map` file next to it. We parse the `sources[]` array + the
 * `sourcesContent[]` (if present) to derive per-source-file byte sizes. That
 * gives us the "top-20 heaviest modules per island" drill-down that the HTML
 * report renders as a second-level treemap.
 *
 * When sourcemaps are absent we degrade gracefully:
 *   - `modules: []` on every island entry
 *   - `heaviestDep: { path: "<sourcemap unavailable>", size: 0 }`
 *   - HTML report still renders the island-level treemap
 *
 * ── Design choices ──────────────────────────────────────────────────────────
 *
 *   - Zero runtime deps. `zlib` (`Bun.gzipSync`) + `fs/promises` only.
 *     The HTML report inlines its own squarify treemap (~150 LOC) so the
 *     output file is fully portable — drag-and-drop into any browser, no
 *     CDN. This is a deliberate no-d3 choice (see `report.html` comment).
 *   - Pure function. `analyzeBundle()` does filesystem reads but does not
 *     write. Serialization (`writeReport()` / `renderHtml()`) is separate so
 *     tests can assert on the report shape without touching disk.
 *   - Stable output. Islands are sorted by `totalRaw DESC`, shared chunks by
 *     size DESC, modules within an island by size DESC. CI snapshots won't
 *     churn on Map iteration order.
 *
 * ── What this module deliberately does NOT do ───────────────────────────────
 *
 *   - No tree-shaking suggestions. That's an optimizer concern; the report
 *     is purely descriptive. Agent η's scope ends at "show the developer
 *     what's in their bundle".
 *   - No historical / delta comparison. A separate command (future
 *     `mandu build --analyze-against=prev.json`) can diff two reports.
 *   - No network. Absolutely nothing is fetched. The report is generated
 *     from files on disk produced by `buildClientBundles()`.
 */

import fs from "fs/promises";
import path from "path";
import zlib from "zlib";

import type { BundleManifest } from "./types";
import type { BudgetReport } from "./budget";

// ============================================================================
// Types
// ============================================================================

export interface AnalyzeModule {
  /** Source path as emitted by the sourcemap (e.g. `node_modules/react/index.js`). */
  path: string;
  /** Raw byte contribution attributed to this module inside the final bundle. */
  size: number;
  /** Estimated gzip size (proportional scaling from bundle gz, since gz is non-additive). */
  gz: number;
}

export interface AnalyzeIsland {
  /** Island / route id (e.g. `home`, `dashboard`). */
  name: string;
  /** Absolute `/.mandu/client/<file>.js` path from the manifest. */
  js: string;
  /** Raw (uncompressed) bytes of the island's JS output. */
  totalRaw: number;
  /** Real gzip size of the island's JS output — not an estimate. */
  totalGz: number;
  /** Hydration priority propagated from the manifest. */
  priority: "immediate" | "visible" | "idle" | "interaction";
  /** Shared-chunk ids this island depends on (e.g. `["runtime", "vendor"]`). */
  shared: string[];
  /** Top-20 heaviest source modules (empty when sourcemaps are unavailable). */
  modules: AnalyzeModule[];
}

export interface AnalyzeSharedChunk {
  /** Logical id — `runtime`, `vendor`, `router`, `fastRefresh.runtime`, etc. */
  id: string;
  /** `/.mandu/client/...` path from the manifest. */
  js: string;
  /** Raw byte size of the chunk. */
  size: number;
  /** Gzip byte size of the chunk. */
  gz: number;
  /** Every island name that transitively depends on this chunk. */
  usedBy: string[];
}

export interface AnalyzeSummary {
  /** Sum of every island + every shared chunk, raw bytes. */
  totalRaw: number;
  /** Sum of every island + every shared chunk, gzip bytes. */
  totalGz: number;
  /** The single heaviest island (by raw bytes). */
  largestIsland: { name: string; totalRaw: number } | null;
  /** The heaviest source module across all islands (source-map derived). */
  heaviestDep: { path: string; size: number } | null;
  /** Island count — convenience for CLI table rendering. */
  islandCount: number;
  /** Shared-chunk count. */
  sharedCount: number;
  /** Deduplication savings: bytes that would have been duplicated if each
   * island inlined its shared deps instead of referencing them. */
  dedupeSavings: number;
  /** Report schema version. Bump on breaking shape changes. */
  version: 1;
  /** ISO timestamp when the report was generated. */
  generatedAt: string;
}

export interface AnalyzeReport {
  islands: AnalyzeIsland[];
  shared: AnalyzeSharedChunk[];
  summary: AnalyzeSummary;
}

// ============================================================================
// Size primitives
// ============================================================================

/**
 * Strip the leading `/.mandu/client/` prefix and join against `<rootDir>/.mandu/client/`.
 *
 * The bundle manifest stores URLs as browser-relative absolute paths
 * (`/.mandu/client/<file>`). The analyzer runs on disk, so we need to flip
 * the URL into a `fs` path. Returns `null` for any URL that does not match
 * the expected shape — defensive against `data:` / `http:` / tampered
 * manifests. (The manifest is already Zod-validated at build time, but
 * belt-and-braces: one more check means this file is safe to feed an
 * unvalidated manifest from an old build.)
 */
function urlToFsPath(rootDir: string, url: string | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  if (!url.startsWith("/.mandu/client/")) return null;
  const rel = url.slice("/".length); // keep `.mandu/client/...`
  return path.join(rootDir, rel);
}

/**
 * Read a file and return both raw and gzip byte counts. Returns `{ raw: 0,
 * gz: 0 }` when the file is missing — the bundler may have emitted a
 * stub entry (e.g. `shared.fastRefresh` in prod) and we don't want the
 * report to crash on one missing file.
 */
async function measureFile(absPath: string): Promise<{ raw: number; gz: number }> {
  try {
    const buf = await fs.readFile(absPath);
    const gz = zlib.gzipSync(buf, { level: 9 });
    return { raw: buf.byteLength, gz: gz.byteLength };
  } catch {
    return { raw: 0, gz: 0 };
  }
}

// ============================================================================
// Sourcemap parsing
// ============================================================================

interface SourceMapV3 {
  version: 3;
  sources: string[];
  sourcesContent?: (string | null)[];
  mappings?: string;
  file?: string;
}

/**
 * Parse the sourcemap file associated with a built bundle (same path + `.map`).
 *
 * Returns a `AnalyzeModule[]` aggregated by source path, largest first,
 * truncated at `limit` entries. Size attribution uses `sourcesContent`
 * byte length as the best available proxy. When sourcesContent is absent
 * (minified-only map) we return an empty array — a stub rather than
 * misleading data.
 *
 * Gzip per module is estimated as `size * (bundleGz / bundleRaw)` — a
 * linear proportional attribution. Gzip is not actually additive (two
 * identical modules don't double the gz weight), so this is an
 * approximation; the HTML treemap labels it as "~gz" to signal that.
 */
async function readTopModules(
  jsAbsPath: string,
  bundleRaw: number,
  bundleGz: number,
  limit = 20
): Promise<AnalyzeModule[]> {
  const mapPath = `${jsAbsPath}.map`;
  let text: string;
  try {
    text = await fs.readFile(mapPath, "utf8");
  } catch {
    return [];
  }
  let map: SourceMapV3;
  try {
    map = JSON.parse(text) as SourceMapV3;
  } catch {
    return [];
  }
  if (!Array.isArray(map.sources) || !Array.isArray(map.sourcesContent)) {
    return [];
  }

  // One source can appear multiple times in a concatenated chunk; we
  // aggregate by path. Use a Map so insertion order is preserved for ties.
  const sizeByPath = new Map<string, number>();
  for (let i = 0; i < map.sources.length; i++) {
    const src = map.sources[i];
    const content = map.sourcesContent[i];
    if (typeof content !== "string") continue;
    // Normalise `../../../node_modules/react/index.js` → `react/index.js`
    // so the treemap legend groups every `react/*` under the same prefix.
    const norm = normalizeSourcePath(src);
    sizeByPath.set(norm, (sizeByPath.get(norm) ?? 0) + content.length);
  }

  const gzRatio = bundleRaw > 0 ? bundleGz / bundleRaw : 0;
  return [...sizeByPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([p, size]) => ({
      path: p,
      size,
      gz: Math.round(size * gzRatio),
    }));
}

/**
 * Collapse a Bun.build source path to something recognizable.
 *
 * Examples:
 *   `../../../node_modules/react/index.js` → `react/index.js`
 *   `../../src/app/home/page.tsx`          → `src/app/home/page.tsx`
 *   `bun:react-dom`                         → `bun:react-dom`
 */
export function normalizeSourcePath(raw: string): string {
  if (!raw) return "<unknown>";
  if (raw.startsWith("bun:")) return raw;
  // Normalise Windows slashes FIRST so the relative-prefix strip below
  // catches `..\src\foo` as well as `../src/foo`.
  let p = raw.replace(/\\/g, "/");
  // Strip leading `./` and `../` segments.
  p = p.replace(/^(\.\.\/|\.\/)+/, "");
  // `node_modules/foo/...` → `foo/...` (keeps dep identity, drops pnpm noise)
  const nmIdx = p.lastIndexOf("node_modules/");
  if (nmIdx !== -1) {
    p = p.slice(nmIdx + "node_modules/".length);
  }
  return p;
}

// ============================================================================
// Main analyzer
// ============================================================================

/**
 * Read every artifact referenced by the manifest and build the report.
 *
 * `rootDir` is the project root (the one containing `.mandu/`).
 */
export async function analyzeBundle(
  rootDir: string,
  manifest: BundleManifest
): Promise<AnalyzeReport> {
  // ── Step 1: Measure shared chunks ────────────────────────────────────────
  const shared: AnalyzeSharedChunk[] = [];
  const sharedUrls: { id: string; url: string }[] = [];
  if (manifest.shared?.runtime) sharedUrls.push({ id: "runtime", url: manifest.shared.runtime });
  if (manifest.shared?.vendor) sharedUrls.push({ id: "vendor", url: manifest.shared.vendor });
  if (manifest.shared?.router) sharedUrls.push({ id: "router", url: manifest.shared.router });
  if (manifest.shared?.fastRefresh?.runtime) {
    sharedUrls.push({
      id: "fastRefresh.runtime",
      url: manifest.shared.fastRefresh.runtime,
    });
  }
  if (manifest.shared?.fastRefresh?.glue) {
    sharedUrls.push({ id: "fastRefresh.glue", url: manifest.shared.fastRefresh.glue });
  }

  const sharedById = new Map<string, AnalyzeSharedChunk>();
  for (const { id, url } of sharedUrls) {
    const abs = urlToFsPath(rootDir, url);
    if (!abs) continue;
    const { raw, gz } = await measureFile(abs);
    const entry: AnalyzeSharedChunk = { id, js: url, size: raw, gz, usedBy: [] };
    shared.push(entry);
    sharedById.set(id, entry);
  }

  // ── Step 2: Walk islands / bundles ───────────────────────────────────────
  //
  // Both `manifest.bundles` (route-level) and `manifest.islands` (per-island
  // code-split) describe client JS entrypoints. We treat each as an "island"
  // in the report — the shape of the drill-down doesn't differ, only the id.
  const islandSources: { name: string; url: string; priority: AnalyzeIsland["priority"]; deps: string[] }[] = [];

  for (const [routeId, entry] of Object.entries(manifest.bundles ?? {})) {
    islandSources.push({
      name: routeId,
      url: entry.js,
      priority: entry.priority,
      deps: entry.dependencies ?? [],
    });
  }
  for (const [islandName, entry] of Object.entries(manifest.islands ?? {})) {
    // Avoid double-counting: if a per-island chunk shares its route id with
    // a route-level bundle, we prefer the island entry (finer granularity).
    const existing = islandSources.findIndex((s) => s.name === islandName);
    if (existing !== -1) islandSources.splice(existing, 1);
    islandSources.push({
      name: islandName,
      url: entry.js,
      priority: entry.priority,
      deps: [],
    });
  }
  for (const [partialName, entry] of Object.entries(manifest.partials ?? {})) {
    islandSources.push({
      name: `partial:${partialName}`,
      url: entry.js,
      priority: entry.priority,
      deps: [],
    });
  }

  const islands: AnalyzeIsland[] = [];
  for (const src of islandSources) {
    const abs = urlToFsPath(rootDir, src.url);
    if (!abs) continue;
    const { raw, gz } = await measureFile(abs);
    const modules = await readTopModules(abs, raw, gz);

    // Shared-chunk attribution: every island implicitly depends on the
    // `runtime` + `vendor` chunks the bundler emits as a contract; `router`
    // is added when the app uses SPA navigation. We add the dep names here
    // so `shared[].usedBy` stays in sync with the treemap links.
    const implicitShared = ["runtime", "vendor"];
    if (sharedById.has("router")) implicitShared.push("router");
    const sharedDeps = [...new Set([...implicitShared, ...src.deps])].filter((id) =>
      sharedById.has(id)
    );
    for (const depId of sharedDeps) {
      const entry = sharedById.get(depId);
      if (entry && !entry.usedBy.includes(src.name)) entry.usedBy.push(src.name);
    }

    islands.push({
      name: src.name,
      js: src.url,
      totalRaw: raw,
      totalGz: gz,
      priority: src.priority,
      shared: sharedDeps,
      modules,
    });
  }

  islands.sort((a, b) => b.totalRaw - a.totalRaw);
  shared.sort((a, b) => b.size - a.size);

  // ── Step 3: Summary ──────────────────────────────────────────────────────
  const islandTotalRaw = islands.reduce((s, i) => s + i.totalRaw, 0);
  const islandTotalGz = islands.reduce((s, i) => s + i.totalGz, 0);
  const sharedTotalRaw = shared.reduce((s, c) => s + c.size, 0);
  const sharedTotalGz = shared.reduce((s, c) => s + c.gz, 0);

  // Dedupe savings — if every island had to inline each shared chunk it
  // uses, the wire cost would be `sum_over_islands(sharedUsed). Subtracting
  // the one-copy cost gives the "load-once" savings the manifest unlocks.
  let dedupeSavings = 0;
  for (const chunk of shared) {
    if (chunk.usedBy.length > 1) {
      dedupeSavings += chunk.size * (chunk.usedBy.length - 1);
    }
  }

  let heaviestDep: AnalyzeSummary["heaviestDep"] = null;
  for (const island of islands) {
    for (const m of island.modules) {
      if (!heaviestDep || m.size > heaviestDep.size) {
        heaviestDep = { path: m.path, size: m.size };
      }
    }
  }

  const summary: AnalyzeSummary = {
    totalRaw: islandTotalRaw + sharedTotalRaw,
    totalGz: islandTotalGz + sharedTotalGz,
    largestIsland: islands[0]
      ? { name: islands[0].name, totalRaw: islands[0].totalRaw }
      : null,
    heaviestDep,
    islandCount: islands.length,
    sharedCount: shared.length,
    dedupeSavings,
    version: 1,
    generatedAt: new Date().toISOString(),
  };

  return { islands, shared, summary };
}

// ============================================================================
// Serializers
// ============================================================================

/**
 * Write `report.json` + `report.html` to `<rootDir>/.mandu/analyze/`.
 *
 * Returns the absolute paths of both files so the CLI can print them.
 * Callers that want JSON only can skip the HTML step via `{ htmlPath: null }`.
 *
 * Phase 18.φ — `opts.budget` is an optional pre-computed budget report
 * that, when present, renders a budget-bar section in the HTML output
 * and is serialised alongside `report.json` as `report.budget`.
 */
export async function writeAnalyzeReport(
  rootDir: string,
  report: AnalyzeReport,
  opts: { html?: boolean; budget?: BudgetReport | null } = {}
): Promise<{ jsonPath: string; htmlPath: string | null }> {
  const outDir = path.join(rootDir, ".mandu", "analyze");
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "report.json");
  const jsonPayload = opts.budget ? { ...report, budget: opts.budget } : report;
  await fs.writeFile(jsonPath, JSON.stringify(jsonPayload, null, 2), "utf8");

  let htmlPath: string | null = null;
  if (opts.html !== false) {
    htmlPath = path.join(outDir, "report.html");
    await fs.writeFile(htmlPath, renderAnalyzeHtml(report, opts.budget ?? null), "utf8");
  }
  return { jsonPath, htmlPath };
}

// ============================================================================
// HTML report
// ============================================================================

/**
 * Render a self-contained single-file HTML report. No external CDN, no d3,
 * no webpack-bundle-analyzer — just inline SVG + a hand-rolled squarify
 * treemap. The result is ~12-30 KB for typical projects.
 *
 * Design notes:
 *   - Dark theme + monospace font so stack-trace-like paths stay readable.
 *   - Clicking an island rectangle drills into its module breakdown.
 *   - ESC / click-outside returns to the island view.
 *   - All SVG elements are generated server-side — the client script only
 *     toggles visibility. This keeps the report working even with JS
 *     disabled (you lose drill-down, but the island treemap still renders).
 */
export function renderAnalyzeHtml(
  report: AnalyzeReport,
  budget: BudgetReport | null = null
): string {
  const { islands, shared, summary } = report;

  // ── Island-level treemap ─────────────────────────────────────────────────
  const VIEW_W = 960;
  const VIEW_H = 480;
  const islandRects = squarify(
    islands.map((i) => ({ name: i.name, value: Math.max(i.totalRaw, 1), island: i })),
    VIEW_W,
    VIEW_H
  );

  const islandSvg = islandRects
    .map((r, idx) => {
      const color = ISLAND_PALETTE[idx % ISLAND_PALETTE.length];
      const island = r.data.island;
      const label = `${r.data.name}\n${fmtBytes(island.totalRaw)} / ${fmtBytes(island.totalGz)} gz`;
      const canLabel = r.w > 60 && r.h > 28;
      // XSS note: island names come from user route ids / island file
      // basenames, so they are not fully trusted. We never embed the raw
      // name in a JS string context — the drill target is carried on
      // `data-drill` and a single delegated event listener reads it via
      // `Element.dataset`, which does zero string parsing.
      return `
  <g class="island-cell" data-drill="${escAttr(r.data.name)}" tabindex="0" role="button" style="cursor:pointer">
    <rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${color}" stroke="#0a0f14" stroke-width="1"/>
    ${
      canLabel
        ? `<text x="${r.x + 8}" y="${r.y + 18}" fill="#fff" font-size="12" font-family="ui-monospace,Menlo,Consolas,monospace">${escText(r.data.name)}</text>
       <text x="${r.x + 8}" y="${r.y + 34}" fill="#cbd5e1" font-size="10" font-family="ui-monospace,Menlo,Consolas,monospace">${fmtBytes(
            island.totalRaw
          )} / ${fmtBytes(island.totalGz)} gz</text>`
        : ""
    }
    <title>${escText(label)}</title>
  </g>`;
    })
    .join("");

  // ── Per-island drill-down panels ─────────────────────────────────────────
  //
  // DOM id is `drill-<index>` (a safe numeric) rather than `drill-<name>`
  // so the name never enters an id-attribute context. The name itself is
  // still shown via the `data-drill` attribute matched by the client
  // script, both values normalised by `escAttr` / `escText`.
  const drillPanels = islands
    .map((island, idx) => {
      const safeId = `drill-${idx}`;
      if (island.modules.length === 0) {
        return `<section class="drill" id="${safeId}" data-drill="${escAttr(island.name)}" hidden>
          <h3>${escText(island.name)}</h3>
          <p class="muted">No sourcemap available for this bundle. Re-run with <code>mandu build --sourcemap --analyze</code> to see per-module breakdown.</p>
        </section>`;
      }
      const maxSize = Math.max(...island.modules.map((m) => m.size), 1);
      const rows = island.modules
        .map((m) => {
          const pct = (m.size / island.totalRaw) * 100;
          const barW = (m.size / maxSize) * 100;
          return `<tr>
            <td class="mod-path" title="${escAttr(m.path)}">${escText(m.path)}</td>
            <td class="num">${fmtBytes(m.size)}</td>
            <td class="num muted">~${fmtBytes(m.gz)}</td>
            <td class="num">${pct.toFixed(1)}%</td>
            <td class="bar"><span style="width:${barW.toFixed(2)}%"></span></td>
          </tr>`;
        })
        .join("");
      return `<section class="drill" id="${safeId}" data-drill="${escAttr(island.name)}" hidden>
        <h3>${escText(island.name)} <span class="muted">${fmtBytes(island.totalRaw)} raw · ${fmtBytes(island.totalGz)} gz · shared: ${island.shared.join(", ") || "—"}</span></h3>
        <table class="modtable">
          <thead><tr><th>module</th><th>size</th><th>~gz</th><th>%</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
    })
    .join("");

  // ── Shared-chunks table ──────────────────────────────────────────────────
  const sharedRows = shared
    .map(
      (c) => `<tr>
      <td>${escText(c.id)}</td>
      <td class="num">${fmtBytes(c.size)}</td>
      <td class="num">${fmtBytes(c.gz)}</td>
      <td>${c.usedBy.length}</td>
      <td class="muted">${escText(c.usedBy.join(", ") || "—")}</td>
    </tr>`
    )
    .join("");

  // ── Summary cards ────────────────────────────────────────────────────────
  const summaryCards = `
    <div class="card"><div class="label">Total raw</div><div class="value">${fmtBytes(summary.totalRaw)}</div></div>
    <div class="card"><div class="label">Total gzip</div><div class="value">${fmtBytes(summary.totalGz)}</div></div>
    <div class="card"><div class="label">Islands</div><div class="value">${summary.islandCount}</div></div>
    <div class="card"><div class="label">Shared chunks</div><div class="value">${summary.sharedCount}</div></div>
    <div class="card"><div class="label">Largest island</div><div class="value">${
      summary.largestIsland
        ? `${escText(summary.largestIsland.name)} (${fmtBytes(summary.largestIsland.totalRaw)})`
        : "—"
    }</div></div>
    <div class="card"><div class="label">Heaviest dep</div><div class="value">${
      summary.heaviestDep
        ? `${escText(summary.heaviestDep.path)} (${fmtBytes(summary.heaviestDep.size)})`
        : "—"
    }</div></div>
    <div class="card"><div class="label">Dedupe savings</div><div class="value">${fmtBytes(summary.dedupeSavings)}</div></div>
  `;

  // ── Phase 18.φ — Budget bar section ──────────────────────────────────────
  //
  // Renders one horizontal bar per island when a budget was evaluated,
  // coloured by `BudgetStatus`: green (within), yellow (within 10% of
  // limit), red (exceeded). The bar width is proportional to
  // `island.gz / gzLimit` (or `raw / rawLimit` if gzLimit is null).
  // When every axis is unconstrained the bar is hidden with a muted "—"
  // placeholder. Matches the "red/yellow/green" spec in Phase 18.φ.
  const budgetSection = budget
    ? renderBudgetSection(budget)
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mandu Bundle Analyzer</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; padding: 0; background: #0a0f14; color: #e5e7eb; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 13px; }
  header { padding: 16px 20px; border-bottom: 1px solid #1f2937; display: flex; align-items: baseline; gap: 12px; }
  header h1 { font-size: 16px; margin: 0; font-weight: 600; color: #f3f4f6; }
  header .meta { color: #64748b; font-size: 11px; }
  main { padding: 20px; max-width: 1080px; margin: 0 auto; }
  h2 { font-size: 14px; color: #9ca3af; font-weight: 600; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: 0.08em; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; }
  .card { background: #111827; border: 1px solid #1f2937; border-radius: 4px; padding: 10px 12px; }
  .card .label { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
  .card .value { color: #f3f4f6; font-size: 14px; margin-top: 4px; word-break: break-all; }
  svg.treemap { background: #0f172a; border: 1px solid #1f2937; border-radius: 4px; display: block; width: 100%; height: auto; }
  .island-cell:hover rect { stroke: #38bdf8; stroke-width: 2; }
  .island-cell:focus rect { stroke: #38bdf8; stroke-width: 2; outline: none; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #1f2937; font-size: 12px; }
  th { color: #64748b; font-weight: 500; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mod-path { max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  td.bar { width: 120px; }
  td.bar span { display: block; height: 8px; background: linear-gradient(90deg, #38bdf8, #0ea5e9); border-radius: 2px; }
  .muted { color: #64748b; }
  .modtable tr:hover td { background: #0f172a; }
  section.drill { margin-top: 16px; background: #0f172a; border: 1px solid #1f2937; border-radius: 4px; padding: 14px; }
  section.drill h3 { margin: 0 0 10px; font-size: 13px; color: #e5e7eb; font-weight: 600; }
  code { background: #1f2937; padding: 1px 4px; border-radius: 2px; color: #93c5fd; }
  button.close { background: #1f2937; color: #e5e7eb; border: 1px solid #374151; padding: 4px 10px; border-radius: 3px; cursor: pointer; font-family: inherit; font-size: 11px; }
  button.close:hover { background: #374151; }
  .drill-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  /* Phase 18.φ — budget bars */
  .budget-row { display: grid; grid-template-columns: 180px 1fr 160px; gap: 10px; align-items: center; padding: 4px 0; border-bottom: 1px solid #1f2937; }
  .budget-row:last-child { border-bottom: none; }
  .budget-name { font-size: 12px; color: #e5e7eb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .budget-meta { font-size: 11px; color: #94a3b8; text-align: right; font-variant-numeric: tabular-nums; }
  .budget-bar-track { position: relative; height: 10px; background: #0f172a; border: 1px solid #1f2937; border-radius: 2px; overflow: hidden; }
  .budget-bar-fill { height: 100%; border-radius: 2px; }
  .budget-bar-fill.within { background: linear-gradient(90deg, #16a34a, #22c55e); }
  .budget-bar-fill.within10 { background: linear-gradient(90deg, #ca8a04, #eab308); }
  .budget-bar-fill.exceeded { background: linear-gradient(90deg, #b91c1c, #ef4444); }
  .budget-bar-fill.unbounded { background: repeating-linear-gradient(45deg, #1f2937, #1f2937 4px, #0f172a 4px, #0f172a 8px); }
  .budget-legend { display: inline-flex; gap: 14px; font-size: 11px; color: #94a3b8; margin-bottom: 10px; }
  .budget-legend span::before { content: ""; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: middle; }
  .budget-legend .lg-within::before { background: #22c55e; }
  .budget-legend .lg-within10::before { background: #eab308; }
  .budget-legend .lg-exceeded::before { background: #ef4444; }
  .budget-mode { display: inline-block; font-size: 10px; text-transform: uppercase; padding: 2px 6px; border-radius: 2px; border: 1px solid #374151; color: #cbd5e1; margin-left: 8px; letter-spacing: 0.04em; }
  .budget-mode.error { background: #7f1d1d; border-color: #991b1b; color: #fecaca; }
  .budget-mode.warning { background: #713f12; border-color: #854d0e; color: #fde68a; }
</style>
</head>
<body>
<header>
  <h1>Mandu Bundle Analyzer</h1>
  <span class="meta">generated ${escText(summary.generatedAt)} · schema v${summary.version}</span>
</header>
<main>
  <h2>Summary</h2>
  <div class="cards">${summaryCards}</div>

  ${budgetSection}

  <h2>Islands (click to drill in)</h2>
  <svg class="treemap" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Island bundle treemap">
    ${islandSvg || `<text x="20" y="30" fill="#64748b">No islands to display.</text>`}
  </svg>

  <div id="drill-host">${drillPanels}</div>

  <h2>Shared chunks</h2>
  <table>
    <thead><tr><th>id</th><th class="num">size</th><th class="num">gzip</th><th>used by #</th><th>islands</th></tr></thead>
    <tbody>${sharedRows || `<tr><td colspan="5" class="muted">(no shared chunks — pure-SSR project?)</td></tr>`}</tbody>
  </table>

  <h2>Islands</h2>
  <table>
    <thead><tr><th>name</th><th class="num">raw</th><th class="num">gzip</th><th>priority</th><th>shared</th><th>modules</th></tr></thead>
    <tbody>
      ${islands
        .map(
          (i) => `<tr>
        <td><a href="#" data-drill="${escAttr(i.name)}" class="drill-link">${escText(i.name)}</a></td>
        <td class="num">${fmtBytes(i.totalRaw)}</td>
        <td class="num">${fmtBytes(i.totalGz)}</td>
        <td>${escText(i.priority)}</td>
        <td class="muted">${escText(i.shared.join(", ") || "—")}</td>
        <td class="num">${i.modules.length}</td>
      </tr>`
        )
        .join("")}
    </tbody>
  </table>
</main>
<script>
  (function () {
    var current = null;
    function drillTo(name) {
      if (!name) return;
      // Find the section by matching data-drill; IDs use a numeric index
      // so we never build a selector from potentially unsafe user text.
      var sections = document.querySelectorAll("section.drill");
      var next = null;
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].getAttribute("data-drill") === name) { next = sections[i]; break; }
      }
      if (!next) return;
      if (current && current !== next) current.hidden = true;
      next.hidden = false;
      current = next;
      next.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    document.addEventListener("click", function (e) {
      var t = e.target;
      while (t && t.nodeType === 1) {
        var d = t.getAttribute && t.getAttribute("data-drill");
        if (d) { e.preventDefault(); drillTo(d); return; }
        t = t.parentNode;
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && current) { current.hidden = true; current = null; }
    });
  })();
</script>
</body>
</html>`;
}

// ============================================================================
// Helpers — formatting + squarify
// ============================================================================

/**
 * Phase 18.φ — render the budget-bar block. Colour-codes each island
 * by {@link BudgetReport.BudgetStatus} and the project-wide total (when
 * present). Islands without any applicable limit render a diagonal-
 * hatched "unbounded" bar so the user sees the row but understands
 * nothing is enforced. Self-contained: no JS, no external assets.
 */
function renderBudgetSection(budget: BudgetReport): string {
  const modeClass = budget.mode === "error" ? "error" : "warning";
  const rows = budget.islands
    .map((i) => renderBudgetRow(i.name, i.raw, i.gz, i.rawLimit, i.gzLimit, i.status))
    .join("");
  const totalRow = budget.total
    ? renderBudgetRow(
        "<project total>",
        budget.total.raw,
        budget.total.gz,
        budget.total.rawLimit,
        budget.total.gzLimit,
        budget.total.status
      )
    : "";
  const exceedHeadline = budget.hasExceeded
    ? ` · <span style="color:#fca5a5">${budget.exceededCount} over limit</span>`
    : "";
  return `
  <h2>Bundle budget <span class="budget-mode ${modeClass}">${escText(budget.mode)}</span></h2>
  <div class="budget-legend">
    <span class="lg-within">within</span>
    <span class="lg-within10">approaching (≥90%)</span>
    <span class="lg-exceeded">exceeded</span>
  </div>
  <p class="muted" style="margin:0 0 10px">
    ${budget.withinCount}/${budget.islandCount} islands within limits${exceedHeadline}
  </p>
  <div class="card" style="padding:12px 14px">
    ${rows}
    ${totalRow}
  </div>`;
}

function renderBudgetRow(
  name: string,
  raw: number,
  gz: number,
  rawLimit: number | null,
  gzLimit: number | null,
  status: "within" | "within10" | "exceeded"
): string {
  // Prefer gz-axis progress bar when a gz limit exists (the 90%-of-the-
  // time-useful axis); fall back to raw when only raw is constrained.
  let pct = 0;
  let barClass: string = status;
  let meta: string;
  if (gzLimit !== null) {
    pct = Math.min(100, Math.max(0, (gz / Math.max(gzLimit, 1)) * 100));
    meta = `${fmtBytes(gz)} / ${fmtBytes(gzLimit)} gz`;
  } else if (rawLimit !== null) {
    pct = Math.min(100, Math.max(0, (raw / Math.max(rawLimit, 1)) * 100));
    meta = `${fmtBytes(raw)} / ${fmtBytes(rawLimit)} raw`;
  } else {
    barClass = "unbounded";
    pct = 100;
    meta = `${fmtBytes(gz)} gz · no limit`;
  }
  return `
    <div class="budget-row">
      <div class="budget-name" title="${escAttr(name)}">${escText(name)}</div>
      <div class="budget-bar-track"><div class="budget-bar-fill ${barClass}" style="width:${pct.toFixed(1)}%"></div></div>
      <div class="budget-meta">${meta}</div>
    </div>`;
}

/** Human-readable byte formatter. Matches the style used by `printBundleStats`. */
export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function escText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return escText(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Distinct dark-theme colour ramp, no dependency on d3-scale. */
const ISLAND_PALETTE = [
  "#1e3a8a", "#155e75", "#166534", "#854d0e", "#7c2d12",
  "#581c87", "#831843", "#0f766e", "#3730a3", "#92400e",
  "#064e3b", "#6b21a8", "#134e4a", "#7f1d1d", "#1e40af",
];

interface SquarifyInput<T> {
  name: string;
  value: number;
  island: T;
}
interface SquarifyRect<T> {
  x: number;
  y: number;
  w: number;
  h: number;
  data: SquarifyInput<T>;
}

/**
 * Minimal squarify treemap layout.
 *
 * Classic Bruls-Huijing-van-Wijk algorithm — pack rectangles into a
 * bounding box to minimise worst-case aspect ratio. Implemented in-repo so
 * the HTML report has zero runtime deps. ~60 LOC.
 *
 * Input is pre-sorted descending by `value`. We maintain a current "row"
 * (strip) and keep adding rectangles until the worst aspect ratio would
 * increase if we added the next one; at that point we lay out the row
 * and start a new one on the remaining area.
 */
function squarify<T>(
  input: SquarifyInput<T>[],
  width: number,
  height: number
): SquarifyRect<T>[] {
  const sorted = [...input].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, n) => s + n.value, 0);
  if (total <= 0 || sorted.length === 0) return [];

  // Scale values so the sum equals width * height.
  const scale = (width * height) / total;
  const scaled = sorted.map((n) => ({ ...n, area: n.value * scale }));

  const result: SquarifyRect<T>[] = [];

  function worst(row: number[], side: number): number {
    if (row.length === 0) return Infinity;
    const sum = row.reduce((s, v) => s + v, 0);
    const rowMax = Math.max(...row);
    const rowMin = Math.min(...row);
    const s2 = side * side;
    const sum2 = sum * sum;
    return Math.max((s2 * rowMax) / sum2, sum2 / (s2 * rowMin));
  }

  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let i = 0;

  while (i < scaled.length) {
    const row: number[] = [];
    const rowData: typeof scaled = [];
    const side = Math.min(w, h);
    // Build row.
    while (i < scaled.length) {
      const next = scaled[i].area;
      const candidate = [...row, next];
      if (row.length === 0 || worst(candidate, side) <= worst(row, side)) {
        row.push(next);
        rowData.push(scaled[i]);
        i++;
      } else {
        break;
      }
    }
    // Lay out row.
    const rowSum = row.reduce((s, v) => s + v, 0);
    const rowThickness = rowSum / side;
    if (w <= h) {
      // Horizontal strip along the top.
      let cx = x;
      for (let r = 0; r < row.length; r++) {
        const rw = row[r] / rowThickness;
        result.push({
          x: cx,
          y,
          w: rw,
          h: rowThickness,
          data: rowData[r],
        });
        cx += rw;
      }
      y += rowThickness;
      h -= rowThickness;
    } else {
      // Vertical strip along the left.
      let cy = y;
      for (let r = 0; r < row.length; r++) {
        const rh = row[r] / rowThickness;
        result.push({
          x,
          y: cy,
          w: rowThickness,
          h: rh,
          data: rowData[r],
        });
        cy += rh;
      }
      x += rowThickness;
      w -= rowThickness;
    }
  }

  return result;
}
