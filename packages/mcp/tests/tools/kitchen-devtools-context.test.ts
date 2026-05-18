/**
 * MCP tool — `mandu.devtools.context` tests.
 *
 * Plan 18 P0-1. The tool fetches `/__kitchen/api/agent-context` from the
 * running dev server. Tests mock `globalThis.fetch` so they don't need a
 * live `mandu dev` process. Three behaviors are covered:
 *
 *   1. Tool definition is registered alongside `mandu.kitchen.errors`.
 *   2. Dev server unreachable → success: false with a helpful message.
 *   3. Dev server reachable → pack reflected back; query params encode
 *      the includeBundle / includeDiagnose / includeDiff toggles.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { kitchenTools, kitchenToolDefinitions } from "../../src/tools/kitchen";

let root: string;
const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string }> = [];
let nextResponse: () => Response = () => new Response("{}", { status: 200 });

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-devtools-context-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push({ url: String(input) });
    return nextResponse();
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  rmSync(join(root, ".mandu"), { recursive: true, force: true });
});

describe("mandu.devtools.context — definition", () => {
  it("is registered next to mandu.kitchen.errors", () => {
    const names = kitchenToolDefinitions.map((tool) => tool.name);
    expect(names).toContain("mandu.kitchen.errors");
    expect(names).toContain("mandu.devtools.context");
  });

  it("declares readOnlyHint and the three toggles", () => {
    const def = kitchenToolDefinitions.find((tool) => tool.name === "mandu.devtools.context");
    expect(def).toBeTruthy();
    expect(def).toBeDefined();
    expect(def?.annotations?.readOnlyHint).toBe(true);
    const schema = (def as { inputSchema: { properties?: Record<string, unknown> } }).inputSchema;
    const props = schema.properties ?? {};
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["includeBundle", "includeDiagnose", "includeDiff", "baseURL", "port"]),
    );
  });
});

describe("mandu.devtools.context — handler", () => {
  it("returns success: false when the dev server is unreachable", async () => {
    nextResponse = () => {
      throw new TypeError("fetch failed");
    };

    const handlers = kitchenTools(root);
    const result = (await handlers["mandu.devtools.context"]({})) as {
      success: boolean;
      message: string;
    };

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/dev server|mandu dev/i);
  });

  it("returns the pack from the dev server on success", async () => {
    const pack = {
      situation: { category: "agent-tools" },
      nextSafeAction: { tool: "mandu.ai.brief" },
    };
    nextResponse = () => new Response(JSON.stringify(pack), { status: 200, headers: { "Content-Type": "application/json" } });

    const handlers = kitchenTools(root);
    const result = (await handlers["mandu.devtools.context"]({})) as {
      success: boolean;
      pack: typeof pack;
      relatedSkills: string[];
    };

    expect(result.success).toBe(true);
    expect(result.pack.situation.category).toBe("agent-tools");
    expect(result.pack.nextSafeAction.tool).toBe("mandu.ai.brief");
    expect(result.relatedSkills).toContain("mandu-agent-workflow");
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toContain("/__kitchen/api/agent-context");
    // Default toggles → no query string suffix
    expect(fetchCalls[0].url.endsWith("/__kitchen/api/agent-context")).toBe(true);
  });

  it("encodes includeBundle/includeDiagnose/includeDiff toggles as query params", async () => {
    nextResponse = () => new Response("{}", { status: 200 });

    const handlers = kitchenTools(root);
    await handlers["mandu.devtools.context"]({
      includeBundle: false,
      includeDiagnose: false,
      includeDiff: false,
    });

    expect(fetchCalls).toHaveLength(1);
    const url = fetchCalls[0].url;
    expect(url).toContain("bundle=0");
    expect(url).toContain("diagnose=0");
    expect(url).toContain("diff=0");
  });

  it("prefers runtime-control baseUrl when no explicit baseURL is supplied", async () => {
    mkdirSync(join(root, ".mandu"), { recursive: true });
    writeFileSync(
      join(root, ".mandu", "runtime-control.json"),
      JSON.stringify({
        mode: "dev",
        port: 3335,
        token: "test-token",
        baseUrl: "http://localhost:3335",
        startedAt: new Date().toISOString(),
      }),
    );
    nextResponse = () => new Response("{}", { status: 200 });

    const handlers = kitchenTools(root);
    await handlers["mandu.devtools.context"]({});

    expect(fetchCalls[0].url).toStartWith("http://localhost:3335/");
  });

  it("prefers runtime-control baseUrl for kitchen errors", async () => {
    mkdirSync(join(root, ".mandu"), { recursive: true });
    writeFileSync(
      join(root, ".mandu", "runtime-control.json"),
      JSON.stringify({
        mode: "dev",
        port: 3337,
        token: "test-token",
        baseUrl: "http://localhost:3337",
        startedAt: new Date().toISOString(),
      }),
    );
    nextResponse = () => new Response(JSON.stringify({ errors: [], count: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const handlers = kitchenTools(root);
    await handlers["mandu.kitchen.errors"]({});

    expect(fetchCalls[0].url).toStartWith("http://localhost:3337/");
  });

  it("uses explicit port for kitchen errors", async () => {
    nextResponse = () => new Response(JSON.stringify({ errors: [], count: 0 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

    const handlers = kitchenTools(root);
    await handlers["mandu.kitchen.errors"]({ port: 4444 });

    expect(fetchCalls[0].url).toStartWith("http://localhost:4444/");
  });

  it("propagates non-200 dev-server responses as success: false", async () => {
    nextResponse = () => new Response("dev server down", { status: 503 });

    const handlers = kitchenTools(root);
    const result = (await handlers["mandu.devtools.context"]({})) as {
      success: boolean;
      status?: number;
    };

    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
  });

  it("is also reachable via the underscore alias", () => {
    const handlers = kitchenTools(root);
    expect(typeof handlers["mandu_devtools_context"]).toBe("function");
    expect(handlers["mandu_devtools_context"]).toBe(handlers["mandu.devtools.context"]);
  });
});
