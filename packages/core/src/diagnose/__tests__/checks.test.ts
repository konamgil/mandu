/**
 * Tests for the Issue #215 extended diagnose checks.
 *
 * Every test uses an isolated `mkdtemp` fixture root so we never touch
 * the real project tree. Checks are pure I/O functions; seeding the
 * fixture directly (no build pipeline required) keeps these tests fast
 * and deterministic.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import {
  checkManifestFreshness,
  checkPrerenderPollution,
  checkCloneElementWarnings,
  checkDevArtifactsInProd,
  checkPackageExportGaps,
  checkNestedInternalCore,
  checkClientBoundaryManifests,
} from "../checks";
import { runExtendedDiagnose, buildReport } from "../run";

async function mkTmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "mandu-diagnose-"));
}

async function writeFile(rootDir: string, rel: string, content: string): Promise<void> {
  const abs = path.join(rootDir, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf-8");
}

// ──────────────────────────────────────────────────────────────────
// manifest_freshness
// ──────────────────────────────────────────────────────────────────

describe("checkManifestFreshness", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkTmpRoot(); });
  afterEach(async () => { await fs.rm(rootDir, { recursive: true, force: true }); });

  it("returns error when .mandu/manifest.json is missing", async () => {
    const result = await checkManifestFreshness(rootDir);
    expect(result.ok).toBe(false);
    expect(result.rule).toBe("manifest_freshness");
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/missing/);
    expect(result.suggestion).toMatch(/mandu build/);
  });

  it("returns error when env=development (dev manifest shipped to prod)", async () => {
    await writeFile(rootDir, ".mandu/manifest.json", JSON.stringify({
      version: 1,
      buildTime: "2026-01-01T00:00:00.000Z",
      env: "development",
      bundles: { "page-home": { js: "/x.js", dependencies: [], priority: "immediate" } },
      shared: { runtime: "", vendor: "" },
    }));
    const result = await checkManifestFreshness(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/dev-mode/);
    expect(result.details?.env).toBe("development");
  });

  it("returns ok for production manifest with populated bundles", async () => {
    await writeFile(rootDir, ".mandu/manifest.json", JSON.stringify({
      version: 1, buildTime: "2026-01-01T00:00:00.000Z", env: "production",
      bundles: { "page-home": { js: "/x.js", dependencies: [], priority: "immediate" } },
      shared: { runtime: "/r.js", vendor: "/v.js" },
    }));
    const result = await checkManifestFreshness(rootDir);
    expect(result.ok).toBe(true);
    expect(result.rule).toBe("manifest_freshness");
  });

  it("returns warning when production but islands present with no bundles", async () => {
    await writeFile(rootDir, ".mandu/manifest.json", JSON.stringify({
      version: 1, buildTime: "x", env: "production",
      bundles: {},
      islands: { "Foo": { js: "/f.js", route: "/x", priority: "visible" } },
      shared: { runtime: "", vendor: "" },
    }));
    const result = await checkManifestFreshness(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warning");
    expect(result.message).toMatch(/0 route bundles/);
  });

  it("returns ok for production with empty bundles AND empty islands (pure-SSR)", async () => {
    await writeFile(rootDir, ".mandu/manifest.json", JSON.stringify({
      version: 1, buildTime: "x", env: "production",
      bundles: {}, shared: { runtime: "", vendor: "" },
    }));
    const result = await checkManifestFreshness(rootDir);
    expect(result.ok).toBe(true);
  });

  it("returns error on corrupted JSON", async () => {
    await writeFile(rootDir, ".mandu/manifest.json", "{ not json }");
    const result = await checkManifestFreshness(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/corrupted/);
  });
});

// ──────────────────────────────────────────────────────────────────
// prerender_pollution
// ──────────────────────────────────────────────────────────────────

describe("checkPrerenderPollution", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkTmpRoot(); });
  afterEach(async () => { await fs.rm(rootDir, { recursive: true, force: true }); });

  it("returns ok when no prerendered output exists", async () => {
    const result = await checkPrerenderPollution(rootDir);
    expect(result.ok).toBe(true);
  });

  it("returns ok for clean route shapes", async () => {
    await writeFile(rootDir, ".mandu/prerendered/index.html", "<html></html>");
    await writeFile(rootDir, ".mandu/prerendered/blog/hello/index.html", "<html></html>");
    await writeFile(rootDir, ".mandu/prerendered/docs/getting-started/index.html", "<html></html>");
    const result = await checkPrerenderPollution(rootDir);
    expect(result.ok).toBe(true);
    expect(result.details?.scanned).toBe(3);
  });

  it("flags a literal 'path' placeholder route (#213)", async () => {
    await writeFile(rootDir, ".mandu/prerendered/path/index.html", "<html></html>");
    const result = await checkPrerenderPollution(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warning");
    expect(result.message).toMatch(/placeholder/);
  });

  it("flags routes containing '...' inside a segment", async () => {
    // We can't create a directory literally named "..." on Windows
    // (trailing dots are stripped), so we use a segment that embeds
    // "..." in the middle — the classifier still catches it.
    await writeFile(rootDir, ".mandu/prerendered/blog/a...b/index.html", "<html></html>");
    const result = await checkPrerenderPollution(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warning");
  });

  it("flags uppercase-starting segments as suspicious", async () => {
    await writeFile(rootDir, ".mandu/prerendered/Foo/index.html", "<html></html>");
    const result = await checkPrerenderPollution(rootDir);
    expect(result.ok).toBe(false);
  });

  it("scans legacy .mandu/static/ location too", async () => {
    await writeFile(rootDir, ".mandu/static/path/index.html", "<html></html>");
    const result = await checkPrerenderPollution(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warning");
  });
});

// ──────────────────────────────────────────────────────────────────
// cloneelement_warnings
// ──────────────────────────────────────────────────────────────────

describe("checkCloneElementWarnings", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkTmpRoot(); });
  afterEach(async () => { await fs.rm(rootDir, { recursive: true, force: true }); });

  it("returns ok when no build log exists", async () => {
    const result = await checkCloneElementWarnings(rootDir);
    expect(result.ok).toBe(true);
  });

  it("returns ok when log has no key warnings", async () => {
    await writeFile(rootDir, ".mandu/build.log", "Build succeeded\nNo warnings\n");
    const result = await checkCloneElementWarnings(rootDir);
    expect(result.ok).toBe(true);
  });

  it("returns info severity for 1-10 warnings", async () => {
    const warn = 'Warning: Each child in a list should have a unique "key" prop.\n';
    await writeFile(rootDir, ".mandu/build.log", warn.repeat(5));
    const result = await checkCloneElementWarnings(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("info");
    expect(result.details?.count).toBe(5);
  });

  it("returns warning severity for >10 warnings (#212)", async () => {
    const warn = 'Warning: Each child in a list should have a unique "key" prop.\n';
    await writeFile(rootDir, ".mandu/build.log", warn.repeat(25));
    const result = await checkCloneElementWarnings(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("warning");
    expect(result.details?.count).toBe(25);
    expect(result.suggestion).toMatch(/0\.32\.0/);
  });

  it("falls back to dev-server.stderr.log when build.log is absent", async () => {
    const warn = 'Each child in a list should have a unique "key" prop\n';
    await writeFile(rootDir, ".mandu/dev-server.stderr.log", warn.repeat(12));
    const result = await checkCloneElementWarnings(rootDir);
    expect(result.ok).toBe(false);
    expect(result.details?.logPath).toMatch(/dev-server\.stderr\.log$/);
  });
});

// ──────────────────────────────────────────────────────────────────
// dev_artifacts_in_prod
// ──────────────────────────────────────────────────────────────────

describe("checkDevArtifactsInProd", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkTmpRoot(); });
  afterEach(async () => { await fs.rm(rootDir, { recursive: true, force: true }); });

  it("returns ok when no _devtools.js artifact exists", async () => {
    const result = await checkDevArtifactsInProd(rootDir);
    expect(result.ok).toBe(true);
  });

  it("flags _devtools.js in production manifest", async () => {
    await writeFile(rootDir, ".mandu/manifest.json", JSON.stringify({
      version: 1, buildTime: "x", env: "production",
      bundles: {}, shared: { runtime: "", vendor: "" },
    }));
    await writeFile(rootDir, ".mandu/client/_devtools.js", "console.log('devtools');");
    const result = await checkDevArtifactsInProd(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/production/);
  });

  it("flags _devtools.js when mandu.config sets dev.devtools: false", async () => {
    await writeFile(rootDir, "mandu.config.ts", `export default { dev: { devtools: false } };`);
    await writeFile(rootDir, ".mandu/client/_devtools.js", "x");
    const result = await checkDevArtifactsInProd(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/dev\.devtools: false/);
  });

  it("flags prerendered HTML with a <script src=\".../devtools.js\"> reference", async () => {
    await writeFile(rootDir, ".mandu/prerendered/index.html",
      '<html><head><script src="/.mandu/client/_devtools.js"></script></head></html>'
    );
    const result = await checkDevArtifactsInProd(rootDir);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/prerendered HTML/);
  });

  it("stays ok in dev builds (env=development, devtools expected)", async () => {
    await writeFile(rootDir, ".mandu/manifest.json", JSON.stringify({
      version: 1, buildTime: "x", env: "development",
      bundles: {}, shared: { runtime: "", vendor: "" },
    }));
    await writeFile(rootDir, ".mandu/client/_devtools.js", "x");
    const result = await checkDevArtifactsInProd(rootDir);
    expect(result.ok).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────
// package_export_gaps
// ──────────────────────────────────────────────────────────────────

describe("checkPackageExportGaps", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkTmpRoot(); });
  afterEach(async () => { await fs.rm(rootDir, { recursive: true, force: true }); });

  async function seedCore(exports: Record<string, unknown>): Promise<void> {
    await writeFile(rootDir, "node_modules/@mandujs/core/package.json", JSON.stringify({
      name: "@mandujs/core", version: "0.32.0", exports,
    }));
  }

  it("skips gracefully when @mandujs/core is not installed", async () => {
    await writeFile(rootDir, "src/foo.ts", `import { x } from "@mandujs/core/compat/unknown";`);
    const result = await checkPackageExportGaps(rootDir);
    expect(result.ok).toBe(true);
    expect(result.details?.skipped).toBe(true);
  });

  it("returns ok when all user imports match the exports map", async () => {
    await seedCore({ ".": "./src/index.ts", "./client": "./src/client/index.ts" });
    await writeFile(rootDir, "src/a.ts", `import { foo } from "@mandujs/core";`);
    await writeFile(rootDir, "src/b.ts", `import { island } from "@mandujs/core/client";`);
    const result = await checkPackageExportGaps(rootDir);
    expect(result.ok).toBe(true);
    expect(result.details?.uniqueSubpaths).toBe(2);
  });

  it("flags an import missing from the exports map", async () => {
    await seedCore({ ".": "./src/index.ts", "./client": "./src/client/index.ts" });
    await writeFile(rootDir, "src/bad.ts", `import { x } from "@mandujs/core/compat/nonexistent";`);
    const result = await checkPackageExportGaps(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/nonexistent/);
  });

  it("honors ./* wildcard export as a catch-all", async () => {
    await seedCore({ ".": "./src/index.ts", "./*": "./src/*" });
    await writeFile(rootDir, "src/a.ts", `import { x } from "@mandujs/core/compat/anything";`);
    const result = await checkPackageExportGaps(rootDir);
    expect(result.ok).toBe(true);
  });

  it("recognizes require() specifiers in addition to import", async () => {
    await seedCore({ ".": "./src/index.ts" });
    await writeFile(rootDir, "src/a.cjs", `const { x } = require("@mandujs/core/compat/ghost");`);
    const result = await checkPackageExportGaps(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
  });
});

// ──────────────────────────────────────────────────────────────────
// nested_internal_core (#261)
// ──────────────────────────────────────────────────────────────────

describe("checkNestedInternalCore", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkTmpRoot(); });
  afterEach(async () => { await fs.rm(rootDir, { recursive: true, force: true }); });

  async function seedHoistedCore(version: string): Promise<void> {
    await writeFile(rootDir, "node_modules/@mandujs/core/package.json", JSON.stringify({
      name: "@mandujs/core", version,
    }));
  }

  async function seedNestedCore(parent: string, version: string): Promise<void> {
    await writeFile(
      rootDir,
      `node_modules/@mandujs/${parent}/node_modules/@mandujs/core/package.json`,
      JSON.stringify({ name: "@mandujs/core", version }),
    );
  }

  it("skips when hoisted @mandujs/core is not installed", async () => {
    const result = await checkNestedInternalCore(rootDir);
    expect(result.ok).toBe(true);
    expect(result.details?.skipped).toBe(true);
  });

  it("passes when no nested core exists", async () => {
    await seedHoistedCore("0.53.2");
    // Seed a sibling without nested core
    await writeFile(rootDir, "node_modules/@mandujs/mcp/package.json", JSON.stringify({
      name: "@mandujs/mcp", version: "0.36.2",
    }));
    const result = await checkNestedInternalCore(rootDir);
    expect(result.ok).toBe(true);
    expect(result.details?.scannedSiblings).toBe(1);
  });

  it("passes when nested core matches hoisted version exactly", async () => {
    await seedHoistedCore("0.53.2");
    await seedNestedCore("mcp", "0.53.2");
    const result = await checkNestedInternalCore(rootDir);
    expect(result.ok).toBe(true);
  });

  it("flags a stale nested core that shadows hoisted (#261 repro)", async () => {
    await seedHoistedCore("0.53.2");
    await seedNestedCore("mcp", "0.47.0");
    const result = await checkNestedInternalCore(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/@mandujs\/mcp/);
    expect(result.message).toMatch(/0\.47\.0/);
    expect(result.suggestion).toMatch(/rm -rf node_modules\/@mandujs\/mcp\/node_modules/);
    expect(result.details?.mismatchCount).toBe(1);
  });

  it("reports every mismatched sibling, not just one", async () => {
    await seedHoistedCore("0.53.2");
    await seedNestedCore("mcp", "0.47.0");
    await seedNestedCore("ate", "0.50.0");
    const result = await checkNestedInternalCore(rootDir);
    expect(result.ok).toBe(false);
    expect(result.details?.mismatchCount).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────
// client_boundary_manifests
// ──────────────────────────────────────────────────────────────────

describe("checkClientBoundaryManifests", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkTmpRoot(); });
  afterEach(async () => { await fs.rm(rootDir, { recursive: true, force: true }); });

  it("skips gracefully when routes manifest is missing", async () => {
    const result = await checkClientBoundaryManifests(rootDir);
    expect(result.ok).toBe(true);
    expect(result.details?.skipped).toBe(true);
  });

  it("passes when the routes manifest has no compiler-owned boundaries", async () => {
    await writeFile(rootDir, ".mandu/routes.manifest.json", JSON.stringify({
      routes: [{ id: "home", kind: "page" }],
    }));
    const result = await checkClientBoundaryManifests(rootDir);
    expect(result.ok).toBe(true);
    expect(result.details?.boundaryCount).toBe(0);
  });

  it("flags duplicate client boundary ids in the routes manifest", async () => {
    await writeFile(rootDir, ".mandu/routes.manifest.json", JSON.stringify({
      routes: [
        {
          id: "a",
          boundaries: [{ id: "dup--0", routeId: "a", module: "src/client/A.client.tsx", exportName: "A" }],
        },
        {
          id: "b",
          boundaries: [{ id: "dup--0", routeId: "b", module: "src/client/B.client.tsx", exportName: "B" }],
        },
      ],
    }));
    const result = await checkClientBoundaryManifests(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/duplicate/);
  });

  it("flags missing boundary bundle manifest entries", async () => {
    await writeFile(rootDir, ".mandu/routes.manifest.json", JSON.stringify({
      routes: [
        {
          id: "home",
          boundaries: [{ id: "home--0", routeId: "home", module: "src/client/Home.client.tsx", exportName: "Home" }],
        },
      ],
    }));
    await writeFile(rootDir, ".mandu/manifest.json", JSON.stringify({
      version: 1,
      buildTime: "x",
      env: "production",
      bundles: {},
      boundaries: {},
      shared: { runtime: "/.mandu/client/_runtime.js", vendor: "/.mandu/client/_react.js" },
    }));
    const result = await checkClientBoundaryManifests(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/incomplete/);
    expect(result.details?.missingEntries).toEqual(["home--0"]);
  });

  it("treats a missing bundle manifest as an error when routes declare compiler-owned boundaries", async () => {
    await writeFile(rootDir, ".mandu/routes.manifest.json", JSON.stringify({
      routes: [
        {
          id: "home",
          boundaries: [{ id: "home--0", routeId: "home", module: "src/client/Home.client.tsx", exportName: "Home" }],
        },
      ],
    }));
    const result = await checkClientBoundaryManifests(rootDir);
    expect(result.ok).toBe(false);
    expect(result.severity).toBe("error");
    expect(result.message).toMatch(/bundle manifest is missing/);
  });

  it("passes when route and bundle boundary manifests line up", async () => {
    await writeFile(rootDir, ".mandu/routes.manifest.json", JSON.stringify({
      routes: [
        {
          id: "home",
          boundaries: [{ id: "home--0", routeId: "home", module: "src/client/Home.client.tsx", exportName: "Home" }],
        },
      ],
    }));
    await writeFile(rootDir, ".mandu/client/home--0.boundary.js", "export default function Home() {}\n");
    await writeFile(rootDir, ".mandu/manifest.json", JSON.stringify({
      version: 1,
      buildTime: "x",
      env: "production",
      bundles: {},
      boundaries: {
        "home--0": {
          route: "home",
          js: "/.mandu/client/home--0.boundary.js",
          module: "src/client/Home.client.tsx",
          exportName: "Home",
        },
      },
      shared: { runtime: "/.mandu/client/_runtime.js", vendor: "/.mandu/client/_react.js" },
    }));
    const result = await checkClientBoundaryManifests(rootDir);
    expect(result.ok).toBe(true);
    expect(result.details?.boundaryCount).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────
// aggregator
// ──────────────────────────────────────────────────────────────────

describe("runExtendedDiagnose", () => {
  let rootDir: string;
  beforeEach(async () => { rootDir = await mkTmpRoot(); });
  afterEach(async () => { await fs.rm(rootDir, { recursive: true, force: true }); });

  it("runs all 8 extended checks and returns a structured report", async () => {
    const report = await runExtendedDiagnose(rootDir);
    // F42/F45 added `client_boundary_manifests` — total is now 8.
    expect(report.summary.total).toBe(8);
    // manifest is missing → at least one error
    expect(report.healthy).toBe(false);
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
    const rules = report.checks.map((c) => c.rule);
    expect(rules).toContain("manifest_freshness");
    expect(rules).toContain("prerender_pollution");
    expect(rules).toContain("cloneelement_warnings");
    expect(rules).toContain("dev_artifacts_in_prod");
    expect(rules).toContain("package_export_gaps");
    expect(rules).toContain("nested_internal_core");
    expect(rules).toContain("client_boundary_manifests");
    expect(rules).toContain("a11y_hints");
  });

  it("returns healthy=true when all checks pass (production manifest, no gaps)", async () => {
    await writeFile(rootDir, ".mandu/manifest.json", JSON.stringify({
      version: 1, buildTime: "x", env: "production",
      bundles: { h: { js: "/h.js", dependencies: [], priority: "immediate" } },
      shared: { runtime: "/r.js", vendor: "/v.js" },
    }));
    const report = await runExtendedDiagnose(rootDir);
    expect(report.healthy).toBe(true);
    expect(report.errorCount).toBe(0);
  });
});

describe("buildReport", () => {
  it("computes healthy=true when no error-severity check fires", () => {
    const report = buildReport([
      { ok: true, rule: "a", message: "ok" },
      { ok: false, rule: "b", severity: "warning", message: "warn" },
      { ok: false, rule: "c", severity: "info", message: "info" },
    ]);
    expect(report.healthy).toBe(true);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(1);
    expect(report.summary.failed).toBe(2);
  });

  it("computes healthy=false when at least one error fires", () => {
    const report = buildReport([
      { ok: false, rule: "a", severity: "error", message: "fail" },
      { ok: true, rule: "b", message: "ok" },
    ]);
    expect(report.healthy).toBe(false);
    expect(report.errorCount).toBe(1);
  });
});
