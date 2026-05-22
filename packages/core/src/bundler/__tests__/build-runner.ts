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
 *       "manifest": {
 *         shared: {
 *           runtime?: string;
 *           vendor?: string;
 *           router?: string;
 *           fastRefresh?: { runtime: string; glue: string };
 *         };
 *         bundles: Record<string, unknown>;
 *       }
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
import { mkdir } from "fs/promises";
import path from "path";
import { generateManifest } from "../../router/fs-routes";

const rootDir = process.argv[2];
if (!rootDir) {
  console.error("usage: build-runner.ts <rootDir>");
  process.exit(2);
}
const mode = process.argv[3] ?? "default";

const manifest: RoutesManifest = mode === "client-boundary-generated-transitive"
  ? (await generateManifest(rootDir)).manifest
  : mode === "server-page-client-module"
  ? {
      version: 1,
      routes: [
        {
          id: "index",
          kind: "page",
          pattern: "/",
          module: "app/page.tsx",
          componentModule: "app/page.tsx",
          clientModule: "app/page.tsx",
          hydration: {
            strategy: "island",
            priority: "visible",
            preload: false,
          },
        },
      ],
    }
  : mode === "server-page-route-client-import"
    || mode === "server-page-route-named-client-import"
    ? {
        version: 1,
        routes: [
          {
            id: "login",
            kind: "page",
            pattern: "/login",
            module: "app/login/page.tsx",
            componentModule: "app/login/page.tsx",
            clientModule: "app/login/page.tsx",
            hydration: {
              strategy: "island",
              priority: "visible",
              preload: false,
            },
          },
        ],
      }
  : mode === "hydration-no-client-module"
    ? {
        version: 1,
        routes: [
          {
            id: "login",
            kind: "page",
            pattern: "/login",
            module: "app/login/page.tsx",
            componentModule: "app/login/page.tsx",
            hydration: {
              strategy: "full",
              priority: "immediate",
              preload: false,
            },
          },
        ],
      }
  : mode === "client-boundary"
    || mode === "client-boundary-target"
    || mode === "client-boundary-skip-framework"
    || mode === "client-boundary-duplicate-id"
    ? {
        version: 1,
        routes: [
          {
            id: "boundary-demo",
            kind: "page",
            pattern: "/boundary",
            module: "app/boundary/page.tsx",
            componentModule: "app/boundary/page.tsx",
            hydration: {
              strategy: "island",
              priority: "visible",
              preload: false,
            },
            boundaries: [
              {
                id: "boundary-demo--0",
                routeId: "boundary-demo",
                module: "src/client/BoundaryWidget.client.tsx",
                importSpecifier: "@/client/BoundaryWidget.client",
                exportName: "BoundaryWidget",
                localName: "BoundaryWidget",
                hydrate: "visible",
                ordinal: 0,
                propsSource: "inline",
                propsKeys: ["label"],
                hasSpreadProps: false,
                source: {
                  file: "app/boundary/page.tsx",
                  line: 5,
                  column: 12,
                },
              },
            ],
          },
          ...(mode === "client-boundary-duplicate-id"
            ? [
                {
                  id: "boundary-copy",
                  kind: "page" as const,
                  pattern: "/boundary-copy",
                  module: "app/boundary/page.tsx",
                  componentModule: "app/boundary/page.tsx",
                  hydration: {
                    strategy: "island" as const,
                    priority: "visible" as const,
                    preload: false,
                  },
                  boundaries: [
                    {
                      id: "boundary-demo--0",
                      routeId: "boundary-copy",
                      module: "src/client/BoundaryWidget.client.tsx",
                      importSpecifier: "@/client/BoundaryWidget.client",
                      exportName: "BoundaryWidget",
                      localName: "BoundaryWidget",
                      hydrate: "visible" as const,
                      ordinal: 0,
                      propsSource: "inline" as const,
                      propsKeys: ["label"],
                      hasSpreadProps: false,
                      source: {
                        file: "app/boundary/page.tsx",
                        line: 8,
                        column: 12,
                      },
                    },
                  ],
                },
              ]
            : []),
        ],
      }
  : mode === "i18n-locale-route-id"
    ? {
        version: 1,
        routes: [
          {
            id: "ko::demo",
            kind: "page",
            pattern: "/ko",
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
      }
    : {
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
  if (mode === "client-boundary-target" || mode === "client-boundary-skip-framework") {
    await mkdir(path.join(rootDir, ".mandu"), { recursive: true });
    await Bun.write(
      path.join(rootDir, ".mandu", "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          buildTime: "2026-05-23T00:00:00.000Z",
          env: "development",
          bundles: {},
          shared: {
            runtime: "/.mandu/client/_runtime.js",
            vendor: "/.mandu/client/_react.js",
            router: "/.mandu/client/_router.js",
          },
        },
        null,
        2,
      ),
    );
  }

  const result = await buildClientBundles(manifest, rootDir, {
    minify: false,
    sourcemap: false,
    splitting: false,
    ...(mode === "client-boundary-target" ? { targetRouteIds: ["boundary-demo"] } : {}),
    ...(mode === "client-boundary-skip-framework" ? { skipFrameworkBundles: true } : {}),
  });
  process.stdout.write(
    JSON.stringify({
      success: result.success,
      errors: result.errors,
      manifest: {
        routes: manifest.routes.map((route) => ({
          id: route.id,
          module: route.module,
          componentModule: route.componentModule,
          boundaries: route.kind === "page" ? route.boundaries ?? [] : [],
        })),
        shared: {
          runtime: result.manifest.shared?.runtime ?? null,
          vendor: result.manifest.shared?.vendor ?? null,
          router: result.manifest.shared?.router ?? null,
          fastRefresh: result.manifest.shared?.fastRefresh ?? null,
        },
        bundles: result.manifest.bundles ?? {},
        boundaries: result.manifest.boundaries ?? {},
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
