import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { getAtePaths, readJson } from "./fs";
import type { ImpactInput, InteractionGraph } from "./types";
import { buildDependencyGraph, findDependents } from "./dep-graph";

function verifyGitRev(repoRoot: string, rev: string): void {
  // Prevent command injection: disallow whitespace and common shell metacharacters.
  if (!/^[0-9A-Za-z._/~-]+$/.test(rev)) {
    throw new Error(`Invalid git revision: ${rev}`);
  }
  // Ensure it resolves (commit-ish)
  execFileSync("git", ["rev-parse", "--verify", `${rev}^{commit}`], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function normalizePath(path: string, rootDir: string): string {
  const abs = resolve(rootDir, path);
  return abs.replace(/\\/g, "/");
}

export async function computeImpact(input: ImpactInput): Promise<{ changedFiles: string[]; selectedRoutes: string[]; warnings: string[] }> {
  const repoRoot = input.repoRoot;
  const base = input.base ?? "HEAD~1";
  const head = input.head ?? "HEAD";
  const warnings: string[] = [];

  // Validate input
  if (!repoRoot) {
    throw new Error("repoRoot는 필수입니다");
  }

  // Verify git revisions
  try {
    verifyGitRev(repoRoot, base);
  } catch (err: any) {
    throw new Error(`잘못된 base revision: ${base} (${err.message})`);
  }

  try {
    verifyGitRev(repoRoot, head);
  } catch (err: any) {
    throw new Error(`잘못된 head revision: ${head} (${err.message})`);
  }

  let out: string;
  try {
    out = execFileSync("git", ["diff", "--name-only", `${base}..${head}`], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString("utf8");
  } catch (err: any) {
    throw new Error(`Git diff 실행 실패: ${err.message}`);
  }

  const changedFiles = out.split("\n").map((s) => toPosixPath(s.trim())).filter(Boolean);

  if (changedFiles.length === 0) {
    warnings.push(`경고: 변경된 파일이 없습니다 (${base}..${head})`);
  }

  // Load interaction graph
  const paths = getAtePaths(repoRoot);

  let graph: InteractionGraph;
  try {
    graph = readJson<InteractionGraph>(paths.interactionGraphPath);
  } catch (err: any) {
    throw new Error(`Interaction graph 읽기 실패: ${err.message}`);
  }

  if (!graph.nodes || graph.nodes.length === 0) {
    warnings.push("경고: Interaction graph가 비어있습니다");
    return { changedFiles, selectedRoutes: [], warnings };
  }

  const routes = graph.nodes.filter((n) => n.kind === "route") as Array<{ kind: "route"; id: string; file: string }>;

  if (routes.length === 0) {
    warnings.push("경고: Route가 없습니다");
    return { changedFiles, selectedRoutes: [], warnings };
  }

  // Build dependency graph for deep impact analysis
  let depGraph;
  try {
    depGraph = await buildDependencyGraph({
      rootDir: repoRoot,
      include: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
      exclude: ["**/node_modules/**", "**/*.test.ts", "**/*.spec.ts"],
    });
  } catch (err: any) {
    warnings.push(`Dependency graph 빌드 실패: ${err.message}`);
    // Fallback: only direct file matching
    const selected = new Set<string>();
    for (const changedFile of changedFiles) {
      const normalizedChangedFile = normalizePath(changedFile, repoRoot);
      for (const r of routes) {
        const routeFile = normalizePath(r.file, repoRoot);
        if (normalizedChangedFile === routeFile) {
          selected.add(r.id);
        }
      }
    }
    return { changedFiles, selectedRoutes: Array.from(selected), warnings };
  }

  const selected = new Set<string>();

  for (const changedFile of changedFiles) {
    try {
      const normalizedChangedFile = normalizePath(changedFile, repoRoot);

      // Direct match: if the route file itself changed
      for (const r of routes) {
        const routeFile = normalizePath(r.file, repoRoot);
        if (normalizedChangedFile === routeFile) {
          selected.add(r.id);
        }
      }

      // Transitive impact: find all files that depend on the changed file
      const affectedFiles = findDependents(depGraph, normalizedChangedFile);

      for (const affectedFile of affectedFiles) {
        for (const r of routes) {
          const routeFile = normalizePath(r.file, repoRoot);
          if (affectedFile === routeFile) {
            selected.add(r.id);
          }
        }
      }
    } catch (err: any) {
      warnings.push(`파일 영향 분석 실패 (${changedFile}): ${err.message}`);
      // Continue with next file
    }
  }

  return { changedFiles, selectedRoutes: Array.from(selected), warnings };
}
