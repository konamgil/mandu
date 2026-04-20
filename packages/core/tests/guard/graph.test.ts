/**
 * Phase 18.π — Guard dependency graph tests.
 *
 * Covers:
 *   1. empty project → well-formed empty graph
 *   2. single-file / no imports
 *   3. two-file happy path (edge created, no violation)
 *   4. violation tagging (features → widgets under fsd preset)
 *   5. layer ordering matches preset hierarchy
 *   6. preset-specific layering (mandu preset: client/features → client/shared)
 *   7. cycle detection (edges still emitted + circular-dependency violation)
 *   8. unassigned layer bucket (file outside any configured layer)
 *   9. JSON shape invariants (version, ids sorted, no NaN)
 *  10. renderGraphHtml emits valid self-contained single file < 500 KB
 *  11. renderGraphHtml escapes hostile module names (XSS hardening)
 *  12. renderGraphHtml degrades to "no modules" message when empty
 *  13. deterministic across two runs (stable id ordering)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  analyzeDependencyGraph,
  renderGraphHtml,
} from "../../src/guard/graph";
import type { GuardConfig } from "../../src/guard/types";

// ────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────

function freshDir(prefix: string): string {
  return join(tmpdir(), `mandu-graph-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

async function seedFsdFixture(root: string): Promise<void> {
  await mkdir(join(root, "src/features/auth"), { recursive: true });
  await mkdir(join(root, "src/widgets/header"), { recursive: true });
  await mkdir(join(root, "src/shared/ui"), { recursive: true });
  await mkdir(join(root, "src/entities/user"), { recursive: true });
}

// ────────────────────────────────────────────────────────────────────────────
// analyzeDependencyGraph
// ────────────────────────────────────────────────────────────────────────────

describe("analyzeDependencyGraph", () => {
  let root: string;
  beforeEach(async () => { root = freshDir("analyze"); await mkdir(root, { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("returns an empty graph for an empty project", async () => {
    await mkdir(join(root, "src"), { recursive: true });
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    expect(g.nodes).toHaveLength(0);
    expect(g.edges).toHaveLength(0);
    expect(g.layers).toHaveLength(0);
    expect(g.violations).toHaveLength(0);
    expect(g.summary.nodes).toBe(0);
    expect(g.summary.edges).toBe(0);
    expect(g.summary.preset).toBe("fsd");
    expect(g.summary.version).toBe(1);
  });

  it("analyzes a single-file project with no imports", async () => {
    await seedFsdFixture(root);
    await writeFile(join(root, "src/shared/ui/button.tsx"), `export const Button = () => null;`);
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].id).toBe("src/shared/ui/button.tsx");
    expect(g.nodes[0].layer).toBe("shared");
    expect(g.edges).toHaveLength(0);
    expect(g.summary.edges).toBe(0);
  });

  it("creates an edge between two files with a valid import", async () => {
    await seedFsdFixture(root);
    await writeFile(join(root, "src/shared/ui/button.tsx"), `export const Button = () => null;`);
    await writeFile(
      join(root, "src/features/auth/login.tsx"),
      `import { Button } from '@/shared/ui/button';\nexport const Login = () => Button();`
    );
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].from).toBe("src/features/auth/login.tsx");
    expect(g.edges[0].to).toBe("src/shared/ui/button.tsx");
    expect(g.edges[0].violation).toBe(false);
    expect(g.edges[0].fromLayer).toBe("features");
    expect(g.edges[0].toLayer).toBe("shared");
  });

  it("flags a layer violation (features → widgets under fsd)", async () => {
    await seedFsdFixture(root);
    await writeFile(join(root, "src/widgets/header/header.tsx"), `export const Header = () => null;`);
    await writeFile(
      join(root, "src/features/auth/login.tsx"),
      `import { Header } from '@/widgets/header/header';\nexport const Login = () => Header();`
    );
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].violation).toBe(true);
    expect(g.summary.violationEdges).toBe(1);
    expect(g.violations.length).toBeGreaterThanOrEqual(1);
    const layerVio = g.violations.find((v) => v.type === "layer-violation");
    expect(layerVio).toBeDefined();
    expect(layerVio!.fromLayer).toBe("features");
    expect(layerVio!.toLayer).toBe("widgets");
  });

  it("orders layers by preset hierarchy (fsd: app → pages → widgets → features → entities → shared)", async () => {
    await mkdir(join(root, "src/app"), { recursive: true });
    await mkdir(join(root, "src/pages"), { recursive: true });
    await mkdir(join(root, "src/widgets"), { recursive: true });
    await mkdir(join(root, "src/shared"), { recursive: true });
    await writeFile(join(root, "src/app/app.tsx"), `export const A = 1;`);
    await writeFile(join(root, "src/pages/home.tsx"), `export const H = 1;`);
    await writeFile(join(root, "src/widgets/nav.tsx"), `export const N = 1;`);
    await writeFile(join(root, "src/shared/btn.tsx"), `export const B = 1;`);
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    const layerNames = g.layers.map((l) => l.name);
    // Only layers that have at least one module appear
    expect(layerNames).toEqual(["app", "pages", "widgets", "shared"]);
    expect(g.layers[0].rank).toBe(0);
    expect(g.layers[g.layers.length - 1].name).toBe("shared");
  });

  it("works with the mandu preset (client/features → client/shared allowed)", async () => {
    await mkdir(join(root, "src/client/features/login"), { recursive: true });
    await mkdir(join(root, "src/client/shared/ui"), { recursive: true });
    await writeFile(join(root, "src/client/shared/ui/button.tsx"), `export const B = 1;`);
    await writeFile(
      join(root, "src/client/features/login/login.tsx"),
      `import { B } from '@/client/shared/ui/button';\nexport const L = () => B;`
    );
    const g = await analyzeDependencyGraph({ preset: "mandu" }, root);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].violation).toBe(false);
    expect(g.edges[0].fromLayer).toBe("client/features");
    expect(g.edges[0].toLayer).toBe("client/shared");
  });

  it("detects cycles via circular-dependency violation", async () => {
    await seedFsdFixture(root);
    await writeFile(
      join(root, "src/shared/a.ts"),
      `import { b } from './b';\nexport const a = 1;`
    );
    await writeFile(
      join(root, "src/shared/b.ts"),
      `import { a } from './a';\nexport const b = 1;`
    );
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    expect(g.edges.length).toBeGreaterThanOrEqual(2);
    const circ = g.violations.find((v) => v.type === "circular-dependency");
    expect(circ).toBeDefined();
  });

  it("puts files outside any layer into the graph with null layer", async () => {
    await mkdir(join(root, "src/misc"), { recursive: true });
    await writeFile(join(root, "src/misc/stray.ts"), `export const x = 1;`);
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    expect(g.nodes).toHaveLength(1);
    expect(g.nodes[0].layer).toBeNull();
  });

  it("guarantees stable ordering + well-formed JSON shape", async () => {
    await seedFsdFixture(root);
    await writeFile(join(root, "src/shared/a.ts"), `export const a = 1;`);
    await writeFile(join(root, "src/shared/b.ts"), `export const b = 1;`);
    await writeFile(join(root, "src/shared/c.ts"), `export const c = 1;`);
    const g1 = await analyzeDependencyGraph({ preset: "fsd" }, root);
    const g2 = await analyzeDependencyGraph({ preset: "fsd" }, root);
    expect(g1.nodes.map((n) => n.id)).toEqual(g2.nodes.map((n) => n.id));
    // Sorted ascending.
    const ids = g1.nodes.map((n) => n.id);
    expect([...ids].sort()).toEqual(ids);
    // summary.version is a finite integer.
    expect(Number.isInteger(g1.summary.version)).toBe(true);
    // roundtrip JSON doesn't throw and preserves node count.
    const jsonRoundtrip = JSON.parse(JSON.stringify(g1));
    expect(jsonRoundtrip.nodes).toHaveLength(g1.nodes.length);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// renderGraphHtml
// ────────────────────────────────────────────────────────────────────────────

describe("renderGraphHtml", () => {
  let root: string;
  beforeEach(async () => { root = freshDir("render"); await mkdir(root, { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("produces a self-contained HTML file under 500 KB", async () => {
    await seedFsdFixture(root);
    // Seed ~10 modules to give the renderer real work.
    for (let i = 0; i < 10; i++) {
      await writeFile(join(root, `src/shared/m${i}.ts`), `export const m${i} = ${i};`);
    }
    await writeFile(
      join(root, "src/features/auth/login.ts"),
      `import { m0 } from '@/shared/m0';\nexport const l = m0;`
    );
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    const html = renderGraphHtml(g);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<svg");
    expect(html).toContain("Mandu Guard Graph");
    // No CDN / external asset.
    expect(html).not.toMatch(/https?:\/\/[^"']*\.(js|css|woff)/i);
    // Size guard.
    expect(html.length).toBeLessThan(500 * 1024);
  });

  it("escapes hostile module names (no raw </script> tag injection)", async () => {
    const hostile = {
      nodes: [
        {
          id: "src/evil.tsx",
          filePath: "/tmp/evil.tsx",
          label: "</script><img src=x>",
          layer: "shared",
          slice: undefined,
        },
      ],
      edges: [],
      layers: [{ name: "shared", rank: 0, description: "s", nodeCount: 1 }],
      violations: [],
      summary: {
        nodes: 1,
        edges: 0,
        violationEdges: 0,
        violations: 0,
        filesAnalyzed: 1,
        preset: "fsd",
        srcDir: "src",
        generatedAt: new Date(0).toISOString(),
        version: 1,
      },
    };
    const html = renderGraphHtml(hostile as any);
    // No unescaped closing script tag from user data.
    const scriptCloses = (html.match(/<\/script>/gi) ?? []).length;
    expect(scriptCloses).toBe(1); // only our own closing tag
    expect(html).not.toContain("<img src=x");
  });

  it("renders without error for an empty graph", async () => {
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    const html = renderGraphHtml(g);
    expect(html).toContain("<svg");
    expect(html).toContain("Modules");
    // 0 modules card.
    expect(html).toMatch(/Modules[\s\S]*?>0</);
  });

  it("embeds violation count in the summary cards", async () => {
    await seedFsdFixture(root);
    await writeFile(join(root, "src/widgets/header.tsx"), `export const H = 1;`);
    await writeFile(
      join(root, "src/features/auth/login.tsx"),
      `import { H } from '@/widgets/header';\nexport const L = H;`
    );
    const g = await analyzeDependencyGraph({ preset: "fsd" }, root);
    const html = renderGraphHtml(g);
    expect(html).toContain("violation");
    // At least one violation edge is present in rendered SVG.
    expect(html).toMatch(/class="edge violation"/);
  });
});
