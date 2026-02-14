import type { InteractionGraph, OracleLevel } from "./types";
import { getAtePaths, readJson, writeJson } from "./fs";

export interface GeneratedScenario {
  id: string;
  kind: "route-smoke";
  route: string;
  oracleLevel: OracleLevel;
}

export interface ScenarioBundle {
  schemaVersion: 1;
  generatedAt: string;
  oracleLevel: OracleLevel;
  scenarios: GeneratedScenario[];
}

export function generateScenariosFromGraph(graph: InteractionGraph, oracleLevel: OracleLevel): ScenarioBundle {
  const routes = graph.nodes.filter((n) => n.kind === "route") as Array<{ kind: "route"; id: string; path: string }>;
  const scenarios: GeneratedScenario[] = routes.map((r) => ({
    id: `route:${r.id}`,
    kind: "route-smoke",
    route: r.id,
    oracleLevel,
  }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    oracleLevel,
    scenarios,
  };
}

export function generateAndWriteScenarios(repoRoot: string, oracleLevel: OracleLevel): { scenariosPath: string; count: number } {
  const paths = getAtePaths(repoRoot);
  const graph = readJson<InteractionGraph>(paths.interactionGraphPath);
  const bundle = generateScenariosFromGraph(graph, oracleLevel);
  writeJson(paths.scenariosPath, bundle);
  return { scenariosPath: paths.scenariosPath, count: bundle.scenarios.length };
}
