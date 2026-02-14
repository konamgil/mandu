import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AtePaths } from "./types";

export function getAtePaths(repoRoot: string): AtePaths {
  const manduDir = join(repoRoot, ".mandu");
  return {
    repoRoot,
    manduDir,
    interactionGraphPath: join(manduDir, "interaction-graph.json"),
    selectorMapPath: join(manduDir, "selector-map.json"),
    scenariosPath: join(manduDir, "scenarios", "generated.json"),
    reportsDir: join(manduDir, "reports"),
    autoE2eDir: join(repoRoot, "tests", "e2e", "auto"),
    manualE2eDir: join(repoRoot, "tests", "e2e", "manual"),
  };
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function writeJson(path: string, data: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
