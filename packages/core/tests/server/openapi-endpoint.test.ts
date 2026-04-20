/**
 * Production OpenAPI endpoint — integration tests.
 *
 * Boots an in-process Mandu server and verifies:
 *   1. Default (disabled) → `/__mandu/openapi.json` returns 404.
 *   2. `openapi.enabled: true` → JSON + YAML variants return 200 with
 *      correct Content-Type, Cache-Control, and ETag headers.
 *   3. Conditional GET short-circuits with 304 on matching `If-None-Match`.
 *   4. `MANDU_OPENAPI_ENABLED=1` env override flips default off → on.
 *   5. Non-GET requests return 405 with `Allow: GET, HEAD`.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  startServer,
  createServerRegistry,
  type ManduServer,
  type ServerRegistry,
} from "../../src/runtime/server";
import { invalidateOpenAPIEndpointCache } from "../../src/runtime/openapi-endpoint";
import type { RoutesManifest } from "../../src/spec/schema";

async function buildFixture(): Promise<{ rootDir: string; manifest: RoutesManifest; cleanup: () => Promise<void> }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-openapi-ep-"));
  const contractPath = "contracts/users.contract.ts";
  const contractAbs = path.join(rootDir, contractPath);
  await fs.mkdir(path.dirname(contractAbs), { recursive: true });
  await fs.writeFile(
    contractAbs,
    `import { z } from "zod";
export default {
  name: "users",
  description: "Users API",
  tags: ["users"],
  request: {
    GET: { query: z.object({ limit: z.number().int().optional() }) },
  },
  response: {
    200: z.object({ items: z.array(z.string()) }),
  },
};
`,
    "utf-8"
  );
  const manifest: RoutesManifest = {
    version: 1,
    routes: [
      {
        id: "api/users",
        pattern: "/api/users",
        kind: "api",
        module: contractPath,
        contractModule: contractPath,
        methods: ["GET"],
      },
    ],
  };
  return {
    rootDir,
    manifest,
    cleanup: async () => {
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

describe("Production OpenAPI endpoint", () => {
  let server: ManduServer | null = null;
  let registry: ServerRegistry;
  let fixture: Awaited<ReturnType<typeof buildFixture>>;
  const originalEnv = process.env.MANDU_OPENAPI_ENABLED;

  beforeEach(async () => {
    registry = createServerRegistry();
    fixture = await buildFixture();
    invalidateOpenAPIEndpointCache();
    delete process.env.MANDU_OPENAPI_ENABLED;
  });

  afterEach(async () => {
    if (server) {
      server.stop();
      server = null;
    }
    await fixture.cleanup();
    if (originalEnv === undefined) {
      delete process.env.MANDU_OPENAPI_ENABLED;
    } else {
      process.env.MANDU_OPENAPI_ENABLED = originalEnv;
    }
    invalidateOpenAPIEndpointCache();
  });

  it("returns 404 by default (endpoint opt-in)", async () => {
    server = startServer(fixture.manifest, {
      port: 0,
      registry,
      rootDir: fixture.rootDir,
      silent: true,
    });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/__mandu/openapi.json`);
    expect(res.status).toBe(404);
    // Drain body to satisfy the fetch implementation.
    await res.text();
  });

  it("serves OpenAPI 3.0.3 JSON when explicitly enabled", async () => {
    server = startServer(fixture.manifest, {
      port: 0,
      registry,
      rootDir: fixture.rootDir,
      openapi: { enabled: true },
      silent: true,
    });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/__mandu/openapi.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=0, must-revalidate"
    );
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{64}"$/);

    const body = await res.json();
    expect(body.openapi).toBe("3.0.3");
    expect(body.info).toBeDefined();
    expect(body.paths["/api/users"]).toBeDefined();
    expect(body.paths["/api/users"].get).toBeDefined();
  });

  it("serves a YAML variant at <path>.yaml", async () => {
    server = startServer(fixture.manifest, {
      port: 0,
      registry,
      rootDir: fixture.rootDir,
      openapi: { enabled: true },
      silent: true,
    });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/__mandu/openapi.yaml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("yaml");
    const body = await res.text();
    expect(body).toContain("openapi: 3.0.3");
    expect(body).toContain("/api/users:");
  });

  it("honors conditional GET via If-None-Match", async () => {
    server = startServer(fixture.manifest, {
      port: 0,
      registry,
      rootDir: fixture.rootDir,
      openapi: { enabled: true },
      silent: true,
    });
    const port = server.server.port;

    const first = await fetch(`http://localhost:${port}/__mandu/openapi.json`);
    await first.text();
    const etag = first.headers.get("ETag");
    expect(etag).toBeDefined();

    const second = await fetch(`http://localhost:${port}/__mandu/openapi.json`, {
      headers: { "If-None-Match": etag! },
    });
    expect(second.status).toBe(304);
    // RFC 7232: 304 has no body.
    const text = await second.text();
    expect(text).toBe("");
  });

  it("MANDU_OPENAPI_ENABLED=1 enables the endpoint without config", async () => {
    process.env.MANDU_OPENAPI_ENABLED = "1";

    server = startServer(fixture.manifest, {
      port: 0,
      registry,
      rootDir: fixture.rootDir,
      silent: true,
    });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/__mandu/openapi.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.openapi).toBe("3.0.3");
  });

  it("explicit enabled: false still wins over MANDU_OPENAPI_ENABLED=1", async () => {
    process.env.MANDU_OPENAPI_ENABLED = "1";

    server = startServer(fixture.manifest, {
      port: 0,
      registry,
      rootDir: fixture.rootDir,
      openapi: { enabled: false },
      silent: true,
    });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/__mandu/openapi.json`);
    expect(res.status).toBe(404);
    await res.text();
  });

  it("rejects non-GET methods with 405 + Allow header", async () => {
    server = startServer(fixture.manifest, {
      port: 0,
      registry,
      rootDir: fixture.rootDir,
      openapi: { enabled: true },
      silent: true,
    });
    const port = server.server.port;

    const res = await fetch(`http://localhost:${port}/__mandu/openapi.json`, {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    await res.text();
  });

  it("respects a custom path override", async () => {
    server = startServer(fixture.manifest, {
      port: 0,
      registry,
      rootDir: fixture.rootDir,
      openapi: { enabled: true, path: "/spec" },
      silent: true,
    });
    const port = server.server.port;

    const hit = await fetch(`http://localhost:${port}/spec.json`);
    expect(hit.status).toBe(200);
    await hit.text();

    // Default path should now miss.
    const miss = await fetch(`http://localhost:${port}/__mandu/openapi.json`);
    expect(miss.status).toBe(404);
    await miss.text();
  });
});
