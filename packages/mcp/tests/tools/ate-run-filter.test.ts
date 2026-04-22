/**
 * mandu.ate.run / mandu_ate_run — scope filters (#237).
 *
 * Covers:
 *   - `onlyFiles` lands as Playwright positional args verbatim
 *     (relative paths stay relative; absolute paths are converted to
 *     repoRoot-relative forward-slash form).
 *   - `onlyRoutes` resolves via the existing Phase A.1 spec-indexer
 *     (`indexSpecs` + `specsForRouteId`).
 *   - Unknown route ids emit a warning but don't short-circuit the run.
 *   - `grep` forwards to Playwright `--grep` through `runSpec`.
 *   - Combined `onlyFiles` + `onlyRoutes` produces the deduped union.
 *
 * We test `resolveRunFilter` directly — the spawn-integration path is
 * covered by existing runner tests. Running real Playwright here is
 * out of scope (no dev server, no specs).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { resolveRunFilter, runSpec } from "@mandujs/ate";

function writeSpec(
  repoRoot: string,
  relPath: string,
  source: string,
): string {
  const full = join(repoRoot, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, source, "utf8");
  return full;
}

describe("mandu.ate.run — scope filters (#237)", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "ate-run-filter-"));
  });

  afterEach(() => {
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  test("onlyFiles passes Playwright positional args verbatim", () => {
    const result = resolveRunFilter(repoRoot, {
      onlyFiles: [
        "tests/e2e/one.spec.ts",
        "tests/e2e/two.spec.ts",
      ],
    });
    expect(result.warnings).toEqual([]);
    expect(result.files).toEqual([
      "tests/e2e/one.spec.ts",
      "tests/e2e/two.spec.ts",
    ]);
  });

  test("onlyFiles with absolute paths normalize to repoRoot-relative", () => {
    const abs = join(repoRoot, "tests", "e2e", "api.spec.ts");
    const result = resolveRunFilter(repoRoot, {
      onlyFiles: [abs],
    });
    expect(result.warnings).toEqual([]);
    // Cross-platform: we always emit forward slashes, never OS sep.
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toBe("tests/e2e/api.spec.ts");
    if (sep === "\\") {
      expect(result.files[0].includes("\\")).toBe(false);
    }
  });

  test("onlyRoutes resolves through spec-indexer and yields correct file set", () => {
    // Spec with an explicit `@ate-covers: <routeId>` comment so the
    // indexer classifies it under that routeId.
    writeSpec(
      repoRoot,
      "tests/e2e/signup.spec.ts",
      `// @ate-covers: api-signup\nimport { test } from "@playwright/test";\ntest("x", async ({ page }) => { await page.goto("/"); });\n`,
    );

    const result = resolveRunFilter(repoRoot, {
      onlyRoutes: ["api-signup"],
    });
    expect(result.warnings).toEqual([]);
    expect(result.files).toEqual(["tests/e2e/signup.spec.ts"]);
  });

  test("onlyRoutes with unknown route id logs a warning but doesn't fail", () => {
    writeSpec(
      repoRoot,
      "tests/e2e/signup.spec.ts",
      `// @ate-covers: api-signup\nimport { test } from "@playwright/test";\ntest("x", async ({ page }) => { await page.goto("/"); });\n`,
    );

    const result = resolveRunFilter(repoRoot, {
      onlyRoutes: ["api-signup", "does-not-exist"],
    });
    expect(result.files).toEqual(["tests/e2e/signup.spec.ts"]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/does-not-exist/);
    expect(result.warnings[0]).toMatch(/skipped/);
  });

  test("combined onlyFiles + onlyRoutes produces the deduped union", () => {
    writeSpec(
      repoRoot,
      "tests/e2e/a.spec.ts",
      `// @ate-covers: route-a\nimport { test } from "@playwright/test";\ntest("x", async () => {});\n`,
    );
    writeSpec(
      repoRoot,
      "tests/e2e/b.spec.ts",
      `// @ate-covers: route-b\nimport { test } from "@playwright/test";\ntest("x", async () => {});\n`,
    );

    const result = resolveRunFilter(repoRoot, {
      // `a.spec.ts` appears in both onlyFiles AND via onlyRoutes resolution
      // — we expect it deduped to a single entry.
      onlyFiles: ["tests/e2e/a.spec.ts"],
      onlyRoutes: ["route-a", "route-b"],
    });
    expect(result.warnings).toEqual([]);
    expect(result.files).toEqual([
      "tests/e2e/a.spec.ts",
      "tests/e2e/b.spec.ts",
    ]);
  });

  test("empty / omitted filters → empty file list (caller sends no filter)", () => {
    const empty = resolveRunFilter(repoRoot, {});
    expect(empty.files).toEqual([]);
    expect(empty.warnings).toEqual([]);

    const emptyArrays = resolveRunFilter(repoRoot, {
      onlyFiles: [],
      onlyRoutes: [],
    });
    expect(emptyArrays.files).toEqual([]);
    expect(emptyArrays.warnings).toEqual([]);
  });

  test("grep forwards to Playwright --grep via runSpec invocation builder", async () => {
    // When `grep` is supplied, the spawned argv must include
    // `--grep` followed by the trimmed value. We intercept the exec
    // layer so no real Playwright process spawns.
    let capturedArgs: string[] = [];
    await runSpec({
      repoRoot,
      spec: "tests/e2e/anything.spec.ts",
      grep: "  only-me  ",
      exec: async (input) => {
        capturedArgs = input.args.slice();
        return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
      },
    });
    const grepIdx = capturedArgs.indexOf("--grep");
    expect(grepIdx).toBeGreaterThanOrEqual(0);
    expect(capturedArgs[grepIdx + 1]).toBe("only-me");
  });

  test("mandu.ate.run tool definition exposes onlyFiles / onlyRoutes / grep", async () => {
    const { ateToolDefinitions } = await import("../../src/tools/ate.js");
    const runDef = ateToolDefinitions.find((d) => d.name === "mandu.ate.run")!;
    expect(runDef).toBeDefined();
    const schema = runDef.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty("onlyFiles");
    expect(schema.properties).toHaveProperty("onlyRoutes");
    expect(schema.properties).toHaveProperty("grep");
  });

  test("mandu_ate_run tool definition exposes grep", async () => {
    const { ateRunToolDefinitions } = await import(
      "../../src/tools/ate-run.js"
    );
    const def = ateRunToolDefinitions[0];
    const schema = def.inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(schema.properties).toHaveProperty("grep");
  });
});
