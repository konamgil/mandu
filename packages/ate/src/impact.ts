import { execSync } from "node:child_process";
import { relative } from "node:path";
import { getAtePaths, readJson } from "./fs";
import type { ImpactInput, InteractionGraph } from "./types";

export function computeImpact(input: ImpactInput): { changedFiles: string[]; selectedRoutes: string[] } {
  const repoRoot = input.repoRoot;
  const base = input.base ?? "HEAD~1";
  const head = input.head ?? "HEAD";

  const out = execSync(`git diff --name-only ${base}..${head}`, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "ignore"],
  }).toString("utf8");

  const changedFiles = out.split("\n").map((s) => s.trim()).filter(Boolean);

  // simple heuristic: if route file changed, select that route
  const paths = getAtePaths(repoRoot);
  const graph = readJson<InteractionGraph>(paths.interactionGraphPath);

  const routes = graph.nodes.filter((n) => n.kind === "route") as Array<{ kind: "route"; id: string; file: string }>;

  const selected = new Set<string>();
  for (const f of changedFiles) {
    for (const r of routes) {
      if (f === r.file) selected.add(r.id);
      // if a shared module under same folder changed, include route
      if (f.startsWith(r.file.replace(/page\.tsx$/, ""))) selected.add(r.id);
    }
  }

  return { changedFiles, selectedRoutes: Array.from(selected) };
}
