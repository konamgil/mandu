/**
 * Phase C.2 — mutation runner.
 *
 * Given a target file (`app/**\/route.ts`, a contract, or a handler),
 * run every operator, write each mutated file to a tmpdir, run the
 * relevant test command, and classify the result:
 *
 *   - `killed`   — test run failed ⇒ mutation was detected (good)
 *   - `survived` — test run passed ⇒ mutation slipped through (bad)
 *   - `timeout`  — test run hit the timeout budget
 *   - `error`    — the mutation itself broke compilation / execution
 *
 * Performance:
 *   - max 50 mutations per invocation by default; callers can lift
 *     with `maxMutations` or `--all`.
 *   - 4 parallel workers by default; `MANDU_ATE_MUTATION_CONCURRENCY`
 *     env tunes.
 *   - `timeoutMs` defaults to 120_000 per mutation.
 *
 * Default test command resolution: we use `spec-indexer` to find a
 * spec that `@ate-covers` the target file; if present, we invoke
 * `bun test <specPath>`. Otherwise we run `bun test` scoped to the
 * target's directory.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { ALL_OPERATORS, type MutatedSourceFile, type MutationOperatorName } from "./operators";
import { indexSpecs, specsForRouteId } from "../spec-indexer";
import { routeIdFromPath } from "../extractor-utils";

export type MutationResultStatus = "killed" | "survived" | "timeout" | "error";

export interface MutationResult {
  id: string;
  operator: MutationOperatorName;
  description: string;
  line?: number;
  status: MutationResultStatus;
  durationMs: number;
  /** Path to the mutated file as written. */
  mutatedPath: string;
  /** stdout + stderr captured from the child run (truncated). */
  output?: string;
}

export interface RunMutationsInput {
  repoRoot: string;
  /** Absolute or repo-relative path to the file to mutate. */
  targetFile: string;
  /**
   * Optional explicit test command, in argv form. Overrides the
   * spec-indexer lookup. Example: ["bun", "test", "tests/signup.test.ts"].
   */
  testCommand?: string[];
  /** Per-mutation timeout. Default 120_000 ms (§C.2.4). */
  timeoutMs?: number;
  /** Hard cap on mutations run. Default 50; `Infinity` lifts the cap. */
  maxMutations?: number;
  /** Parallelism. Default 4 or MANDU_ATE_MUTATION_CONCURRENCY. */
  concurrency?: number;
  /**
   * Filter operator set. Default = every operator in ALL_OPERATORS.
   */
  operators?: MutationOperatorName[];
  /** Inject a custom spawn — tests use this to avoid real child processes. */
  spawn?: SpawnFn;
}

export interface RunMutationsResult {
  targetFile: string;
  totalGenerated: number;
  totalExecuted: number;
  results: MutationResult[];
  /** Persisted JSON path — `.mandu/ate-mutations/last-run.json`. */
  reportPath: string;
}

export type SpawnFn = (
  argv: string[],
  opts: { cwd: string; timeoutMs: number },
) => Promise<{ exitCode: number; output: string; timedOut: boolean }>;

// ────────────────────────────────────────────────────────────────────────────
// Default spawn — uses Bun.spawn with abort timeout.
// ────────────────────────────────────────────────────────────────────────────

