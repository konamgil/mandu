import { execFileSync } from "node:child_process";
import path from "node:path";
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

function posixDirname(p: string): string {
  // Normalize windows separators first, then use posix dirname.
  return path.posix.dirname(toPosixPath(p));
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
      const routeDir = posixDirname(routeFile);

      // 1) Direct hit: route spec file changed
      if (f === routeFile) {
        selected.add(r.id);
        continue;
      }

      // 2) Any change under the same route directory likely impacts the route
      //    (more accurate than a hard-coded page.tsx strip)
      if (f.startsWith(routeDir + "/")) {
        selected.add(r.id);
      }
    }
  }

  return { changedFiles, selectedRoutes: Array.from(selected) };
}
