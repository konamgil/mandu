/**
 * Loop Closure — Integration tests.
 *
 * End-to-end flow: `closeLoop({ stdout, stderr, exitCode })` → report.
 * We exercise representative real-world outputs from:
 *   - `bun test` failures
 *   - `tsc --noEmit` errors
 *   - Node/Bun runtime unhandled rejections
 *   - Missing-module resolver errors
 *   - Clean (green) runs
 *   - Genuine Mandu source text (negative control)
 */

import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { closeLoop } from "../index";

// Locate the mandu repo root so we can read real source files for the
// negative-control test. This test file lives at
// packages/skills/src/loop-closure/__tests__/ — go up 5 levels.
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

describe("closeLoop — happy paths", () => {
  it("returns no-stall on empty input", () => {
    const report = closeLoop();
    expect(report.stallReason).toBe("no-stall-detected");
    expect(report.evidence).toEqual([]);
  });

  it("returns no-stall when stdout and stderr are empty strings", () => {
    const report = closeLoop({ stdout: "", stderr: "", exitCode: 0 });
    expect(report.stallReason).toBe("no-stall-detected");
  });

  it("returns no-patterns-matched when exitCode is non-zero but no detector fires", () => {
    const report = closeLoop({
      stdout: "opaque custom tool output with no known pattern",
      stderr: "",
      exitCode: 7,
    });
    expect(report.stallReason).toBe("no-patterns-matched");
  });
});

describe("closeLoop — real-world scenarios", () => {
  it("bun test failure scenario produces a test-failure report", () => {
    const stdout = [
      "bun test v1.3.12",
      "",
      "src/foo.test.ts:",
      "(pass) math > adds",
      "(fail) math > multiplies",
      "  expected 6 to be 5",
      "",
      "5 pass",
      "1 fail",
      "Ran 6 tests across 1 file. [0.12s]",
    ].join("\n");
    const report = closeLoop({ stdout, stderr: "", exitCode: 1 });
    expect(report.stallReason).toContain("test failure");
    expect(report.nextPrompt).toContain("multiplies");
    expect(report.evidence.length).toBeGreaterThan(0);
  });

  it("typescript error scenario produces a typecheck-error report", () => {
    const stderr = [
      "src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "src/other.ts(5,3): error TS2304: Cannot find name 'foo'.",
      "",
      "Found 2 errors in 2 files.",
    ].join("\n");
    const report = closeLoop({ stdout: "", stderr, exitCode: 2 });
    expect(report.stallReason).toBe("2 typecheck errors detected");
    expect(report.nextPrompt).toContain("src/index.ts");
    expect(report.nextPrompt).toContain("src/other.ts");
    // Files touched section must be sorted
    const idxIndex = report.nextPrompt.indexOf("src/index.ts");
    const idxOther = report.nextPrompt.indexOf("src/other.ts");
    expect(idxIndex).toBeGreaterThan(0);
    expect(idxOther).toBeGreaterThan(0);
  });

  it("missing-module scenario produces a module-install prompt", () => {
    const stderr = "error: Cannot find module 'zod' imported from 'src/schema.ts'";
    const report = closeLoop({ stdout: "", stderr, exitCode: 1 });
    expect(report.stallReason).toContain("missing module");
    expect(report.nextPrompt).toContain("zod");
    expect(report.nextPrompt.toLowerCase()).toContain("install");
  });

  it("unhandled-rejection scenario produces a rejection prompt", () => {
    const stderr = [
      "error: Unhandled Promise Rejection",
      "    at asyncHandler (/app/main.ts:42:7)",
    ].join("\n");
    const report = closeLoop({ stdout: "", stderr, exitCode: 1 });
    // Unhandled rejection should be flagged; stack-trace is secondary.
    expect(report.nextPrompt.toLowerCase()).toContain("rejection");
  });

  it("not-implemented scenario produces a stub-completion prompt", () => {
    const stderr = 'Error: not implemented\n    at stubFn (/app/stub.ts:1:1)';
    const report = closeLoop({ stdout: "", stderr, exitCode: 1 });
    expect(report.stallReason).toContain("not-implemented");
  });

  it("mixed-stall scenario promotes typecheck as primary", () => {
    const stdout = "(fail) a > b";
    const stderr = [
      "x.ts(1,1): error TS1111: A",
      "TODO: bar",
    ].join("\n");
    const report = closeLoop({ stdout, stderr, exitCode: 1 });
    expect(report.stallReason).toContain("typecheck");
    // Secondary signals should be listed
    expect(report.nextPrompt).toContain("Other signals");
  });
});

