/**
 * MCP tools — `mandu.deploy.plan` + `mandu.deploy.compile` tests.
 *
 * Issue #250 — agents-side surface for the deploy intent pipeline.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  deployPlanToolDefinitions,
  deployPlanTools,
} from "../../src/tools/deploy-plan";
import {
  loadDeployIntentCache,
  saveDeployIntentCache,
  DEPLOY_INTENT_CACHE_FILE,
  type DeployIntentCache,
} from "@mandujs/core/compat/deploy/index";

async function setupFixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-mcp-deploy-"));
  await fs.mkdir(path.join(root, "app", "api", "embed"), { recursive: true });
  await fs.writeFile(
    path.join(root, "app", "api", "embed", "route.ts"),
    `export default async function POST() { return new Response("ok"); }`,
  );
  await fs.mkdir(path.join(root, "app", "[lang]"), { recursive: true });
  await fs.writeFile(
    path.join(root, "app", "[lang]", "page.tsx"),
    `export default function Page() { return null; }`,
  );
  return { root, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

describe("deployPlanToolDefinitions", () => {
  it("declares both tools with sensible annotations", () => {
    const names = deployPlanToolDefinitions.map((t) => t.name);
    expect(names).toContain("mandu.deploy.plan");
    expect(names).toContain("mandu.deploy.compile");

    const planDef = deployPlanToolDefinitions.find((t) => t.name === "mandu.deploy.plan")!;
    expect(planDef.annotations?.readOnlyHint).toBe(false);

    const compileDef = deployPlanToolDefinitions.find(
      (t) => t.name === "mandu.deploy.compile",
    )!;
    expect(compileDef.annotations?.readOnlyHint).toBe(true);
  });
});

describe("mandu.deploy.plan", () => {
  let fix: { root: string; cleanup: () => Promise<void> };
  beforeEach(async () => {
    fix = await setupFixture();
  });
  afterEach(async () => {
    await fix.cleanup();
  });

  it("default call is read-only — diff returned, no cache written", async () => {
    const h = deployPlanTools(fix.root);
    const result = (await h["mandu.deploy.plan"]!({})) as {
      diff: Array<{ kind: string }>;
      applied: boolean;
      intent_count: number;
    };
    expect(result.applied).toBe(false);
    expect(result.intent_count).toBeGreaterThan(0);
    const cacheFile = path.join(fix.root, DEPLOY_INTENT_CACHE_FILE);
    const exists = await fs.stat(cacheFile).then(() => true).catch(() => false);
    expect(exists).toBe(false);
  });

  it("apply=true writes the cache atomically", async () => {
    const h = deployPlanTools(fix.root);
    const result = (await h["mandu.deploy.plan"]!({ apply: true })) as {
      applied: boolean;
    };
    expect(result.applied).toBe(true);
    const after = await loadDeployIntentCache(fix.root);
    expect(Object.keys(after.intents).length).toBeGreaterThan(0);
  });

  it("returns rationale and runtime per route", async () => {
    const h = deployPlanTools(fix.root);
    const result = (await h["mandu.deploy.plan"]!({})) as {
      diff: Array<{ route_id: string; runtime?: string; rationale?: string }>;
    };
    const api = result.diff.find((d) => d.route_id.startsWith("api-embed"));
    expect(api?.runtime).toBe("edge");
    expect(api?.rationale).toBeTruthy();
  });

  it("use_brain returns brain_status; falls back gracefully without a cloud token", async () => {
    const h = deployPlanTools(fix.root);
    const result = (await h["mandu.deploy.plan"]!({ use_brain: true })) as {
      brain_status?: string;
      brain_model?: string;
    };
    expect(result.brain_status).toBeDefined();
    // In CI / dev-without-token the resolver returns "template", so
    // brain_status starts with "unavailable:". On a developer machine
    // logged into OpenAI the brain may actually run — accept either.
    expect(
      result.brain_status === "unavailable:needs_login" ||
        result.brain_status === "unavailable:opted_out" ||
        result.brain_status?.startsWith("used:"),
    ).toBe(true);
  });

  it("default call sets brain_status to 'not_requested'", async () => {
    const h = deployPlanTools(fix.root);
    const result = (await h["mandu.deploy.plan"]!({})) as { brain_status?: string };
    expect(result.brain_status).toBe("not_requested");
  });

  it("explicit override is preserved across calls", async () => {
    // Seed cache with explicit override.
    const h = deployPlanTools(fix.root);
    await h["mandu.deploy.plan"]!({ apply: true });
    const seeded = await loadDeployIntentCache(fix.root);
    const apiId = Object.keys(seeded.intents).find((id) => id.startsWith("api-embed"))!;
    const pinned: DeployIntentCache = {
      ...seeded,
      intents: {
        ...seeded.intents,
        [apiId]: {
          ...seeded.intents[apiId]!,
          source: "explicit",
          intent: { runtime: "bun", cache: "no-store", visibility: "public" },
          rationale: "manual",
        },
      },
    };
    await saveDeployIntentCache(fix.root, pinned);

    const result = (await h["mandu.deploy.plan"]!({ apply: true })) as {
      diff: Array<{ route_id: string; kind: string; source?: string }>;
    };
    const apiDiff = result.diff.find((d) => d.route_id === apiId)!;
    expect(apiDiff.source).toBe("explicit");
  });
});

describe("mandu.deploy.compile", () => {
  let fix: { root: string; cleanup: () => Promise<void> };
  beforeEach(async () => {
    fix = await setupFixture();
  });
  afterEach(async () => {
    await fix.cleanup();
  });

  it("returns a clear error when the cache is empty", async () => {
    const h = deployPlanTools(fix.root);
    const result = (await h["mandu.deploy.compile"]!({})) as { error: string; hint?: string };
    expect(result.error).toBeDefined();
    expect(result.hint).toContain("mandu.deploy.plan");
  });

  it("compiles vercel.json from a populated cache", async () => {
    const h = deployPlanTools(fix.root);
    await h["mandu.deploy.plan"]!({ apply: true });
    const result = (await h["mandu.deploy.compile"]!({})) as {
      target: string;
      config: { functions?: Record<string, unknown>; headers?: unknown[] };
      per_route: Array<{ route_id: string; runtime: string }>;
      warnings: string[];
    };
    expect(result.target).toBe("vercel");
    expect(result.config.headers).toBeDefined();
    // API route → edge function entry; dynamic page (no static params) → also edge
    expect(Object.keys(result.config.functions ?? {}).length).toBeGreaterThan(0);
    expect(result.per_route.length).toBeGreaterThan(0);
  });

  it("rejects unknown targets with a helpful hint", async () => {
    const h = deployPlanTools(fix.root);
    await h["mandu.deploy.plan"]!({ apply: true });
    const result = (await h["mandu.deploy.compile"]!({ target: "fly" })) as {
      error?: string;
      hint?: string;
    };
    expect(result.error).toContain("not supported");
    expect(result.hint).toContain("vercel");
  });
});
