import { beforeEach, afterEach, describe, test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { generatePlaywrightSpecs } from "../src/codegen";
import { initSelectorMap, addSelectorEntry, writeSelectorMap, generateAlternatives } from "../src/selector-map";
import { writeJson } from "../src/fs";
import type { ScenarioBundle } from "../src/scenario";

describe("codegen selector integration", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(tmpdir(), `ate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test("generates specs without selector map", () => {
    // Create minimal scenario bundle
    const bundle: ScenarioBundle = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      oracleLevel: "L1",
      scenarios: [
        {
          id: "home",
          route: "/",
          oracleLevel: "L1",
          actions: [],
        },
      ],
    };

    const scenariosDir = join(testRoot, ".mandu", "scenarios");
    mkdirSync(scenariosDir, { recursive: true });
    writeJson(join(scenariosDir, "generated.json"), bundle);

    const result = generatePlaywrightSpecs(testRoot);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toContain("home.spec.ts");

    const specContent = readFileSync(result.files[0], "utf8");
    expect(specContent).toContain("import { test, expect }");
    expect(specContent).toContain("test.describe");
    expect(specContent).not.toContain("Example: Selector with fallback chain");
  });

  test("generates specs with selector map and includes fallback chain example", () => {
    // Create selector map
    let map = initSelectorMap();
    const alternatives = generateAlternatives({
      manduId: "login-btn",
      element: "button",
      text: "Login",
      className: "btn-primary",
    });

    map = addSelectorEntry(map, {
      manduId: "login-btn",
      file: "Login.tsx",
      element: "button",
      primary: { type: "mandu-id", value: "login-btn", priority: 0 },
      alternatives,
    });

    writeSelectorMap(testRoot, map);

    // Create scenario bundle
    const bundle: ScenarioBundle = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      oracleLevel: "L1",
      scenarios: [
        {
          id: "login",
          route: "/login",
          oracleLevel: "L1",
          actions: [],
        },
      ],
    };

    const scenariosDir = join(testRoot, ".mandu", "scenarios");
    mkdirSync(scenariosDir, { recursive: true });
    writeJson(join(scenariosDir, "generated.json"), bundle);

    const result = generatePlaywrightSpecs(testRoot);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toContain("login.spec.ts");

    const specContent = readFileSync(result.files[0], "utf8");
    expect(specContent).toContain("import { test, expect }");
    expect(specContent).toContain("test.describe");
    expect(specContent).toContain("Example: Selector with fallback chain");
    expect(specContent).toContain('page.locator(\'[data-mandu-id="login-btn"]\')');
    expect(specContent).toContain(".or(");
  });

  test("generates multiple specs with selector map", () => {
    // Create selector map with multiple entries
    let map = initSelectorMap();

    const alt1 = generateAlternatives({
      manduId: "nav-home",
      element: "a",
      text: "Home",
    });

    map = addSelectorEntry(map, {
      manduId: "nav-home",
      file: "Nav.tsx",
      element: "a",
      primary: { type: "mandu-id", value: "nav-home", priority: 0 },
      alternatives: alt1,
    });

    const alt2 = generateAlternatives({
      manduId: "search-input",
      element: "input",
      className: "search-box",
      ariaRole: "searchbox",
    });

    map = addSelectorEntry(map, {
      manduId: "search-input",
      file: "Search.tsx",
      element: "input",
      primary: { type: "mandu-id", value: "search-input", priority: 0 },
      alternatives: alt2,
    });

    writeSelectorMap(testRoot, map);

    // Create scenario bundle with multiple routes
    const bundle: ScenarioBundle = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      oracleLevel: "L1",
      scenarios: [
        { id: "home", route: "/", oracleLevel: "L1", actions: [] },
        { id: "about", route: "/about", oracleLevel: "L1", actions: [] },
        { id: "contact", route: "/contact", oracleLevel: "L1", actions: [] },
      ],
    };

    const scenariosDir = join(testRoot, ".mandu", "scenarios");
    mkdirSync(scenariosDir, { recursive: true });
    writeJson(join(scenariosDir, "generated.json"), bundle);

    const result = generatePlaywrightSpecs(testRoot);

    expect(result.files).toHaveLength(3);
    expect(result.files.some((f) => f.includes("home.spec.ts"))).toBe(true);
    expect(result.files.some((f) => f.includes("about.spec.ts"))).toBe(true);
    expect(result.files.some((f) => f.includes("contact.spec.ts"))).toBe(true);

    // Check that all specs include selector example
    for (const file of result.files) {
      const content = readFileSync(file, "utf8");
      expect(content).toContain("Example: Selector with fallback chain");
    }
  });

  test("filters routes when onlyRoutes is specified", () => {
    // Create selector map
    let map = initSelectorMap();
    const alternatives = generateAlternatives({
      manduId: "test-btn",
      element: "button",
      text: "Test",
    });

    map = addSelectorEntry(map, {
      manduId: "test-btn",
      file: "Test.tsx",
      element: "button",
      primary: { type: "mandu-id", value: "test-btn", priority: 0 },
      alternatives,
    });

    writeSelectorMap(testRoot, map);

    // Create scenario bundle with multiple routes
    const bundle: ScenarioBundle = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      oracleLevel: "L1",
      scenarios: [
        { id: "home", route: "/", oracleLevel: "L1", actions: [] },
        { id: "about", route: "/about", oracleLevel: "L1", actions: [] },
        { id: "contact", route: "/contact", oracleLevel: "L1", actions: [] },
      ],
    };

    const scenariosDir = join(testRoot, ".mandu", "scenarios");
    mkdirSync(scenariosDir, { recursive: true });
    writeJson(join(scenariosDir, "generated.json"), bundle);

    const result = generatePlaywrightSpecs(testRoot, { onlyRoutes: ["/about"] });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toContain("about.spec.ts");
  });
});
