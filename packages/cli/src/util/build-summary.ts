import type { BundleManifest, BundleOutput } from "@mandujs/core";
import type { RouteSpec } from "@mandujs/core";
import { renderTable } from "../terminal";
import { formatSize } from "@mandujs/core";
import path from "path";

export interface BuildSummaryRow {
  bundle: string;
  size: string;
  gzip: string;
  strategy: string;
}

interface AssetMetrics {
  size: number;
  gzipSize: number;
}

export async function createBuildSummaryRows(
  rootDir: string,
  routes: RouteSpec[],
  outputs: BundleOutput[],
  manifest: BundleManifest
): Promise<BuildSummaryRow[]> {
  const rows: BuildSummaryRow[] = [];
  const routeMap = new Map(routes.map((route) => [route.id, route]));

  for (const output of outputs) {
    const route = routeMap.get(output.routeId);
    const label = route?.pattern ?? output.routeId;
    const strategy = route?.hydration
      ? `${route.hydration.strategy}/${route.hydration.priority}`
      : "island/visible";

    rows.push({
      bundle: label,
      size: formatSize(output.size),
      gzip: formatSize(output.gzipSize),
      strategy,
    });
  }

  const sharedAssets = [
    { label: path.basename(manifest.shared.runtime), assetPath: manifest.shared.runtime },
    { label: path.basename(manifest.shared.vendor), assetPath: manifest.shared.vendor },
    ...(manifest.shared.router
      ? [{ label: path.basename(manifest.shared.router), assetPath: manifest.shared.router }]
      : []),
  ];

  for (const asset of sharedAssets) {
    const metrics = await readAssetMetrics(rootDir, asset.assetPath);
    if (!metrics) continue;
    rows.push({
      bundle: asset.label,
      size: formatSize(metrics.size),
      gzip: formatSize(metrics.gzipSize),
      strategy: "shared",
    });
  }

  return rows;
}

export function renderBuildSummaryTable(rows: BuildSummaryRow[], elapsedMs: number): string {
  const tableRows: Record<string, unknown>[] = rows.map((row) => ({
    bundle: row.bundle,
    size: row.size,
    gzip: row.gzip,
    strategy: row.strategy,
  }));

  const table = renderTable({
    border: "none",
    compact: true,
    columns: [
      { key: "bundle", header: "Bundle", minWidth: 18, flex: true },
      { key: "size", header: "Size", align: "right", minWidth: 10 },
      { key: "gzip", header: "Gzip", align: "right", minWidth: 10 },
      { key: "strategy", header: "Strategy", minWidth: 18, flex: true },
    ],
    rows: [
      ...tableRows,
      {
        bundle: "Total",
        size: summarizeColumn(rows, "size"),
        gzip: summarizeColumn(rows, "gzip"),
        strategy: `${elapsedMs}ms`,
      },
    ] as Record<string, unknown>[],
  });

  return `${table}\n\nNext: mandu start (or mandu preview)`;
}

function summarizeColumn(rows: BuildSummaryRow[], key: "size" | "gzip"): string {
  const totalBytes = rows.reduce((sum, row) => sum + parseFormattedSize(row[key]), 0);
  return formatSize(totalBytes);
}

function parseFormattedSize(value: string): number {
  const match = value.match(/^([\d.]+)\s*(B|KB|MB)$/);
  if (!match) return 0;

  const amount = Number(match[1]);
  switch (match[2]) {
    case "KB":
      return Math.round(amount * 1024);
    case "MB":
      return Math.round(amount * 1024 * 1024);
    case "B":
    default:
      return Math.round(amount);
  }
}

async function readAssetMetrics(rootDir: string, assetPath: string): Promise<AssetMetrics | null> {
  const relativePath = assetPath.startsWith("/") ? assetPath.slice(1) : assetPath;
  const absolutePath = path.join(rootDir, relativePath.replace(/\//g, path.sep));
  const file = Bun.file(absolutePath);

  if (!(await file.exists())) {
    return null;
  }

  const content = await file.text();
  const gzipped = Bun.gzipSync(Buffer.from(content));
  return {
    size: file.size,
    gzipSize: gzipped.length,
  };
}
