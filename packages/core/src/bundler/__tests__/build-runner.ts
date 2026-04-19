#!/usr/bin/env bun
/**
 * Internal helper used by `build.test.ts` + `fast-refresh.test.ts` to run
 * `buildClientBundles` in an isolated `bun` subprocess.
 *
 * # Why this exists
 *
 * When the parent `bun test` process has loaded `react` or `react-dom`
 * (transitively through most test files that import from `src/testing/*`
 * or `src/runtime/*`), Bun 1.3.x's bundler resolver state interacts with
 * `buildClientBundles`' 7-parallel shim fan-out (runtime + router +
 * vendor[5] + devtools) to produce `AggregateError: Bundle failed` on
 * one or more shims. Which shim fails is non-deterministic per run;
 * retrying in-process does not recover because the state is sticky.
 * Running the build in a fresh `bun` subprocess has a clean module graph
 * and builds successfully on the first attempt.
 *
 * Reproducer (in-process): import `"react"` or `"./src/testing/server.ts"`
 * in ANY other test file that ships with `src/bundler/build.test.ts`, and
 * `bun test src/bundler/build.test.ts <that file>` fails ~100 %.
 *
 * # Contract
 *
 * - Invocation: `bun run src/bundler/__tests__/build-runner.ts <rootDir>`
 * - The caller must pre-create `rootDir` with:
 *     - `package.json` (any valid contents; shim cache keys walk up to
 *       find `node_modules/react`)
 *     - `app/demo.client.tsx` (the fixed manifest references this as an
 *       island client module)
 * - stdout: JSON blob terminated by `\n`:
 *     { "success": boolean,
 *       "errors": string[],
 *       "manifest": { shared: { fastRefresh?: { runtime: string; glue: string } } }
 *     }
 *   Only the fields tests consume are serialized; the in-memory manifest
 *   is also persisted at `<rootDir>/.mandu/manifest.json` by the build.
 * - exit code: 0 on successful build, 1 on failure (for scripting).
 *
 * # Lifetime
 *
 * Each test spawns, awaits, and discards the subprocess. The subprocess
 * does NOT reuse a vendor cache across runs — every fresh `rootDir` is a
 * clean tmpdir with no prior `.mandu/vendor-cache/`.
 */

import { buildClientBundles } from "../build";
import type { RoutesManifest } from "../../spec/schema";

const rootDir = process.argv[2];
if (!rootDir) {
  console.error("usage: build-runner.ts <rootDir>");
  process.exit(2);
}

const manifest: RoutesManifest = {
  version: 1,
  routes: [
    {
      id: "demo",
      kind: "page",
      pattern: "/",
      module: "app/page.tsx",
      componentModule: "app/page.tsx",
      clientModule: "app/demo.client.tsx",
      hydration: {
        strategy: "island",
        priority: "visible",
        preload: false,
      },
    },
  ],
};

try {
  const result = await buildClientBundles(manifest, rootDir, {
    minify: false,
    sourcemap: false,
    splitting: false,
  });
  process.stdout.write(
    JSON.stringify({
      success: result.success,
      errors: result.errors,
      manifest: {
        shared: {
          fastRefresh: result.manifest.shared?.fastRefresh ?? null,
        },
      },
    }) + "\n",
  );
  process.exit(result.success ? 0 : 1);
} catch (err) {
  process.stdout.write(
    JSON.stringify({
      success: false,
      errors: [String(err)],
      manifest: null,
    }) + "\n",
  );
  process.exit(1);
}
