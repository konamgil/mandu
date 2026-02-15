import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  ateExtract,
  ateGenerate,
  ateRun,
  ateReport,
  ateHeal,
  ateImpact,
  runFullPipeline,
  analyzeFeedback,
  applyHeal,
} from "@mandujs/ate";

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
    description: "ATE: 테스트 리포트 생성 (JSON, HTML, 또는 both)",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string" },
        runId: { type: "string" },
        startedAt: { type: "string" },
        finishedAt: { type: "string" },
        exitCode: { type: "number" },
        oracleLevel: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
        format: { type: "string", enum: ["json", "html", "both"], description: "리포트 포맷 (기본값: both)" },
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
  {
    name: "mandu.ate.auto_pipeline",
    description: "ATE: 전체 파이프라인 자동 실행 (Extract → Generate → Run → Report → Heal)",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string" },
        baseURL: { type: "string" },
        oracleLevel: { type: "string", enum: ["L0", "L1", "L2", "L3"] },
        ci: { type: "boolean" },
        useImpactAnalysis: { type: "boolean" },
        base: { type: "string" },
        head: { type: "string" },
        autoHeal: { type: "boolean" },
        tsconfigPath: { type: "string" },
        routeGlobs: { type: "array", items: { type: "string" } },
        buildSalt: { type: "string" },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "mandu.ate.feedback",
    description: "ATE: 테스트 실패 원인 분석 및 heal 제안 평가",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "프로젝트 루트 디렉토리" },
        runId: { type: "string", description: "테스트 실행 ID" },
        autoApply: {
          type: "boolean",
          description: "자동 적용 가능 여부 (selector-map만 안전)",
        },
      },
      required: ["repoRoot", "runId"],
    },
  },
  {
    name: "mandu.ate.apply_heal",
    description: "ATE: heal diff를 실제 코드에 적용 (rollback 가능)",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "프로젝트 루트 디렉토리" },
        runId: { type: "string", description: "테스트 실행 ID" },
        healIndex: {
          type: "number",
          description: "적용할 heal suggestion의 인덱스 (0부터 시작)",
        },
        createBackup: {
          type: "boolean",
          description: "백업 생성 여부 (기본값: true, 필수 권장)",
        },
      },
      required: ["repoRoot", "runId", "healIndex"],
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
        format: input.format ?? "both",
        impact: input.impact,
      });
    },
    "mandu.ate.heal": async (args: Record<string, unknown>) => {
      return ateHeal(args as any);
    },
    "mandu.ate.impact": async (args: Record<string, unknown>) => {
      return ateImpact(args as any);
    },
    "mandu.ate.auto_pipeline": async (args: Record<string, unknown>) => {
      return await runFullPipeline(args as any);
    },
    "mandu.ate.feedback": async (args: Record<string, unknown>) => {
      const result = analyzeFeedback(args as any);
      return {
        ok: true,
        category: result.category,
        autoApplicable: result.autoApplicable,
        priority: result.priority,
        reasoning: result.reasoning,
        suggestions: result.suggestions,
      };
    },
    "mandu.ate.apply_heal": async (args: Record<string, unknown>) => {
      const result = applyHeal(args as any);
      return {
        ok: result.success,
        ...result,
      };
    },
  };
}