const defaultSpawn: SpawnFn = async (argv, { cwd, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let timedOut = false;
  try {
    const proc = (globalThis as unknown as { Bun?: { spawn: Function } }).Bun?.spawn
      ? (globalThis as unknown as { Bun: { spawn: Function } }).Bun.spawn({
          cmd: argv,
          cwd,
          stdout: "pipe",
          stderr: "pipe",
          signal: controller.signal,
        })
      : null;
    if (!proc) {
      return { exitCode: -1, output: "Bun.spawn unavailable", timedOut: false };
    }
    const [stdout, stderr, exited] = await Promise.all([
      new Response(proc.stdout as ReadableStream).text(),
      new Response(proc.stderr as ReadableStream).text(),
      proc.exited,
    ]);
    const exitCode = typeof exited === "number" ? exited : -1;
    return {
      exitCode,
      output: (stdout + stderr).slice(0, 10_000),
      timedOut,
    };
  } catch (err) {
    if (controller.signal.aborted) timedOut = true;
    return {
      exitCode: -1,
      output: err instanceof Error ? err.message : String(err),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export async function runMutations(input: RunMutationsInput): Promise<RunMutationsResult> {
  const repoRoot = input.repoRoot;
  const abs = resolve(repoRoot, input.targetFile);
  if (!existsSync(abs)) {
    throw new Error(`runMutations: target file not found: ${abs}`);
  }

  // 1. Build mutations via ts-morph (lazy import — heavy).
  const { Project, SyntaxKind } = await import("ts-morph");
  const project = new Project({ useInMemoryFileSystem: false });
  const sf = project.addSourceFileAtPath(abs);
  const operatorFilter = input.operators;
  const operators = operatorFilter
    ? ALL_OPERATORS.filter((o) => operatorFilter.includes(o.name))
    : ALL_OPERATORS;

  const allMutations: MutatedSourceFile[] = [];
  const ctx = { targetFile: abs, SyntaxKind } as const;
  for (const op of operators) {
    try {
      allMutations.push(...op.run(sf, ctx));
    } catch {
      // one operator failing shouldn't kill the batch
    }
  }

  // 2. Cap.
  const maxMutations = input.maxMutations ?? 50;
  const selected = allMutations.slice(0, maxMutations);

  // 3. Resolve test command.
  const testCommand = input.testCommand ?? resolveTestCommand(repoRoot, abs);

  // 4. Prepare tmpdir mirror — each mutation writes to its own file.
  const tmpRoot = mkdtempSync(join(tmpdir(), "mandu-mutation-"));
  const spawn = input.spawn ?? defaultSpawn;
  const timeoutMs = input.timeoutMs ?? 120_000;
  // Because mutations swap the target file in place, we MUST run them
  // sequentially — concurrency on the same file would race writes.
  // The MANDU_ATE_MUTATION_CONCURRENCY env is kept for future multi-file
  // runs.
  const concurrency = 1;
  void input.concurrency;

  // 5. Execute with a simple semaphore.
  const results: MutationResult[] = [];
  const relTarget = relative(repoRoot, abs);

  try {
    const queue = selected.slice();
    const workers: Promise<void>[] = [];
    const runOne = async () => {
      for (;;) {
        const next = queue.shift();
        if (!next) break;
        const result = await executeMutation({
          repoRoot,
          absTarget: abs,
          relTarget,
          tmpRoot,
          mutation: next,
          testCommand,
          timeoutMs,
          spawn,
        });
        results.push(result);
      }
    };
    for (let i = 0; i < concurrency; i++) workers.push(runOne());
    await Promise.all(workers);
  } finally {
    // Cleanup tmp.
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // swallow
    }
  }

  // 6. Sort + persist report.
  results.sort((a, b) => a.id.localeCompare(b.id));
  const reportPath = join(repoRoot, ".mandu", "ate-mutations", "last-run.json");
  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          targetFile: relTarget.replace(/\\/g, "/"),
          totalGenerated: allMutations.length,
          totalExecuted: results.length,
          generatedAt: new Date().toISOString(),
          results,
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    // swallow
  }

  return {
    targetFile: relTarget.replace(/\\/g, "/"),
    totalGenerated: allMutations.length,
    totalExecuted: results.length,
    results,
    reportPath,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

// Concurrency is pinned to 1 for same-file runs (see runMutations).
// The helper remains in case future multi-file runs reinstate parallelism.
function _clampConcurrency(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 16) return 16;
  return Math.floor(n);
}
void _clampConcurrency;

interface ExecuteInput {
  repoRoot: string;
  absTarget: string;
  relTarget: string;
  tmpRoot: string;
  mutation: MutatedSourceFile;
  testCommand: string[];
  timeoutMs: number;
  spawn: SpawnFn;
}

async function executeMutation(input: ExecuteInput): Promise<MutationResult> {
  const { repoRoot, absTarget, tmpRoot, mutation, testCommand, timeoutMs, spawn } = input;

  // Write the mutated source to the tmp location that mirrors the
  // original, then temporarily replace the original via rename-swap.
  // We snapshot the original, overwrite it with the mutated source,
  // run the test, then restore. This keeps the repo resolver chain
  // intact (contracts / imports). We do NOT run mutations in parallel
  // on the same file — the semaphore above is 1/file; we can however
  // run mutations on different files concurrently.
  const origContent = readFileSync(absTarget, "utf8");
  const mutatedPath = join(tmpRoot, `${mutation.id}.txt`);
  writeFileSync(mutatedPath, mutation.mutatedSource, "utf8");

  const start = Date.now();

  try {
    writeFileSync(absTarget, mutation.mutatedSource, "utf8");
    const runResult = await spawn(testCommand, { cwd: repoRoot, timeoutMs });
    const durationMs = Date.now() - start;
    let status: MutationResultStatus;
    if (runResult.timedOut) status = "timeout";
    else if (runResult.exitCode === 0) status = "survived";
    else if (runResult.exitCode === -1) status = "error";
    else status = "killed";
    return {
      id: mutation.id,
      operator: mutation.operator,
      description: mutation.description,
      line: mutation.line,
      status,
      durationMs,
      mutatedPath,
      output: runResult.output.slice(0, 2_000),
    };
  } catch (err) {
    return {
      id: mutation.id,
      operator: mutation.operator,
      description: mutation.description,
      line: mutation.line,
      status: "error",
      durationMs: Date.now() - start,
      mutatedPath,
      output: err instanceof Error ? err.message : String(err),
    };
  } finally {
    try {
      writeFileSync(absTarget, origContent, "utf8");
    } catch {
      // if we can't restore, the developer has a problem — but bail out cleanly.
    }
  }
}

/**
 * Default test command resolution.
 *   - If an `@ate-covers` spec index matches the target route, run that spec.
 *   - Otherwise, run `bun test` on the target's sibling `__tests__`
 *     / `tests` directory (best effort).
 *   - Fallback: `bun test` on the whole target file's directory.
 */
export function resolveTestCommand(repoRoot: string, absTarget: string): string[] {
  const rel = relative(repoRoot, absTarget).replace(/\\/g, "/");
  const routeId = deriveRouteIdFromPath(rel);
  if (routeId) {
    try {
      const idx = indexSpecs(repoRoot);
      const specs = specsForRouteId(idx, routeId);
      if (specs.length > 0) {
        return ["bun", "test", specs[0].path];
      }
    } catch {
      // fall through
    }
  }
  // Try sibling directories.
  const dir = dirname(absTarget);
  const candidates = [join(dir, "__tests__"), join(dir, "tests")];
  for (const c of candidates) {
    if (existsSync(c)) {
      return ["bun", "test", relative(repoRoot, c)];
    }
  }
  return ["bun", "test", relative(repoRoot, dir)];
}

function deriveRouteIdFromPath(relPath: string): string | null {
  // Only attempt for `app/**/route.ts` / `app/**/page.tsx`.
  if (!relPath.startsWith("app/")) return null;
  const base = basename(relPath);
  if (base !== "route.ts" && base !== "route.tsx" && base !== "page.tsx") return null;
  try {
    return routeIdFromPath("/" + relPath.slice("app/".length).replace(/\/(route|page)\.[^/]+$/, ""));
  } catch {
    return null;
  }
}
