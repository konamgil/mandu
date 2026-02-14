import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { computeImpact } from "./impact";

function sh(cwd: string, args: string[]) {
  return execFileSync(args[0]!, args.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");
}

function initGitRepo(dir: string) {
  sh(dir, ["git", "init"]);
  sh(dir, ["git", "config", "user.email", "ate@example.com"]);
  sh(dir, ["git", "config", "user.name", "ATE Test"]);
}

function commitAll(dir: string, msg: string) {
  sh(dir, ["git", "add", "-A"]);
  sh(dir, ["git", "commit", "-m", msg]);
  return sh(dir, ["git", "rev-parse", "HEAD"]).trim();
}

describe("computeImpact", () => {
  it("selects a route when a file under the route directory changes", () => {
    const dir = join(process.cwd(), ".tmp-impact-" + Date.now());
    mkdirSync(dir, { recursive: true });
    initGitRepo(dir);

    // .mandu interaction graph
    const manduDir = join(dir, ".mandu");
    mkdirSync(manduDir, { recursive: true });
    writeFileSync(
      join(manduDir, "interaction-graph.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          buildSalt: "test",
          nodes: [
            { kind: "route", id: "route:a", file: "app/routes/a/page.tsx", path: "/a" },
          ],
          edges: [],
          stats: { routes: 1, navigations: 0, modals: 0, actions: 0 },
        },
        null,
        2,
      ),
    );

    // route files
    mkdirSync(join(dir, "app/routes/a"), { recursive: true });
    writeFileSync(join(dir, "app/routes/a/page.tsx"), "export default function Page(){return null}\n");
    writeFileSync(join(dir, "app/routes/a/component.tsx"), "export const x = 1;\n");

    const base = commitAll(dir, "init");

    // modify a file under the same directory
    writeFileSync(join(dir, "app/routes/a/component.tsx"), "export const x = 2;\n");
    const head = commitAll(dir, "change component");

    const impact = computeImpact({ repoRoot: dir, base, head });
    expect(impact.changedFiles).toContain("app/routes/a/component.tsx");
    expect(impact.selectedRoutes).toContain("route:a");
  });

  it("normalizes windows-style route file paths in interaction graph", () => {
    const dir = join(process.cwd(), ".tmp-impact-win-" + Date.now());
    mkdirSync(dir, { recursive: true });
    initGitRepo(dir);

    const manduDir = join(dir, ".mandu");
    mkdirSync(manduDir, { recursive: true });
    writeFileSync(
      join(manduDir, "interaction-graph.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          buildSalt: "test",
          nodes: [
            { kind: "route", id: "route:b", file: "app\\routes\\b\\page.tsx", path: "/b" },
          ],
          edges: [],
          stats: { routes: 1, navigations: 0, modals: 0, actions: 0 },
        },
        null,
        2,
      ),
    );

    mkdirSync(join(dir, "app/routes/b"), { recursive: true });
    writeFileSync(join(dir, "app/routes/b/page.tsx"), "export default function Page(){return null}\n");
    writeFileSync(join(dir, "app/routes/b/util.ts"), "export const u = 1;\n");

    const base = commitAll(dir, "init");

    writeFileSync(join(dir, "app/routes/b/util.ts"), "export const u = 2;\n");
    const head = commitAll(dir, "change util");

    const impact = computeImpact({ repoRoot: dir, base, head });
    expect(impact.selectedRoutes).toContain("route:b");
  });

  it("rejects suspicious git revisions", () => {
    const dir = join(process.cwd(), ".tmp-impact-sec-" + Date.now());
    mkdirSync(dir, { recursive: true });
    initGitRepo(dir);
    writeFileSync(join(dir, "README.md"), "hi\n");
    commitAll(dir, "init");

    expect(() => computeImpact({ repoRoot: dir, base: "HEAD;rm -rf /", head: "HEAD" })).toThrow();
  });
});
