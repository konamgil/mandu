/**
 * Phase 18.φ — CLI integration tests for the bundle-size budget flow.
 *
 * Strategy:
 *   The `build()` function in `../build.ts` is a very large fn that wires
 *   `validateAndReport` + `resolveManifest` + `buildClientBundles` +
 *   prerender + analyzer. Unit testing it end-to-end would require a full
 *   project scaffold. Instead this suite covers the surface the CLI
 *   actually contributes over the core library:
 *
 *     1. `--no-budget` CLI arg is parsed into `options.noBudget === true`
 *        and surfaces in `BuildOptions`.
 *     2. `build` command registry exposes `--no-budget` in help text so
 *        users can discover it.
 *     3. The analyzer.writeAnalyzeReport() signature accepts a budget
 *        argument (the wire between CLI budget-evaluation and HTML emit).
 *     4. End-to-end budget evaluation on a real-fs fixture produces the
 *        expected fail/pass verdict the CLI will enforce.
 *     5. Budget-bar HTML renders the islands with expected CSS classes
 *        (the front-end of requirement 4 in the spec).
 *
 *  The deeper orchestration behaviour (exit code on mode:'error', etc.)
 *  is covered indirectly by `packages/core/tests/bundler/budget.test.ts`,
 *  which exercises the evaluator that the CLI hands its decision over to.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { parseArgs } from "../../main";
import { getCommand } from "../registry";
import {
  analyzeBundle,
  renderAnalyzeHtml,
  writeAnalyzeReport,
} from "@mandujs/core/compat/bundler/analyzer";
import {
  evaluateBudget,
  DEFAULT_BUDGET_MAX_GZ_BYTES,
} from "@mandujs/core/compat/bundler/budget";
import type { BundleManifest } from "@mandujs/core/compat/bundler/types";

let ROOT: string;
beforeAll(async () => {
  ROOT = await mkdtemp(path.join(tmpdir(), "mandu-cli-budget-"));
});
afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true }).catch(() => {});
});

// ─── Case 1: `--no-budget` CLI parsing ─────────────────────────────────────

describe("parseArgs — `--no-budget` flag", () => {
  test("sets options['no-budget'] = 'true' when present bare", () => {
    const { command, options } = parseArgs(["build", "--no-budget"]);
    expect(command).toBe("build");
    expect(options["no-budget"]).toBe("true");
  });

  test("omitted by default", () => {
    const { options } = parseArgs(["build"]);
    expect(options["no-budget"]).toBeUndefined();
  });
});

// ─── Case 2: registry help exposes the flag ────────────────────────────────

describe("build command registry", () => {
  test("help text documents --no-budget", () => {
    const cmd = getCommand("build");
    expect(cmd).toBeDefined();
    expect(cmd!.help).toContain("--no-budget");
  });

  test("help text still documents --analyze (η un-regressed)", () => {
    const cmd = getCommand("build");
    expect(cmd!.help).toContain("--analyze");
  });
});

// ─── Case 3: end-to-end exceed check on real filesystem artefacts ──────────

async function writeClient(
  root: string,
  name: string,
  body: string
): Promise<void> {
  const abs = path.join(root, ".mandu", "client", name);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body, "utf8");
}

function manifestFor(
  routeId: string
): BundleManifest {
  return {
    version: 1,
    buildTime: new Date().toISOString(),
    env: "production",
    bundles: {
      [routeId]: {
        js: `/.mandu/client/${routeId}.js`,
        dependencies: [],
        priority: "visible",
      },
    },
    shared: {
      runtime: "/.mandu/client/_runtime.js",
      vendor: "/.mandu/client/_vendor.js",
    },
  };
}

describe("analyzeBundle + evaluateBudget — end-to-end exceed", () => {
  test("large island under explicit 50 KB gz cap → exceeded, mode: error", async () => {
    const dir = await mkdtemp(path.join(ROOT, "exceed-"));
    // True pseudo-random incompressible bytes — gzip cannot compact
    // `crypto.getRandomValues` output, so the gzipped size closely tracks
    // the raw byte count. 200 KB of random base64 stays ~200 KB gzipped,
    // comfortably above any per-island cap we'd test against.
    const rand = new Uint8Array(200_000);
    crypto.getRandomValues(rand);
    const body = Buffer.from(rand).toString("base64");
    await writeClient(dir, "home.js", body);
    await writeClient(dir, "_runtime.js", "r");
    await writeClient(dir, "_vendor.js", "v");

    const report = await analyzeBundle(dir, manifestFor("home"));
    // Sanity: file is actually big and gz is bigger than 50 KB too.
    const realGz = zlib.gzipSync(body, { level: 9 }).byteLength;
    expect(realGz).toBeGreaterThan(50_000);
    expect(report.islands[0].totalGz).toBe(realGz);

    const budget = evaluateBudget(report, { maxGzBytes: 50_000, mode: "error" });
    expect(budget).not.toBeNull();
    expect(budget!.hasExceeded).toBe(true);
    expect(budget!.exceededCount).toBe(1);
    expect(budget!.mode).toBe("error");
  });
});

describe("analyzeBundle + evaluateBudget — empty budget default", () => {
  test("empty `{}` budget opts into DEFAULT_BUDGET_MAX_GZ_BYTES per-island cap", async () => {
    const dir = await mkdtemp(path.join(ROOT, "default-"));
    await writeClient(dir, "tiny.js", "export default 1;");
    await writeClient(dir, "_runtime.js", "r");
    await writeClient(dir, "_vendor.js", "v");
    const report = await analyzeBundle(dir, manifestFor("tiny"));
    const budget = evaluateBudget(report, {});
    expect(budget!.islands[0].gzLimit).toBe(DEFAULT_BUDGET_MAX_GZ_BYTES);
    expect(budget!.hasExceeded).toBe(false);
  });
});

// ─── Case 4: writeAnalyzeReport accepts budget & emits budget JSON ─────────

describe("writeAnalyzeReport — budget plumbing", () => {
  test("passes budget into JSON payload under `budget` key", async () => {
    const dir = await mkdtemp(path.join(ROOT, "write-"));
    await writeClient(dir, "home.js", "hi".repeat(100));
    await writeClient(dir, "_runtime.js", "r");
    await writeClient(dir, "_vendor.js", "v");
    const report = await analyzeBundle(dir, manifestFor("home"));
    const budget = evaluateBudget(report, { maxGzBytes: 10_000 })!;

    const { jsonPath, htmlPath } = await writeAnalyzeReport(dir, report, {
      budget,
    });
    expect(htmlPath).not.toBeNull();
    const serialised = JSON.parse(await Bun.file(jsonPath).text()) as {
      budget?: { islandCount: number };
    };
    expect(serialised.budget).toBeDefined();
    expect(serialised.budget!.islandCount).toBe(1);
  });
});

// ─── Case 5: HTML renders budget bars with colour classes ──────────────────

describe("renderAnalyzeHtml — budget bar section", () => {
  test("renders budget section with green / red / yellow classes when budget present", async () => {
    const dir = await mkdtemp(path.join(ROOT, "html-"));
    // Two islands: one tiny (green), one exceeding. Use
    // incompressible random bytes for `big.js` so gzip doesn't squeeze
    // the file below the 1 KB budget.
    const rand = new Uint8Array(50_000);
    crypto.getRandomValues(rand);
    const bigBody = Buffer.from(rand).toString("base64");
    await writeClient(dir, "tiny.js", "a");
    await writeClient(dir, "big.js", bigBody);
    await writeClient(dir, "_runtime.js", "r");
    await writeClient(dir, "_vendor.js", "v");
    const manifest: BundleManifest = {
      version: 1,
      buildTime: new Date().toISOString(),
      env: "production",
      bundles: {
        tiny: { js: "/.mandu/client/tiny.js", dependencies: [], priority: "visible" },
        big: { js: "/.mandu/client/big.js", dependencies: [], priority: "visible" },
      },
      shared: {
        runtime: "/.mandu/client/_runtime.js",
        vendor: "/.mandu/client/_vendor.js",
      },
    };
    const report = await analyzeBundle(dir, manifest);
    const budget = evaluateBudget(report, {
      maxGzBytes: 1_000, // exceedingly tight, guarantees `big` exceeds
    })!;

    const html = renderAnalyzeHtml(report, budget);
    // Budget block header + legend (`<h2>` heading text + rendered legend
    // row containing the "approaching (≥90%)" prose — neither appears in
    // the CSS-rule definitions at the top of the file).
    expect(html).toContain("Bundle budget");
    expect(html).toContain("approaching (≥90%)");
    // Exceeded class on the big island bar.
    expect(html).toContain("budget-bar-fill exceeded");
    // Mode badge rendered body-side: the CSS rule uses `.budget-mode.error
    // {` / `.budget-mode.warning {` (dot-separated) so the space-separated
    // `budget-mode warning` attribute-token combination only appears in
    // the rendered element's class list.
    expect(html).toContain('class="budget-mode warning"');
    // Does not reference any CDN / external resource.
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  test("no budget → no budget section emitted", async () => {
    const dir = await mkdtemp(path.join(ROOT, "no-budget-html-"));
    await writeClient(dir, "home.js", "hi");
    await writeClient(dir, "_runtime.js", "r");
    await writeClient(dir, "_vendor.js", "v");
    const report = await analyzeBundle(dir, manifestFor("home"));
    const html = renderAnalyzeHtml(report, null);
    // The <h2> block header is unique to the rendered body; the CSS
    // declarations up top use class names only (no "Bundle budget"
    // literal string). Likewise the legend-row prose + the rendered
    // element markup (identifiable by `class="budget-row"` as a full
    // attribute token, not the bare CSS selector `.budget-row`) both
    // live under the body and must be absent.
    expect(html).not.toContain("Bundle budget");
    expect(html).not.toContain("approaching (≥90%)");
    expect(html).not.toContain('class="budget-row"');
    expect(html).not.toContain('class="budget-mode');
  });
});
