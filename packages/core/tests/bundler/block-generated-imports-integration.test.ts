/**
 * Issue #207 — End-to-end: exercise `safeBuild` (the wrapper every Mandu
 * bundler call-site goes through) with the default-installed
 * block-generated-imports plugin and assert that a direct
 * `__generated__/` import fails the build with the expected error text.
 *
 * This mirrors the user experience of `mandu build` / `mandu dev`: the
 * plugin is composed via `defaultBundlerPlugins()` and fed straight to
 * Bun.build through `safeBuild()`. No other bundler wiring is touched.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { safeBuild } from "../../src/bundler/safe-build";
import {
  defaultBundlerPlugins,
} from "../../src/bundler/plugins";
import { GENERATED_IMPORT_DOCS_URL } from "../../src/guard/check";

const SKIP_BUNDLER = process.env.MANDU_SKIP_BUNDLER_TESTS === "1";

describe.skipIf(SKIP_BUNDLER)(
  "safeBuild + defaultBundlerPlugins — #207 end-to-end",
  () => {
    let tmpRoot: string;

    beforeAll(async () => {
      tmpRoot = await mkdtemp(path.join(tmpdir(), "mandu-207-"));
    });

    afterAll(async () => {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    });

    test("direct __generated__ import -> safeBuild returns unsuccessful result with actionable log", async () => {
      const dir = path.join(tmpRoot, "forbidden");
      await mkdir(path.join(dir, "__generated__"), { recursive: true });
      await writeFile(
        path.join(dir, "__generated__/routes.ts"),
        "export const routes = [{ id: 'home' }];\n",
      );
      await writeFile(
        path.join(dir, "page.ts"),
        `import { routes } from "./__generated__/routes";\nexport default routes;\n`,
      );

      const collected: string[] = [];
      try {
        const result = await safeBuild({
          entrypoints: [path.join(dir, "page.ts")],
          outdir: path.join(dir, "out"),
          target: "browser",
          plugins: defaultBundlerPlugins(),
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
            collected.push(inner instanceof Error ? inner.message : String(inner));
          }
        }
      }

      const log = collected.join("\n");
      // Single authoritative error surface — must match what the static
      // Guard rule emits, via the shared message helper.
      expect(log).toMatch(/Direct __generated__\/ imports are forbidden/);
      expect(log).toContain(GENERATED_IMPORT_DOCS_URL);
      // Actionable remediation hint reaches the user.
      expect(log).toContain("getGenerated");
    });

    test("opt-out via config.guard.blockGeneratedImport=false lets the build pass", async () => {
      const dir = path.join(tmpRoot, "optout");
      await mkdir(path.join(dir, "__generated__"), { recursive: true });
      await writeFile(
        path.join(dir, "__generated__/routes.ts"),
        "export const routes = [];\n",
      );
      await writeFile(
        path.join(dir, "page.ts"),
        `import { routes } from "./__generated__/routes";\nexport default routes;\n`,
      );

      const plugins = defaultBundlerPlugins({
        config: { guard: { blockGeneratedImport: false } },
      });

      const result = await safeBuild({
        entrypoints: [path.join(dir, "page.ts")],
        outdir: path.join(dir, "out"),
        target: "browser",
        plugins,
      });

      expect(result.success).toBe(true);
    });

    test("clean source (no __generated__ import) builds successfully with default plugins", async () => {
      const dir = path.join(tmpRoot, "clean");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "lib.ts"),
        "export const answer = 42;\n",
      );
      await writeFile(
        path.join(dir, "entry.ts"),
        `import { answer } from "./lib";\nexport default answer;\n`,
      );

      const result = await safeBuild({
        entrypoints: [path.join(dir, "entry.ts")],
        outdir: path.join(dir, "out"),
        target: "browser",
        plugins: defaultBundlerPlugins(),
      });

      expect(result.success).toBe(true);
    });
  },
);
