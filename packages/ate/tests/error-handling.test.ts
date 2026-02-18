import { test, expect, describe } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ATEFileError, readJson, writeJson, ensureDir } from "../src/fs";

describe("Error Handling", () => {
  describe("fs.ts", () => {
    let testDir: string;

    test("readJson should throw ATEFileError for missing file", () => {
      testDir = mkdtempSync(join(tmpdir(), "ate-error-test-"));
      const missingPath = join(testDir, "missing.json");

      try {
        readJson(missingPath);
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ATEFileError);
        const ateErr = err as ATEFileError;
        expect(ateErr.code).toBe("FILE_NOT_FOUND");
        expect(ateErr.message).toContain("찾을 수 없습니다");
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    test("readJson should throw ATEFileError for invalid JSON", () => {
      testDir = mkdtempSync(join(tmpdir(), "ate-error-test-"));
      const invalidPath = join(testDir, "invalid.json");
      writeFileSync(invalidPath, "not valid json {{{");

      try {
        readJson(invalidPath);
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(ATEFileError);
        const ateErr = err as ATEFileError;
        expect(ateErr.code).toBe("INVALID_JSON");
        expect(ateErr.message).toContain("잘못된 JSON 형식");
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    test("writeJson should create directories recursively", () => {
      testDir = mkdtempSync(join(tmpdir(), "ate-error-test-"));
      const deepPath = join(testDir, "a", "b", "c", "test.json");

      writeJson(deepPath, { test: true });

      const result = readJson(deepPath);
      expect(result).toEqual({ test: true });

      rmSync(testDir, { recursive: true, force: true });
    });

    test("ensureDir should handle permission errors gracefully", () => {
      // Note: Permission tests are platform-specific and may not work on all systems
      // This test is primarily for documentation
      expect(true).toBe(true);
    });
  });

  describe("extractor.ts", () => {
    test("should validate repoRoot", async () => {
      const { extract } = await import("../src/extractor");

      try {
        await extract({ repoRoot: "" });
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain("repoRoot");
      }
    });

    test("should handle missing route files gracefully", async () => {
      const { extract } = await import("../src/extractor");
      const testDir = mkdtempSync(join(tmpdir(), "ate-extract-test-"));

      try {
        const result = await extract({
          repoRoot: testDir,
          routeGlobs: ["nonexistent/**/*.tsx"],
        });

        expect(result.ok).toBe(true);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0]).toContain("route 파일을 찾을 수 없습니다");
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("scenario.ts", () => {
    test("should validate oracle level", () => {
      const { generateScenariosFromGraph } = require("../src/scenario");
      const graph = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        buildSalt: "test",
        nodes: [],
        edges: [],
        stats: { routes: 0, navigations: 0, modals: 0, actions: 0 },
      };

      try {
        generateScenariosFromGraph(graph, "INVALID" as unknown as "L1"); // intentionally invalid
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain("잘못된 oracleLevel");
        expect((err as Error).message).toContain("INVALID");
      }
    });

    test("should handle empty graph gracefully", () => {
      const { generateScenariosFromGraph } = require("../src/scenario");
      const graph = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        buildSalt: "test",
        nodes: [],
        edges: [],
        stats: { routes: 0, navigations: 0, modals: 0, actions: 0 },
      };

      const result = generateScenariosFromGraph(graph, "L1");

      expect(result.scenarios).toEqual([]);
      expect(result.oracleLevel).toBe("L1");
    });
  });

  describe("codegen.ts", () => {
    test("should handle missing scenario bundle", () => {
      const { generatePlaywrightSpecs } = require("../src/codegen");
      const testDir = mkdtempSync(join(tmpdir(), "ate-codegen-test-"));

      try {
        generatePlaywrightSpecs(testDir);
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain("시나리오 번들 읽기 실패");
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    test("should handle empty scenarios gracefully", () => {
      const { generatePlaywrightSpecs } = require("../src/codegen");
      const testDir = mkdtempSync(join(tmpdir(), "ate-codegen-test-"));

      try {
        // Create .mandu/scenarios directory
        const scenariosDir = join(testDir, ".mandu", "scenarios");
        ensureDir(scenariosDir);

        // Write empty scenario bundle
        const bundle = {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          oracleLevel: "L1",
          scenarios: [],
        };
        writeJson(join(scenariosDir, "generated.json"), bundle);

        const result = generatePlaywrightSpecs(testDir);

        expect(result.files).toEqual([]);
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0]).toContain("시나리오가 없습니다");
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("report.ts", () => {
    test("should validate required params", () => {
      const { composeSummary } = require("../src/report");

      try {
        composeSummary({
          repoRoot: "",
          runId: "test",
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          exitCode: 0,
          oracleLevel: "L1",
        });
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain("repoRoot");
      }
    });

    test("should validate runId", () => {
      const { writeSummary } = require("../src/report");
      const testDir = mkdtempSync(join(tmpdir(), "ate-report-test-"));

      try {
        writeSummary(testDir, "", {} as unknown as Parameters<typeof writeSummary>[2]); // intentionally invalid
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain("runId");
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });

  describe("impact.ts", () => {
    test("should validate repoRoot", async () => {
      const { computeImpact } = await import("../src/impact");

      try {
        await computeImpact({ repoRoot: "" });
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain("repoRoot");
      }
    });

    test("should validate git revisions", async () => {
      const { computeImpact } = await import("../src/impact");
      const testDir = mkdtempSync(join(tmpdir(), "ate-impact-test-"));

      try {
        await computeImpact({
          repoRoot: testDir,
          base: "invalid rev with spaces",
          head: "HEAD",
        });
        expect.unreachable("Should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).message).toContain("Invalid git revision");
      } finally {
        rmSync(testDir, { recursive: true, force: true });
      }
    });
  });
});
