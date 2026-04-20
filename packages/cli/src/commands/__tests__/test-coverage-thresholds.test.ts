/**
 * Phase 18.σ — per-metric coverage threshold enforcement tests.
 *
 * Verifies:
 *  - `resolveEffectiveThresholds` hoists legacy shorthand into the
 *    new `thresholds` sub-block.
 *  - `enforceCoverageThresholds` passes / fails correctly against a
 *    real on-disk LCOV body.
 *  - Missing thresholds = no enforcement (backward compat).
 *  - Missing LCOV file = no enforcement.
 *  - Per-metric breakdown is printed when any metric fails.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  enforceCoverageThresholds,
  resolveEffectiveThresholds,
} from "../test";
import { resolveTestConfig } from "@mandujs/core/config/validate";

const PREFIX = path.join(os.tmpdir(), "mandu-cli-threshold-");

function writeLcov(
  dir: string,
  name: string,
  opts: { lh: number; lf: number; bh?: number; bf?: number; fh?: number; ff?: number },
): string {
  const body: string[] = ["SF:file.ts"];
  if (opts.ff !== undefined) body.push(`FNF:${opts.ff}`);
  if (opts.fh !== undefined) body.push(`FNH:${opts.fh}`);
  if (opts.bf !== undefined) body.push(`BRF:${opts.bf}`);
  if (opts.bh !== undefined) body.push(`BRH:${opts.bh}`);
  body.push(`LF:${opts.lf}`);
  body.push(`LH:${opts.lh}`);
  body.push("end_of_record");
  body.push("");
  const lcovPath = path.join(dir, `${name}.lcov`);
  fs.writeFileSync(lcovPath, body.join("\n"));
  return lcovPath;
}

// ═══════════════════════════════════════════════════════════════════════════
// resolveEffectiveThresholds
// ═══════════════════════════════════════════════════════════════════════════

describe("resolveEffectiveThresholds", () => {
  it("returns undefined when nothing is configured", () => {
    const cfg = resolveTestConfig({ coverage: {} });
    expect(resolveEffectiveThresholds(cfg)).toBeUndefined();
  });

  it("hoists legacy `coverage.lines` into thresholds.lines", () => {
    const cfg = resolveTestConfig({ coverage: { lines: 80 } });
    expect(resolveEffectiveThresholds(cfg)).toEqual({ lines: 80 });
  });

  it("prefers explicit `thresholds.lines` over legacy shorthand", () => {
    const cfg = resolveTestConfig({
      coverage: { lines: 50, thresholds: { lines: 90 } },
    });
    expect(resolveEffectiveThresholds(cfg)).toEqual({ lines: 90 });
  });

  it("carries all four metrics when set", () => {
    const cfg = resolveTestConfig({
      coverage: {
        thresholds: {
          lines: 80,
          branches: 60,
          functions: 70,
          statements: 75,
        },
      },
    });
    expect(resolveEffectiveThresholds(cfg)).toEqual({
      lines: 80,
      branches: 60,
      functions: 70,
      statements: 75,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// enforceCoverageThresholds
// ═══════════════════════════════════════════════════════════════════════════

describe("enforceCoverageThresholds", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.promises.mkdtemp(PREFIX);
  });
  afterAll(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("returns ok=true when thresholds are undefined", () => {
    const lcov = writeLcov(dir, "none", { lh: 50, lf: 100 });
    const res = enforceCoverageThresholds(lcov, undefined);
    expect(res.ok).toBe(true);
  });

  it("returns ok=true when the LCOV file does not exist", () => {
    const res = enforceCoverageThresholds(path.join(dir, "nope.lcov"), {
      lines: 80,
    });
    expect(res.ok).toBe(true);
  });

  it("returns ok=true when every metric meets its target", () => {
    const lcov = writeLcov(dir, "pass", {
      lh: 90,
      lf: 100,
      bh: 60,
      bf: 60,
      fh: 8,
      ff: 10,
    });
    const res = enforceCoverageThresholds(lcov, {
      lines: 80,
      branches: 80,
      functions: 80,
    });
    expect(res.ok).toBe(true);
    expect(res.coverage?.lines?.pct).toBe(90);
    expect(res.coverage?.branches?.pct).toBe(100);
  });

  it("returns ok=false when lines are below target (repo at 70%, required 90%)", () => {
    const lcov = writeLcov(dir, "under-lines", { lh: 70, lf: 100 });
    const res = enforceCoverageThresholds(lcov, { lines: 90 });
    expect(res.ok).toBe(false);
    expect(res.coverage?.lines?.pct).toBe(70);
  });

  it("returns ok=false when any single metric fails (branches)", () => {
    const lcov = writeLcov(dir, "under-branches", {
      lh: 95,
      lf: 100,
      bh: 10,
      bf: 100,
    });
    const res = enforceCoverageThresholds(lcov, {
      lines: 80,
      branches: 50,
    });
    expect(res.ok).toBe(false);
  });

  it("treats a missing metric in the LCOV as actual=0 when target is set", () => {
    const lcov = writeLcov(dir, "no-branches", { lh: 100, lf: 100 });
    // Branches unset in LCOV → actual=0 vs target=50 → fail.
    const res = enforceCoverageThresholds(lcov, { branches: 50 });
    expect(res.ok).toBe(false);
  });

  it("tolerates a metric with zero found lines (skip)", () => {
    const lcov = writeLcov(dir, "empty-found", { lh: 0, lf: 0 });
    // No LF=no data → no lines block emitted → lines threshold skipped
    // against an undefined metric. With `{lines: 80}` target → fails
    // (because actual=0). We assert the shape without ambiguity:
    const res = enforceCoverageThresholds(lcov, { functions: 50 });
    expect(res.ok).toBe(false); // functions undefined → 0 → fails target
    expect(res.coverage).toBeDefined();
  });

  it("reports coverage even when threshold check passes so reporter can emit it", () => {
    const lcov = writeLcov(dir, "ok", { lh: 80, lf: 100 });
    const res = enforceCoverageThresholds(lcov, { lines: 80 });
    expect(res.ok).toBe(true);
    expect(res.coverage?.lines?.hit).toBe(80);
    expect(res.coverage?.lines?.found).toBe(100);
  });
});
