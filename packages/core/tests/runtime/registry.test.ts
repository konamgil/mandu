/**
 * Runtime registry tests — fix #200.
 *
 * Verifies:
 * 1. `getGenerated()` throws a helpful error before `registerManifest()` fires
 * 2. Seeding the registry makes `getGenerated()`, `getManifest()`, and
 *    `getRouteById()` return the expected shape
 * 3. The guard rule `INVALID_GENERATED_IMPORT` still fires for direct
 *    `__generated__/` imports AND its message now points at the docs URL
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  getGenerated,
  tryGetGenerated,
  getManifest,
  getRouteById,
  registerManifest,
  clearGeneratedRegistry,
} from "../../src/runtime/registry";
import { checkInvalidGeneratedImport } from "../../src/guard/check";
import type { RoutesManifest } from "../../src/spec/schema";
import fs from "fs/promises";
import path from "path";
import os from "os";

// ═══════════════════════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════════════════════

const fixtureManifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "home",
      pattern: "/",
      kind: "page",
      module: ".mandu/generated/web/routes/home.route.ts",
      componentModule: ".mandu/generated/web/routes/home.route.tsx",
    },
    {
      id: "users-list",
      pattern: "/api/users",
      kind: "api",
      module: ".mandu/generated/server/routes/users-list.route.ts",
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// Registry API
// ═══════════════════════════════════════════════════════════════════════════

describe("runtime registry", () => {
  beforeEach(() => {
    clearGeneratedRegistry();
  });

  afterEach(() => {
    clearGeneratedRegistry();
  });

  describe("before registration", () => {
    test("getGenerated throws a helpful error with docs URL", () => {
      expect(() => getGenerated("routes")).toThrow(
        /Generated artifact "routes" not registered/,
      );
      expect(() => getGenerated("routes")).toThrow(
        /registerManifestHandlers\(\)/,
      );
      expect(() => getGenerated("routes")).toThrow(
        /mandujs\.com\/docs\/architect\/generated-access/,
      );
    });

    test("getManifest throws with the same clear message", () => {
      expect(() => getManifest()).toThrow(/not registered/);
    });

    test("tryGetGenerated returns undefined without throwing", () => {
      expect(tryGetGenerated("routes")).toBeUndefined();
    });

    test("getRouteById returns undefined without throwing", () => {
      expect(getRouteById("home")).toBeUndefined();
    });
  });

  describe("after registration", () => {
    beforeEach(() => {
      registerManifest("routes", fixtureManifest);
    });

    test("getGenerated returns the registered manifest", () => {
      const routes = getGenerated("routes");
      expect(routes).toBe(fixtureManifest);
      expect(routes.routes).toHaveLength(2);
    });

    test("getManifest returns the same shape as getGenerated('routes')", () => {
      expect(getManifest()).toBe(fixtureManifest);
    });

    test("getRouteById finds an existing route", () => {
      const route = getRouteById("home");
      expect(route).toBeDefined();
      expect(route!.pattern).toBe("/");
      expect(route!.kind).toBe("page");
    });

    test("getRouteById returns undefined for an unknown id", () => {
      expect(getRouteById("does-not-exist")).toBeUndefined();
    });

    test("tryGetGenerated returns the manifest without throwing", () => {
      expect(tryGetGenerated("routes")).toBe(fixtureManifest);
    });
  });

  describe("clearGeneratedRegistry", () => {
    test("resets the global slot so getGenerated throws again", () => {
      registerManifest("routes", fixtureManifest);
      expect(getGenerated("routes")).toBe(fixtureManifest);

      clearGeneratedRegistry();

      expect(() => getGenerated("routes")).toThrow(/not registered/);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard regression — #200 message improvement
// ═══════════════════════════════════════════════════════════════════════════

describe("guard INVALID_GENERATED_IMPORT (fix #200)", () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-guard-200-"));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  test("still fires when app/ code imports from __generated__/", async () => {
    const appDir = path.join(tmpRoot, "app");
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(
      path.join(appDir, "bad.ts"),
      `import { routes } from "../.mandu/generated/routes.manifest";\nexport default routes;\n`,
    );

    const violations = await checkInvalidGeneratedImport(tmpRoot);

    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!.ruleId).toBe("INVALID_GENERATED_IMPORT");
  });

  test("message points at the docs URL so users know where to go", async () => {
    const srcDir = path.join(tmpRoot, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, "bad.ts"),
      `import manifest from "../.mandu/generated/manifest";\nexport default manifest;\n`,
    );

    const violations = await checkInvalidGeneratedImport(tmpRoot);

    expect(violations).toHaveLength(1);
    const violation = violations[0]!;
    expect(violation.message).toContain(
      "https://mandujs.com/docs/architect/generated-access",
    );
    expect(violation.message).toContain("forbidden");
    expect(violation.suggestion).toContain("getGenerated");
  });

  test("no false positives when code does NOT import from generated/", async () => {
    const srcDir = path.join(tmpRoot, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, "ok.ts"),
      `import { getGenerated } from "@mandujs/core/runtime";\nexport const routes = getGenerated("routes");\n`,
    );

    const violations = await checkInvalidGeneratedImport(tmpRoot);
    expect(violations).toHaveLength(0);
  });

  test("allows package-local generated build modules", async () => {
    const srcDir = path.join(tmpRoot, "packages", "cli", "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, "init.ts"),
      `import { templates } from "../../generated/cli-ux-manifest.js";\nexport default templates;\n`,
    );

    const violations = await checkInvalidGeneratedImport(tmpRoot);
    expect(violations).toHaveLength(0);
  });

  test("ignores generated import examples inside fixture strings", async () => {
    const srcDir = path.join(tmpRoot, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, "fixture.ts"),
      "export const source = `import routes from '../.mandu/generated/routes.manifest'`;\n",
    );

    const violations = await checkInvalidGeneratedImport(tmpRoot);
    expect(violations).toHaveLength(0);
  });
});
