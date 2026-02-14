import { beforeEach, afterEach, describe, test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import {
  initSelectorMap,
  readSelectorMap,
  writeSelectorMap,
  addSelectorEntry,
  getSelectorEntry,
  removeSelectorEntry,
  generateAlternatives,
  buildPlaywrightLocatorChain,
  type SelectorMap,
  type SelectorMapEntry,
} from "../src/selector-map";

describe("selector-map", () => {
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

  describe("initSelectorMap", () => {
    test("creates empty selector map with schema version 1", () => {
      const map = initSelectorMap();
      expect(map.schemaVersion).toBe(1);
      expect(map.entries).toEqual([]);
      expect(map.generatedAt).toBeDefined();
    });
  });

  describe("writeSelectorMap and readSelectorMap", () => {
    test("writes and reads selector map from .mandu directory", () => {
      const map: SelectorMap = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        entries: [
          {
            manduId: "login-btn",
            file: "Login.tsx",
            element: "button",
            primary: { type: "mandu-id", value: "login-btn", priority: 0 },
            alternatives: [],
          },
        ],
      };

      writeSelectorMap(testRoot, map);
      const read = readSelectorMap(testRoot);

      expect(read).not.toBeNull();
      expect(read?.schemaVersion).toBe(1);
      expect(read?.entries).toHaveLength(1);
      expect(read?.entries[0].manduId).toBe("login-btn");
    });

    test("returns null when selector-map.json does not exist", () => {
      const read = readSelectorMap(testRoot);
      expect(read).toBeNull();
    });
  });

  describe("addSelectorEntry", () => {
    test("adds new selector entry to map", () => {
      let map = initSelectorMap();
      const entry: Omit<SelectorMapEntry, "alternatives"> = {
        manduId: "submit-btn",
        file: "Form.tsx",
        element: "button",
        primary: { type: "mandu-id", value: "submit-btn", priority: 0 },
      };

      map = addSelectorEntry(map, entry);
      expect(map.entries).toHaveLength(1);
      expect(map.entries[0].manduId).toBe("submit-btn");
    });

    test("updates existing selector entry with same manduId", () => {
      let map = initSelectorMap();
      const entry1: Omit<SelectorMapEntry, "alternatives"> = {
        manduId: "nav-link",
        file: "Nav.tsx",
        element: "a",
        primary: { type: "mandu-id", value: "nav-link", priority: 0 },
      };

      map = addSelectorEntry(map, entry1);
      expect(map.entries).toHaveLength(1);

      const entry2: Omit<SelectorMapEntry, "alternatives"> = {
        manduId: "nav-link",
        file: "Nav.tsx",
        element: "a",
        primary: { type: "text", value: ":has-text('Home')", priority: 1 },
      };

      map = addSelectorEntry(map, entry2);
      expect(map.entries).toHaveLength(1);
      expect(map.entries[0].primary.type).toBe("text");
    });

    test("adds alternatives when provided", () => {
      let map = initSelectorMap();
      const alternatives = generateAlternatives({
        manduId: "login-btn",
        element: "button",
        text: "Login",
        className: "btn-primary",
      });

      const entry: Omit<SelectorMapEntry, "alternatives"> & { alternatives: typeof alternatives } = {
        manduId: "login-btn",
        file: "Login.tsx",
        element: "button",
        primary: { type: "mandu-id", value: "login-btn", priority: 0 },
        alternatives,
      };

      map = addSelectorEntry(map, entry);
      expect(map.entries[0].alternatives.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("getSelectorEntry", () => {
    test("retrieves selector entry by manduId", () => {
      let map = initSelectorMap();
      const entry: Omit<SelectorMapEntry, "alternatives"> = {
        manduId: "search-input",
        file: "Search.tsx",
        element: "input",
        primary: { type: "mandu-id", value: "search-input", priority: 0 },
      };

      map = addSelectorEntry(map, entry);
      const found = getSelectorEntry(map, "search-input");

      expect(found).toBeDefined();
      expect(found?.manduId).toBe("search-input");
      expect(found?.element).toBe("input");
    });

    test("returns undefined for non-existent manduId", () => {
      const map = initSelectorMap();
      const found = getSelectorEntry(map, "non-existent");
      expect(found).toBeUndefined();
    });
  });

  describe("removeSelectorEntry", () => {
    test("removes selector entry by manduId", () => {
      let map = initSelectorMap();
      const entry: Omit<SelectorMapEntry, "alternatives"> = {
        manduId: "delete-me",
        file: "Test.tsx",
        element: "button",
        primary: { type: "mandu-id", value: "delete-me", priority: 0 },
      };

      map = addSelectorEntry(map, entry);
      expect(map.entries).toHaveLength(1);

      map = removeSelectorEntry(map, "delete-me");
      expect(map.entries).toHaveLength(0);
    });

    test("does not fail when removing non-existent entry", () => {
      let map = initSelectorMap();
      map = removeSelectorEntry(map, "non-existent");
      expect(map.entries).toHaveLength(0);
    });
  });

  describe("generateAlternatives", () => {
    test("generates text-based alternative when text is provided", () => {
      const alternatives = generateAlternatives({
        manduId: "login-btn",
        element: "button",
        text: "Sign In",
      });

      const textAlt = alternatives.find((a) => a.type === "text");
      expect(textAlt).toBeDefined();
      expect(textAlt?.value).toContain("Sign In");
      expect(textAlt?.priority).toBe(1);
    });

    test("generates class-based alternative when className is provided", () => {
      const alternatives = generateAlternatives({
        manduId: "login-btn",
        element: "button",
        className: "btn-primary",
      });

      const classAlt = alternatives.find((a) => a.type === "class");
      expect(classAlt).toBeDefined();
      expect(classAlt?.value).toBe(".btn-primary");
      expect(classAlt?.priority).toBe(2);
    });

    test("generates role-based alternative when ariaRole is provided", () => {
      const alternatives = generateAlternatives({
        manduId: "login-btn",
        element: "button",
        ariaRole: "button",
      });

      const roleAlt = alternatives.find((a) => a.type === "role");
      expect(roleAlt).toBeDefined();
      expect(roleAlt?.value).toBe("role=button");
      expect(roleAlt?.priority).toBe(3);
    });

    test("always generates xpath fallback", () => {
      const alternatives = generateAlternatives({
        manduId: "login-btn",
        element: "button",
      });

      const xpathAlt = alternatives.find((a) => a.type === "xpath");
      expect(xpathAlt).toBeDefined();
      expect(xpathAlt?.value).toContain("//button");
      expect(xpathAlt?.value).toContain('data-mandu-id="login-btn"');
      expect(xpathAlt?.priority).toBe(4);
    });

    test("generates at least 3 alternatives with all options provided", () => {
      const alternatives = generateAlternatives({
        manduId: "login-btn",
        element: "button",
        text: "Login",
        className: "btn-primary",
        ariaRole: "button",
      });

      expect(alternatives.length).toBeGreaterThanOrEqual(3);
    });

    test("sorts alternatives by priority", () => {
      const alternatives = generateAlternatives({
        manduId: "login-btn",
        element: "button",
        text: "Login",
        className: "btn-primary",
        ariaRole: "button",
      });

      for (let i = 0; i < alternatives.length - 1; i++) {
        expect(alternatives[i].priority).toBeLessThanOrEqual(alternatives[i + 1].priority);
      }
    });
  });

  describe("buildPlaywrightLocatorChain", () => {
    test("returns only primary locator when no alternatives", () => {
      const entry: SelectorMapEntry = {
        manduId: "login-btn",
        file: "Login.tsx",
        element: "button",
        primary: { type: "mandu-id", value: "login-btn", priority: 0 },
        alternatives: [],
      };

      const chain = buildPlaywrightLocatorChain(entry);
      expect(chain).toBe('page.locator(\'[data-mandu-id="login-btn"]\')');
    });

    test("builds .or() chain with text alternative", () => {
      const entry: SelectorMapEntry = {
        manduId: "login-btn",
        file: "Login.tsx",
        element: "button",
        primary: { type: "mandu-id", value: "login-btn", priority: 0 },
        alternatives: [{ type: "text", value: ':has-text("Login")', priority: 1 }],
      };

      const chain = buildPlaywrightLocatorChain(entry);
      expect(chain).toContain('page.locator(\'[data-mandu-id="login-btn"]\')');
      expect(chain).toContain('.or(');
      expect(chain).toContain('button:has-text("Login")');
    });

    test("builds .or() chain with multiple alternatives", () => {
      const alternatives = generateAlternatives({
        manduId: "login-btn",
        element: "button",
        text: "Login",
        className: "btn-primary",
      });

      const entry: SelectorMapEntry = {
        manduId: "login-btn",
        file: "Login.tsx",
        element: "button",
        primary: { type: "mandu-id", value: "login-btn", priority: 0 },
        alternatives,
      };

      const chain = buildPlaywrightLocatorChain(entry);
      expect(chain).toContain('page.locator(\'[data-mandu-id="login-btn"]\')');
      expect(chain).toContain('.or(');
      expect(chain.match(/\.or\(/g)?.length).toBeGreaterThanOrEqual(2);
    });

    test("handles role-based alternative correctly", () => {
      const entry: SelectorMapEntry = {
        manduId: "login-btn",
        file: "Login.tsx",
        element: "button",
        primary: { type: "mandu-id", value: "login-btn", priority: 0 },
        alternatives: [{ type: "role", value: "role=button", priority: 3 }],
      };

      const chain = buildPlaywrightLocatorChain(entry);
      expect(chain).toContain("page.getByRole('button')");
    });

    test("handles xpath alternative correctly", () => {
      const entry: SelectorMapEntry = {
        manduId: "login-btn",
        file: "Login.tsx",
        element: "button",
        primary: { type: "mandu-id", value: "login-btn", priority: 0 },
        alternatives: [
          { type: "xpath", value: '//button[@data-mandu-id="login-btn"]', priority: 4 },
        ],
      };

      const chain = buildPlaywrightLocatorChain(entry);
      expect(chain).toContain("page.locator('xpath=//button");
    });
  });

  describe("integration: full workflow", () => {
    test("creates map, adds entries, writes, reads, and builds locator chains", () => {
      // Initialize
      let map = initSelectorMap();

      // Add first entry with alternatives
      const alternatives1 = generateAlternatives({
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
        alternatives: alternatives1,
      });

      // Add second entry
      const alternatives2 = generateAlternatives({
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
        alternatives: alternatives2,
      });

      // Write to disk
      writeSelectorMap(testRoot, map);

      // Read back
      const readMap = readSelectorMap(testRoot);
      expect(readMap).not.toBeNull();
      expect(readMap?.entries).toHaveLength(2);

      // Build locator chains
      const entry1 = getSelectorEntry(readMap!, "login-btn");
      expect(entry1).toBeDefined();
      const chain1 = buildPlaywrightLocatorChain(entry1!);
      expect(chain1).toContain('page.locator(\'[data-mandu-id="login-btn"]\')');
      expect(chain1).toContain('.or(');

      const entry2 = getSelectorEntry(readMap!, "search-input");
      expect(entry2).toBeDefined();
      const chain2 = buildPlaywrightLocatorChain(entry2!);
      expect(chain2).toContain('page.locator(\'[data-mandu-id="search-input"]\')');
      expect(chain2).toContain('.or(');
    });
  });
});
