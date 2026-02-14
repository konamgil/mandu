export * from "./types";
export * as ATEFS from "./fs";

import { existsSync } from "node:fs";

export { extract } from "./extractor";
export { generateAndWriteScenarios } from "./scenario";
export { generatePlaywrightSpecs } from "./codegen";
export { runPlaywright } from "./runner";
export { composeSummary, writeSummary } from "./report";
export { heal } from "./heal";
export { computeImpact } from "./impact";

import type { ExtractInput, GenerateInput, RunInput, ImpactInput, HealInput, OracleLevel } from "./types";
import { getAtePaths, writeJson } from "./fs";
import { extract } from "./extractor";
import { generateAndWriteScenarios } from "./scenario";
import { generatePlaywrightSpecs } from "./codegen";
import { heal } from "./heal";
import { computeImpact } from "./impact";

/**
 * High-level ATE pipeline helpers (JSON in/out)
 */
export async function ateExtract(input: ExtractInput) {
  return extract(input);
}

export function ateGenerate(input: GenerateInput) {
  const paths = getAtePaths(input.repoRoot);
  const oracleLevel = input.oracleLevel ?? ("L1" as OracleLevel);
  // generate scenarios then specs
  generateAndWriteScenarios(input.repoRoot, oracleLevel);
  const res = generatePlaywrightSpecs(input.repoRoot, { onlyRoutes: input.onlyRoutes });

  // Ensure selector-map.json exists (may be updated later during run)
  try {
    if (!existsSync(paths.selectorMapPath)) {
      writeJson(paths.selectorMapPath, {
        version: 1,
        buildSalt: process.env.MANDU_BUILD_SALT ?? "dev",
        generatedAt: new Date().toISOString(),
        entries: [],
      });
    }
  } catch {
    // ignore
  }

  return {
    ok: true,
    scenariosPath: paths.scenariosPath,
    generatedSpecs: res.files,
  };
}

export async function ateRun(input: RunInput) {
  const startedAt = new Date().toISOString();
  const { runPlaywright } = await import("./runner");
  const run = await runPlaywright(input);
  const finishedAt = new Date().toISOString();
  return { ok: run.exitCode === 0, ...run, startedAt, finishedAt };
}

export async function ateReport(params: { repoRoot: string; runId: string; startedAt: string; finishedAt: string; exitCode: number; oracleLevel: OracleLevel; impact?: { changedFiles: string[]; selectedRoutes: string[]; mode: "full" | "subset" } }) {
  const { composeSummary, writeSummary } = await import("./report");
  const summary = composeSummary({
    repoRoot: params.repoRoot,
    runId: params.runId,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    exitCode: params.exitCode,
    oracleLevel: params.oracleLevel,
    impact: params.impact,
  });
  const summaryPath = writeSummary(params.repoRoot, params.runId, summary);
  return { ok: true, summaryPath, summary };
}

export function ateImpact(input: ImpactInput) {
  return { ok: true, ...computeImpact(input) };
}

export function ateHeal(input: HealInput) {
  return { ok: true, ...heal(input) };
}
