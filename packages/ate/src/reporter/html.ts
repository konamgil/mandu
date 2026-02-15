import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { getAtePaths, ensureDir } from "../fs";
import type { SummaryJson } from "../types";
import { generateHtmlTemplate } from "./html-template";

export interface HtmlReportOptions {
  repoRoot: string;
  runId: string;
  outputPath?: string;
  includeScreenshots?: boolean;
  includeTraces?: boolean;
}

export interface HtmlReportResult {
  path: string;
  size: number;
}

export async function generateHtmlReport(options: HtmlReportOptions): Promise<HtmlReportResult> {
  const { repoRoot, runId, outputPath, includeScreenshots = true } = options;

  if (!repoRoot) {
    throw new Error("repoRoot는 필수입니다");
  }
  if (!runId) {
    throw new Error("runId는 필수입니다");
  }

  const paths = getAtePaths(repoRoot);
  const runDir = join(paths.reportsDir, runId);
  const summaryPath = join(runDir, "summary.json");

  // 1. summary.json 읽기
  if (!existsSync(summaryPath)) {
    throw new Error(`Summary 파일을 찾을 수 없습니다: ${summaryPath}`);
  }

  let summary: SummaryJson;
  try {
    const content = readFileSync(summaryPath, "utf-8");
    summary = JSON.parse(content);
  } catch (err: any) {
    throw new Error(`Summary 파일 읽기 실패: ${err.message}`);
  }

  // 2. 스크린샷 URL 수집 (선택)
  const screenshotUrls: string[] = [];
  if (includeScreenshots) {
    try {
      const screenshotsDir = join(runDir, "screenshots");
      if (existsSync(screenshotsDir)) {
        const files = readdirSync(screenshotsDir);
        files
          .filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
          .forEach((f) => {
            screenshotUrls.push(`./screenshots/${f}`);
          });
      }
    } catch (err: any) {
      console.warn(`스크린샷 수집 실패: ${err.message}`);
    }
  }

  // 3. HTML 생성
  const html = generateHtmlTemplate(summary, screenshotUrls);

  // 4. 파일 저장
  const htmlPath = outputPath ?? join(runDir, "index.html");
  try {
    ensureDir(join(htmlPath, "..")); // 상위 디렉토리 확인
    writeFileSync(htmlPath, html, "utf-8");
  } catch (err: any) {
    throw new Error(`HTML 파일 저장 실패: ${err.message}`);
  }

  const size = Buffer.byteLength(html, "utf-8");

  return {
    path: htmlPath,
    size,
  };
}
