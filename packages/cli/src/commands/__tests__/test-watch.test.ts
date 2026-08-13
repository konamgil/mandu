/**
 * Tests for `mandu test --watch` orchestration (Phase 12.3).
 *
 * The watcher itself blocks the event loop, so we don't exercise it
 * end-to-end here. Instead we validate:
 *
 *  - `planWatch` and `describeWatchPlan` produce deterministic output.
 *  - `computeAffectedTests` maps changed files → re-run test files
 *    correctly (direct match + import scan).
 *  - `--watch --dry-run` via `testCommand` returns true and prints the
 *    plan.
 *  - Regression: zero available watch dirs → CLI_E066.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  computeAffectedTests,
  describeWatchPlan,
  planWatch,
  testCommand,
} from "../test";
import { resolveTestConfig } from "@mandujs/core/compat/config/validate";

const PREFIX = path.join(os.tmpdir(), "mandu-cli-test-watch-");

// ═══════════════════════════════════════════════════════════════════════════
// computeAffectedTests
// ═══════════════════════════════════════════════════════════════════════════

describe("computeAffectedTests", () => {
  it("returns a direct test match when the changed file is a test", () => {
    const result = computeAffectedTests({
      changedFiles: ["/repo/app/foo.test.ts"],
      testFiles: ["/repo/app/foo.test.ts", "/repo/app/bar.test.ts"],
      readFile: () => "",
    });
    expect(result).toEqual(["/repo/app/foo.test.ts"]);
  });

  it("picks up tests that import the changed source file by basename", () => {
    const result = computeAffectedTests({
      changedFiles: ["/repo/src/user.ts"],
      testFiles: ["/repo/tests/user.test.ts", "/repo/tests/other.test.ts"],
      readFile: (abs) => {
        if (abs.endsWith("user.test.ts")) {
          return `import { User } from "../src/user";`;
        }
        return `import { Other } from "../src/other";`;
      },
    });
    expect(result).toEqual(["/repo/tests/user.test.ts"]);
  });

  it("matches extension-stripped import paths", () => {
    const result = computeAffectedTests({
      changedFiles: ["/repo/src/login.ts"],
      testFiles: ["/repo/tests/login.test.ts"],
      readFile: () => `import { doLogin } from "../src/login"; // extension-stripped`,
    });
    expect(result).toEqual(["/repo/tests/login.test.ts"]);
  });

  it("returns an empty array when nothing imports the changed file", () => {
    const result = computeAffectedTests({
      changedFiles: ["/repo/src/unused.ts"],
      testFiles: ["/repo/tests/a.test.ts", "/repo/tests/b.test.ts"],
      readFile: () => `// no imports`,
    });
    expect(result).toEqual([]);
  });

  it("deduplicates when multiple needles hit the same test file", () => {
    const result = computeAffectedTests({
      changedFiles: ["/repo/src/user.ts", "/repo/src/user.helpers.ts"],
      testFiles: ["/repo/tests/user.test.ts"],
      readFile: () => `import "../src/user"; import "../src/user.helpers";`,
    });
    expect(result).toEqual(["/repo/tests/user.test.ts"]);
  });

  it("survives unreadable test files", () => {
    const result = computeAffectedTests({
      changedFiles: ["/repo/src/user.ts"],
      testFiles: ["/repo/tests/broken.test.ts"],
      readFile: () => {
        throw new Error("ENOENT");
      },
    });
    // Unreadable file simply drops out; no crash.
    expect(result).toEqual([]);
  });

  it("sorts output deterministically", () => {
    const result = computeAffectedTests({
      changedFiles: [
        "/repo/tests/z.test.ts",
        "/repo/tests/a.test.ts",
      ],
      testFiles: [
        "/repo/tests/z.test.ts",
        "/repo/tests/a.test.ts",
      ],
      readFile: () => "",
    });
    expect(result).toEqual([
      "/repo/tests/a.test.ts",
      "/repo/tests/z.test.ts",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// planWatch + describeWatchPlan
// ═══════════════════════════════════════════════════════════════════════════

describe("planWatch + describeWatchPlan", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await fs.promises.mkdtemp(PREFIX + "plan-");
    fs.mkdirSync(path.join(dir, "app"));
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(path.join(dir, "src", "foo.test.ts"), "// t");
  });

  afterAll(async () => {
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("reports the actual watch directories + debounce + targets", async () => {
    const plan = await planWatch({}, dir, resolveTestConfig({}));
    expect(plan.debounceMs).toBe(200);
    expect(plan.targets).toEqual(["unit", "integration"]);
    expect(plan.watchDirs.length).toBeGreaterThanOrEqual(1);
    expect(plan.watchDirs.some((d) => d.includes("app"))).toBe(true);
    expect(plan.watchDirs.some((d) => d.includes("src"))).toBe(true);
  });

  it("describeWatchPlan renders a human-readable block", async () => {
    const plan = await planWatch({}, dir, resolveTestConfig({}));
    const text = describeWatchPlan(plan);
    expect(text).toContain("mandu test --watch plan");
    expect(text).toContain("debounce:");
    expect(text).toContain("targets:");
    expect(text).toContain("watch dirs:");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// testCommand --watch --dry-run
// ═══════════════════════════════════════════════════════════════════════════

describe("testCommand --watch --dry-run", () => {
  it("returns true and never spawns the watcher", async () => {
    const dir = await fs.promises.mkdtemp(PREFIX + "dryrun-");
    try {
      fs.mkdirSync(path.join(dir, "src"));
      const ok = await testCommand("all", {
        cwd: dir,
        watch: true,
        dryRun: true,
      });
      expect(ok).toBe(true);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns false when there's nothing to watch (regression for CLI_E066)", async () => {
    const dir = await fs.promises.mkdtemp(PREFIX + "empty-");
    try {
      // No app/, src/, or packages/ directories exist.
      const ok = await testCommand("all", {
        cwd: dir,
        watch: true,
        dryRun: false,
      });
      expect(ok).toBe(false);
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Debounce safety — concurrent changes should coalesce
// ═══════════════════════════════════════════════════════════════════════════

describe("computeAffectedTests — concurrency safety", () => {
  it("handles hundreds of changes in a single pass", () => {
    const testFiles = Array.from({ length: 20 }, (_, i) => `/repo/tests/t${i}.test.ts`);
    const changedFiles = Array.from({ length: 500 }, (_, i) => `/repo/src/lib${i}.ts`);
    // Each test imports library `lib0`; all other libs are orphans.
    const start = Date.now();
    const result = computeAffectedTests({
      changedFiles,
      testFiles,
      readFile: () => `import "../src/lib0";`,
    });
    const durationMs = Date.now() - start;
    // All 20 tests reference lib0 → should be included.
    expect(result).toHaveLength(20);
    // Stays well under a debounce window even with 500 changes.
    expect(durationMs).toBeLessThan(1000);
  });
});
