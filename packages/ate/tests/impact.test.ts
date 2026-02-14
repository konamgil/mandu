import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDependencyGraph, findDependents, findDependencies, detectCircularDependencies } from "../src/dep-graph";
import type { DependencyGraph } from "../src/dep-graph";

let testDir: string;

beforeAll(() => {
  // Create temporary test directory
  testDir = mkdtempSync(join(tmpdir(), "ate-impact-test-"));
});

afterAll(() => {
  // Clean up
  if (testDir) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

function createTestProject(files: Record<string, string>): string {
  const projectDir = join(testDir, `project-${Date.now()}`);
  mkdirSync(projectDir, { recursive: true });

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = join(projectDir, filePath);
    const dir = join(fullPath, "..");
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content, "utf8");
  }

  return projectDir;
}

test("buildDependencyGraph: simple linear dependency chain", async () => {
  const projectDir = createTestProject({
    "a.ts": `import { b } from "./b";`,
    "b.ts": `import { c } from "./c";`,
    "c.ts": `export const c = 42;`,
  });

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "*.ts")],
  });

  expect(graph.files.size).toBe(3);

  // a.ts depends on b.ts
  const aDeps = graph.dependencies.get(join(projectDir, "a.ts").replace(/\\/g, "/"));
  expect(aDeps?.has(join(projectDir, "b.ts").replace(/\\/g, "/"))).toBe(true);

  // b.ts depends on c.ts
  const bDeps = graph.dependencies.get(join(projectDir, "b.ts").replace(/\\/g, "/"));
  expect(bDeps?.has(join(projectDir, "c.ts").replace(/\\/g, "/"))).toBe(true);

  // c.ts has no dependencies
  const cDeps = graph.dependencies.get(join(projectDir, "c.ts").replace(/\\/g, "/"));
  expect(cDeps?.size).toBe(0);
});

test("buildDependencyGraph: shared utility pattern", async () => {
  const projectDir = createTestProject({
    "shared/utils.ts": `export const formatDate = (d: Date) => d.toISOString();`,
    "routes/home/page.tsx": `import { formatDate } from "../../shared/utils";`,
    "routes/profile/page.tsx": `import { formatDate } from "../../shared/utils";`,
    "routes/settings/page.tsx": `import { formatDate } from "../../shared/utils";`,
  });

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "**/*.ts"), join(projectDir, "**/*.tsx")],
  });

  expect(graph.files.size).toBe(4);

  const utilsPath = join(projectDir, "shared/utils.ts").replace(/\\/g, "/");

  // All routes depend on utils
  const homeDeps = graph.dependencies.get(join(projectDir, "routes/home/page.tsx").replace(/\\/g, "/"));
  expect(homeDeps?.has(utilsPath)).toBe(true);

  const profileDeps = graph.dependencies.get(join(projectDir, "routes/profile/page.tsx").replace(/\\/g, "/"));
  expect(profileDeps?.has(utilsPath)).toBe(true);

  const settingsDeps = graph.dependencies.get(join(projectDir, "routes/settings/page.tsx").replace(/\\/g, "/"));
  expect(settingsDeps?.has(utilsPath)).toBe(true);

  // Utils has 3 dependents
  const utilsDependents = graph.dependents.get(utilsPath);
  expect(utilsDependents?.size).toBe(3);
});

test("findDependents: transitive dependency detection", async () => {
  const projectDir = createTestProject({
    "shared/utils.ts": `export const helper = () => 42;`,
    "lib/formatter.ts": `import { helper } from "../shared/utils";`,
    "routes/home/page.tsx": `import { formatter } from "../../lib/formatter";`,
  });

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "**/*.ts"), join(projectDir, "**/*.tsx")],
  });

  const utilsPath = join(projectDir, "shared/utils.ts").replace(/\\/g, "/");
  const affectedFiles = findDependents(graph, utilsPath);

  // Changing utils.ts should affect both formatter.ts and page.tsx
  expect(affectedFiles.size).toBe(2);
  expect(affectedFiles.has(join(projectDir, "lib/formatter.ts").replace(/\\/g, "/"))).toBe(true);
  expect(affectedFiles.has(join(projectDir, "routes/home/page.tsx").replace(/\\/g, "/"))).toBe(true);
});

test("findDependents: handles circular dependencies without infinite loop", async () => {
  const projectDir = createTestProject({
    "a.ts": `import { b } from "./b"; export const a = 1;`,
    "b.ts": `import { c } from "./c"; export const b = 2;`,
    "c.ts": `import { a } from "./a"; export const c = 3;`, // Circular: c → a → b → c
  });

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "*.ts")],
  });

  const aPath = join(projectDir, "a.ts").replace(/\\/g, "/");

  // Should not hang due to circular dependency
  const affectedFiles = findDependents(graph, aPath);

  // Should find b and c as dependents
  expect(affectedFiles.size).toBeGreaterThanOrEqual(1);
});

