import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { FileAPI } from "../../src/kitchen/api/file-api";
import fs from "fs";
import path from "path";
import os from "os";

describe("FileAPI", () => {
  let tmpDir: string;
  let api: FileAPI;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-api-"));
    api = new FileAPI(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("handleReadFile", () => {
    it("should read an existing file", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.ts"), 'const x = 1;');
      const url = new URL(`http://localhost/__kitchen/api/file?path=test.ts`);
      const res = await api.handleReadFile(url);
      const data = await res.json();

      expect(data.content).toBe("const x = 1;");
      expect(data.language).toBe("typescript");
    });

    it("should return 400 for missing path param", async () => {
      const url = new URL("http://localhost/__kitchen/api/file");
      const res = await api.handleReadFile(url);
      expect(res.status).toBe(400);
    });

    it("should return 404 for non-existent file", async () => {
      const url = new URL("http://localhost/__kitchen/api/file?path=nonexistent.ts");
      const res = await api.handleReadFile(url);
      expect(res.status).toBe(404);
    });

    it("should block path traversal", async () => {
      const url = new URL("http://localhost/__kitchen/api/file?path=../../etc/passwd");
      const res = await api.handleReadFile(url);
      expect(res.status).toBe(403);
    });
  });

  describe("handleFileDiff", () => {
    it("should return 400 for missing path param", async () => {
      const url = new URL("http://localhost/__kitchen/api/file/diff");
      const res = await api.handleFileDiff(url);
      expect(res.status).toBe(400);
    });

    it("should block path traversal", async () => {
      const url = new URL("http://localhost/__kitchen/api/file/diff?path=../../../etc/passwd");
      const res = await api.handleFileDiff(url);
      expect(res.status).toBe(403);
    });
  });

  describe("handleRecentChanges", () => {
    it("should return changes array", async () => {
      const res = await api.handleRecentChanges();
      const data = await res.json();
      expect(data).toHaveProperty("changes");
      expect(Array.isArray(data.changes)).toBe(true);
    });
  });
});
