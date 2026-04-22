/**
 * artifact-store — on-disk storage for per-run traces, screenshots,
 * DOM snapshots, and other failure evidence.
 *
 * Layout: `<repoRoot>/.mandu/ate-artifacts/<runId>/{trace.zip, screenshot.png, dom.html, ...}`
 *
 * Auto-prune policy: keep the most recent N runs (default 10).
 * Override with `MANDU_ATE_ARTIFACT_KEEP` (integer, 1..1000).
 *
 * All functions are synchronous + small — artifact I/O is intentionally
 * out-of-band from the hot test-run path (callers stage files into the
 * run directory, then call `pruneArtifacts` once at the end).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { join } from "node:path";
import { emitArtifactSaved } from "./run-events";
import type { AteArtifactSavedEvent } from "./types";

export interface ArtifactPaths {
  runDir: string;
  tracePath: string;
  screenshotPath: string;
  domPath: string;
}

/**
 * Classify an on-disk artifact from its filename. Used by the
 * run-events emitter so we can tag `artifact_saved` with a stable
 * kind that downstream renderers can filter.
 */
function classifyArtifact(filename: string): AteArtifactSavedEvent["artifactKind"] {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".zip") || lower.includes("trace")) return "trace";
  if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.includes("screenshot")) {
    return "screenshot";
  }
  if (lower.endsWith(".html") || lower.includes("dom")) return "dom";
  return "other";
}

/**
 * Best-effort file-size lookup — on failure returns 0. Never throws.
 */
function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

export interface ArtifactRun {
  runId: string;
  dir: string;
  modifiedAt: number;
  files: string[];
}

const DEFAULT_KEEP = 10;
const HARD_MAX_KEEP = 1000;

function artifactsRoot(repoRoot: string): string {
  return join(repoRoot, ".mandu", "ate-artifacts");
}

/**
 * Resolve every artifact path for a given run id. Does **not** create
 * the directory — caller invokes `ensureArtifactDir` once it has real
 * content to write.
 */
export function resolveArtifactPaths(repoRoot: string, runId: string): ArtifactPaths {
  const runDir = join(artifactsRoot(repoRoot), runId);
  return {
    runDir,
    tracePath: join(runDir, "trace.zip"),
    screenshotPath: join(runDir, "screenshot.png"),
    domPath: join(runDir, "dom.html"),
  };
}

export function ensureArtifactDir(repoRoot: string, runId: string): string {
  const paths = resolveArtifactPaths(repoRoot, runId);
  mkdirSync(paths.runDir, { recursive: true });
  return paths.runDir;
}

/**
 * Write a text artifact (DOM snapshot, JSON diagnostic, log). Creates
 * the run directory lazily.
 *
 * Emits an `artifact_saved` event on successful write. `specPath` is
 * forwarded into the event payload when provided.
 */
export function writeTextArtifact(
  repoRoot: string,
  runId: string,
  filename: string,
  content: string,
  specPath?: string,
): string {
  const dir = ensureArtifactDir(repoRoot, runId);
  const target = join(dir, filename);
  writeFileSync(target, content, "utf8");
  emitArtifactSaved({
    runId,
    specPath,
    artifactKind: classifyArtifact(filename),
    path: target,
    sizeBytes: sizeOf(target),
  });
  return target;
}

/**
 * Stage an existing file into the artifact run directory. Used when
 * the runner itself emits a file (Playwright trace.zip) that we just
 * need to relocate.
 *
 * Emits an `artifact_saved` event on successful copy. `specPath` is
 * forwarded into the event payload when provided.
 */
export function stageArtifact(
  repoRoot: string,
  runId: string,
  sourceAbsPath: string,
  destFilename: string,
  specPath?: string,
): string | null {
  if (!existsSync(sourceAbsPath)) return null;
  const dir = ensureArtifactDir(repoRoot, runId);
  const target = join(dir, destFilename);
  copyFileSync(sourceAbsPath, target);
  emitArtifactSaved({
    runId,
    specPath,
    artifactKind: classifyArtifact(destFilename),
    path: target,
    sizeBytes: sizeOf(target),
  });
  return target;
}

/**
 * List every retained artifact run, newest first. Used by the prune
 * routine + debug tooling.
 */
export function listArtifactRuns(repoRoot: string): ArtifactRun[] {
  const root = artifactsRoot(repoRoot);
  if (!existsSync(root)) return [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  const runs: ArtifactRun[] = [];
  for (const name of entries) {
    const dir = join(root, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    let files: string[] = [];
    try {
      files = readdirSync(dir);
    } catch {
      files = [];
    }
    runs.push({
      runId: name,
      dir,
      modifiedAt: st.mtimeMs,
      files,
    });
  }
  runs.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return runs;
}

/**
 * Drop the oldest artifact runs until only `keep` remain. Returns the
 * list of run ids removed (empty when nothing was pruned).
 *
 * `keep` precedence: argument > MANDU_ATE_ARTIFACT_KEEP env > default.
 * Values outside [1, HARD_MAX_KEEP] snap to the bound.
 */
export function pruneArtifacts(repoRoot: string, keep?: number): string[] {
  const limit = clampKeep(keep ?? readEnvKeep() ?? DEFAULT_KEEP);
  const runs = listArtifactRuns(repoRoot);
  if (runs.length <= limit) return [];
  const removed: string[] = [];
  for (const run of runs.slice(limit)) {
    try {
      rmSync(run.dir, { recursive: true, force: true });
      removed.push(run.runId);
    } catch {
      // Non-fatal: leave stale dirs in place rather than throw mid-run.
    }
  }
  return removed;
}

function readEnvKeep(): number | null {
  const raw = process.env.MANDU_ATE_ARTIFACT_KEEP;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function clampKeep(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_KEEP;
  if (value < 1) return 1;
  if (value > HARD_MAX_KEEP) return HARD_MAX_KEEP;
  return Math.floor(value);
}

/**
 * Produce a fresh, collision-resistant run id. Not cryptographic — the
 * timestamp prefix keeps filesystem sort order stable, and the random
 * suffix prevents collision when two runs land inside the same ms.
 */
export function newRunId(): string {
  const ts = Date.now().toString(36);
  const rnd = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `${ts}-${rnd}`;
}