test("detectCircularDependencies: finds circular reference", async () => {
  const projectDir = createTestProject({
    "a.ts": `import { b } from "./b"; export const a = 1;`,
    "b.ts": `import { c } from "./c"; export const b = 2;`,
    "c.ts": `import { a } from "./a"; export const c = 3;`,
  });

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "*.ts")],
  });

  const cycles = detectCircularDependencies(graph);

  // Should detect the circular dependency
  expect(cycles.length).toBeGreaterThan(0);
});

test("findDependencies: forward dependency traversal", async () => {
  const projectDir = createTestProject({
    "a.ts": `import { b } from "./b"; import { c } from "./c";`,
    "b.ts": `import { d } from "./d";`,
    "c.ts": `export const c = 1;`,
    "d.ts": `export const d = 2;`,
  });

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "*.ts")],
  });

  const aPath = join(projectDir, "a.ts").replace(/\\/g, "/");
  const deps = findDependencies(graph, aPath);

  // a depends on b, c, and transitively d
  expect(deps.size).toBe(3);
  expect(deps.has(join(projectDir, "b.ts").replace(/\\/g, "/"))).toBe(true);
  expect(deps.has(join(projectDir, "c.ts").replace(/\\/g, "/"))).toBe(true);
  expect(deps.has(join(projectDir, "d.ts").replace(/\\/g, "/"))).toBe(true);
});

test("buildDependencyGraph: performance with 100 files", async () => {
  const files: Record<string, string> = {};

  // Create a chain of 100 files
  for (let i = 0; i < 100; i++) {
    if (i === 0) {
      files[`file-${i}.ts`] = `export const val${i} = ${i};`;
    } else {
      files[`file-${i}.ts`] = `import { val${i - 1} } from "./file-${i - 1}"; export const val${i} = ${i};`;
    }
  }

  const projectDir = createTestProject(files);

  const startTime = Date.now();

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "*.ts")],
  });

  const endTime = Date.now();
  const duration = endTime - startTime;

  expect(graph.files.size).toBe(100);

  // Performance: should complete in less than 5 seconds
  expect(duration).toBeLessThan(5000);
});

test("buildDependencyGraph: exclude patterns work correctly", async () => {
  const projectDir = createTestProject({
    "src/app.ts": `import { helper } from "./utils";\nexport const app = helper();`,
    "src/utils.ts": `export const helper = () => 42;`,
    "src/app.test.ts": `import { app } from "./app";\ntest("app", () => {});`,
    "src/utils.spec.ts": `import { helper } from "./utils";\ntest("helper", () => {});`,
  });

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "src/**/*.ts")],
    exclude: ["**/*.test.ts", "**/*.spec.ts"],
  });

  // Check file names - the important part is test files are excluded
  const fileNames = Array.from(graph.files).map((f) => f.split(/[\\/]/).pop());

  // Primary assertions: test files should be excluded
  expect(fileNames).not.toContain("app.test.ts");
  expect(fileNames).not.toContain("utils.spec.ts");

  // Production files should be included
  expect(fileNames).toContain("app.ts");
  expect(fileNames).toContain("utils.ts");

  // Count should be 2 (only app.ts and utils.ts)
  expect(graph.files.size).toBe(2);
});

test("buildDependencyGraph: handles export re-exports", async () => {
  const projectDir = createTestProject({
    "utils.ts": `export const helper = () => 42;`,
    "index.ts": `export { helper } from "./utils";`,
    "app.ts": `import { helper } from "./index";`,
  });

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "*.ts")],
  });

  const indexPath = join(projectDir, "index.ts").replace(/\\/g, "/");
  const utilsPath = join(projectDir, "utils.ts").replace(/\\/g, "/");

  // index.ts should depend on utils.ts
  const indexDeps = graph.dependencies.get(indexPath);
  expect(indexDeps?.has(utilsPath)).toBe(true);

  // app.ts should depend on index.ts
  const appPath = join(projectDir, "app.ts").replace(/\\/g, "/");
  const appDeps = graph.dependencies.get(appPath);
  expect(appDeps?.has(indexPath)).toBe(true);
});

test("findDependents: maxDepth option limits traversal", async () => {
  const projectDir = createTestProject({
    "a.ts": `export const a = 1;`,
    "b.ts": `import { a } from "./a";`,
    "c.ts": `import { b } from "./b";`,
    "d.ts": `import { c } from "./c";`,
  });

  const graph = await buildDependencyGraph({
    rootDir: projectDir,
    include: [join(projectDir, "*.ts")],
  });

  const aPath = join(projectDir, "a.ts").replace(/\\/g, "/");

  // maxDepth = 1: should only find b.ts
  const depth1 = findDependents(graph, aPath, { maxDepth: 1 });
  expect(depth1.size).toBe(1);

  // maxDepth = 2: should find b.ts and c.ts
  const depth2 = findDependents(graph, aPath, { maxDepth: 2 });
  expect(depth2.size).toBe(2);

  // No limit: should find all (b, c, d)
  const depthAll = findDependents(graph, aPath);
  expect(depthAll.size).toBe(3);
});
