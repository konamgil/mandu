import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { KitchenHandler, KITCHEN_PREFIX } from "../../src/kitchen/kitchen-handler";
import type { RoutesManifest } from "../../src/spec/schema";
import fs from "fs";
import path from "path";
import os from "os";

const mockManifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "home",
      pattern: "/",
      kind: "page",
      module: "./app/page.tsx",
      componentModule: "./app/page.tsx",
    },
    {
      id: "api-users",
      pattern: "/api/users",
      kind: "api",
      module: "./app/api/users/route.ts",
      methods: ["GET", "POST"],
    },
  ],
};

describe("KitchenHandler Phase 2", () => {
  let tmpDir: string;
  let handler: KitchenHandler;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kitchen-p2-"));
    fs.mkdirSync(path.join(tmpDir, ".mandu"), { recursive: true });

    handler = new KitchenHandler({
      rootDir: tmpDir,
      manifest: mockManifest,
      guardConfig: null,
    });
    handler.start();
  });

  afterEach(() => {
    handler.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── File API ──────────────────────────────────

  describe("File API", () => {
    it("should read a file via GET /__kitchen/api/file", async () => {
      fs.writeFileSync(path.join(tmpDir, "test.ts"), "const x = 1;");
      const req = new Request("http://localhost/__kitchen/api/file?path=test.ts");
      const res = await handler.handle(req, "/__kitchen/api/file");

      expect(res).not.toBeNull();
      const data = await res!.json();
      expect(data.content).toBe("const x = 1;");
      expect(data.language).toBe("typescript");
    });

    it("should return 400 for missing path", async () => {
      const req = new Request("http://localhost/__kitchen/api/file");
      const res = await handler.handle(req, "/__kitchen/api/file");
      expect(res!.status).toBe(400);
    });

    it("should return file changes via GET /__kitchen/api/file/changes", async () => {
      const req = new Request("http://localhost/__kitchen/api/file/changes");
      const res = await handler.handle(req, "/__kitchen/api/file/changes");

      expect(res).not.toBeNull();
      const data = await res!.json();
      expect(data).toHaveProperty("changes");
    });

    it("should handle diff request", async () => {
      fs.writeFileSync(path.join(tmpDir, "diff-test.ts"), "const y = 2;");
      const req = new Request("http://localhost/__kitchen/api/file/diff?path=diff-test.ts");
      const res = await handler.handle(req, "/__kitchen/api/file/diff");

      expect(res).not.toBeNull();
      expect(res!.status).toBe(200);
    });
  });

  // ─── Guard Decisions API ─────────────────────────

  describe("Guard Decisions API", () => {
    it("should return empty decisions initially", async () => {
      const req = new Request("http://localhost/__kitchen/api/guard/decisions");
      const res = await handler.handle(req, "/__kitchen/api/guard/decisions");

      expect(res).not.toBeNull();
      const data = await res!.json();
      expect(data.decisions).toHaveLength(0);
    });

    it("should approve a violation", async () => {
      const req = new Request("http://localhost/__kitchen/api/guard/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleId: "no-cross-layer",
          filePath: "src/app/page.tsx",
          reason: "Intentional",
        }),
      });
      const res = await handler.handle(req, "/__kitchen/api/guard/approve");

      expect(res).not.toBeNull();
      const data = await res!.json();
      expect(data.decision.action).toBe("approve");
      expect(data.decision.id).toBeTruthy();
    });

    it("should reject a violation", async () => {
      const req = new Request("http://localhost/__kitchen/api/guard/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleId: "no-cross-layer",
          filePath: "src/app/page.tsx",
        }),
      });
      const res = await handler.handle(req, "/__kitchen/api/guard/reject");

      expect(res).not.toBeNull();
      const data = await res!.json();
      expect(data.decision.action).toBe("reject");
    });

    it("should list decisions after approval", async () => {
      // Approve first
      const approveReq = new Request("http://localhost/__kitchen/api/guard/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleId: "rule1",
          filePath: "src/test.ts",
        }),
      });
      await handler.handle(approveReq, "/__kitchen/api/guard/approve");

      // List
      const listReq = new Request("http://localhost/__kitchen/api/guard/decisions");
      const res = await handler.handle(listReq, "/__kitchen/api/guard/decisions");
      const data = await res!.json();

      expect(data.decisions).toHaveLength(1);
      expect(data.decisions[0].ruleId).toBe("rule1");
    });

    it("should delete a decision", async () => {
      // Create
      const approveReq = new Request("http://localhost/__kitchen/api/guard/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: "rule1", filePath: "test.ts" }),
      });
      const approveRes = await handler.handle(approveReq, "/__kitchen/api/guard/approve");
      const { decision } = await approveRes!.json();

      // Delete
      const deleteReq = new Request(`http://localhost/__kitchen/api/guard/decisions/${decision.id}`, {
        method: "DELETE",
      });
      const deleteRes = await handler.handle(deleteReq, `/__kitchen/api/guard/decisions/${decision.id}`);
      const deleteData = await deleteRes!.json();
      expect(deleteData.removed).toBe(true);

      // Verify empty
      const listReq = new Request("http://localhost/__kitchen/api/guard/decisions");
      const listRes = await handler.handle(listReq, "/__kitchen/api/guard/decisions");
      const listData = await listRes!.json();
      expect(listData.decisions).toHaveLength(0);
    });
  });

  // ─── Contracts API ───────────────────────────────

  describe("Contracts API", () => {
    it("should list contracts (empty when no contractModules)", async () => {
      const req = new Request("http://localhost/__kitchen/api/contracts");
      const res = await handler.handle(req, "/__kitchen/api/contracts");

      expect(res).not.toBeNull();
      const data = await res!.json();
      expect(data.contracts).toHaveLength(0);
    });

    it("should return 404 for unknown contract detail", async () => {
      const req = new Request("http://localhost/__kitchen/api/contracts/nonexistent");
      const res = await handler.handle(req, "/__kitchen/api/contracts/nonexistent");

      expect(res).not.toBeNull();
      expect(res!.status).toBe(404);
    });

    it("should return OpenAPI JSON", async () => {
      const req = new Request("http://localhost/__kitchen/api/contracts/openapi");
      const res = await handler.handle(req, "/__kitchen/api/contracts/openapi");

      expect(res).not.toBeNull();
      expect(res!.headers.get("Content-Type")).toContain("application/json");
      const text = await res!.text();
      const doc = JSON.parse(text);
      expect(doc.openapi).toBe("3.0.3");
    });

    it("should return OpenAPI YAML", async () => {
      const req = new Request("http://localhost/__kitchen/api/contracts/openapi.yaml");
      const res = await handler.handle(req, "/__kitchen/api/contracts/openapi.yaml");

      expect(res).not.toBeNull();
      expect(res!.headers.get("Content-Type")).toContain("text/yaml");
    });

    it("should return 400 for validate without contractId", async () => {
      const req = new Request("http://localhost/__kitchen/api/contracts/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "GET", input: {} }),
      });
      const res = await handler.handle(req, "/__kitchen/api/contracts/validate");
      expect(res!.status).toBe(400);
    });
  });

  // ─── Dashboard HTML (extended tabs) ───────────────

  describe("Dashboard HTML", () => {
    it("should include Preview and Contracts tabs", async () => {
      const req = new Request("http://localhost/__kitchen");
      const res = await handler.handle(req, "/__kitchen");
      const html = await res!.text();

      expect(html).toContain("Preview");
      expect(html).toContain("Contracts");
    });
  });
});
