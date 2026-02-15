import type { OracleLevel } from "./types";
import { ATEFileError } from "./fs";
import { ateExtract, ateGenerate, ateRun, ateReport, ateImpact, ateHeal } from "./index";

export interface AutoPipelineOptions {
  repoRoot: string;
  baseURL?: string;
  oracleLevel?: OracleLevel;
  ci?: boolean;
  useImpactAnalysis?: boolean;
  base?: string;
  head?: string;
  autoHeal?: boolean;
  tsconfigPath?: string;
  routeGlobs?: string[];
  buildSalt?: string;
}

export interface AutoPipelineResult {
  ok: boolean;
  steps: {
    extract: { ok: boolean; error?: string };
    generate: { ok: boolean; error?: string };
    impact?: { ok: boolean; mode: "full" | "subset"; selectedRoutes: string[]; error?: string };
    run: { ok: boolean; runId: string; exitCode: number; error?: string };
    report: { ok: boolean; summaryPath?: string; error?: string };
    heal?: { ok: boolean; suggestionsCount: number; error?: string };
  };
}

/**
 * ATE 전체 파이프라인 자동 실행
 * Extract → Generate → (Impact) → Run → Report → (Heal)
 */
export async function runFullPipeline(options: AutoPipelineOptions): Promise<AutoPipelineResult> {
  const result: AutoPipelineResult = {
    ok: false,
    steps: {
      extract: { ok: false },
      generate: { ok: false },
      run: { ok: false, runId: "", exitCode: -1 },
      report: { ok: false },
    },
  };

  const oracleLevel = options.oracleLevel ?? "L1";

  try {
    // Step 1: Extract
    console.log("📊 [ATE Pipeline] Step 1/5: Extract - 상호작용 그래프 추출 중...");
    try {
      await ateExtract({
        repoRoot: options.repoRoot,
        tsconfigPath: options.tsconfigPath,
        routeGlobs: options.routeGlobs,
        buildSalt: options.buildSalt,
      });
      result.steps.extract.ok = true;
      console.log("✅ [ATE Pipeline] Extract 완료");
    } catch (err: any) {
      result.steps.extract.error = err.message;
      console.error(`❌ [ATE Pipeline] Extract 실패: ${err.message}`);
      return result;
    }

    // Step 2: Generate
    console.log("🎬 [ATE Pipeline] Step 2/5: Generate - 시나리오 및 테스트 생성 중...");
    try {
      await ateGenerate({
        repoRoot: options.repoRoot,
        oracleLevel,
      });
      result.steps.generate.ok = true;
      console.log("✅ [ATE Pipeline] Generate 완료");
    } catch (err: any) {
      result.steps.generate.error = err.message;
      console.error(`❌ [ATE Pipeline] Generate 실패: ${err.message}`);
      return result;
    }

    // Step 3 (Optional): Impact Analysis
    let impactResult: { changedFiles: string[]; selectedRoutes: string[] } | undefined;
    if (options.useImpactAnalysis) {
      console.log("🔍 [ATE Pipeline] Step 3/5: Impact Analysis - 변경 영향 분석 중...");
      try {
        const impact = await ateImpact({
          repoRoot: options.repoRoot,
          base: options.base,
          head: options.head,
        });
        result.steps.impact = {
          ok: true,
          mode: impact.selectedRoutes.length > 0 ? "subset" : "full",
          selectedRoutes: impact.selectedRoutes,
        };
        impactResult = {
          changedFiles: impact.changedFiles,
          selectedRoutes: impact.selectedRoutes,
        };
        console.log(
          `✅ [ATE Pipeline] Impact Analysis 완료 - ${impact.selectedRoutes.length}개 라우트 선택됨`,
        );
      } catch (err: any) {
        result.steps.impact = {
          ok: false,
          mode: "full",
          selectedRoutes: [],
          error: err.message,
        };
        console.warn(`⚠️ [ATE Pipeline] Impact Analysis 실패, 전체 테스트 실행: ${err.message}`);
        // Impact analysis 실패 시에도 계속 진행 (full test)
      }
    }

    // Step 4: Run
    console.log("🧪 [ATE Pipeline] Step 4/5: Run - Playwright 테스트 실행 중...");
    let runId = "";
    let exitCode = -1;
    let startedAt = "";
    let finishedAt = "";
    try {
      const runResult = await ateRun({
        repoRoot: options.repoRoot,
        baseURL: options.baseURL,
        ci: options.ci,
      });
      runId = runResult.runId;
      exitCode = runResult.exitCode;
      startedAt = runResult.startedAt;
      finishedAt = runResult.finishedAt;
      result.steps.run = { ok: exitCode === 0, runId, exitCode };
      console.log(
        `${exitCode === 0 ? "✅" : "⚠️"} [ATE Pipeline] Run 완료 - exitCode: ${exitCode}`,
      );
    } catch (err: any) {
      result.steps.run.error = err.message;
      console.error(`❌ [ATE Pipeline] Run 실패: ${err.message}`);
      return result;
    }

    // Step 5: Report
    console.log("📝 [ATE Pipeline] Step 5/5: Report - 테스트 리포트 생성 중...");
    try {
      const reportResult = await ateReport({
        repoRoot: options.repoRoot,
        runId,
        startedAt,
        finishedAt,
        exitCode,
        oracleLevel,
        impact: impactResult
          ? {
              mode: impactResult.selectedRoutes.length > 0 ? "subset" : "full",
              changedFiles: impactResult.changedFiles,
              selectedRoutes: impactResult.selectedRoutes,
            }
          : undefined,
      });
      result.steps.report = { ok: true, summaryPath: reportResult.summaryPath };
      console.log(`✅ [ATE Pipeline] Report 완료 - ${reportResult.summaryPath}`);
    } catch (err: any) {
      result.steps.report.error = err.message;
      console.error(`❌ [ATE Pipeline] Report 실패: ${err.message}`);
      return result;
    }

    // Step 6 (Optional): Heal
    if (options.autoHeal && exitCode !== 0) {
      console.log("🔧 [ATE Pipeline] Step 6/6: Heal - 자동 복구 제안 생성 중...");
      try {
        const healResult = await ateHeal({
          repoRoot: options.repoRoot,
          runId,
        });
        result.steps.heal = {
          ok: true,
          suggestionsCount: healResult.suggestions?.length ?? 0,
        };
        console.log(
          `✅ [ATE Pipeline] Heal 완료 - ${healResult.suggestions?.length ?? 0}개 제안 생성됨`,
        );
      } catch (err: any) {
        result.steps.heal = {
          ok: false,
          suggestionsCount: 0,
          error: err.message,
        };
        console.warn(`⚠️ [ATE Pipeline] Heal 실패: ${err.message}`);
        // Heal 실패는 전체 파이프라인 실패로 보지 않음
      }
    }

    // 최종 결과
    result.ok = result.steps.extract.ok && result.steps.generate.ok && result.steps.report.ok;
    console.log(
      `\n${result.ok ? "✅" : "⚠️"} [ATE Pipeline] 파이프라인 완료 - 전체 성공: ${result.ok}`,
    );

    return result;
  } catch (err: any) {
    throw new ATEFileError(
      `파이프라인 실행 중 예상치 못한 오류: ${err.message}`,
      "PIPELINE_ERROR",
      options.repoRoot,
    );
  }
}
