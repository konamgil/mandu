import fs from "node:fs";
import path from "node:path";

export interface LcovMergeInput {
  label: string;
  source: { kind: "file"; path: string } | { kind: "text"; body: string };
}

interface LcovRecord {
  sourceFile: string;
  lines: Map<number, number>;
  functions: Map<string, number>;
  functionLines: Map<string, number>;
  branches: Map<string, number>;
}

export interface LcovMergeSummary {
  files: number;
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
  functionsFound: number;
  functionsHit: number;
}

function createRecord(sourceFile: string): LcovRecord {
  return {
    sourceFile,
    lines: new Map(),
    functions: new Map(),
    functionLines: new Map(),
    branches: new Map(),
  };
}

function add(map: Map<number, number>, key: number, value: number): void;
function add(map: Map<string, number>, key: string, value: number): void;
function add(
  map: Map<number, number> | Map<string, number>,
  key: number | string,
  value: number,
): void {
  const target = map as Map<number | string, number>;
  target.set(key, (target.get(key) ?? 0) + value);
}

function ingestLcov(body: string, records: Map<string, LcovRecord>): void {
  let current: LcovRecord | null = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("SF:")) {
      const sourceFile = line.slice(3);
      current = records.get(sourceFile) ?? createRecord(sourceFile);
      records.set(sourceFile, current);
      continue;
    }
    if (!current) continue;
    if (line === "end_of_record") {
      current = null;
      continue;
    }
    if (line.startsWith("DA:")) {
      const [lineNumber, hits] = line.slice(3).split(",").map(Number);
      if (Number.isFinite(lineNumber) && Number.isFinite(hits)) {
        add(current.lines, lineNumber!, hits!);
      }
      continue;
    }
    if (line.startsWith("FN:")) {
      const separator = line.indexOf(",", 3);
      if (separator > 3) {
        const lineNumber = Number(line.slice(3, separator));
        const name = line.slice(separator + 1);
        if (Number.isFinite(lineNumber) && name) current.functionLines.set(name, lineNumber);
      }
      continue;
    }
    if (line.startsWith("FNDA:")) {
      const separator = line.indexOf(",", 5);
      if (separator > 5) {
        const hits = Number(line.slice(5, separator));
        const name = line.slice(separator + 1);
        if (Number.isFinite(hits) && name) add(current.functions, name, hits);
      }
      continue;
    }
    if (line.startsWith("BRDA:")) {
      const parts = line.slice(5).split(",");
      if (parts.length >= 4) {
        const key = parts.slice(0, 3).join(",");
        const hits = parts[3] === "-" ? 0 : Number(parts[3]);
        if (Number.isFinite(hits)) add(current.branches, key, hits);
      }
    }
  }
}

function renderRecord(record: LcovRecord): string {
  const lines = [`SF:${record.sourceFile}`];
  const functionNames = new Set([
    ...record.functionLines.keys(),
    ...record.functions.keys(),
  ]);

  for (const name of [...functionNames].sort()) {
    const line = record.functionLines.get(name);
    if (line !== undefined) lines.push(`FN:${line},${name}`);
  }
  for (const name of [...functionNames].sort()) {
    lines.push(`FNDA:${record.functions.get(name) ?? 0},${name}`);
  }
  lines.push(`FNF:${functionNames.size}`);
  lines.push(`FNH:${[...functionNames].filter((name) => (record.functions.get(name) ?? 0) > 0).length}`);

  for (const key of [...record.branches.keys()].sort()) {
    lines.push(`BRDA:${key},${record.branches.get(key) ?? 0}`);
  }
  lines.push(`BRF:${record.branches.size}`);
  lines.push(`BRH:${[...record.branches.values()].filter((hits) => hits > 0).length}`);

  for (const lineNumber of [...record.lines.keys()].sort((left, right) => left - right)) {
    lines.push(`DA:${lineNumber},${record.lines.get(lineNumber) ?? 0}`);
  }
  lines.push(`LF:${record.lines.size}`);
  lines.push(`LH:${[...record.lines.values()].filter((hits) => hits > 0).length}`);
  lines.push("end_of_record");
  return lines.join("\n");
}

function summarize(records: Map<string, LcovRecord>): LcovMergeSummary {
  const summary: LcovMergeSummary = {
    files: records.size,
    linesFound: 0,
    linesHit: 0,
    branchesFound: 0,
    branchesHit: 0,
    functionsFound: 0,
    functionsHit: 0,
  };

  for (const record of records.values()) {
    const functionNames = new Set([
      ...record.functionLines.keys(),
      ...record.functions.keys(),
    ]);
    summary.linesFound += record.lines.size;
    summary.linesHit += [...record.lines.values()].filter((hits) => hits > 0).length;
    summary.branchesFound += record.branches.size;
    summary.branchesHit += [...record.branches.values()].filter((hits) => hits > 0).length;
    summary.functionsFound += functionNames.size;
    summary.functionsHit += [...functionNames].filter((name) => (record.functions.get(name) ?? 0) > 0).length;
  }

  return summary;
}

/**
 * Merge LCOV sources into the canonical Mandu coverage artifact. This lives
 * in Core so the product CLI does not need the optional ATE Labs package for
 * ordinary unit/integration coverage.
 */
export function mergeAndWriteLcov(params: {
  repoRoot: string;
  inputs: LcovMergeInput[];
  outputPath?: string;
}): { summary: LcovMergeSummary; outputPath: string | null } {
  const records = new Map<string, LcovRecord>();

  for (const input of params.inputs) {
    if (input.source.kind === "file" && !fs.existsSync(input.source.path)) continue;
    const body = input.source.kind === "file"
      ? fs.readFileSync(input.source.path, "utf8")
      : input.source.body;
    ingestLcov(body, records);
  }

  const summary = summarize(records);
  if (records.size === 0) return { summary, outputPath: null };

  const outputPath = path.resolve(
    params.outputPath ?? path.join(params.repoRoot, ".mandu", "coverage", "lcov.info"),
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const body = [...records.values()]
    .sort((left, right) => left.sourceFile.localeCompare(right.sourceFile))
    .map(renderRecord)
    .join("\n");
  fs.writeFileSync(outputPath, `${body}\n`, "utf8");
  return { summary, outputPath };
}