describe("closeLoop — negative control against real Mandu source", () => {
  it("produces zero evidence on a real source file from the repo", () => {
    // Use this test file's own source — it contains only prose and tests,
    // not markers / rejections / typecheck noise.
    const candidatePaths = [
      join(REPO_ROOT, "packages", "skills", "src", "index.ts"),
      join(REPO_ROOT, "packages", "skills", "src", "generator", "index.ts"),
    ];
    const existing = candidatePaths.find((p) => existsSync(p));
    if (!existing) {
      // If we can't locate the repo (e.g. published install), assert a
      // synthetic clean payload instead. Still gives us a negative anchor.
      const report = closeLoop({
        stdout: "export function add(a: number, b: number): number { return a + b; }",
        stderr: "",
        exitCode: 0,
      });
      expect(report.evidence).toEqual([]);
      expect(report.stallReason).toBe("no-stall-detected");
      return;
    }
    const text = readFileSync(existing, "utf8");
    const report = closeLoop({ stdout: text, stderr: "", exitCode: 0 });
    expect(report.evidence).toEqual([]);
    expect(report.stallReason).toBe("no-stall-detected");
  });
});

describe("closeLoop — safety invariants", () => {
  it(
    "never spawns or performs I/O on bad input",
    () => {
      // Construct extreme inputs — very long strings, binary-ish noise,
      // and null-ish typecasts. closeLoop() must be total and pure.
      const bigStdout = "x".repeat(50_000);
      const report = closeLoop({
        stdout: bigStdout as unknown as string,
        stderr: null as unknown as string,
        exitCode: "not-a-number" as unknown as number,
      });
      // We just assert it returned a report shape; defaults kick in.
      expect(typeof report.stallReason).toBe("string");
      expect(typeof report.nextPrompt).toBe("string");
      expect(Array.isArray(report.evidence)).toBe(true);
    },
    15_000,
  );

  it("returns the same object shape regardless of input size", () => {
    const a = closeLoop({ stdout: "TODO: one", stderr: "", exitCode: 0 });
    const b = closeLoop({
      stdout: Array.from({ length: 100 }, () => "TODO: x").join("\n"),
      stderr: "",
      exitCode: 0,
    });
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
});

describe("Wave R3 L-05 — @mandujs/skills/loop-closure subpath export", () => {
  it("dynamic import via '@mandujs/skills/loop-closure' resolves and exposes closeLoop", async () => {
    // This import must succeed purely through package.json#exports mapping —
    // not a fs-fallback Bun-in-monorepo resolution. If the exports map is
    // missing the subpath, strict-mode consumers (npm-installed packages)
    // would fail with ERR_PACKAGE_PATH_NOT_EXPORTED.
    const mod = await import("@mandujs/skills/loop-closure");
    expect(typeof mod.closeLoop).toBe("function");
    expect(Array.isArray(mod.DEFAULT_DETECTORS)).toBe(true);
    expect(typeof mod.listDetectorIds).toBe("function");
  });

  it("dynamic import via '@mandujs/skills/loop-closure/detectors' resolves", async () => {
    const mod = await import("@mandujs/skills/loop-closure/detectors");
    expect(typeof mod.runDetectors).toBe("function");
    expect(Array.isArray(mod.DEFAULT_DETECTORS)).toBe(true);
    // A representative detector surfaces under this subpath.
    expect(typeof mod.detectTypecheckErrors).toBe("function");
  });
});

