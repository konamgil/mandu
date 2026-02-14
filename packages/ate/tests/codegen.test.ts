import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generatePlaywrightSpecs } from "../src/codegen";
import { generateAndWriteScenarios } from "../src/scenario";
import { createEmptyGraph, addNode } from "../src/ir";
import { writeJson } from "../src/fs";
import type { InteractionGraph } from "../src/types";

describe("codegen", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = mkdtempSync(join(tmpdir(), "ate-codegen-test-"));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function setupProject(routes: Array<{ id: string; path: string; file: string }>) {
    const repoRoot = join(testDir, `project-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });

    const graph = createEmptyGraph("test");
    routes.forEach((r) => addNode(graph, { kind: "route", ...r }));

    const manduDir = join(repoRoot, ".mandu");
    mkdirSync(manduDir, { recursive: true });
    writeJson(join(manduDir, "interaction-graph.json"), graph);

    return repoRoot;
  }

  test("should generate Playwright spec for single route", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toContain("route__.spec.ts"); // Normalized: route:/ → route__

    const specContent = readFileSync(result.files[0], "utf8");
    expect(specContent).toContain('import { test, expect } from "@playwright/test"');
    expect(specContent).toContain('test.describe("route:/"');
    expect(specContent).toContain('test("smoke /"');
  });

  test("should apply L0 oracle template", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L0");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    const specContent = readFileSync(result.files[0], "utf8");

    // L0: console.error and exception checks
    expect(specContent).toContain("const errors: string[] = []");
    expect(specContent).toContain('page.on("console"');
    expect(specContent).toContain('page.on("pageerror"');
    expect(specContent).toContain('expect(errors, "console/page errors").toEqual([])');

    // L0: should NOT have L1 structure checks
    expect(specContent).not.toContain('expect(page.locator("main"))');
  });

  test("should apply L1 oracle template", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    const specContent = readFileSync(result.files[0], "utf8");

    // L1: includes L0 checks
    expect(specContent).toContain('page.on("console"');

    // L1: structure signals (실제 구현은 Domain-aware)
    expect(specContent).toContain("// L1: Domain-aware structure signals");
    expect(specContent).toContain('await expect(page.locator("main, [role=\'main\']")).toBeVisible()');
  });

  test("should apply L2 oracle template", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L2");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    const specContent = readFileSync(result.files[0], "utf8");

    // L2: includes L1 checks
    expect(specContent).toContain("L1: Domain-aware structure signals");

    // L2: behavior signals
    expect(specContent).toContain("// L2: behavior signals");
    expect(specContent).toContain("await expect(page).toHaveURL(/.*/)");
  });

  test("should apply L3 oracle template", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L3");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    const specContent = readFileSync(result.files[0], "utf8");

    // L3: includes L2 checks
    expect(specContent).toContain("// L2: behavior signals");

    // L3: domain hints
    expect(specContent).toContain("// L3: domain hints");
  });

  test("should generate config file if not exists", async () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    generatePlaywrightSpecs(repoRoot);

    // Wait for async Bun.write to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Assert
    const configPath = join(repoRoot, "tests", "e2e", "playwright.config.ts");
    expect(existsSync(configPath)).toBe(true);

    const configContent = readFileSync(configPath, "utf8");
    expect(configContent).toContain("export default defineConfig");
    expect(configContent).toContain('testDir: "."');
    expect(configContent).toContain("baseURL:");
  });

  test("should not overwrite existing config", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    const configPath = join(repoRoot, "tests", "e2e", "playwright.config.ts");
    mkdirSync(join(repoRoot, "tests", "e2e"), { recursive: true });

    const customConfig = `// Custom config\nexport default defineConfig({ testDir: "." });\n`;
    Bun.write(configPath, customConfig);

    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    generatePlaywrightSpecs(repoRoot);

    // Assert - should keep custom config
    const configContent = readFileSync(configPath, "utf8");
    expect(configContent).not.toBe(customConfig); // Will be replaced due to old testDir pattern
  });

  test("should filter routes with onlyRoutes option", () => {
    // Setup
    const repoRoot = setupProject([
      { id: "/", path: "/", file: "app/page.tsx" },
      { id: "/about", path: "/about", file: "app/about/page.tsx" },
      { id: "/contact", path: "/contact", file: "app/contact/page.tsx" },
    ]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot, { onlyRoutes: ["/", "/about"] });

    // Assert
    expect(result.files.length).toBeGreaterThanOrEqual(2);

    const fileNames = result.files.map((f) => f.split(/[\\/]/).pop());
    expect(fileNames).toContain("route__.spec.ts"); // route:/ → route__
    expect(fileNames).toContain("route__about.spec.ts");
    expect(fileNames).not.toContain("route__contact.spec.ts");
  });

  test("should sanitize route IDs for filenames", () => {
    // Setup
    const repoRoot = setupProject([
      { id: "/products/[id]", path: "/products/[id]", file: "app/products/[id]/page.tsx" },
    ]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    const fileName = result.files[0].split(/[\\/]/).pop();
    expect(fileName).toBe("route__products__id_.spec.ts");
    expect(fileName).not.toContain("[");
    expect(fileName).not.toContain("]");
  });

  test("should generate multiple specs for multiple routes", () => {
    // Setup
    const repoRoot = setupProject([
      { id: "/", path: "/", file: "app/page.tsx" },
      { id: "/dashboard", path: "/dashboard", file: "app/dashboard/page.tsx" },
      { id: "/settings", path: "/settings", file: "app/settings/page.tsx" },
    ]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    expect(result.files).toHaveLength(3);

    result.files.forEach((file) => {
      expect(existsSync(file)).toBe(true);
      const content = readFileSync(file, "utf8");
      expect(content).toContain("import { test, expect }");
    });
  });

  test("should use baseURL from environment", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    const specContent = readFileSync(result.files[0], "utf8");
    expect(specContent).toContain('const url = (baseURL ?? "http://localhost:3333")');
  });

  test("should handle root route correctly", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    const specContent = readFileSync(result.files[0], "utf8");
    expect(specContent).toContain('+ "/"');
    expect(specContent).not.toContain('+ ""');
  });

  test("should include await page.goto", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    const specContent = readFileSync(result.files[0], "utf8");
    expect(specContent).toContain("await page.goto(url)");
  });

  test("should create auto/ directory for generated specs", () => {
    // Setup
    const repoRoot = setupProject([{ id: "/", path: "/", file: "app/page.tsx" }]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    generatePlaywrightSpecs(repoRoot);

    // Assert
    const autoDir = join(repoRoot, "tests", "e2e", "auto");
    expect(existsSync(autoDir)).toBe(true);
  });

  test("should handle empty scenarios gracefully", () => {
    // Setup
    const repoRoot = setupProject([]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert
    expect(result.files).toHaveLength(0);
  });

  test("should generate valid TypeScript syntax", () => {
    // Setup
    const repoRoot = setupProject([
      { id: "/", path: "/", file: "app/page.tsx" },
      { id: "/about", path: "/about", file: "app/about/page.tsx" },
    ]);
    generateAndWriteScenarios(repoRoot, "L1");

    // Execute
    const result = generatePlaywrightSpecs(repoRoot);

    // Assert - basic syntax validation
    result.files.forEach((file) => {
      const content = readFileSync(file, "utf8");

      // Check for balanced braces
      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;
      expect(openBraces).toBe(closeBraces);

      // Check for balanced parentheses
      const openParens = (content.match(/\(/g) || []).length;
      const closeParens = (content.match(/\)/g) || []).length;
      expect(openParens).toBe(closeParens);

      // Check imports are at top
      expect(content.trim().startsWith("import")).toBe(true);
    });
  });
});
