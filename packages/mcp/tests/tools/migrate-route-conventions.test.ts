/**
 * MCP tool — `mandu.refactor.migrate_route_conventions` tests.
 *
 * Coverage:
 *   • Tool definition + destructiveHint annotation
 *   • `detectConventions` — Suspense, ErrorBoundary, inline NotFound
 *   • Dry-run does not write files
 *   • Actual write creates `loading.tsx` / `error.tsx` / `not-found.tsx`
 *   • Existing convention file is not overwritten (reported with `note`)
 *   • Input validation (bad dryRun, bad routes)
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  migrateRouteConventionsToolDefinitions,
  migrateRouteConventionsTools,
  detectConventions,
} from "../../src/tools/migrate-route-conventions";

describe("migrateRouteConventionsToolDefinitions", () => {
  it("declares the tool with destructiveHint", () => {
    expect(migrateRouteConventionsToolDefinitions).toHaveLength(1);
    const def = migrateRouteConventionsToolDefinitions[0];
    expect(def.name).toBe("mandu.refactor.migrate_route_conventions");
    expect(def.annotations?.readOnlyHint).toBe(false);
    expect(def.annotations?.destructiveHint).toBe(true);
  });
});

describe("detectConventions", () => {
  it("detects inline Suspense", () => {
    const src = `<Suspense fallback={<div>Loading…</div>}><Page /></Suspense>`;
    const hits = detectConventions(src);
    expect(hits.some((h) => h.convention === "loading")).toBe(true);
  });

  it("detects inline ErrorBoundary", () => {
    const src = `<ErrorBoundary fallback={<Err />}>…</ErrorBoundary>`;
    const hits = detectConventions(src);
    expect(hits.some((h) => h.convention === "error")).toBe(true);
  });

  it("detects inline NotFound element", () => {
    const src = `if (!user) return <NotFound />`;
    const hits = detectConventions(src);
    expect(hits.some((h) => h.convention === "not-found")).toBe(true);
  });

  it("detects notFound() call", () => {
    const src = `if (!user) { notFound(); }`;
    const hits = detectConventions(src);
    expect(hits.some((h) => h.convention === "not-found")).toBe(true);
  });

  it("returns empty for clean pages", () => {
    const src = `export default function Page() { return <div>hi</div>; }`;
    expect(detectConventions(src)).toHaveLength(0);
  });
});

describe("migrateRouteConventionsTools — filesystem integration", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "mandu-routes-"));
    await mkdir(path.join(root, "app", "dashboard"), { recursive: true });
    await writeFile(
      path.join(root, "app", "dashboard", "page.tsx"),
      `import { Suspense } from "react";\n` +
        `export default function Page() {\n` +
        `  return <Suspense fallback={<div>Loading…</div>}><Data/></Suspense>;\n` +
        `}\n`,
    );
    // Route with an already-existing loading.tsx
    await mkdir(path.join(root, "app", "settings"), { recursive: true });
    await writeFile(
      path.join(root, "app", "settings", "page.tsx"),
      `export default function Page() {\n` +
        `  return <Suspense fallback={<div>…</div>}>hi</Suspense>;\n` +
        `}\n`,
    );
    await writeFile(
      path.join(root, "app", "settings", "loading.tsx"),
      `export default function Loading() { return <div>existing</div>; }\n`,
    );
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("plans extractions on dry-run without writing", async () => {
    const handlers = migrateRouteConventionsTools(root);
    const result = (await handlers["mandu.refactor.migrate_route_conventions"]({
      dryRun: true,
    })) as {
      extracted: Array<{ route: string; convention: string; note?: string }>;
    };
    expect(result.extracted.length).toBeGreaterThanOrEqual(2);
    // Confirm no file was written for app/dashboard/loading.tsx:
    const exists = await Bun.file(
      path.join(root, "app", "dashboard", "loading.tsx"),
    ).exists();
    expect(exists).toBe(false);
  });

  it("writes files when dryRun:false and skips existing ones", async () => {
    const handlers = migrateRouteConventionsTools(root);
    const result = (await handlers["mandu.refactor.migrate_route_conventions"]({
      dryRun: false,
    })) as {
      extracted: Array<{ route: string; convention: string; note?: string }>;
    };

    const existsDashboard = await Bun.file(
      path.join(root, "app", "dashboard", "loading.tsx"),
    ).exists();
    expect(existsDashboard).toBe(true);

    // Existing settings/loading.tsx should be reported with a `note` and its
    // content must not have changed.
    const settingsEntry = result.extracted.find((e) =>
      e.route.includes("settings"),
    );
    expect(settingsEntry?.note).toBe("already exists — skipped write");
    const settingsContent = await Bun.file(
      path.join(root, "app", "settings", "loading.tsx"),
    ).text();
    expect(settingsContent).toContain("existing");
  });

  it("rejects non-boolean dryRun", async () => {
    const handlers = migrateRouteConventionsTools(root);
    const result = (await handlers["mandu.refactor.migrate_route_conventions"]({
      dryRun: 1,
    })) as { error?: string; field?: string };
    expect(result.error).toBeDefined();
    expect(result.field).toBe("dryRun");
  });

  it("rejects non-array routes", async () => {
    const handlers = migrateRouteConventionsTools(root);
    const result = (await handlers["mandu.refactor.migrate_route_conventions"]({
      routes: "app/dashboard",
    })) as { error?: string; field?: string };
    expect(result.error).toBeDefined();
    expect(result.field).toBe("routes");
  });
});
