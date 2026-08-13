/**
 * Issue #250 M2 — `mandu deploy:plan` integration tests.
 *
 * Set up a tmp `app/` tree, run `deployPlan()` against it, and assert
 * on (a) the cache file written, (b) the diff renderer output, (c)
 * exit code semantics, (d) the apply/dry-run/decline branches.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  deployPlan,
  renderDiffSummary,
  renderDiffLines,
} from "../plan";
import {
  DEPLOY_INTENT_CACHE_FILE,
  loadDeployIntentCache,
  saveDeployIntentCache,
  type DeployIntentCache,
} from "@mandujs/core/compat/deploy/index";

const FIXED_NOW = "2026-04-30T00:00:00.000Z";

async function setupFixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-deploy-plan-"));
  await fs.mkdir(path.join(root, "app", "api", "embed"), { recursive: true });
  await fs.writeFile(
    path.join(root, "app", "api", "embed", "route.ts"),
    `import { Mandu } from "@mandujs/core";
export default Mandu.filling().post(async () => Response.json({ ok: true }));
`,
  );
  await fs.mkdir(path.join(root, "app", "[lang]"), { recursive: true });
  await fs.writeFile(
    path.join(root, "app", "[lang]", "page.tsx"),
    `export default function Page() { return null; }`,
  );
  return {
    root,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

describe("deployPlan() — first run", () => {
  let fix: { root: string; cleanup: () => Promise<void> };
  beforeEach(async () => {
    fix = await setupFixture();
  });
  afterEach(async () => {
    await fix.cleanup();
  });

  it("writes cache on --apply with both routes inferred", async () => {
    const logs: string[] = [];
    const result = await deployPlan({
      cwd: fix.root,
      apply: true,
      now: () => FIXED_NOW,
      log: (m) => logs.push(m),
      error: (m) => logs.push(`ERR: ${m}`),
    });
    expect(result.exitCode).toBe(0);
    expect(result.applied).toBe(true);

    const cache = await loadDeployIntentCache(fix.root);
    const ids = Object.keys(cache.intents).sort();
    expect(ids.length).toBeGreaterThanOrEqual(2);
    // API route → edge.
    const api = ids.find((id) => id.startsWith("api-embed"));
    expect(api).toBeDefined();
    expect(cache.intents[api!]?.intent.runtime).toBe("edge");
    // Dynamic page (no generateStaticParams) → edge per heuristic.
    const page = ids.find((id) => id.includes("$lang"));
    expect(page).toBeDefined();
    expect(cache.intents[page!]?.intent.runtime).toBe("edge");

    // Output sanity.
    expect(logs.join("\n")).toContain("Mandu deploy:plan");
    expect(logs.join("\n")).toContain("Wrote .mandu");
  });

  it("--dry-run does not write the cache", async () => {
    const result = await deployPlan({
      cwd: fix.root,
      dryRun: true,
      now: () => FIXED_NOW,
      log: () => {},
    });
    expect(result.applied).toBe(false);
    const cacheFile = path.join(fix.root, DEPLOY_INTENT_CACHE_FILE);
    const exists = await fs
      .stat(cacheFile)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("declined prompt → exitCode 2 and cache unchanged", async () => {
    const result = await deployPlan({
      cwd: fix.root,
      now: () => FIXED_NOW,
      log: () => {},
      prompt: async () => false,
    });
    expect(result.exitCode).toBe(2);
    expect(result.applied).toBe(false);
  });

  it("approved prompt writes the cache", async () => {
    const result = await deployPlan({
      cwd: fix.root,
      now: () => FIXED_NOW,
      log: () => {},
      prompt: async () => true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.applied).toBe(true);
  });
});

describe("deployPlan() — incremental run", () => {
  let fix: { root: string; cleanup: () => Promise<void> };
  beforeEach(async () => {
    fix = await setupFixture();
  });
  afterEach(async () => {
    await fix.cleanup();
  });

  it("'no changes' case — cache exists, sources unchanged → applied:false, exitCode 0", async () => {
    // Seed the cache from a first run.
    await deployPlan({
      cwd: fix.root,
      apply: true,
      now: () => FIXED_NOW,
      log: () => {},
    });
    // Re-run.
    const second = await deployPlan({
      cwd: fix.root,
      now: () => FIXED_NOW,
      log: () => {},
    });
    expect(second.exitCode).toBe(0);
    expect(second.applied).toBe(false);
    expect(second.diff.every((d) => d.kind === "unchanged")).toBe(true);
  });

  it("explicit pin survives re-plan", async () => {
    // Run once to discover the real route IDs the manifest uses.
    await deployPlan({
      cwd: fix.root,
      apply: true,
      now: () => FIXED_NOW,
      log: () => {},
    });
    const seeded = await loadDeployIntentCache(fix.root);
    const apiId = Object.keys(seeded.intents).find((id) => id.startsWith("api-embed"))!;
    expect(apiId).toBeDefined();

    // Re-write the cache marking that entry as user-explicit.
    const pinned: DeployIntentCache = {
      ...seeded,
      brainModel: "manual",
      intents: {
        ...seeded.intents,
        [apiId]: {
          intent: {
            runtime: "bun",
            cache: "no-store",
            visibility: "private",
            regions: ["icn1"],
          },
          source: "explicit",
          rationale: "user pinned to bun for the embed worker",
          sourceHash: "x".repeat(64),
        },
      },
    };
    await saveDeployIntentCache(fix.root, pinned);

    const result = await deployPlan({
      cwd: fix.root,
      apply: true,
      now: () => FIXED_NOW,
      log: () => {},
    });
    expect(result.exitCode).toBe(0);

    const after = await loadDeployIntentCache(fix.root);
    expect(after.intents[apiId]?.source).toBe("explicit");
    expect(after.intents[apiId]?.intent.runtime).toBe("bun");
    expect(after.intents[apiId]?.intent.visibility).toBe("private");
  });

  it("--reinfer forces re-inference even on matching hash", async () => {
    await deployPlan({
      cwd: fix.root,
      apply: true,
      now: () => FIXED_NOW,
      log: () => {},
    });
    let inferCalls = 0;
    await deployPlan({
      cwd: fix.root,
      apply: true,
      reinfer: true,
      now: () => FIXED_NOW,
      log: () => {},
      infer: () => {
        inferCalls++;
        return {
          intent: { runtime: "node", cache: "no-store", visibility: "public" },
          rationale: "forced",
        };
      },
    });
    expect(inferCalls).toBeGreaterThan(0);
  });
});

describe("deployPlan() — --use-brain", () => {
  let fix: { root: string; cleanup: () => Promise<void> };
  beforeEach(async () => {
    fix = await setupFixture();
  });
  afterEach(async () => {
    await fix.cleanup();
  });

  it("falls back to heuristic with a clear warning when no cloud token is available", async () => {
    const logs: string[] = [];
    const result = await deployPlan({
      cwd: fix.root,
      apply: true,
      useBrain: true,
      now: () => FIXED_NOW,
      log: (m) => logs.push(m),
    });
    expect(result.exitCode).toBe(0);
    // resolveBrainAdapter has no real token in CI/test → falls back.
    // Either the warning appears, OR (rare) the resolver finds a real
    // dev token; in that case the run still succeeds. We assert the
    // exit code rather than the precise log line so this test is
    // resilient on dev machines with logged-in brains.
    if (logs.some((l) => l.includes("--use-brain"))) {
      expect(logs.some((l) => l.includes("Falling back to heuristic"))).toBe(true);
    } else {
      expect(logs.some((l) => l.includes("Using brain"))).toBe(true);
    }
  });
});

describe("renderDiffSummary / renderDiffLines", () => {
  it("summary collapses counts", () => {
    const out = renderDiffSummary([
      { routeId: "a", pattern: "/a", kind: "added" },
      { routeId: "b", pattern: "/b", kind: "added" },
      { routeId: "c", pattern: "/c", kind: "changed" },
      { routeId: "d", pattern: "/d", kind: "unchanged" },
    ]);
    expect(out).toContain("2 added");
    expect(out).toContain("1 changed");
    expect(out).toContain("1 unchanged");
  });

  it("lines hide unchanged unless verbose=true", () => {
    const sample = [
      {
        routeId: "a",
        pattern: "/a",
        kind: "unchanged" as const,
        next: {
          intent: { runtime: "edge" as const, cache: "no-store" as const, visibility: "public" as const },
          source: "inferred" as const,
          rationale: "x",
          sourceHash: "h".repeat(64),
        },
      },
    ];
    expect(renderDiffLines(sample, { verbose: false })).toEqual([]);
    const verbose = renderDiffLines(sample, { verbose: true });
    expect(verbose.length).toBeGreaterThan(0);
    expect(verbose[0]!).toContain("/a");
  });

  it("changed entries show prev → next runtime", () => {
    const sample = [
      {
        routeId: "x",
        pattern: "/x",
        kind: "changed" as const,
        next: {
          intent: { runtime: "edge" as const, cache: "no-store" as const, visibility: "public" as const },
          source: "inferred" as const,
          rationale: "moved to edge",
          sourceHash: "h".repeat(64),
        },
        previous: {
          intent: { runtime: "node" as const, cache: "no-store" as const, visibility: "public" as const },
          source: "inferred" as const,
          rationale: "old",
          sourceHash: "g".repeat(64),
        },
      },
    ];
    const lines = renderDiffLines(sample, { verbose: false }).join("\n");
    expect(lines).toContain("node → edge");
  });
});
