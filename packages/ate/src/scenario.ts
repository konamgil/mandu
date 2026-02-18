import type { InteractionGraph, OracleLevel } from "./types";
import { getAtePaths, readJson, writeJson } from "./fs";

export interface GeneratedScenario {
  id: string;
  kind: "route-smoke" | "api-smoke";
  route: string;
  methods?: string[];
  oracleLevel: OracleLevel;
}

export interface ScenarioBundle {
  schemaVersion: 1;
  generatedAt: string;
  oracleLevel: OracleLevel;
  scenarios: GeneratedScenario[];
}

const VALID_ORACLE_LEVELS: OracleLevel[] = ["L0", "L1", "L2", "L3"];

export function generateScenariosFromGraph(graph: InteractionGraph, oracleLevel: OracleLevel): ScenarioBundle {
  // Validate oracle level
  if (!VALID_ORACLE_LEVELS.includes(oracleLevel)) {
    throw new Error(`잘못된 oracleLevel입니다: ${oracleLevel} (허용: ${VALID_ORACLE_LEVELS.join(", ")})`);
  }

  // Validate graph
  if (!graph || !graph.nodes) {
    throw new Error("빈 interaction graph입니다 (nodes가 없습니다)");
  }

  const routes = graph.nodes.filter((n) => n.kind === "route") as Array<{ kind: "route"; id: string; path: string; methods?: string[] }>;

  if (routes.length === 0) {
    console.warn("[ATE] 경고: route가 없습니다. 빈 시나리오 번들을 생성합니다.");
  }

  const scenarios: GeneratedScenario[] = routes.map((r) => {
    const isApi = r.path.startsWith("/api/") || (r.methods && r.methods.length > 0);
    return {
      id: `${isApi ? "api" : "route"}:${r.id}`,
      kind: isApi ? "api-smoke" : "route-smoke",
      route: r.id,
      ...(isApi && r.methods ? { methods: r.methods } : {}),
      oracleLevel,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    oracleLevel,
    scenarios,
  };
}

export function generateAndWriteScenarios(repoRoot: string, oracleLevel: OracleLevel): { scenariosPath: string; count: number } {
  const paths = getAtePaths(repoRoot);

  let graph: InteractionGraph;
  try {
    graph = readJson<InteractionGraph>(paths.interactionGraphPath);
  } catch (err: unknown) {
    throw new Error(`Interaction graph 읽기 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  const bundle = generateScenariosFromGraph(graph, oracleLevel);

  try {
    writeJson(paths.scenariosPath, bundle);
  } catch (err: unknown) {
    throw new Error(`시나리오 파일 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { scenariosPath: paths.scenariosPath, count: bundle.scenarios.length };
}
