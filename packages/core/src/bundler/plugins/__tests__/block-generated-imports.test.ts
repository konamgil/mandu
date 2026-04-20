/**
 * Regression tests for `mandu:block-generated-imports` (issue #207).
 *
 * Split into two sections:
 *   A — pure unit tests on `ForbiddenGeneratedImportError` + helpers.
 *   B — integration tests driving a real `Bun.build` with a synthetic
 *       `__generated__/` import in a tmpdir, asserting the build fails
 *       with the expected error text.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import {
  ForbiddenGeneratedImportError,
  blockGeneratedImports,
  defaultAllowImporter,
  DEFAULT_BLOCK_FILTER,
  defaultBundlerPlugins,
} from "../index";
import { GENERATED_IMPORT_DOCS_URL } from "../../../guard/check";

// ────────────────────────────────────────────────────────────────────
// Section A — unit
// ────────────────────────────────────────────────────────────────────

describe("ForbiddenGeneratedImportError", () => {
  test("captures specifier and importer fields", () => {
    const err = new ForbiddenGeneratedImportError(
      "./__generated__/routes",
      "/repo/src/app.ts",
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ForbiddenGeneratedImportError);
    expect(err.specifier).toBe("./__generated__/routes");
    expect(err.importer).toBe("/repo/src/app.ts");
    expect(err.docsUrl).toBe(GENERATED_IMPORT_DOCS_URL);
    expect(err.name).toBe("ForbiddenGeneratedImportError");
  });

  test("message includes specifier, importer, docs URL, and getGenerated() hint", () => {
    const err = new ForbiddenGeneratedImportError(
      "./__generated__/data",
      "/repo/src/page.tsx",
    );
    expect(err.message).toContain("./__generated__/data");
    expect(err.message).toContain("/repo/src/page.tsx");
    expect(err.message).toContain(GENERATED_IMPORT_DOCS_URL);
    expect(err.message).toContain("getGenerated");
    expect(err.message).toContain('@mandujs/core/runtime');
  });

  test("message falls back to <unknown> importer when empty", () => {
    const err = new ForbiddenGeneratedImportError("./__generated__/x", "");
    expect(err.message).toContain("<unknown>");
  });
});

describe("defaultAllowImporter", () => {
  test("exempts packages/core/src/runtime/** paths", () => {
    expect(
      defaultAllowImporter("/repo/packages/core/src/runtime/registry.ts"),
    ).toBe(true);
  });

  test("normalises Windows backslashes", () => {
    expect(
      defaultAllowImporter(
        "C:\\repo\\packages\\core\\src\\runtime\\registry.ts",
      ),
    ).toBe(true);
  });

  test("does NOT exempt regular user code", () => {
    expect(defaultAllowImporter("/repo/src/app.ts")).toBe(false);
    expect(defaultAllowImporter("")).toBe(false);
  });
});

describe("DEFAULT_BLOCK_FILTER", () => {
  test("matches __generated__ specifiers", () => {
    expect("./__generated__/foo").toMatch(DEFAULT_BLOCK_FILTER);
    expect("../../src/__generated__/routes").toMatch(DEFAULT_BLOCK_FILTER);
  });
  test("does NOT match look-alikes without double underscores", () => {
    expect("./generated/foo".match(DEFAULT_BLOCK_FILTER)).toBeNull();
    expect("./src/generate/foo".match(DEFAULT_BLOCK_FILTER)).toBeNull();
  });
});

describe("defaultBundlerPlugins", () => {
  test("installs block-generated-imports by default", () => {
    const plugins = defaultBundlerPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("mandu:block-generated-imports");
  });

  test("respects opt-out via guard.blockGeneratedImport === false", () => {
    const plugins = defaultBundlerPlugins({
      config: { guard: { blockGeneratedImport: false } },
    });
    expect(plugins).toHaveLength(0);
  });

  test("treats undefined as default-on", () => {
    const plugins = defaultBundlerPlugins({ config: { guard: {} } });
    expect(plugins).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// Section B — integration against real Bun.build
// ────────────────────────────────────────────────────────────────────

/**
 * Integration tests invoke real `Bun.build`. On shards where the
 * Windows `onResolve` panic is flaky, set `MANDU_SKIP_BUNDLER_TESTS=1`
 * to skip — matches the convention used by `fast-refresh.test.ts`.
 */
const SKIP_BUNDLER = process.env.MANDU_SKIP_BUNDLER_TESTS === "1";

