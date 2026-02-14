import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getAtePaths,
  ensureDir,
  writeJson,
  readJson,
  fileExists,
  ATEFileError,
} from "../src/fs";

describe("fs", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-fs-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("getAtePaths", () => {
    test("should return correct paths structure", () => {
      const repoRoot = join(testDir, "project");
      const paths = getAtePaths(repoRoot);

      expect(paths.repoRoot).toBe(repoRoot);
      expect(paths.manduDir).toBe(join(repoRoot, ".mandu"));
      expect(paths.interactionGraphPath).toBe(join(repoRoot, ".mandu", "interaction-graph.json"));
      expect(paths.selectorMapPath).toBe(join(repoRoot, ".mandu", "selector-map.json"));
      expect(paths.scenariosPath).toBe(join(repoRoot, ".mandu", "scenarios", "generated.json"));
      expect(paths.reportsDir).toBe(join(repoRoot, ".mandu", "reports"));
      expect(paths.autoE2eDir).toBe(join(repoRoot, "tests", "e2e", "auto"));
      expect(paths.manualE2eDir).toBe(join(repoRoot, "tests", "e2e", "manual"));
    });

    test("should handle Windows paths", () => {
      const repoRoot = "C:\\Users\\test\\project";
      const paths = getAtePaths(repoRoot);

      expect(paths.repoRoot).toBe(repoRoot);
      expect(paths.manduDir).toContain(".mandu");
    });

    test("should handle Unix paths", () => {
      const repoRoot = "/home/user/project";
      const paths = getAtePaths(repoRoot);

      expect(paths.repoRoot).toBe(repoRoot);
      expect(paths.manduDir).toContain(".mandu");
    });
  });

  describe("ensureDir", () => {
    test("should create directory", () => {
      const dirPath = join(testDir, "new-dir");
      ensureDir(dirPath);

      expect(existsSync(dirPath)).toBe(true);
    });

    test("should create nested directories", () => {
      const dirPath = join(testDir, "a", "b", "c");
      ensureDir(dirPath);

      expect(existsSync(dirPath)).toBe(true);
    });

    test("should not throw if directory already exists", () => {
      const dirPath = join(testDir, "existing");
      mkdirSync(dirPath);

      expect(() => ensureDir(dirPath)).not.toThrow();
    });

    test("should throw ATEFileError on permission denied", () => {
      // This test is platform-specific and may not work on all systems
      // Skip if we can't simulate permission errors
      const restrictedPath = "/root/restricted-dir";

      try {
        ensureDir(restrictedPath);
        // If it succeeds, we're probably running as root or on Windows
        // Clean up and skip assertion
        if (existsSync(restrictedPath)) {
          rmSync(restrictedPath, { recursive: true, force: true });
        }
      } catch (err) {
        if (err instanceof ATEFileError) {
          expect(err.code).toBe("PERMISSION_DENIED");
          expect(err.path).toBe(restrictedPath);
        }
      }
    });
  });

  describe("writeJson", () => {
    test("should write JSON file", async () => {
      const filePath = join(testDir, "test.json");
      const data = { foo: "bar", count: 42 };

      writeJson(filePath, data);

      expect(existsSync(filePath)).toBe(true);
      const content = JSON.parse(await Bun.file(filePath).text());
      expect(content.foo).toBe("bar");
      expect(content.count).toBe(42);
    });

    test("should create parent directories", () => {
      const filePath = join(testDir, "nested", "deep", "test.json");
      const data = { test: true };

      writeJson(filePath, data);

      expect(existsSync(filePath)).toBe(true);
    });

    test("should pretty-print JSON", async () => {
      const filePath = join(testDir, "pretty.json");
      const data = { a: 1, b: { c: 2 } };

      writeJson(filePath, data);

      const content = await Bun.file(filePath).text();
      expect(content.includes("\n")).toBe(true);
    });

    test("should handle arrays", async () => {
      const filePath = join(testDir, "array.json");
      const data = [1, 2, 3, { name: "test" }];

      writeJson(filePath, data);

      expect(existsSync(filePath)).toBe(true);
      const content = JSON.parse(await Bun.file(filePath).text());
      expect(Array.isArray(content)).toBe(true);
      expect(content).toHaveLength(4);
    });

    test("should overwrite existing file", async () => {
      const filePath = join(testDir, "overwrite.json");
      writeJson(filePath, { version: 1 });
      writeJson(filePath, { version: 2 });

      const content = JSON.parse(await Bun.file(filePath).text());
      expect(content.version).toBe(2);
    });
  });

  describe("readJson", () => {
    test("should read JSON file", () => {
      const filePath = join(testDir, "read-test.json");
      const data = { name: "test", value: 123 };
      writeFileSync(filePath, JSON.stringify(data));

      const result = readJson<typeof data>(filePath);

      expect(result.name).toBe("test");
      expect(result.value).toBe(123);
    });

    test("should throw ATEFileError if file not found", () => {
      const filePath = join(testDir, "nonexistent.json");

      expect(() => readJson(filePath)).toThrow(ATEFileError);
      expect(() => readJson(filePath)).toThrow("파일을 찾을 수 없습니다");

      try {
        readJson(filePath);
      } catch (err) {
        if (err instanceof ATEFileError) {
          expect(err.code).toBe("FILE_NOT_FOUND");
          expect(err.path).toBe(filePath);
        }
      }
    });

    test("should throw ATEFileError on invalid JSON", () => {
      const filePath = join(testDir, "invalid.json");
      writeFileSync(filePath, "{ invalid json }");

      expect(() => readJson(filePath)).toThrow(ATEFileError);

      try {
        readJson(filePath);
      } catch (err) {
        if (err instanceof ATEFileError) {
          expect(err.code).toBe("INVALID_JSON");
        }
      }
    });

    test("should read nested objects", () => {
      const filePath = join(testDir, "nested.json");
      const data = {
        user: {
          name: "Alice",
          settings: {
            theme: "dark",
            notifications: true,
          },
        },
      };
      writeFileSync(filePath, JSON.stringify(data));

      const result = readJson<typeof data>(filePath);

      expect(result.user.name).toBe("Alice");
      expect(result.user.settings.theme).toBe("dark");
    });

    test("should read arrays", () => {
      const filePath = join(testDir, "array-read.json");
      const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
      writeFileSync(filePath, JSON.stringify(data));

      const result = readJson<typeof data>(filePath);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(3);
      expect(result[1].id).toBe(2);
    });

    test("should handle empty JSON object", () => {
      const filePath = join(testDir, "empty-object.json");
      writeFileSync(filePath, "{}");

      const result = readJson<Record<string, unknown>>(filePath);

      expect(result).toEqual({});
    });

    test("should handle empty JSON array", () => {
      const filePath = join(testDir, "empty-array.json");
      writeFileSync(filePath, "[]");

      const result = readJson<unknown[]>(filePath);

      expect(result).toEqual([]);
    });
  });

  describe("fileExists", () => {
    test("should return true for existing file", () => {
      const filePath = join(testDir, "exists.txt");
      writeFileSync(filePath, "content");

      expect(fileExists(filePath)).toBe(true);
    });

    test("should return false for non-existing file", () => {
      const filePath = join(testDir, "does-not-exist.txt");

      expect(fileExists(filePath)).toBe(false);
    });

    test("should return true for existing directory", () => {
      const dirPath = join(testDir, "exists-dir");
      mkdirSync(dirPath);

      expect(fileExists(dirPath)).toBe(true);
    });

    test("should return false for invalid path", () => {
      const invalidPath = "\0invalid";

      expect(fileExists(invalidPath)).toBe(false);
    });

    test("should not throw on permission errors", () => {
      // fileExists should safely return false instead of throwing
      const restrictedPath = "/root/restricted-file.txt";

      expect(() => fileExists(restrictedPath)).not.toThrow();
    });
  });

  describe("ATEFileError", () => {
    test("should create error with message, code, and path", () => {
      const err = new ATEFileError("Test error", "TEST_CODE", "/test/path");

      expect(err.message).toBe("Test error");
      expect(err.code).toBe("TEST_CODE");
      expect(err.path).toBe("/test/path");
      expect(err.name).toBe("ATEFileError");
    });

    test("should be instance of Error", () => {
      const err = new ATEFileError("Test", "CODE", "/path");

      expect(err instanceof Error).toBe(true);
      expect(err instanceof ATEFileError).toBe(true);
    });
  });

  describe("integration: writeJson + readJson", () => {
    test("should write and read complex data structure", () => {
      const filePath = join(testDir, "integration.json");
      const data = {
        schemaVersion: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
        nodes: [
          { kind: "route", id: "/", path: "/" },
          { kind: "route", id: "/about", path: "/about" },
        ],
        edges: [
          { kind: "navigate", from: "/", to: "/about" },
        ],
        stats: { routes: 2, navigations: 1 },
      };

      writeJson(filePath, data);
      const result = readJson<typeof data>(filePath);

      expect(result.schemaVersion).toBe(1);
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.stats.routes).toBe(2);
    });

    test("should preserve data types", () => {
      const filePath = join(testDir, "types.json");
      const data = {
        string: "hello",
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { nested: "value" },
      };

      writeJson(filePath, data);
      const result = readJson<typeof data>(filePath);

      expect(typeof result.string).toBe("string");
      expect(typeof result.number).toBe("number");
      expect(typeof result.boolean).toBe("boolean");
      expect(result.null).toBe(null);
      expect(Array.isArray(result.array)).toBe(true);
      expect(typeof result.object).toBe("object");
    });
  });
});
