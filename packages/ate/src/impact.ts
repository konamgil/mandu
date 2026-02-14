import { execFileSync } from "node:child_process";
import { relative } from "node:path";
import { getAtePaths, readJson } from "./fs";
import type { ImpactInput, InteractionGraph } from "./types";

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

export function computeImpact(input: ImpactInput): { changedFiles: string[]; selectedRoutes: string[] } {
  const repoRoot = input.repoRoot;
  const base = input.base ?? "HEAD~1";
  const head = input.head ?? "HEAD";

  verifyGitRev(repoRoot, base);
  verifyGitRev(repoRoot, head);

  const out = execFileSync("git", ["diff", "--name-only", `${base}..${head}`], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString("utf8");

  const changedFiles = out.split("\n").map((s) => toPosixPath(s.trim())).filter(Boolean);

  // simple heuristic: if route file changed, select that route
  const paths = getAtePaths(repoRoot);
  const graph = readJson<InteractionGraph>(paths.interactionGraphPath);

  const routes = graph.nodes.filter((n) => n.kind === "route") as Array<{ kind: "route"; id: string; file: string }>;

  const selected = new Set<string>();
  for (const f of changedFiles) {
    for (const r of routes) {
      const routeFile = toPosixPath(r.file);
      if (f === routeFile) selected.add(r.id);
      // if a shared module under same folder changed, include route
      if (f.startsWith(routeFile.replace(/page\.tsx$/, ""))) selected.add(r.id);
    }
  }

  return { changedFiles, selectedRoutes: Array.from(selected) };
}
