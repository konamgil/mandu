import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ateExtract, ateGenerate, ateRun, ateReport, ateHeal, ateImpact } from "@mandujs/ate";
import type { ExtractInput, GenerateInput, RunInput, ImpactInput, HealInput, OracleLevel } from "@mandujs/ate";

type WithOptionalRepoRoot<T extends { repoRoot: string }> = Omit<T, "repoRoot"> & { repoRoot?: string };

function withRepoRoot<T extends { repoRoot: string }>(projectRoot: string, input: WithOptionalRepoRoot<T>): T {
  const repoRoot = input.repoRoot ?? projectRoot;
  return { ...(input as any), repoRoot } as T;
}

export const ateToolDefinitions: Tool[] = [
  {
    name: "mandu.ate.extract",
    description: "ATE: AST 기반 상호작용 그래프 추출",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "(optional) defaults to MCP projectRoot" },
        tsconfigPath: { type: "string" },
        routeGlobs: { type: "array", items: { type: "string" } },
        buildSalt: { type: "string" },
      },
      required: [],
    },
  },
  {
    name: "mandu.ate.generate",
    description: "ATE: 시나리오 생성 + Playwright spec codegen",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "(optional) defaults to MCP projectRoot" },
        oracleLevel: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
        onlyRoutes: { type: "array", items: { type: "string" } },
      },
      required: [],
    },
  },
  {
    name: "mandu.ate.run",
    description: "ATE: Playwright runner 실행(artifacts 수집)",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "(optional) defaults to MCP projectRoot" },
        baseURL: { type: "string" },
        ci: { type: "boolean" },
        headless: { type: "boolean" },
        browsers: { type: "array", items: { type: "string", enum: ["chromium", "firefox", "webkit"] } },
      },
      required: [],
    },
  },
  {
    name: "mandu.ate.report",
    description: "ATE: summary.json 생성",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "(optional) defaults to MCP projectRoot" },
        runId: { type: "string" },
        startedAt: { type: "string" },
        finishedAt: { type: "string" },
        exitCode: { type: "number" },
        oracleLevel: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
        impact: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["full", "subset"] },
            changedFiles: { type: "array", items: { type: "string" } },
            selectedRoutes: { type: "array", items: { type: "string" } },
          },
          required: ["mode", "changedFiles", "selectedRoutes"],
        },
      },
      required: ["runId", "startedAt", "finishedAt", "exitCode"],
    },
  },
  {
    name: "mandu.ate.heal",
    description: "ATE: 실패 원인 분류 + 복구 제안(diff) 생성 (자동 커밋 금지)",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "(optional) defaults to MCP projectRoot" },
        runId: { type: "string" },
      },
      required: ["runId"],
    },
  },
  {
    name: "mandu.ate.impact",
    description: "ATE: git diff 기반 subset 계산",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "(optional) defaults to MCP projectRoot" },
        base: { type: "string" },
        head: { type: "string" },
      },
      required: [],
    },
  },
];

export function ateTools(projectRoot: string) {
  return {
    "mandu.ate.extract": async (args: WithOptionalRepoRoot<ExtractInput>) => {
      return await ateExtract(withRepoRoot<ExtractInput>(projectRoot, args));
    },
    "mandu.ate.generate": async (args: WithOptionalRepoRoot<GenerateInput>) => {
      return ateGenerate(withRepoRoot<GenerateInput>(projectRoot, args));
    },
    "mandu.ate.run": async (args: WithOptionalRepoRoot<RunInput>) => {
      return await ateRun(withRepoRoot<RunInput>(projectRoot, args));
    },
    "mandu.ate.report": async (
      args: WithOptionalRepoRoot<{
        repoRoot: string;
        runId: string;
        startedAt: string;
        finishedAt: string;
        exitCode: number;
        oracleLevel?: OracleLevel;
        impact?: { mode: "full" | "subset"; changedFiles: string[]; selectedRoutes: string[] };
      }>
    ) => {
      const input = withRepoRoot(projectRoot, args);
      return await ateReport({
        repoRoot: input.repoRoot,
        runId: input.runId,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        exitCode: input.exitCode,
        oracleLevel: input.oracleLevel ?? "L1",
        impact: input.impact,
      });
    },
    "mandu.ate.heal": async (args: WithOptionalRepoRoot<HealInput>) => {
      return ateHeal(withRepoRoot<HealInput>(projectRoot, args));
    },
    "mandu.ate.impact": async (args: WithOptionalRepoRoot<ImpactInput>) => {
      return ateImpact(withRepoRoot<ImpactInput>(projectRoot, args));
    },
  };
}
