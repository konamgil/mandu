import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ateExtract, ateGenerate, ateRun, ateReport, ateHeal, ateImpact } from "@mandujs/ate";

export const ateToolDefinitions: Tool[] = [
  {
    name: "mandu.ate.extract",
    description: "ATE: AST 기반 상호작용 그래프 추출",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string" },
        tsconfigPath: { type: "string" },
        routeGlobs: { type: "array", items: { type: "string" } },
        buildSalt: { type: "string" },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "mandu.ate.generate",
    description: "ATE: 시나리오 생성 + Playwright spec codegen",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string" },
        oracleLevel: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
        onlyRoutes: { type: "array", items: { type: "string" } },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "mandu.ate.run",
    description: "ATE: Playwright runner 실행(artifacts 수집)",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string" },
        baseURL: { type: "string" },
        ci: { type: "boolean" },
        headless: { type: "boolean" },
        browsers: { type: "array", items: { type: "string", enum: ["chromium", "firefox", "webkit"] } },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "mandu.ate.report",
    description: "ATE: summary.json 생성",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string" },
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
      required: ["repoRoot", "runId", "startedAt", "finishedAt", "exitCode"],
    },
  },
  {
    name: "mandu.ate.heal",
    description: "ATE: 실패 원인 분류 + 복구 제안(diff) 생성 (자동 커밋 금지)",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string" },
        runId: { type: "string" },
      },
      required: ["repoRoot", "runId"],
    },
  },
  {
    name: "mandu.ate.impact",
    description: "ATE: git diff 기반 subset 계산",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string" },
        base: { type: "string" },
        head: { type: "string" },
      },
      required: ["repoRoot"],
    },
  },
];

export function ateTools(projectRoot: string) {
  return {
    "mandu.ate.extract": async (args: Record<string, unknown>) => {
      return await ateExtract(args as any);
    },
    "mandu.ate.generate": async (args: Record<string, unknown>) => {
      return ateGenerate(args as any);
    },
    "mandu.ate.run": async (args: Record<string, unknown>) => {
      return await ateRun(args as any);
    },
    "mandu.ate.report": async (args: Record<string, unknown>) => {
      const input = args as any;
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
    "mandu.ate.heal": async (args: Record<string, unknown>) => {
      return ateHeal(args as any);
    },
    "mandu.ate.impact": async (args: Record<string, unknown>) => {
      return ateImpact(args as any);
    },
  };
}
