import { describe, it, expect } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { createBuildSummaryRows, renderBuildSummaryTable } from "../../src/util/build-summary";
import type { BundleManifest, BundleOutput, RouteSpec } from "@mandujs/core";

describe("build summary helpers", () => {
  it("creates route and shared asset rows", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "mandu-build-summary-"));

    try {
      const clientDir = path.join(rootDir, ".mandu", "client");
      await fs.mkdir(clientDir, { recursive: true });
      await fs.writeFile(path.join(clientDir, "runtime.js"), "console.log('runtime');");
      await fs.writeFile(path.join(clientDir, "vendor.js"), "console.log('vendor');");
      await fs.writeFile(path.join(clientDir, "router.js"), "console.log('router');");

      const routes: RouteSpec[] = [
        {
          id: "home",
          pattern: "/",
          module: "app/page.tsx",
          componentModule: "app/page.tsx",
          clientModule: "app/home.island.tsx",
          kind: "page",
          hydration: {
            strategy: "island",
            priority: "visible",
            preload: false,
          },
        },
      ];

      const outputs: BundleOutput[] = [
        {
          routeId: "home",
          entrypoint: "app/home.island.tsx",
          outputPath: "/.mandu/client/home.island.js",
          size: 12_288,
          gzipSize: 4_096,
        },
      ];

      const manifest: BundleManifest = {
        version: 1,
        buildTime: new Date().toISOString(),
        env: "production",
        bundles: {
          home: {
            js: "/.mandu/client/home.island.js",
            dependencies: ["_runtime", "_react"],
            priority: "visible",
          },
        },
        shared: {
          runtime: "/.mandu/client/runtime.js",
          vendor: "/.mandu/client/vendor.js",
          router: "/.mandu/client/router.js",
        },
        importMap: {
          imports: {},
        },
      };

      const rows = await createBuildSummaryRows(rootDir, routes, outputs, manifest);
      expect(rows.some((row) => row.bundle === "/")).toBe(true);
      expect(rows.some((row) => row.bundle === "runtime.js")).toBe(true);
      expect(rows.some((row) => row.bundle === "vendor.js")).toBe(true);
      expect(rows.some((row) => row.bundle === "router.js")).toBe(true);

      const table = renderBuildSummaryTable(rows, 420);
      expect(table).toContain("Bundle");
      expect(table).toContain("Total");
      expect(table).toContain("420ms");
      expect(table).toContain("mandu preview");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
