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

describe("KitchenHandler", () => {
  let tmpDir: string;
  let handler: KitchenHandler;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kitchen-handler-"));
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

  it("should return null for non-kitchen paths", async () => {
    const req = new Request("http://localhost:3000/some/path");
    const result = await handler.handle(req, "/some/path");
    expect(result).toBeNull();
  });

  it("should serve dashboard HTML at /__kitchen", async () => {
    const req = new Request("http://localhost:3000/__kitchen");
    const result = await handler.handle(req, "/__kitchen");

    expect(result).not.toBeNull();
    expect(result!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");

    const html = await result!.text();
    expect(html).toContain("Mandu Kitchen");
    expect(html).toContain("Activity");
    expect(html).toContain("Routes");
    expect(html).toContain("Guard");
  });

  it("should serve dashboard HTML at /__kitchen/", async () => {
    const req = new Request("http://localhost:3000/__kitchen/");
    const result = await handler.handle(req, "/__kitchen/");

    expect(result).not.toBeNull();
    const html = await result!.text();
    expect(html).toContain("Mandu Kitchen");
  });

  it("should return SSE response at /__kitchen/sse/activity", async () => {
    const req = new Request("http://localhost:3000/__kitchen/sse/activity");
    const result = await handler.handle(req, "/__kitchen/sse/activity");

    expect(result).not.toBeNull();
    expect(result!.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("should return routes JSON at /__kitchen/api/routes", async () => {
    const req = new Request("http://localhost:3000/__kitchen/api/routes");
    const result = await handler.handle(req, "/__kitchen/api/routes");

    expect(result).not.toBeNull();
    const data = await result!.json();

    expect(data.routes).toHaveLength(2);
    expect(data.summary.total).toBe(2);
    expect(data.summary.pages).toBe(1);
    expect(data.summary.apis).toBe(1);
  });

  it("should return guard status at /__kitchen/api/guard", async () => {
    const req = new Request("http://localhost:3000/__kitchen/api/guard");
    const result = await handler.handle(req, "/__kitchen/api/guard");

    expect(result).not.toBeNull();
    const data = await result!.json();

    // guardConfig is null, so guard is disabled
    expect(data.enabled).toBe(false);
  });

  it("should return 404 for unknown kitchen routes", async () => {
    const req = new Request("http://localhost:3000/__kitchen/unknown");
    const result = await handler.handle(req, "/__kitchen/unknown");

    expect(result).not.toBeNull();
    expect(result!.status).toBe(404);
  });

  it("should update manifest", async () => {
    const newManifest: RoutesManifest = {
      version: 1,
      routes: [
        {
          id: "about",
          pattern: "/about",
          kind: "page",
          module: "./app/about/page.tsx",
          componentModule: "./app/about/page.tsx",
        },
      ],
    };

    handler.updateManifest(newManifest);

    const req = new Request("http://localhost:3000/__kitchen/api/routes");
    const result = await handler.handle(req, "/__kitchen/api/routes");
    const data = await result!.json();

    expect(data.routes).toHaveLength(1);
    expect(data.routes[0].id).toBe("about");
  });

  it("KITCHEN_PREFIX should be /__kitchen", () => {
    expect(KITCHEN_PREFIX).toBe("/__kitchen");
  });
});