describe.skipIf(SKIP_BUNDLER)("blockGeneratedImports — Bun.build integration", () => {
  let tmpRoot: string;

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), "mandu-block-gen-"));
  });

  afterAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  test("Bun.build fails when source imports a __generated__ file", async () => {
    const dir = path.join(tmpRoot, "scenario-block");
    await mkdir(path.join(dir, "__generated__"), { recursive: true });
    await writeFile(
      path.join(dir, "__generated__/data.ts"),
      "export const routes = [];\n",
    );
    await writeFile(
      path.join(dir, "entry.ts"),
      `import { routes } from "./__generated__/data";\nconsole.log(routes);\n`,
    );

    // Bun's plugin host surfaces a thrown onResolve error either as an
    // exception from `Bun.build(...)` OR as an unsuccessful result whose
    // logs contain the message. Accept either shape so the assertion is
    // robust across Bun patch releases.
    // Bun's plugin host surfaces a thrown onResolve error via multiple
    // channels across patch releases: an exception from `Bun.build()`
    // (with `AggregateError.errors[]` on recent versions), or an
    // unsuccessful `result.logs[]`. Collect from every channel and assert
    // the aggregated text.
    const collected: string[] = [];
    try {
      const result = await Bun.build({
        entrypoints: [path.join(dir, "entry.ts")],
        outdir: path.join(dir, "out"),
        target: "browser",
        plugins: [blockGeneratedImports()],
      });
      expect(result.success).toBe(false);
      for (const log of result.logs) {
        collected.push(String(log?.message ?? log));
      }
    } catch (err) {
      if (err instanceof Error) collected.push(err.message);
      const maybeAgg = err as { errors?: unknown[] };
      if (Array.isArray(maybeAgg.errors)) {
        for (const inner of maybeAgg.errors) {
          if (inner instanceof Error) collected.push(inner.message);
          else collected.push(String(inner));
        }
      }
    }

    const message = collected.join("\n");
    expect(message).toContain("__generated__");
    expect(message).toContain(GENERATED_IMPORT_DOCS_URL);
    expect(message).toContain("getGenerated");
  });

  test("Bun.build succeeds when opt-out is set (no plugin installed)", async () => {
    const dir = path.join(tmpRoot, "scenario-optout");
    await mkdir(path.join(dir, "__generated__"), { recursive: true });
    await writeFile(
      path.join(dir, "__generated__/data.ts"),
      "export const routes = [];\n",
    );
    await writeFile(
      path.join(dir, "entry.ts"),
      `import { routes } from "./__generated__/data";\nconsole.log(routes);\n`,
    );

    // Simulate the opt-out path: defaultBundlerPlugins with the flag off
    // returns an empty plugin list, so the build has nothing to reject it.
    const plugins = defaultBundlerPlugins({
      config: { guard: { blockGeneratedImport: false } },
    });

    const result = await Bun.build({
      entrypoints: [path.join(dir, "entry.ts")],
      outdir: path.join(dir, "out"),
      target: "browser",
      plugins,
    });

    expect(result.success).toBe(true);
  });

  test("Bun.build succeeds when source has no __generated__ imports", async () => {
    const dir = path.join(tmpRoot, "scenario-clean");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "clean.ts"),
      `export const value = 42;\n`,
    );
    await writeFile(
      path.join(dir, "entry.ts"),
      `import { value } from "./clean";\nconsole.log(value);\n`,
    );

    const result = await Bun.build({
      entrypoints: [path.join(dir, "entry.ts")],
      outdir: path.join(dir, "out"),
      target: "browser",
      plugins: [blockGeneratedImports()],
    });

    expect(result.success).toBe(true);
  });

  test("allowImporter lets whitelisted files import __generated__", async () => {
    const dir = path.join(tmpRoot, "scenario-allow");
    const runtimeDir = path.join(dir, "packages/core/src/runtime");
    await mkdir(path.join(dir, "__generated__"), { recursive: true });
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      path.join(dir, "__generated__/data.ts"),
      "export const routes = [];\n",
    );
    // Use a relative import so the filter can see `__generated__` in the
    // specifier and invoke our hook — at which point the importer path
    // matches the default allow-list.
    await writeFile(
      path.join(runtimeDir, "registry.ts"),
      `import { routes } from "../../../../__generated__/data";\nexport { routes };\n`,
    );

    const result = await Bun.build({
      entrypoints: [path.join(runtimeDir, "registry.ts")],
      outdir: path.join(dir, "out"),
      target: "browser",
      plugins: [blockGeneratedImports()],
    });

    // The allow predicate lets the import fall through to Bun's default
    // resolution, which succeeds because the file exists.
    expect(result.success).toBe(true);
  });
});
