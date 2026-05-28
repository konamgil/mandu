import { describe, expect, test } from "bun:test";
import {
  classifyPackageDrift,
  normalizePackageMetadata,
  type PackageJson,
} from "./check-npm-drift";

describe("check-npm-drift metadata comparison", () => {
  test("normalizes workspace dependency specs before comparing published metadata", () => {
    const local: PackageJson = {
      name: "@mandujs/mcp",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./src/index.ts" },
      dependencies: {
        "@mandujs/core": "workspace:*",
      },
    };

    const published = {
      name: "@mandujs/mcp",
      version: "1.0.0",
      type: "module",
      exports: { ".": "./src/index.ts" },
      dependencies: {
        "@mandujs/core": "^2.0.0",
      },
    };

    const report = classifyPackageDrift(
      "packages/mcp",
      local,
      {
        latest: "1.0.0",
        versions: ["1.0.0"],
        manifestForLocalVersion: published,
      },
      new Map([["@mandujs/core", "2.0.0"]]),
    );

    expect(report.status).toBe("clean");
    expect(report.publishAction).toBe("skip");
    expect(report.metadataDiffs).toEqual([]);
  });

  test("blocks when the same version exists but package metadata differs", () => {
    const local: PackageJson = {
      name: "@mandujs/core",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": "./src/index.ts",
        "./new": "./src/new.ts",
      },
    };

    const published = {
      name: "@mandujs/core",
      version: "1.0.0",
      type: "module",
      exports: {
        ".": "./src/index.ts",
      },
    };

    const report = classifyPackageDrift("packages/core", local, {
      latest: "1.0.0",
      versions: ["1.0.0"],
      manifestForLocalVersion: published,
    });

    expect(report.status).toBe("metadata-drift");
    expect(report.publishAction).toBe("blocked");
    expect(report.metadataDiffs.map((diff) => diff.field)).toEqual(["exports"]);
  });

  test("marks unpublished higher local versions as ready to publish", () => {
    const local: PackageJson = {
      name: "@mandujs/core",
      version: "1.1.0",
    };

    const report = classifyPackageDrift("packages/core", local, {
      latest: "1.0.0",
      versions: ["1.0.0"],
      manifestForLocalVersion: null,
    });

    expect(report.status).toBe("ahead");
    expect(report.publishAction).toBe("publish");
  });

  test("only compares release metadata fields", () => {
    const normalized = normalizePackageMetadata({
      name: "@mandujs/core",
      version: "1.0.0",
      scripts: { test: "bun test" },
      dist: { tarball: "https://registry.example/pkg.tgz" },
      maintainers: [{ name: "registry-only" }],
    } as unknown as PackageJson);

    expect(Object.keys(normalized).sort()).toEqual(["name", "version"]);
  });
});
