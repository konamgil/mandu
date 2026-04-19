import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  generateSkillsForProject,
  analyzeProject,
  analyzeManifest,
  analyzeGuard,
  analyzeStack,
  listGeneratedSkills,
  resolveSkillsOutDir,
  SkillsPathEscapeError,
} from "../index";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "skills-gen-test-"));

  // A fake Mandu project
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "my-proj",
        version: "0.0.1",
        dependencies: {
          "@mandujs/core": "0.22.1",
          react: "19.0.0",
          "react-dom": "19.0.0",
          tailwindcss: "4.0.0",
        },
        devDependencies: {
          "@playwright/test": "1.40.0",
        },
        engines: { bun: ">=1.3.12" },
      },
      null,
      2,
    ),
  );

  // Manifest with routes
  mkdirSync(join(root, ".mandu"), { recursive: true });
  writeFileSync(
    join(root, ".mandu", "manifest.json"),
    JSON.stringify(
      {
        version: 1,
        routes: [
          { id: "/api/users", pattern: "/api/users", kind: "api", methods: ["GET", "POST"], module: "app/api/users/route.ts" },
          { id: "/users", pattern: "/users", kind: "page", module: "app/users/page.tsx", componentModule: "app/users/page.tsx" },
          { id: "/", pattern: "/", kind: "page", module: "app/page.tsx", componentModule: "app/page.tsx" },
        ],
      },
      null,
      2,
    ),
  );

  // Resources
  mkdirSync(join(root, "shared", "resources"), { recursive: true });
  writeFileSync(join(root, "shared", "resources", "user.resource.ts"), "// user");
  writeFileSync(join(root, "shared", "resources", "post.resource.ts"), "// post");

  // Guard config
  writeFileSync(
    join(root, "guard.config.ts"),
    `export default { preset: "mandu" };`,
  );

  // Guard report with violations
  writeFileSync(
    join(root, ".mandu", "guard-report.json"),
    JSON.stringify(
      {
        violations: [
          { ruleId: "LAYER_VIOLATION", file: "a.ts", message: "bad layer" },
          { ruleId: "LAYER_VIOLATION", file: "b.ts", message: "bad layer" },
          { ruleId: "SLOT_NOT_FOUND", file: "c.ts", message: "missing slot" },
        ],
      },
      null,
      2,
    ),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("analyzers", () => {
  it("analyzeManifest counts routes and samples", () => {
    const m = analyzeManifest(root);
    expect(m.present).toBe(true);
    expect(m.totalRoutes).toBe(3);
    expect(m.apiRoutes).toBe(1);
    expect(m.pageRoutes).toBe(2);
    expect(m.resources).toContain("user");
    expect(m.resources).toContain("post");
    expect(m.sampleRoutes.length).toBe(3);
  });

  it("analyzeGuard detects preset and top rules", () => {
    const g = analyzeGuard(root);
    expect(g.preset).toBe("mandu");
    expect(g.reportPresent).toBe(true);
    expect(g.violationCount).toBe(3);
    expect(g.topRules?.[0].ruleId).toBe("LAYER_VIOLATION");
    expect(g.topRules?.[0].count).toBe(2);
  });

  it("analyzeStack detects stack + Bun runtime", () => {
    const s = analyzeStack(root);
    expect(s.manduCore).toBe("0.22.1");
    expect(s.hasReact).toBe(true);
    expect(s.hasTailwind).toBe(true);
    expect(s.hasPlaywright).toBe(true);
    expect(s.bunRuntime).toBe(true);
  });

  it("analyzers are safe on an empty dir", () => {
    const empty = mkdtempSync(join(tmpdir(), "skills-gen-empty-"));
    try {
      const m = analyzeManifest(empty);
      expect(m.present).toBe(false);
      expect(m.totalRoutes).toBe(0);
      const g = analyzeGuard(empty);
      expect(g.reportPresent).toBe(false);
      const s = analyzeStack(empty);
      expect(s.hasReact).toBe(false);
      expect(s.bunRuntime).toBe(false);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe("generateSkillsForProject", () => {
  it("throws when repoRoot is missing", () => {
    // @ts-expect-error intentional
    expect(() => generateSkillsForProject({})).toThrow();
  });

  it("produces glossary / conventions / workflow by default", () => {
    const result = generateSkillsForProject({ repoRoot: root, regenerate: true });
    const ids = result.files.map((f) => f.id);
    expect(ids).toContain("my-proj-domain-glossary");
    expect(ids).toContain("my-proj-conventions");
    expect(ids).toContain("my-proj-workflow");
    expect(result.files.every((f) => f.written || f.skipped)).toBe(true);
  });

  it("glossary includes manifest resources and sample routes", () => {
    const result = generateSkillsForProject({ repoRoot: root, regenerate: true });
    const glossary = result.files.find((f) => f.id === "my-proj-domain-glossary")!;
    expect(glossary.content).toContain("user");
    expect(glossary.content).toContain("post");
    expect(glossary.content).toContain("/api/users");
    expect(glossary.content).toContain("Total: 3 routes");
  });

  it("conventions reflect guard violations", () => {
    const result = generateSkillsForProject({ repoRoot: root, regenerate: true });
    const conv = result.files.find((f) => f.id === "my-proj-conventions")!;
    expect(conv.content).toContain("Guard preset: **mandu**");
    expect(conv.content).toContain("LAYER_VIOLATION");
    expect(conv.content).toContain("| 2 |");
  });

  it("workflow hints at installed Playwright + Tailwind", () => {
    const result = generateSkillsForProject({ repoRoot: root, regenerate: true });
    const wf = result.files.find((f) => f.id === "my-proj-workflow")!;
    expect(wf.content).toContain("Tailwind");
    expect(wf.content).toContain("playwright");
  });

  it("dry-run writes no files", () => {
    const result = generateSkillsForProject({
      repoRoot: root,
      regenerate: true,
      dryRun: true,
    });
    for (const f of result.files) {
      expect(f.written).toBe(false);
      expect(f.skipped).toBe(false);
    }
    expect(result.dryRun).toBe(true);
  });

  it("skips existing files by default (no regenerate)", () => {
    // First write
    generateSkillsForProject({ repoRoot: root, regenerate: true });
    // Second without regenerate
    const second = generateSkillsForProject({ repoRoot: root });
    expect(second.files.every((f) => f.skipped)).toBe(true);
    expect(second.files.every((f) => !f.written)).toBe(true);
  });

  it("regenerate overwrites existing files", () => {
    generateSkillsForProject({ repoRoot: root, regenerate: true });
    const target = join(root, ".claude", "skills", "my-proj-domain-glossary.md");
    writeFileSync(target, "USER_CHANGED");
    const res = generateSkillsForProject({ repoRoot: root, regenerate: true });
    const glossary = res.files.find((f) => f.id === "my-proj-domain-glossary")!;
    expect(glossary.written).toBe(true);
    const content = readFileSync(target, "utf8");
    expect(content).not.toContain("USER_CHANGED");
    expect(content).toContain("Domain Glossary");
  });

  it("honors custom outDir", () => {
    const customRoot = mkdtempSync(join(tmpdir(), "skills-gen-custom-"));
    try {
      writeFileSync(
        join(customRoot, "package.json"),
        JSON.stringify({ name: "cust" }),
      );
      const custom = join(customRoot, "out");
      generateSkillsForProject({
        repoRoot: customRoot,
        outDir: custom,
        regenerate: true,
      });
      expect(existsSync(join(custom, "cust-domain-glossary.md"))).toBe(true);
    } finally {
      rmSync(customRoot, { recursive: true, force: true });
    }
  });

  it("honors kinds filter", () => {
    const res = generateSkillsForProject({
      repoRoot: root,
      regenerate: true,
      kinds: ["glossary"],
    });
    expect(res.files.length).toBe(1);
    expect(res.files[0].id).toBe("my-proj-domain-glossary");
  });

  it("analyzeProject ties all analyzers together", () => {
    const p = analyzeProject(root);
    expect(p.projectName).toBe("my-proj");
    expect(p.manifest.totalRoutes).toBe(3);
    expect(p.guard.preset).toBe("mandu");
    expect(p.stack.bunRuntime).toBe(true);
  });

  it("listGeneratedSkills returns files after generation", () => {
    generateSkillsForProject({ repoRoot: root, regenerate: true });
    const paths = listGeneratedSkills(root);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p.endsWith("my-proj-conventions.md"))).toBe(true);
  });

  it("strips scope from scoped project name", () => {
    const scoped = mkdtempSync(join(tmpdir(), "skills-gen-scoped-"));
    try {
      writeFileSync(
        join(scoped, "package.json"),
        JSON.stringify({ name: "@myorg/my-feature" }),
      );
      const res = generateSkillsForProject({ repoRoot: scoped, regenerate: true });
      expect(res.analysis.projectName).toBe("my-feature");
      expect(res.files.some((f) => f.id === "my-feature-domain-glossary")).toBe(true);
    } finally {
      rmSync(scoped, { recursive: true, force: true });
    }
  });
});

describe("skills out-dir containment (Wave R3 L-02)", () => {
  it("resolveSkillsOutDir accepts a relative subdir", () => {
    const proj = mkdtempSync(join(tmpdir(), "skills-contain-ok-"));
    try {
      const resolved = resolveSkillsOutDir(proj, ".claude/skills");
      expect(resolved.startsWith(proj)).toBe(true);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  it("resolveSkillsOutDir accepts .mandu/skills (relative)", () => {
    const proj = mkdtempSync(join(tmpdir(), "skills-contain-mandu-"));
    try {
      const resolved = resolveSkillsOutDir(proj, ".mandu/skills");
      expect(resolved.startsWith(proj)).toBe(true);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  it("resolveSkillsOutDir rejects ../../etc traversal", () => {
    const proj = mkdtempSync(join(tmpdir(), "skills-contain-traverse-"));
    try {
      expect(() => resolveSkillsOutDir(proj, "../../etc")).toThrow(SkillsPathEscapeError);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  it("resolveSkillsOutDir rejects a sibling-directory absolute path", () => {
    const base = mkdtempSync(join(tmpdir(), "skills-contain-sib-"));
    const sibling = mkdtempSync(join(tmpdir(), "skills-contain-other-"));
    try {
      expect(() => resolveSkillsOutDir(base, sibling)).toThrow(SkillsPathEscapeError);
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("generateSkillsForProject propagates SkillsPathEscapeError for ../../etc", () => {
    const proj = mkdtempSync(join(tmpdir(), "skills-gen-escape-"));
    try {
      writeFileSync(join(proj, "package.json"), JSON.stringify({ name: "x" }));
      expect(() =>
        generateSkillsForProject({ repoRoot: proj, outDir: "../../etc" }),
      ).toThrow(SkillsPathEscapeError);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });

  it("generateSkillsForProject accepts .mandu/skills and writes there", () => {
    const proj = mkdtempSync(join(tmpdir(), "skills-gen-relmandu-"));
    try {
      writeFileSync(join(proj, "package.json"), JSON.stringify({ name: "relproj" }));
      const res = generateSkillsForProject({
        repoRoot: proj,
        outDir: ".mandu/skills",
        regenerate: true,
      });
      const firstPath = res.files[0]?.path;
      expect(firstPath).toBeDefined();
      expect(firstPath!.includes(join(".mandu", "skills"))).toBe(true);
      expect(firstPath!.startsWith(proj)).toBe(true);
    } finally {
      rmSync(proj, { recursive: true, force: true });
    }
  });
});

