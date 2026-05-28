import type * as __ManduPluginsReactCompilerTypes0 from "./plugins/react-compiler";
/**
 * Mandu Client Bundler 📦
 * Bun.build 기반 클라이언트 번들 빌드
 */

import type { RouteClientBoundary, RoutesManifest, RouteSpec } from "../spec/schema";
import { needsHydration, getRouteHydration } from "../spec/schema";
import type {
  BundleResult,
  BundleOutput,
  BundleManifest,
  BundleStats,
  BundlerOptions,
  IslandFileEntry,
  PartialFileEntry,
} from "./types";
import { HYDRATION } from "../constants";
import { safeBuild } from "./safe-build";
import { fastRefreshPlugin } from "./fast-refresh-plugin";
import { defaultBundlerPlugins } from "./plugins";
import type { BunPlugin } from "bun";
import { mark, measure } from "../perf";
import { HMR_PERF } from "../perf/hmr-markers";
import { runOnBundleComplete } from "../plugins/runner";
import {
  describeMissingHydrationClientModule,
  validateClientModuleForBrowserBundle,
} from "../router/client-entry";
import {
  readVendorCache,
  writeVendorCache,
  restoreVendorCache,
  resolveVendorCacheKeys,
  type VendorCacheKeyInput,
  type VendorCacheWriteEntry,
} from "./vendor-cache";
import path from "path";
import fs from "fs/promises";

interface BoundaryBundleBuild {
  id: string;
  route: string;
  js: string;
  module: string;
  exportName: string;
  priority: "immediate" | "visible" | "idle" | "interaction";
  hydrate: string;
  size: number;
  gzipSize: number;
}

/**
 * Resolve Mandu's default bundler plugin set from a `BundlerOptions`
 * object. Currently returns the `mandu:block-generated-imports` plugin
 * unless `options.blockGeneratedImport === false`. Centralised here so
 * every `safeBuild(...)` call-site can compose
 * `[...manduDefaultPlugins(options), ...buildLocalPlugins]` and stay in
 * sync as the default set grows.
 */
function manduDefaultPlugins(options: BundlerOptions): BunPlugin[] {
  const defaults = defaultBundlerPlugins({
    config: {
      guard: {
        blockGeneratedImport: options.blockGeneratedImport,
      },
    },
  });
  // Phase 18.τ — append consumer-supplied bundler plugins (from
  // `defineBundlerPlugin()` hook, resolved by the CLI or library caller).
  // Runs AFTER Mandu defaults so user transforms see already-resolved
  // imports / aliases.
  if (options.pluginBundlerPlugins && options.pluginBundlerPlugins.length > 0) {
    return [...defaults, ...options.pluginBundlerPlugins];
  }
  return defaults;
}

/**
 * Client-path plugin composition — defaults + (optionally) React
 * Compiler. Only the islands / `"use client"` / partial builds call
 * this; SSR builds use `manduDefaultPlugins()` directly because React
 * Compiler offers zero benefit for one-shot HTML rendering.
 */
function manduClientPlugins(options: BundlerOptions): BunPlugin[] {
  const base = manduDefaultPlugins(options);
  if (options.reactCompiler?.enabled !== true) return base;
  // Lazy import to avoid pulling the react-compiler module into every
  // build graph — SSR / non-client paths never touch this branch.
  const { reactCompiler } = require("./plugins/react-compiler") as typeof __ManduPluginsReactCompilerTypes0;
  return [
    ...base,
    reactCompiler({
      reactCompilerConfig: options.reactCompiler.compilerConfig,
    }),
  ];
}

function resolveBundlerMode(options: BundlerOptions): "development" | "production" {
  return options.mode ?? (process.env.NODE_ENV === "production" ? "production" : "development");
}

function isDevelopmentBuild(options: BundlerOptions): boolean {
  return resolveBundlerMode(options) === "development";
}

function shouldMinify(options: BundlerOptions): boolean {
  return options.minify ?? (resolveBundlerMode(options) === "production");
}

function shouldSplitChunks(options: BundlerOptions): boolean {
  return options.splitting ?? (resolveBundlerMode(options) === "production");
}

function nodeEnvDefine(options: BundlerOptions): string {
  return JSON.stringify(resolveBundlerMode(options));
}

const FAST_REFRESH_SELF_ALIAS_PATTERN =
  /^var\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*\1;\s*\r?\n(?=\$RefreshReg\$\(\1,\s*["'][^"']*:default["']\);)/gm;

function resolveClientOutDir(rootDir: string, outDir?: string): string {
  const defaultOutDir = path.join(rootDir, ".mandu/client");
  if (!outDir) return defaultOutDir;

  const resolvedOutDir = path.isAbsolute(outDir) ? outDir : path.resolve(rootDir, outDir);
  if (path.normalize(resolvedOutDir) === path.normalize(path.join(rootDir, ".mandu"))) {
    return defaultOutDir;
  }

  return resolvedOutDir;
}

/**
 * Scan for *.island.tsx / *.island.ts files across hydrated route directories.
 *
 * Phase 7.1 R1 Agent C — per-island conditional skip defence.
 *
 * Callers (the two `buildClientBundles` paths at L1643 and L1817) feed us
 * `hydratedRoutes` (from `getHydratedRoutes`), which already filters for
 * `route.kind === "page" && route.clientModule && needsHydration(route)`.
 * We re-assert the `needsHydration` predicate here for two reasons:
 *
 *   1. Defence-in-depth — if a future caller forgets the filter, we still
 *      skip routes with `hydration.strategy === "none"`. Each skipped route
 *      saves one `fs.readdir` + O(files) regex matches (~1-2 ms on Windows
 *      NTFS per skipped dir, per diagnostic R0.3).
 *
 *   2. Cold-start regression guard — the R0 → R3 F breakdown attributes
 *      +40-80 ms of cold start to per-island splitting (commit b503c36).
 *      The unit test `per-island-scan-skips-non-hydrated` pins this so a
 *      refactor cannot silently re-introduce the scan overhead for routes
 *      that opt out of hydration.
 */
async function scanIslandFiles(routes: RouteSpec[], rootDir: string): Promise<IslandFileEntry[]> {
  const entries: IslandFileEntry[] = [];
  const seenDirs = new Set<string>();

  // Sub-folders under a route directory that the scanner also descends into,
  // one level only. Convention-driven (not configurable) so the scan cost
  // stays predictable. `_components` is the Mandu equivalent of the widely
  // used Next.js "private folder" convention — leading underscore signals
  // "not a route", which is exactly the place users drop page-local island
  // sources. Keep this list short; every name adds one `readdir` per route.
  const ISLAND_SUBDIRS = ["_components", "_islands"] as const;

  const collectIslandsInDir = async (dir: string, routeId: string, priority: IslandFileEntry["priority"]) => {
    if (seenDirs.has(dir)) return;
    seenDirs.add(dir);
    let files: string[];
    try { files = await fs.readdir(dir); } catch { return; }
    for (const file of files) {
      if (/\.island\.tsx?$/.test(file)) {
        entries.push({
          name: file.replace(/\.island\.tsx?$/, ""),
          filePath: path.join(dir, file),
          routeId,
          priority,
        });
      }
    }
  };

  for (const route of routes) {
    // Defensive guard — see the block comment above for rationale. Without
    // this, a hypothetical caller passing `manifest.routes` directly would
    // readdir every page route, including pure-SSR ones.
    if (!needsHydration(route)) continue;

    const dir = path.dirname(path.join(rootDir, route.componentModule ?? route.module));
    const priority = getRouteHydration(route)?.priority || HYDRATION.DEFAULT_PRIORITY;

    await collectIslandsInDir(dir, route.id, priority);
    for (const sub of ISLAND_SUBDIRS) {
      await collectIslandsInDir(path.join(dir, sub), route.id, priority);
    }
  }
  return entries;
}

/**
 * Test-only accessor for the island-file scanner. Allows the cold-start
 * test suite (`__tests__/cold-start.test.ts`) to assert the per-island
 * conditional skip without having to spin up a full `buildClientBundles`
 * invocation (which would also run `safeBuild`).
 *
 * @internal
 */
export const _testOnly_scanIslandFiles = scanIslandFiles;

function normalizeClientEntryName(name: string): string {
  return name
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "") || "partial";
}

async function scanPartialFiles(rootDir: string): Promise<PartialFileEntry[]> {
  const entries: PartialFileEntry[] = [];
  const seen = new Set<string>();

  try {
    const glob = new Bun.Glob("**/*.partial.{ts,tsx}");
    for await (const rel of glob.scan({ cwd: rootDir, absolute: true })) {
      if (rel.includes(`${path.sep}node_modules${path.sep}`)) continue;
      if (rel.includes(`${path.sep}.mandu${path.sep}`)) continue;

      const filePath = path.resolve(rel);
      if (seen.has(filePath)) continue;
      seen.add(filePath);

      const base = path.basename(filePath).replace(/\.partial\.tsx?$/, "");
      entries.push({
        name: normalizeClientEntryName(base),
        filePath,
        priority: HYDRATION.DEFAULT_PRIORITY,
      });
    }
  } catch {
    // Bun.Glob unavailable or scan failed — a missing partial bundle should
    // not prevent route-level islands from building.
  }

  return entries.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

/** @internal test helper */
export const _testOnly_scanPartialFiles = scanPartialFiles;

/**
 * Test-only accessor for the hydrated-routes filter. Mirrors the rationale
 * above — lets tests verify that `getHydratedRoutes` really does drop
 * `hydration.strategy: "none"` routes without rebuilding its logic.
 *
 * @internal
 */
export const _testOnly_getHydratedRoutes = getHydratedRoutes;
export const _testOnly_getHydrationRoutesMissingClientModule =
  getHydrationRoutesMissingClientModule;

/**
 * Issue #240 Phase 2 — collect every file the React Compiler plugin
 * would touch during a client build. Used by `mandu check` to feed
 * `runReactCompilerLint` so developers see which components are
 * silently bailing out.
 *
 * Included:
 *   - `*.island.tsx` / `*.island.ts` under each hydrated route dir
 *     (+ `_components/` / `_islands/` siblings — matches
 *     `scanIslandFiles` exactly).
 *   - `route.clientModule` for every hydrated route (`"use client"`
 *     page entry).
 *   - `*.partial.ts` / `*.partial.tsx` anywhere under `rootDir`.
 *
 * Paths are absolute and deduplicated. Returns `[]` when the manifest
 * has no hydrated routes.
 */
export async function collectCompilerLintTargets(
  manifest: RoutesManifest,
  rootDir: string,
): Promise<string[]> {
  const hydratedRoutes = getHydratedRoutes(manifest);

  const out = new Set<string>();

  // 1) Islands (reuses the bundler's canonical scanner).
  if (hydratedRoutes.length > 0) {
    const islandFiles = await scanIslandFiles(hydratedRoutes, rootDir);
    for (const entry of islandFiles) {
      out.add(path.resolve(entry.filePath));
    }

    // 2) `"use client"` page modules — the hydrated-route filter
    //    already asserted `clientModule` exists.
    for (const route of hydratedRoutes) {
      const rel = route.clientModule ?? route.module;
      if (rel) out.add(path.resolve(rootDir, rel));
    }
  }

  // 3) Partials — glob the whole project once. Partials live anywhere
  //    the user chooses, they're not sibling-scoped like islands.
  for (const entry of await scanPartialFiles(rootDir)) {
    out.add(path.resolve(entry.filePath));
  }

  return Array.from(out).sort();
}

/** Build a single per-island bundle. */
async function buildPerIslandBundle(
  entry: IslandFileEntry, outDir: string, options: BundlerOptions
): Promise<{ name: string; js: string; route: string; priority: IslandFileEntry["priority"] }> {
  const entryPath = path.join(outDir, `_entry_island_${entry.name}.js`);
  const outputName = `${entry.name}.island.js`;
  // Phase 7.1 B-1/B-4: wire Bun's native React Fast Refresh transform +
  // Mandu's boundary injection plugin — but only in dev. Production
  // bundles stay clean of `$RefreshReg$` / `$RefreshSig$` stubs.
  const isDev = isDevelopmentBuild(options);
  try {
    await Bun.write(entryPath, generateIslandEntry(entry.name, entry.filePath));
    const result = await safeBuild({
      entrypoints: [entryPath],
      outdir: outDir,
      naming: outputName,
      minify: shouldMinify(options),
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      ...(isDev ? { reactFastRefresh: true } : {}),
      plugins: [...manduClientPlugins(options), ...(isDev ? [fastRefreshPlugin()] : [])],
      external: ["react", "react-dom", "react-dom/client", ...(options.external || [])],
      define: { "process.env.NODE_ENV": nodeEnvDefine(options), ...options.define },
    });
    await fs.unlink(entryPath).catch(() => {});
    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      throw new Error(`Island build failed for '${entry.name}' (source: ${entry.filePath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types in this island file.`);
    }
    await sanitizeGeneratedClientBundle(path.join(outDir, outputName), isDev);
    return { name: entry.name, js: `/.mandu/client/${outputName}`, route: entry.routeId, priority: entry.priority };
  } catch (error) {
    await fs.unlink(entryPath).catch(() => {});
    throw error;
  }
}

interface PartialBundleBuild {
  name: string;
  js: string;
  priority: PartialFileEntry["priority"];
  size: number;
  gzipSize: number;
}

/** Build a single inline partial bundle. */
async function buildPartialBundle(
  entry: PartialFileEntry,
  outDir: string,
  options: BundlerOptions,
): Promise<PartialBundleBuild> {
  const entryPath = path.join(outDir, `_entry_partial_${entry.name}.js`);
  const outputName = `${entry.name}.partial.js`;
  const isDev = isDevelopmentBuild(options);

  try {
    await Bun.write(entryPath, generatePartialEntry(entry.name, entry.filePath));
    const result = await safeBuild({
      entrypoints: [entryPath],
      outdir: outDir,
      naming: outputName,
      minify: shouldMinify(options),
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      ...(isDev ? { reactFastRefresh: true } : {}),
      plugins: [...manduClientPlugins(options), ...(isDev ? [fastRefreshPlugin()] : [])],
      external: ["react", "react-dom", "react-dom/client", ...(options.external || [])],
      define: { "process.env.NODE_ENV": nodeEnvDefine(options), ...options.define },
    });
    await fs.unlink(entryPath).catch(() => {});

    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      throw new Error(`Partial build failed for '${entry.name}' (source: ${entry.filePath}):\n${grouped}\n  Hint: Export a Mandu partial from this file with \`partial({ component })\`.`);
    }

    const outputPath = path.join(outDir, outputName);
    const sanitizedContent = await sanitizeGeneratedClientBundle(outputPath, isDev);
    const outputFile = Bun.file(outputPath);
    const gzipped = Bun.gzipSync(Buffer.from(sanitizedContent));

    return {
      name: entry.name,
      js: `/.mandu/client/${outputName}`,
      priority: entry.priority,
      size: outputFile.size,
      gzipSize: gzipped.length,
    };
  } catch (error) {
    await fs.unlink(entryPath).catch(() => {});
    throw error;
  }
}

/**
 * 빈 매니페스트 생성
 */
function createEmptyManifest(env: "development" | "production"): BundleManifest {
  return {
    version: 1,
    buildTime: new Date().toISOString(),
    env,
    bundles: {},
    shared: {
      runtime: "",
      vendor: "",
    },
    importMap: {
      imports: {},
    },
  };
}

/**
 * Hydration이 필요한 라우트 필터링
 */
function getHydratedRoutes(manifest: RoutesManifest): RouteSpec[] {
  return manifest.routes.filter(
    (route) =>
      route.kind === "page" &&
      (!!route.clientModule || !!route.boundaries?.length) &&
      needsHydration(route)
  );
}

function getHydrationRoutesMissingClientModule(manifest: RoutesManifest): RouteSpec[] {
  return manifest.routes.filter(
    (route) =>
      route.kind === "page" &&
      !route.clientModule &&
      !route.boundaries?.length &&
      needsHydration(route)
  );
}

const REACT_SHIM_EXPORTS = [
  "Activity",
  "Children",
  "Component",
  "Fragment",
  "Profiler",
  "PureComponent",
  "StrictMode",
  "Suspense",
  "__COMPILER_RUNTIME",
  "act",
  "cache",
  "cacheSignal",
  "captureOwnerStack",
  "cloneElement",
  "createContext",
  "createElement",
  "createRef",
  "forwardRef",
  "isValidElement",
  "lazy",
  "memo",
  "startTransition",
  "unstable_useCacheRefresh",
  "use",
  "useActionState",
  "useCallback",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useEffect",
  "useEffectEvent",
  "useId",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
  "useOptimistic",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
  "version",
] as const;

const REACT_DOM_SHIM_EXPORTS = [
  "createPortal",
  "flushSync",
  "preconnect",
  "prefetchDNS",
  "preinit",
  "preinitModule",
  "preload",
  "preloadModule",
  "requestFormReset",
  "unstable_batchedUpdates",
  "useFormState",
  "useFormStatus",
  "version",
] as const;

const REACT_DOM_CLIENT_SHIM_EXPORTS = [
  "createRoot",
  "hydrateRoot",
  "version",
] as const;

function formatShimBindings(names: readonly string[], indent = "  "): string {
  return names.map((name) => `${indent}${name},`).join("\n");
}

/**
 * Runtime bundle entry point.
 *
 * The browser runtime lives in client/runtime-entry.ts so it is typechecked
 * with the rest of core and imports the shared props deserializer directly.
 */
function getRuntimeEntryPath(): string {
  return path.resolve(import.meta.dir, "..", "client", "runtime-entry.ts");
}
/**
 * React shim 소스 생성 (import map용)
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateReactShimSource(): string {
  return `
/**
 * Mandu React Shim (Generated)
 * import map을 통해 bare specifier 해결
 */
import React, {
${formatShimBindings(REACT_SHIM_EXPORTS)}
} from 'react';

// JSX Runtime functions (JSX 변환에 필요)
import { jsx, jsxs } from 'react/jsx-runtime';
import { jsxDEV } from 'react/jsx-dev-runtime';

// React internals (ReactDOM이 내부적으로 접근 필요)
// React 19+: __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
// React <=18: __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
const __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE =
  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE || {};
const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED =
  React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED || {};

// Null safety for Playwright headless browsers (React 19)
if (__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.S == null) {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.S = function () {};
}

// 전역 React 설정 (모든 모듈에서 동일 인스턴스 공유)
if (typeof window !== 'undefined') {
  window.React = React;
  window.__MANDU_REACT__ = React;
}

// Named exports
export {
${formatShimBindings(REACT_SHIM_EXPORTS)}
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
  // JSX Runtime exports
  jsx,
  jsxs,
  jsxDEV,
};

// Default export
export default React;
`;
}

/**
 * React DOM shim 소스 생성
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateReactDOMShimSource(): string {
  return `
/**
 * Mandu React DOM Shim (Generated)
 */
import ReactDOM, {
${formatShimBindings(REACT_DOM_SHIM_EXPORTS)}
} from 'react-dom';

// Named exports
export {
${formatShimBindings(REACT_DOM_SHIM_EXPORTS)}
};

// Default export
export default ReactDOM;
`;
}

/**
 * React DOM Client shim 소스 생성
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateReactDOMClientShimSource(): string {
  return `
/**
 * Mandu React DOM Client Shim (Generated)
 */
import { 
${formatShimBindings(REACT_DOM_CLIENT_SHIM_EXPORTS)}
} from 'react-dom/client';

// Named exports (명시적으로 re-export)
export { 
${formatShimBindings(REACT_DOM_CLIENT_SHIM_EXPORTS)}
};

// Default export
export default { 
${formatShimBindings(REACT_DOM_CLIENT_SHIM_EXPORTS)}
};
`;
}

/**
 * JSX Runtime shim 소스 생성
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateJsxRuntimeShimSource(): string {
  return `
/**
 * Mandu JSX Runtime Shim (Generated)
 * Production JSX 변환용
 *
 * #323: import map의 'react/jsx-runtime'이 다시 이 셰임을 가리키므로
 * 'react/jsx-runtime'에서 import하면 순환 self-import가 된다. 대신
 * 'react'(→ _react.js, external 없이 react 전체를 인라인하며 jsx/jsxs/
 * Fragment를 re-export하는 vendor 번들)에서 가져와 순환을 끊는다.
 */
import { jsx, jsxs, Fragment } from 'react';

// Named exports
export { jsx, jsxs, Fragment };

// Default export
export default { jsx, jsxs, Fragment };
`;
}

/**
 * JSX Dev Runtime shim 소스 생성
 * 주의: export *는 Bun bundler에서 제대로 작동하지 않으므로 명시적 export 필요
 */
function generateJsxDevRuntimeShimSource(): string {
  return `
/**
 * Mandu JSX Dev Runtime Shim (Generated)
 * Development JSX 변환용
 *
 * #323: import map의 'react/jsx-dev-runtime'이 다시 이 셰임을 가리키므로
 * 'react/jsx-dev-runtime'에서 import하면 순환 self-import가 된다. 대신
 * 'react'(→ _react.js, react 전체를 인라인하는 vendor 번들)에서 가져온다.
 *
 * #323 재발(0.54.30): jsxDEV는 React의 **dev 전용** export다. _react.js가
 * production NODE_ENV로 번들되면 'react/jsx-dev-runtime'이 production 변형으로
 * 해소되어 jsxDEV 값이 undefined가 된다(jsx/jsxs는 둘 다 존재). 그 결과 dev
 * island가 'jsxDEV is not a function'으로 전멸했다. _react.js가 어떤 NODE_ENV로
 * 빌드되든 안전하도록, jsxDEV가 함수가 아니면 jsx/jsxs로 폴백한다(dev 경고만
 * 잃고 렌더는 정상). isStaticChildren일 때는 jsxs로 라우팅한다.
 */
import { jsx, jsxs, jsxDEV as __manduReactJsxDEV, Fragment } from 'react';

const jsxDEV =
  typeof __manduReactJsxDEV === 'function'
    ? __manduReactJsxDEV
    : function jsxDEV(type, config, key, isStaticChildren) {
        return (isStaticChildren ? jsxs : jsx)(type, config, key);
      };

// Named exports
export { jsxDEV, Fragment };

// Default export
export default { jsxDEV, Fragment };
`;
}

/**
 * Test-only access to the JSX runtime shim generators so tests can assert
 * that jsx/jsxDEV/Fragment are sourced from the correct React subpaths
 * (regression guard for #322: jsxDEV must come from 'react/jsx-dev-runtime',
 * never from bare 'react' which does not export it).
 *
 * @internal
 */
export const _testOnly_generateJsxRuntimeShimSource = generateJsxRuntimeShimSource;
/** @internal */
export const _testOnly_generateJsxDevRuntimeShimSource = generateJsxDevRuntimeShimSource;

/**
 * Client-side Router 런타임 소스 생성
 */
function generateRouterRuntimeSource(): string {
  return `
/**
 * Mandu Client Router Runtime (Generated)
 * Client-side Routing을 위한 런타임
 * 전역 상태를 사용하여 모든 모듈에서 동일 인스턴스 공유
 */

// 전역 상태 초기화 (Island와 공유)
(function initGlobalState() {
  if (window.__MANDU_ROUTER_STATE__) return;
  var route = window.__MANDU_ROUTE__;
  window.__MANDU_ROUTER_STATE__ = {
    currentRoute: route ? {
      id: route.id,
      pattern: route.pattern,
      params: route.params || {}
    } : null,
    loaderData: window.__MANDU_DATA__ && window.__MANDU_DATA__[route && route.id] ? window.__MANDU_DATA__[route.id].serverData : undefined,
    navigation: { state: 'idle' }
  };
  window.__MANDU_ROUTER_LISTENERS__ = window.__MANDU_ROUTER_LISTENERS__ || new Set();
})();

function getGlobalState() {
  return window.__MANDU_ROUTER_STATE__;
}

function setGlobalState(state) {
  window.__MANDU_ROUTER_STATE__ = state;
}

function getListeners() {
  return window.__MANDU_ROUTER_LISTENERS__;
}

// 패턴 매칭 캐시 (Phase 17 — bounded LRU, inlined to keep the runtime
// bundle self-contained. Same semantics as packages/core/src/utils/lru-cache.ts
// but hand-written here so the client-side shim has no server imports.)
var PATTERN_CACHE_MAX = 200;
var patternCache = new Map();

function patternCacheGet(key) {
  if (!patternCache.has(key)) return undefined;
  var value = patternCache.get(key);
  // Promote to MRU.
  patternCache.delete(key);
  patternCache.set(key, value);
  return value;
}

function patternCacheSet(key, value) {
  if (patternCache.has(key)) {
    patternCache.delete(key);
  } else if (patternCache.size >= PATTERN_CACHE_MAX) {
    var oldest = patternCache.keys().next().value;
    if (oldest !== undefined) patternCache.delete(oldest);
  }
  patternCache.set(key, value);
}

function compilePattern(pattern) {
  var cached = patternCacheGet(pattern);
  if (cached) return cached;

  const paramNames = [];
  const normalized = pattern === '/' ? '/' : pattern.replace(/\\/+$/, '') || '/';
  const segments = normalized.split('/').filter(Boolean);
  const regexStr = segments.length === 0
    ? '/'
    : segments.map((segment) => {
        if (segment === '*') return '/.+';
        const wildcardMatch = segment.match(/^:([a-zA-Z_][a-zA-Z0-9_]*)\\*(\\?)?$/);
        if (wildcardMatch) {
          paramNames.push(wildcardMatch[1]);
          return wildcardMatch[2] === '?' ? '(?:/(.*))?' : '/(.+)';
        }
        const paramMatch = segment.match(/^:([a-zA-Z_][a-zA-Z0-9_]*)$/);
        if (paramMatch) {
          paramNames.push(paramMatch[1]);
          return '/([^/]+)';
        }
        return '/' + segment.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
      }).join('');

  const compiled = { regex: new RegExp('^' + regexStr + '$'), paramNames };
  patternCacheSet(pattern, compiled);
  return compiled;
}

function extractParams(pattern, pathname) {
  const compiled = compilePattern(pattern);
  const match = pathname.match(compiled.regex);
  if (!match) return {};

  const params = {};
  compiled.paramNames.forEach((name, i) => { params[name] = match[i + 1] || ''; });
  return params;
}

function notifyListeners() {
  const state = getGlobalState();
  getListeners().forEach(fn => { try { fn(state); } catch(e) {} });
}

export function subscribe(listener) {
  getListeners().add(listener);
  return () => getListeners().delete(listener);
}

export function getRouterState() {
  return getGlobalState();
}

export async function navigate(to, options = {}) {
  const { replace = false, scroll = true } = options;

  try {
    const url = new URL(to, location.origin);
    if (url.origin !== location.origin) {
      location.href = to;
      return;
    }

    // 로딩 상태로 전환
    const state = getGlobalState();
    setGlobalState({ ...state, navigation: { state: 'loading', location: to } });
    notifyListeners();

    const dataUrl = url.pathname + (url.search ? url.search + '&' : '?') + '_data=1';
    const res = await fetch(dataUrl);

    if (!res.ok) {
      location.href = to;
      return;
    }

    const data = await res.json();

    if (replace) {
      history.replaceState({ routeId: data.routeId }, '', to);
    } else {
      history.pushState({ routeId: data.routeId }, '', to);
    }

    // 전역 상태 업데이트
    setGlobalState({
      currentRoute: { id: data.routeId, pattern: data.pattern, params: data.params },
      loaderData: data.loaderData,
      navigation: { state: 'idle' }
    });

    window.__MANDU_DATA__ = window.__MANDU_DATA__ || {};
    window.__MANDU_DATA__[data.routeId] = { serverData: data.loaderData };

    notifyListeners();

    if (scroll) window.scrollTo(0, 0);
  } catch (err) {
    console.error('[Mandu Router] Error:', err);
    location.href = to;
  }
}

// Link 클릭 핸들러
function handleClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;

  const anchor = e.target.closest('a[data-mandu-link]');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  try {
    const url = new URL(href, location.origin);
    if (url.origin !== location.origin) return;
  } catch { return; }

  e.preventDefault();
  navigate(href);
}

// Popstate 핸들러
function handlePopState(e) {
  if (e.state?.routeId) {
    navigate(location.pathname + location.search, { replace: true, scroll: false });
  }
}

// 초기화
function init() {
  var state = getGlobalState();
  if (state.currentRoute) {
    state.currentRoute.params = extractParams(state.currentRoute.pattern, location.pathname);
    setGlobalState(state);
  }

  window.addEventListener('popstate', handlePopState);
  document.addEventListener('click', handleClick);
  console.log('[Mandu Router] Initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
`;
}

/**
 * DevTools 번들 빌드 (개발 모드 전용)
 * devtools/init.ts를 브라우저용 번들로 컴파일하여 _devtools.js 생성
 */
async function buildDevtoolsBundle(
  outDir: string,
  options: BundlerOptions
): Promise<{ success: boolean; outputPath: string; errors: string[] }> {
  const srcPath = path.join(outDir, "_devtools.src.js");
  const outputName = "_devtools.js";

  // devtools/init.ts의 절대 경로 (build.ts → ../devtools/init.ts)
  const devtoolsInitPath = path.resolve(
    import.meta.dir, '..', 'devtools', 'init.ts'
  ).replace(/\\/g, '/');

  const source = `
import { initManduKitchen } from "${devtoolsInitPath}";
if (typeof window !== 'undefined') {
  window.__MANDU_DEV_TOOLS__ = true;
  initManduKitchen({ position: 'bottom-right' });
}
`;

  try {
    await Bun.write(srcPath, source);

    const result = await safeBuild({
      entrypoints: [srcPath],
      outdir: outDir,
      naming: outputName,
      minify: false, // dev only
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      plugins: manduDefaultPlugins(options),
      // React를 인라인 번들링 (import map 없이도 독립 동작)
      // DevTools는 Shadow DOM 격리 → 앱 React와 충돌 없음
      define: {
        "process.env.NODE_ENV": JSON.stringify("development"),
        ...options.define,
      },
    });

    await fs.unlink(srcPath).catch(() => {});

    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      return {
        success: false,
        outputPath: "",
        errors: [`DevTools client build failed (source: ${srcPath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types.`],
      };
    }

    return {
      success: true,
      outputPath: `/.mandu/client/${outputName}`,
      errors: [],
    };
  } catch (error) {
    await fs.unlink(srcPath).catch(() => {});
    return {
      success: false,
      outputPath: "",
      errors: [`DevTools client build threw an exception (source: ${srcPath}): ${String(error)}`],
    };
  }
}

/**
 * Router 런타임 번들 빌드
 */
async function buildRouterRuntime(
  outDir: string,
  options: BundlerOptions
): Promise<{ success: boolean; outputPath: string; errors: string[] }> {
  const routerPath = path.join(outDir, "_router.src.js");
  const outputName = "_router.js";

  try {
    await Bun.write(routerPath, generateRouterRuntimeSource());

    const result = await safeBuild({
      entrypoints: [routerPath],
      outdir: outDir,
      naming: outputName,
      minify: shouldMinify(options),
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      plugins: manduDefaultPlugins(options),
      define: {
        "process.env.NODE_ENV": nodeEnvDefine(options),
        ...options.define,
      },
    });

    await fs.unlink(routerPath).catch(() => {});

    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      return {
        success: false,
        outputPath: "",
        errors: [`Router runtime build failed (source: ${routerPath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types.`],
      };
    }

    return {
      success: true,
      outputPath: `/.mandu/client/${outputName}`,
      errors: [],
    };
  } catch (error) {
    await fs.unlink(routerPath).catch(() => {});
    return {
      success: false,
      outputPath: "",
      errors: [`Router runtime build threw an exception (source: ${routerPath}): ${String(error)}`],
    };
  }
}

/**
 * Island 엔트리 래퍼 생성 (v0.8.0 재설계)
 *
 * 설계 원칙:
 * - 순수 export만 (부작용 없음)
 * - Runtime이 dynamic import로 로드
 * - 등록/초기화 코드 없음
 */
function generateIslandEntry(routeId: string, clientModulePath: string, exportName?: string): string {
  // Windows 경로의 백슬래시를 슬래시로 변환 (JS escape 문제 방지)
  const normalizedPath = clientModulePath.replace(/\\/g, "/");
  const normalizedExportName = exportName && exportName !== "default" ? exportName : undefined;
  const namedExport = normalizedExportName && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(normalizedExportName)
    ? `export const ${normalizedExportName} = exportedIsland;`
    : "";
  const candidates = [
    normalizedExportName,
    inferClientExportNameFromPath(clientModulePath),
    inferClientExportNameFromRouteId(routeId),
  ].filter((candidate, index, values): candidate is string =>
    !!candidate && values.indexOf(candidate) === index
  );
  const importSpecifier = JSON.stringify(normalizedPath);
  const routeLabel = JSON.stringify(routeId);
  const commentRouteId = routeId.replace(/\*\//g, "* /");
  return `
/**
 * Mandu Island: ${commentRouteId} (Generated)
 * Pure export - no side effects
 */
import React from "react";
import * as islandModule from ${importSpecifier};

const candidateExportNames = ${JSON.stringify(candidates)};
const explicitExportName = ${JSON.stringify(normalizedExportName ?? null)};

function resolveIslandExport(mod) {
  if (explicitExportName && mod[explicitExportName]) return mod[explicitExportName];
  if (mod.default) return mod.default;
  for (const name of candidateExportNames) {
    if (mod[name]) return mod[name];
  }
  const runtimeExports = Object.keys(mod).filter((name) => name !== "__esModule");
  if (runtimeExports.length === 1) return mod[runtimeExports[0]];
  throw new Error(
    "[Mandu Island] " + ${routeLabel} + " must export a default component" +
      (candidateExportNames.length > 0 ? " or one of: " + candidateExportNames.join(", ") : "")
  );
}

const island = resolveIslandExport(islandModule);
const exportedIsland = island && island.__mandu_island === true
  ? island
  : function ManduGeneratedIsland(props) {
      return React.createElement(island, props || {});
    };

export default exportedIsland;
${namedExport}
`;
}

function inferClientExportNameFromPath(clientModulePath: string): string | null {
  const basename = path.basename(clientModulePath).replace(/\.[cm]?[jt]sx?$/, "");
  const withoutClientSuffix = basename.replace(/\.(client|island)$/, "");
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(withoutClientSuffix) ? withoutClientSuffix : null;
}

function inferClientExportNameFromRouteId(routeId: string): string | null {
  const pascal = routeId
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(pascal) ? pascal : null;
}

function generatePartialEntry(partialId: string, partialModulePath: string): string {
  const normalizedPath = partialModulePath.replace(/\\/g, "/");
  return `
/**
 * Mandu Partial: ${partialId} (Generated)
 * Exports a runtime-compatible island wrapper around a compiled partial.
 */
import React from "react";
import * as partialModule from "${normalizedPath}";

function findPartial(mod) {
  if (mod.default && mod.default.__mandu_partial === true) return mod.default;
  for (const value of Object.values(mod)) {
    if (value && value.__mandu_partial === true) return value;
  }
  throw new Error("[Mandu Partial] ${partialId} must export a value returned by partial({ component })");
}

const partial = findPartial(partialModule);
const definition = partial.definition;
const component = definition.component;

export default {
  __mandu_island: true,
  definition: {
    setup(serverData) {
      if (serverData && typeof serverData === "object" && Object.keys(serverData).length > 0) {
        return serverData;
      }
      return definition.initialProps || {};
    },
    render(props) {
      return React.createElement(component, props);
    },
    errorBoundary: definition.errorBoundary,
    loading: definition.loading,
  },
};
`;
}

/**
 * Runtime 번들 빌드
 */
async function buildRuntime(
  outDir: string,
  options: BundlerOptions
): Promise<{ success: boolean; outputPath: string; errors: string[] }> {
  const runtimePath = getRuntimeEntryPath();
  const outputName = "_runtime.js";

  try {
    const result = await safeBuild({
      entrypoints: [runtimePath],
      outdir: outDir,
      naming: outputName,
      minify: shouldMinify(options),
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      external: ["react", "react-dom", "react-dom/client"],
      plugins: manduDefaultPlugins(options),
      define: {
        "process.env.NODE_ENV": nodeEnvDefine(options),
        ...options.define,
      },
    });

    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      return {
        success: false,
        outputPath: "",
        errors: [`Runtime bundle build failed (source: ${runtimePath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types.`],
      };
    }

    return {
      success: true,
      outputPath: `/.mandu/client/${outputName}`,
      errors: [],
    };
  } catch (error: unknown) {
    const extra: string[] = [];
    const errObj = error as Record<string, unknown> | null;
    if (errObj && Array.isArray(errObj.errors)) {
      extra.push(...errObj.errors.map((e: unknown) => String((e as Record<string, unknown>)?.message || e)));
    }
    if (errObj && Array.isArray(errObj.logs)) {
      extra.push(...errObj.logs.map((l: unknown) => String((l as Record<string, unknown>)?.message || l)));
    }

    return {
      success: false,
      outputPath: "",
      errors: [`Runtime bundle build threw an exception (source: ${runtimePath}): ${String(error)}`, ...extra].filter(Boolean),
    };
  }
}

/**
 * Vendor shim 번들 빌드 결과
 */
interface VendorBuildResult {
  success: boolean;
  react: string;
  reactDom: string;
  reactDomClient: string;
  jsxRuntime: string;
  jsxDevRuntime: string;
  /**
   * Phase 7.1 B-2: bundled `react-refresh/runtime` — emitted ONLY in
   * dev mode. Empty string in production. Consumed by the HTML
   * preamble (`bundler/dev.ts`) via a dynamic import.
   */
  reactRefreshRuntime: string;
  /**
   * Phase 7.1 B-2: Mandu's `__MANDU_HMR__` glue module — also dev-only.
   * Imported once by the HTML preamble which then calls `installGlobal`
   * with the already-loaded refresh runtime.
   */
  fastRefreshRuntime: string;
  errors: string[];
}

/**
 * Phase 7.1 B-2 — source generator for the `react-refresh/runtime` shim.
 *
 * The shim simply re-exports the upstream module under a default export
 * that `fast-refresh-runtime.ts`'s `installGlobal({ runtimeImport })`
 * can consume. Mirrors the pattern Vite uses for its `/@react-refresh`
 * endpoint.
 */
function generateReactRefreshRuntimeShimSource(): string {
  return `
/**
 * Mandu React Refresh Runtime Shim (Generated, dev-only)
 * Re-exports the upstream react-refresh/runtime so the bundler can
 * pre-bundle it without leaking the CommonJS entry into the app graph.
 */
import * as Runtime from 'react-refresh/runtime';
export const injectIntoGlobalHook = Runtime.injectIntoGlobalHook;
export const register = Runtime.register;
export const createSignatureFunctionForTransform = Runtime.createSignatureFunctionForTransform;
export const performReactRefresh = Runtime.performReactRefresh;
export default {
  injectIntoGlobalHook,
  register,
  createSignatureFunctionForTransform,
  performReactRefresh,
};
`;
}

/**
 * Phase 7.1 B-2 — source generator for the Mandu Fast Refresh glue.
 *
 * This re-exports `installGlobal` / `manduHMR` / helpers from
 * `runtime/fast-refresh-runtime.ts`. By routing through a generated
 * shim we keep the absolute path to core resolved once at build time
 * (same pattern as `_devtools.js`).
 */
function generateFastRefreshRuntimeShimSource(): string {
  const runtimePath = path
    .resolve(import.meta.dir, "..", "runtime", "fast-refresh-runtime.ts")
    .replace(/\\/g, "/");
  return `
/**
 * Mandu Fast Refresh Runtime Shim (Generated, dev-only)
 * Wires the react-refresh runtime to window.__MANDU_HMR__.
 */
export * from "${runtimePath}";
import { installGlobal } from "${runtimePath}";
export { installGlobal };
`;
}

/**
 * Vendor shim 번들 빌드
 * React, ReactDOM, ReactDOMClient를 각각의 shim으로 빌드
 *
 * Phase 7.2.S2: caches the built shim outputs on disk under
 * `.mandu/vendor-cache/` keyed by Bun + React + ReactDOM + react-refresh +
 * @mandujs/core versions. Warm boots reuse the cached files instead of
 * re-running Bun.build, eliminating ~80-120 ms from cold start.
 */
async function buildVendorShims(
  rootDir: string,
  outDir: string,
  options: BundlerOptions
): Promise<VendorBuildResult> {
  const errors: string[] = [];
  type VendorShimKey =
    | "react"
    | "reactDom"
    | "reactDomClient"
    | "jsxRuntime"
    | "jsxDevRuntime"
    | "reactRefreshRuntime"
    | "fastRefreshRuntime";
  const results: Record<VendorShimKey, string> = {
    react: "",
    reactDom: "",
    reactDomClient: "",
    jsxRuntime: "",
    jsxDevRuntime: "",
    reactRefreshRuntime: "",
    fastRefreshRuntime: "",
  };

  // Phase 7.1 B-2: dev-only Fast Refresh shims. In production we skip
  // them entirely so `react-refresh/runtime` is never bundled and the
  // attack surface / bundle size regressions stay zero for deploys.
  const isDev = isDevelopmentBuild(options);

  const shims: Array<{ name: string; source: string; key: VendorShimKey; cacheId: string }> = [
    { name: "_react", source: generateReactShimSource(), key: "react", cacheId: "react" },
    { name: "_react-dom", source: generateReactDOMShimSource(), key: "reactDom", cacheId: "react-dom" },
    { name: "_react-dom-client", source: generateReactDOMClientShimSource(), key: "reactDomClient", cacheId: "react-dom-client" },
    { name: "_jsx-runtime", source: generateJsxRuntimeShimSource(), key: "jsxRuntime", cacheId: "jsx-runtime" },
    { name: "_jsx-dev-runtime", source: generateJsxDevRuntimeShimSource(), key: "jsxDevRuntime", cacheId: "jsx-dev-runtime" },
  ];
  if (isDev) {
    shims.push(
      {
        name: "_vendor-react-refresh",
        source: generateReactRefreshRuntimeShimSource(),
        key: "reactRefreshRuntime",
        cacheId: "react-refresh-runtime",
      },
      {
        name: "_fast-refresh-runtime",
        source: generateFastRefreshRuntimeShimSource(),
        key: "fastRefreshRuntime",
        cacheId: "fast-refresh-glue",
      },
    );
  }

  // Phase 7.2.S2 — Tier 2 disk cache consultation. Production builds
  // (non-dev, minified) still rebuild fresh because (a) the shim set is
  // smaller (no fast-refresh) and (b) production is one-shot — there's no
  // warm workflow to amortize the cache cost against. Dev warm restarts
  // are where the cache pays off.
  //
  // `MANDU_VENDOR_CACHE=0` disables the cache (escape hatch for debugging
  // cache-invalidation bugs without touching code).
  const cacheEnabled = isDev && process.env.MANDU_VENDOR_CACHE !== "0";
  let cacheKeys: VendorCacheKeyInput | null = null;

  if (cacheEnabled) {
    try {
      cacheKeys = await resolveVendorCacheKeys(rootDir);
      const hitOrMiss = await readVendorCache(rootDir, cacheKeys);

      if (hitOrMiss.kind === "hit") {
        // Attempt to restore every shim file to outDir.
        const restored = await restoreVendorCache(
          rootDir,
          hitOrMiss.manifest,
          outDir,
        );
        if (restored !== null) {
          // Map the restored files into the result shape. If a shim is
          // not in the manifest (eg. an older cache from before we added
          // fast-refresh) we rebuild just that one — but the simpler
          // policy is to require the manifest to cover every entry the
          // current shim list wants, so we only accept hits that include
          // everything. Otherwise fall through to rebuild.
          const expected = new Set(shims.map((s) => s.cacheId));
          const present = new Set(restored.keys());
          let allPresent = true;
          for (const id of expected) {
            if (!present.has(id)) {
              allPresent = false;
              break;
            }
          }
          if (allPresent) {
            // Populate result + return. Every shim's outputPath references
            // the freshly-restored file in `outDir`.
            for (const shim of shims) {
              const dst = restored.get(shim.cacheId);
              if (dst) {
                const fileName = path.basename(dst);
                results[shim.key] = `/.mandu/client/${fileName}`;
              }
            }
            mark(HMR_PERF.VENDOR_CACHE_HIT);
            measure(HMR_PERF.VENDOR_CACHE_HIT, HMR_PERF.VENDOR_CACHE_HIT);
            return {
              success: true,
              react: results.react,
              reactDom: results.reactDom,
              reactDomClient: results.reactDomClient,
              jsxRuntime: results.jsxRuntime,
              jsxDevRuntime: results.jsxDevRuntime,
              reactRefreshRuntime: results.reactRefreshRuntime,
              fastRefreshRuntime: results.fastRefreshRuntime,
              errors,
            };
          }
          // Restored but missing one of the expected shims — fall through.
        }
        // Restore failed — fall through to rebuild.
      }

      // Miss / failed restore: record the miss marker for perf logs.
      mark(HMR_PERF.VENDOR_CACHE_MISS);
      measure(HMR_PERF.VENDOR_CACHE_MISS, HMR_PERF.VENDOR_CACHE_MISS);
    } catch {
      // Any cache failure falls through to the full rebuild path — cache
      // is strictly an optimisation.
    }
  }

  const buildShim = async (
    shim: { name: string; source: string; key: VendorShimKey; cacheId: string }
  ): Promise<{ key: VendorShimKey; cacheId: string; outputName?: string; outputPath?: string; error?: string }> => {
    const srcPath = path.join(outDir, `${shim.name}.src.js`);
    const outputName = `${shim.name}.js`;

    try {
      await Bun.write(srcPath, shim.source);

      // _react.js는 external 없이 React 전체를 번들링
      // _react-dom*, jsx-runtime은 react를 external로 처리하여 동일한 React 인스턴스 공유
      let shimExternal: string[] = [];
      if (shim.name === "_react-dom" || shim.name === "_react-dom-client") {
        shimExternal = ["react"];
      } else if (shim.name === "_jsx-runtime" || shim.name === "_jsx-dev-runtime") {
        shimExternal = ["react"];
      }
      // `_vendor-react-refresh` and `_fast-refresh-runtime` are
      // self-contained: we WANT react-refresh bundled in so the
      // preamble's single dynamic import pulls the whole graph.

      const result = await safeBuild({
        entrypoints: [srcPath],
        outdir: outDir,
        naming: outputName,
        minify: shouldMinify(options),
        sourcemap: options.sourcemap ? "external" : "none",
        target: "browser",
        external: shimExternal,
        plugins: manduDefaultPlugins(options),
        define: {
          "process.env.NODE_ENV": nodeEnvDefine(options),
          ...options.define,
        },
      });

      await fs.unlink(srcPath).catch(() => {});

      if (!result.success) {
        const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
        return {
          key: shim.key,
          cacheId: shim.cacheId,
          error: `Vendor shim '${shim.name}' build failed (source: ${srcPath}):\n${grouped}\n  ${vendorShimFailureHint(shim.name)}`,
        };
      }

      return {
        key: shim.key,
        cacheId: shim.cacheId,
        outputName,
        outputPath: `/.mandu/client/${outputName}`,
      };
    } catch (error) {
      await fs.unlink(srcPath).catch(() => {});
      return {
        key: shim.key,
        cacheId: shim.cacheId,
        error: `[${shim.name}] ${String(error)}\n  ${vendorShimFailureHint(shim.name)}`,
      };
    }
  };

  const buildResults = await Promise.all(shims.map((shim) => buildShim(shim)));
  const writeEntries: VendorCacheWriteEntry[] = [];
  for (const result of buildResults) {
    if (result.error) {
      errors.push(result.error);
    } else if (result.outputPath && result.outputName) {
      results[result.key] = result.outputPath;
      writeEntries.push({
        logicalId: result.cacheId,
        absPath: path.join(outDir, result.outputName),
      });
    }
  }

  // Phase 7.2.S2 — persist freshly-built shims for next boot. Best-effort;
  // a write failure is logged via perf markers (opt-in) but never breaks
  // the build. Only write when every shim succeeded — partial manifests
  // would still satisfy the expected-set check on next boot but we
  // prefer writing only complete manifests.
  if (cacheEnabled && cacheKeys && errors.length === 0 && writeEntries.length > 0) {
    // Fire-and-forget so the fast path isn't blocked on disk. The
    // returned VendorBuildResult does not depend on the write outcome.
    mark(HMR_PERF.VENDOR_CACHE_WRITE);
    void writeVendorCache(rootDir, cacheKeys, writeEntries)
      .then(() => {
        measure(HMR_PERF.VENDOR_CACHE_WRITE, HMR_PERF.VENDOR_CACHE_WRITE);
      })
      .catch(() => {});
  }

  return {
    success: errors.length === 0,
    react: results.react,
    reactDom: results.reactDom,
    reactDomClient: results.reactDomClient,
    jsxRuntime: results.jsxRuntime,
    jsxDevRuntime: results.jsxDevRuntime,
    reactRefreshRuntime: results.reactRefreshRuntime,
    fastRefreshRuntime: results.fastRefreshRuntime,
    errors,
  };
}

function vendorShimFailureHint(shimName: string): string {
  if (shimName.includes("react-refresh")) {
    return "Hint: install the optional dev peer dependency with `bun add -d react-refresh`.";
  }
  return "Hint: check the import paths and ensure the vendor package is installed.";
}

function routeIdToAssetStem(routeId: string): string {
  const safe = routeId.replace(/[<>:"/\\|?*\x00-\x1F]/g, (ch) =>
    `_${ch.codePointAt(0)!.toString(16)}_`
  );
  return safe.replace(/[. ]+$/g, "") || "route";
}

/**
 * 단일 Island 번들 빌드
 */
async function buildIsland(
  route: RouteSpec,
  rootDir: string,
  outDir: string,
  options: BundlerOptions
): Promise<BundleOutput> {
  const clientModulePath = path.join(rootDir, route.clientModule!);
  const assetStem = routeIdToAssetStem(route.id);
  const entryStem = `_entry_${assetStem}`;
  const entryPath = path.join(outDir, `${entryStem}.js`);
  const outputName = `${assetStem}.island.js`;

  // Phase 7.1 B-1/B-4: wire native Fast Refresh transform + Mandu's
  // boundary injection plugin. Dev-only; prod bundles remain clean.
  const isDev = isDevelopmentBuild(options);
  try {
    // 엔트리 래퍼 생성
    await Bun.write(entryPath, generateIslandEntry(route.id, clientModulePath, route.clientExportName));

    // 빌드
    // splitting 옵션: true면 공통 코드를 별도 청크로 추출
    const result = await safeBuild({
      entrypoints: [entryPath],
      outdir: outDir,
      naming: options.splitting ? "[name]-[hash].js" : outputName,
      minify: shouldMinify(options),
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      splitting: shouldSplitChunks(options),
      ...(isDev ? { reactFastRefresh: true } : {}),
      plugins: [...manduClientPlugins(options), ...(isDev ? [fastRefreshPlugin()] : [])],
      external: ["react", "react-dom", "react-dom/client", ...(options.external || [])],
      define: {
        "process.env.NODE_ENV": nodeEnvDefine(options),
        ...options.define,
      },
    });

    // 엔트리 파일 정리
    await fs.unlink(entryPath).catch(() => {});

    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      throw new Error(`Island build failed for route '${route.id}' (source: ${clientModulePath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types in this island file.`);
    }

    // 출력 파일 정보
    // splitting 활성화 시 Bun.build 결과에서 실제 출력 파일 찾기
    let actualOutputPath: string;
    let actualOutputName: string;

    if (options.splitting && result.outputs.length > 0) {
      // splitting 모드: 결과에서 엔트리 파일 찾기
      const entryOutput = result.outputs.find(
        (o) => o.kind === "entry-point" || o.path.includes(entryStem) || o.path.includes(assetStem)
      );
      if (entryOutput) {
        actualOutputPath = entryOutput.path;
        actualOutputName = path.basename(entryOutput.path);
      } else {
        actualOutputPath = result.outputs[0].path;
        actualOutputName = path.basename(result.outputs[0].path);
      }
    } else {
      // 일반 모드: 예상 경로 사용
      actualOutputPath = path.join(outDir, outputName);
      actualOutputName = outputName;
    }

    const outputFile = Bun.file(actualOutputPath);
    const content = await sanitizeGeneratedClientBundle(actualOutputPath, isDev);
    const gzipped = Bun.gzipSync(Buffer.from(content));

    return {
      routeId: route.id,
      entrypoint: route.clientModule!,
      outputPath: `/.mandu/client/${actualOutputName}`,
      size: outputFile.size,
      gzipSize: gzipped.length,
    };
  } catch (error) {
    await fs.unlink(entryPath).catch(() => {});
    throw error;
  }
}

async function buildBoundaryBundle(
  boundary: RouteClientBoundary,
  rootDir: string,
  outDir: string,
  options: BundlerOptions,
): Promise<BoundaryBundleBuild> {
  const clientModulePath = path.join(rootDir, boundary.module);
  const assetStem = routeIdToAssetStem(boundary.id);
  const entryStem = `_entry_boundary_${assetStem}`;
  const entryPath = path.join(outDir, `${entryStem}.js`);
  const outputName = `${assetStem}.boundary.js`;
  const isDev = isDevelopmentBuild(options);

  try {
    await Bun.write(entryPath, generateIslandEntry(boundary.id, clientModulePath, boundary.exportName));

    const result = await safeBuild({
      entrypoints: [entryPath],
      outdir: outDir,
      naming: options.splitting ? "[name]-[hash].js" : outputName,
      minify: shouldMinify(options),
      sourcemap: options.sourcemap ? "external" : "none",
      target: "browser",
      splitting: shouldSplitChunks(options),
      ...(isDev ? { reactFastRefresh: true } : {}),
      plugins: [...manduClientPlugins(options), ...(isDev ? [fastRefreshPlugin()] : [])],
      external: ["react", "react-dom", "react-dom/client", ...(options.external || [])],
      define: {
        "process.env.NODE_ENV": nodeEnvDefine(options),
        ...options.define,
      },
    });

    await fs.unlink(entryPath).catch(() => {});

    if (!result.success) {
      const grouped = result.logs.map((l) => `  - ${l.message}`).join("\n");
      throw new Error(`Boundary build failed for '${boundary.id}' (source: ${clientModulePath}):\n${grouped}\n  Hint: Check the import paths and TypeScript types in this client boundary file.`);
    }

    let actualOutputPath: string;
    let actualOutputName: string;
    if (options.splitting && result.outputs.length > 0) {
      const entryOutput = result.outputs.find(
        (o) => o.kind === "entry-point" || o.path.includes(entryStem) || o.path.includes(assetStem),
      );
      actualOutputPath = entryOutput?.path ?? result.outputs[0].path;
      actualOutputName = path.basename(actualOutputPath);
    } else {
      actualOutputPath = path.join(outDir, outputName);
      actualOutputName = outputName;
    }

    const outputFile = Bun.file(actualOutputPath);
    const content = await sanitizeGeneratedClientBundle(actualOutputPath, isDev);
    const gzipped = Bun.gzipSync(Buffer.from(content));
    const priority = boundaryPriorityToLegacyPriority(boundary.hydrate);

    return {
      id: boundary.id,
      route: boundary.routeId,
      js: `/.mandu/client/${actualOutputName}`,
      module: boundary.module,
      exportName: boundary.exportName,
      priority,
      hydrate: boundary.hydrate,
      size: outputFile.size,
      gzipSize: gzipped.length,
    };
  } finally {
    await fs.unlink(entryPath).catch(() => {});
  }
}

async function buildBoundaryBundlesForRecords(
  boundaries: RouteClientBoundary[],
  rootDir: string,
  outDir: string,
  options: BundlerOptions,
  errors: string[],
): Promise<BoundaryBundleBuild[]> {
  if (boundaries.length === 0) return [];
  if (pushDuplicateBoundaryIdErrors(boundaries, errors)) return [];

  const results = await Promise.all(
    boundaries.map(async (boundary) => {
      try {
        return await buildBoundaryBundle(boundary, rootDir, outDir, options);
      } catch (error) {
        errors.push(`[boundary:${boundary.id}] ${String(error)}`);
        return null;
      }
    }),
  );

  return results.filter((result): result is BoundaryBundleBuild => result !== null);
}

function pushDuplicateBoundaryIdErrors(boundaries: RouteClientBoundary[], errors: string[]): boolean {
  const firstById = new Map<string, RouteClientBoundary>();
  let hasDuplicate = false;

  for (const boundary of boundaries) {
    const first = firstById.get(boundary.id);
    if (!first) {
      firstById.set(boundary.id, boundary);
      continue;
    }

    hasDuplicate = true;
    errors.push(
      `[boundary:${boundary.id}] MANDU_BOUNDARY_DUPLICATE_ID Duplicate client boundary id. ` +
      `First route="${first.routeId}" source="${first.source.file}", duplicate route="${boundary.routeId}" source="${boundary.source.file}". ` +
      "Boundary ids must be unique before bundle manifest generation.",
    );
  }

  return hasDuplicate;
}

function mergeBoundaryBundlesIntoManifest(
  manifest: BundleManifest,
  routeIds: Iterable<string>,
  boundaryBundles: BoundaryBundleBuild[],
): void {
  const rebuiltRouteIds = new Set(routeIds);
  if (rebuiltRouteIds.size === 0 && boundaryBundles.length === 0) return;

  if (manifest.boundaries) {
    for (const [id, boundary] of Object.entries(manifest.boundaries)) {
      if (rebuiltRouteIds.has(boundary.route)) {
        delete manifest.boundaries[id];
      }
    }
  }

  if (boundaryBundles.length > 0) {
    manifest.boundaries = manifest.boundaries || {};
    for (const boundary of boundaryBundles) {
      manifest.boundaries[boundary.id] = {
        route: boundary.route,
        js: boundary.js,
        module: boundary.module,
        exportName: boundary.exportName,
        priority: boundary.priority,
        hydrate: boundary.hydrate,
      };
    }
  }

  if (manifest.boundaries && Object.keys(manifest.boundaries).length === 0) {
    delete manifest.boundaries;
  }
}

function boundaryPriorityToLegacyPriority(value: string): BoundaryBundleBuild["priority"] {
  if (value === "load") return "immediate";
  if (value === "immediate" || value === "visible" || value === "idle" || value === "interaction") {
    return value;
  }
  return "visible";
}

async function sanitizeGeneratedClientBundle(outputPath: string, isDev: boolean): Promise<string> {
  const source = await Bun.file(outputPath).text();
  if (!isDev) return source;

  const sanitized = removeFastRefreshSelfAliases(source);
  if (sanitized === source) return source;

  await Bun.write(outputPath, sanitized);
  await validateGeneratedClientBundle(outputPath);
  return sanitized;
}

function removeFastRefreshSelfAliases(source: string): string {
  return source.replace(FAST_REFRESH_SELF_ALIAS_PATTERN, (line, localName: string, offset: number) => {
    const priorSource = source.slice(0, offset);
    const declarationPattern = new RegExp(`(?:const|let|class|function)\\s+${escapeRegExp(localName)}\\b`);
    return declarationPattern.test(priorSource) ? "" : line;
  });
}

async function validateGeneratedClientBundle(outputPath: string): Promise<void> {
  const tempOutDir = await fs.mkdtemp(path.join(path.dirname(outputPath), ".validate-"));
  try {
    const result = await safeBuild({
      entrypoints: [outputPath],
      outdir: tempOutDir,
      target: "browser",
      external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"],
    });
    if (result.success) return;

    const grouped = result.logs.map((log) => `  - ${log.message}`).join("\n");
    throw new Error(`Generated client bundle failed syntax validation (source: ${outputPath}):\n${grouped}`);
  } finally {
    await fs.rm(tempOutDir, { recursive: true, force: true }).catch(() => {});
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 번들 매니페스트 생성
 */
function createBundleManifest(
  outputs: BundleOutput[],
  routes: RouteSpec[],
  runtimePath: string,
  vendorResult: VendorBuildResult,
  routerPath: string,
  env: "development" | "production",
  islandBundles?: Array<{ name: string; js: string; route: string; priority: IslandFileEntry["priority"] }>,
  partialBundles?: Array<{ name: string; js: string; priority: PartialFileEntry["priority"] }>,
  boundaryBundles?: BoundaryBundleBuild[],
): BundleManifest {
  const bundles: BundleManifest["bundles"] = {};

  for (const output of outputs) {
    const route = routes.find((r) => r.id === output.routeId);
    const hydration = route ? getRouteHydration(route) : null;

    bundles[output.routeId] = {
      js: output.outputPath,
      dependencies: ["_runtime", "_react"],
      priority: hydration?.priority || HYDRATION.DEFAULT_PRIORITY,
    };
  }

  // Per-island bundles (code splitting)
  let islands: BundleManifest["islands"];
  if (islandBundles && islandBundles.length > 0) {
    islands = {};
    for (const ib of islandBundles) {
      islands[ib.name] = {
        js: ib.js,
        route: ib.route,
        priority: ib.priority,
      };
    }
  }

  let partials: BundleManifest["partials"];
  if (partialBundles && partialBundles.length > 0) {
    partials = {};
    for (const partial of partialBundles) {
      partials[partial.name] = {
        js: partial.js,
        priority: partial.priority,
      };
    }
  }

  let boundaries: BundleManifest["boundaries"];
  if (boundaryBundles && boundaryBundles.length > 0) {
    boundaries = {};
    for (const boundary of boundaryBundles) {
      boundaries[boundary.id] = {
        route: boundary.route,
        js: boundary.js,
        module: boundary.module,
        exportName: boundary.exportName,
        priority: boundary.priority,
        hydrate: boundary.hydrate,
      };
    }
  }

  // Phase 7.1 B-2: expose Fast Refresh dev bundles so the HTML
  // preamble can inject a dynamic import pointing at them. Only
  // populated when buildVendorShims ran in dev mode.
  const fastRefresh =
    vendorResult.reactRefreshRuntime && vendorResult.fastRefreshRuntime
      ? {
          runtime: vendorResult.reactRefreshRuntime,
          glue: vendorResult.fastRefreshRuntime,
        }
      : undefined;

  return {
    version: 1,
    buildTime: new Date().toISOString(),
    env,
    bundles,
    ...(islands ? { islands } : {}),
    ...(partials ? { partials } : {}),
    ...(boundaries ? { boundaries } : {}),
    shared: {
      runtime: runtimePath,
      vendor: vendorResult.react, // primary vendor for backwards compatibility
      router: routerPath, // Client-side Router
      ...(fastRefresh ? { fastRefresh } : {}),
    },
    importMap: {
      imports: {
        "react": vendorResult.react,
        "react-dom": vendorResult.reactDom,
        "react-dom/client": vendorResult.reactDomClient,
        "react/jsx-runtime": vendorResult.jsxRuntime,
        "react/jsx-dev-runtime": vendorResult.jsxDevRuntime,
      },
    },
  };
}

/**
 * 번들 통계 계산
 */
function calculateStats(
  outputs: BundleOutput[],
  startTime: number,
  extraOutputs: Array<{ routeId: string; size: number; gzipSize: number }> = [],
): BundleStats {
  let totalSize = 0;
  let totalGzipSize = 0;
  let largestBundle = { routeId: "", size: 0 };

  for (const output of [...outputs, ...extraOutputs]) {
    totalSize += output.size;
    totalGzipSize += output.gzipSize;

    if (output.size > largestBundle.size) {
      largestBundle = { routeId: output.routeId, size: output.size };
    }
  }

  return {
    totalSize,
    totalGzipSize,
    largestBundle,
    buildTime: performance.now() - startTime,
    bundleCount: outputs.length + extraOutputs.length,
  };
}

/**
 * 클라이언트 번들 빌드
 *
 * @example
 * ```typescript
 * import { buildClientBundles } from "@mandujs/core/bundler";
 *
 * const result = await buildClientBundles(manifest, "./my-app", {
 *   minify: true,
 *   sourcemap: true,
 * });
 *
 * if (result.success) {
 *   console.log("Built", result.stats.bundleCount, "bundles");
 * }
 * ```
 */
export async function buildClientBundles(
  manifest: RoutesManifest,
  rootDir: string,
  options: BundlerOptions = {}
): Promise<BundleResult> {
  mark("bundler:full");
  const startTime = performance.now();
  const outputs: BundleOutput[] = [];
  const errors: string[] = [];

  // Phase 18.τ — fire `onBundleComplete(stats)` before returning. Helper
  // is inlined here so every return path in this function can opt in
  // with a single `await fireOnBundleComplete(stats);` call without
  // leaking plugin plumbing into the hot path.
  const fireOnBundleComplete = async (stats: BundleStats): Promise<void> => {
    const plugins = options.plugins ?? [];
    if (plugins.length === 0 && !options.configHooks) return;
    const { errors: hookErrors } = await runOnBundleComplete(stats, {
      plugins,
      configHooks: options.configHooks,
    });
    for (const e of hookErrors) {
      errors.push(`onBundleComplete[${e.source}]: ${e.error.message}`);
    }
  };
  const env = resolveBundlerMode(options);

  // 1. Hydration이 필요한 라우트 필터링
  const invalidClientRouteIds = new Set<string>();
  const runtimeRoutes = manifest.routes.filter((route) => route.kind === "page" && needsHydration(route));
  const partialFiles = runtimeRoutes.length > 0 ? await scanPartialFiles(rootDir) : [];
  const routesMissingClientModule = getHydrationRoutesMissingClientModule(manifest);
  if (routesMissingClientModule.length > 0) {
    const missingClientErrors = await Promise.all(
      routesMissingClientModule.map((route) =>
        describeMissingHydrationClientModule(route, rootDir, {
          allowPartialOnly: partialFiles.length > 0,
        })
      )
    );
    errors.push(...missingClientErrors.filter((error): error is string => error !== null));
  }

  let hydratedRoutes = getHydratedRoutes(manifest);
  if (hydratedRoutes.length > 0) {
    const validRoutes: RouteSpec[] = [];
    for (const route of hydratedRoutes) {
      const validationError = await validateClientModuleForBrowserBundle(route, rootDir);
      if (validationError) {
        invalidClientRouteIds.add(route.id);
        errors.push(validationError);
        continue;
      }
      validRoutes.push(route);
    }
    hydratedRoutes = validRoutes;
  }
  // 2. 출력 디렉토리 생성 (항상 필요 - 매니페스트 저장용)
  const outDir = resolveClientOutDir(rootDir, options.outDir);
  await fs.mkdir(outDir, { recursive: true });

  // Hydration 라우트가 없어도 빈 매니페스트를 저장해야 함
  // (이전 빌드의 stale 매니페스트 참조 방지)
  if (hydratedRoutes.length === 0 && partialFiles.length === 0) {
    // #185: skipFrameworkBundles 모드에서는 기존 manifest를 그대로 유지 (devtools 재빌드도 스킵)
    if (options.skipFrameworkBundles && errors.length === 0) {
      const manifestPath = path.join(rootDir, ".mandu/manifest.json");
      try {
        const manifestRaw = await fs.readFile(manifestPath, "utf-8");
        let existing: BundleManifest;
        try {
          existing = JSON.parse(manifestRaw) as BundleManifest;
        } catch (parseError) {
          // #186 hardening: corrupt JSON이면 silent overwrite 대신 경고 + full build로 fallback
          console.warn(
            `[Mandu] Existing manifest is corrupt, falling back to full build: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          );
          throw parseError;
        }
        // #186 hardening: 필수 필드 검증 (shared / bundles 누락 시 fallback)
        if (!existing || typeof existing !== "object" || !existing.shared || !existing.bundles) {
          console.warn("[Mandu] Existing manifest missing required fields, falling back to full build");
          throw new Error("invalid manifest shape");
        }
        return {
          success: true,
          outputs: [],
          errors: [],
          manifest: existing,
          stats: {
            totalSize: 0,
            totalGzipSize: 0,
            largestBundle: { routeId: "", size: 0 },
            buildTime: 0,
            bundleCount: 0,
          },
        };
      } catch {
        // 기존 manifest 없음/corrupt/invalid → full path로 fallback
      }
    }

    // Dev 모드에서는 DevTools 번들 빌드 (island 없어도 동작해야 함)
    const isDev = env === "development";
    if (isDev) {
      const devtoolsResult = await buildDevtoolsBundle(outDir, options);
      if (!devtoolsResult.success) {
        console.warn("[Mandu] DevTools bundle build failed:", devtoolsResult.errors.join(", "));
      }
    }

    const emptyManifest = createEmptyManifest(env);
    await fs.writeFile(
      path.join(rootDir, ".mandu/manifest.json"),
      JSON.stringify(emptyManifest, null, 2)
    );
    return {
      success: errors.length === 0,
      outputs: [],
      errors,
      manifest: emptyManifest,
      stats: {
        totalSize: 0,
        totalGzipSize: 0,
        largestBundle: { routeId: "", size: 0 },
        buildTime: 0,
        bundleCount: 0,
      },
    };
  }

  // 부분 빌드 모드: targetRouteIds가 지정되면 해당 Island만 재빌드 (#122)
  if (options.targetRouteIds && options.targetRouteIds.length > 0) {
    const targetRouteIds = new Set(options.targetRouteIds);
    const targetRoutes = hydratedRoutes.filter((r) => targetRouteIds.has(r.id));
    const targetIslandRoutes = targetRoutes.filter((route) => !!route.clientModule);

    const targetResults = await Promise.all(
      targetIslandRoutes.map(async (route) => {
        try {
          return { ok: true as const, result: await buildIsland(route, rootDir, outDir, options) };
        } catch (error) {
          return { ok: false as const, routeId: route.id, error: String(error) };
        }
      }),
    );
    for (const r of targetResults) {
      if (r.ok) outputs.push(r.result);
      else errors.push(`[${r.routeId}] ${r.error}`);
    }

    const boundaryRecords = targetRoutes.flatMap((route) => route.boundaries ?? []);
    const boundaryBundles = await buildBoundaryBundlesForRecords(
      boundaryRecords,
      rootDir,
      outDir,
      options,
      errors,
    );

    // 기존 매니페스트를 읽어 변경된 Island만 갱신
    let existingManifest: BundleManifest;
    try {
      const manifestData = await fs.readFile(path.join(rootDir, ".mandu/manifest.json"), "utf-8");
      existingManifest = JSON.parse(manifestData) as BundleManifest;
    } catch {
      // 기존 매니페스트 없으면 전체 빌드로 재시도 (targetRouteIds 제거)
      return buildClientBundles(manifest, rootDir, { ...options, targetRouteIds: undefined });
    }

    // Only update manifest with successfully built outputs (#10: preserve previous good manifest on failure)
    for (const routeId of invalidClientRouteIds) {
      delete existingManifest.bundles[routeId];
    }
    if (outputs.length > 0 || invalidClientRouteIds.size > 0 || boundaryRecords.length > 0) {
      for (const output of outputs) {
        if (existingManifest.bundles[output.routeId]) {
          existingManifest.bundles[output.routeId].js = output.outputPath;
        } else {
          const route = targetIslandRoutes.find((r) => r.id === output.routeId);
          const hydration = route ? getRouteHydration(route) : null;
          existingManifest.bundles[output.routeId] = {
            js: output.outputPath,
            dependencies: ["_runtime", "_react"],
            priority: hydration?.priority || HYDRATION.DEFAULT_PRIORITY,
          };
        }
      }

      mergeBoundaryBundlesIntoManifest(
        existingManifest,
        targetRoutes.map((route) => route.id),
        boundaryBundles,
      );

      await fs.writeFile(
        path.join(rootDir, ".mandu/manifest.json"),
        JSON.stringify(existingManifest, null, 2)
      );
    }
    // When all builds failed, do NOT overwrite manifest — keep previous good state

    const stats = calculateStats(
      outputs,
      startTime,
      boundaryBundles.map((boundary) => ({
        routeId: `boundary:${boundary.id}`,
        size: boundary.size,
        gzipSize: boundary.gzipSize,
      })),
    );
    return { success: errors.length === 0, outputs, errors, manifest: existingManifest, stats };
  }

  // #185: Framework-internal 번들 스킵 모드
  // 사용자 코드(src/shared 등) 변경 시 runtime/router/vendor/devtools 재빌드는 낭비.
  // 기존 매니페스트를 로드해 framework 출력 경로만 재사용하고 사용자 island만 재빌드.
  if (options.skipFrameworkBundles) {
    let existingManifest: BundleManifest;
    try {
      const manifestData = await fs.readFile(path.join(rootDir, ".mandu/manifest.json"), "utf-8");
      existingManifest = JSON.parse(manifestData) as BundleManifest;
    } catch (parseError) {
      // 기존 매니페스트 없음/corrupt → 경고 후 full build로 fallback
      if (parseError instanceof SyntaxError) {
        console.warn(
          `[Mandu] Existing manifest is corrupt, falling back to full build: ${parseError.message}`,
        );
      }
      return buildClientBundles(manifest, rootDir, { ...options, skipFrameworkBundles: false });
    }

    // #186 hardening: 필수 필드 검증 — 누락 시 full build로 fallback
    if (
      !existingManifest ||
      typeof existingManifest !== "object" ||
      !existingManifest.shared ||
      !existingManifest.bundles
    ) {
      console.warn(
        "[Mandu] Existing manifest missing required fields (shared/bundles), falling back to full build",
      );
      return buildClientBundles(manifest, rootDir, { ...options, skipFrameworkBundles: false });
    }

    for (const routeId of invalidClientRouteIds) {
      delete existingManifest.bundles[routeId];
    }

    // Pre-build validation + 병렬 island 빌드 (framework 번들은 스킵)
    for (const route of hydratedRoutes) {
      if (!route.clientModule) continue;
      const clientModulePath = path.join(rootDir, route.clientModule);
      try {
        const source = await fs.readFile(clientModulePath, "utf-8");
        const wrongImportPattern = /(?:import|from)\s+['"]@mandujs\/core['"]|require\s*\(\s*['"]@mandujs\/core['"]\s*\)/;
        if (wrongImportPattern.test(source)) {
          errors.push(
            `[${route.id}] Island file "${route.clientModule}" imports from "@mandujs/core" which is a server-side module.\n` +
            `  Fix: Change the import to "@mandujs/core/client".`,
          );
        }
      } catch {
        // 파일 읽기 실패는 나중 빌드에서 catch됨
      }
    }

    const islandResults = await Promise.all(
      hydratedRoutes.filter((route) => !!route.clientModule).map(async (route) => {
        try {
          return { ok: true as const, result: await buildIsland(route, rootDir, outDir, options) };
        } catch (error) {
          return { ok: false as const, routeId: route.id, error: String(error) };
        }
      }),
    );
    for (const r of islandResults) {
      if (r.ok) outputs.push(r.result);
      else errors.push(`[${r.routeId}] ${r.error}`);
    }

    // Per-island bundle 재빌드 (이미 병렬)
    const islandFiles = await scanIslandFiles(hydratedRoutes, rootDir);
    const perIslandBundles: Array<{ name: string; js: string; route: string; priority: IslandFileEntry["priority"] }> = [];
    if (islandFiles.length > 0) {
      const perIslandResults = await Promise.all(
        islandFiles.map(async (entry) => {
          try {
            return await buildPerIslandBundle(entry, outDir, options);
          } catch (error) {
            errors.push(`[island:${entry.name}] ${String(error)}`);
            return null;
          }
        }),
      );
      for (const result of perIslandResults) {
        if (result) perIslandBundles.push(result);
      }
    }

    // 기존 manifest를 기반으로 bundles / islands 엔트리만 교체 (framework 경로는 유지)
    for (const output of outputs) {
      if (existingManifest.bundles[output.routeId]) {
        existingManifest.bundles[output.routeId].js = output.outputPath;
      } else {
        const route = hydratedRoutes.find((r) => r.id === output.routeId);
        const hydration = route ? getRouteHydration(route) : null;
        existingManifest.bundles[output.routeId] = {
          js: output.outputPath,
          dependencies: ["_runtime", "_react"],
          priority: hydration?.priority || HYDRATION.DEFAULT_PRIORITY,
        };
      }
    }
    if (perIslandBundles.length > 0) {
      existingManifest.islands = existingManifest.islands || {};
      for (const ib of perIslandBundles) {
        existingManifest.islands[ib.name] = {
          js: ib.js,
          route: ib.route,
          priority: ib.priority,
        };
      }
    }

    const boundaryRecords = hydratedRoutes.flatMap((route) => route.boundaries ?? []);
    const boundaryBundles = await buildBoundaryBundlesForRecords(
      boundaryRecords,
      rootDir,
      outDir,
      options,
      errors,
    );
    mergeBoundaryBundlesIntoManifest(
      existingManifest,
      hydratedRoutes.map((route) => route.id),
      boundaryBundles,
    );

    const partialBundles: PartialBundleBuild[] = [];
    if (partialFiles.length > 0) {
      const partialResults = await Promise.all(
        partialFiles.map(async (entry) => {
          try {
            return await buildPartialBundle(entry, outDir, options);
          } catch (error) {
            errors.push(`[partial:${entry.name}] ${String(error)}`);
            return null;
          }
        }),
      );
      for (const result of partialResults) {
        if (result) partialBundles.push(result);
      }
    }
    if (partialFiles.length > 0 || existingManifest.partials) {
      existingManifest.partials = {};
      for (const partial of partialBundles) {
        existingManifest.partials[partial.name] = {
          js: partial.js,
          priority: partial.priority,
        };
      }
      if (Object.keys(existingManifest.partials).length === 0) {
        delete existingManifest.partials;
      }
    }

    await fs.writeFile(
      path.join(rootDir, ".mandu/manifest.json"),
      JSON.stringify(existingManifest, null, 2),
    );

    const stats = calculateStats(
      outputs,
      startTime,
      [
        ...partialBundles.map((partial) => ({
          routeId: `partial:${partial.name}`,
          size: partial.size,
          gzipSize: partial.gzipSize,
        })),
        ...boundaryBundles.map((boundary) => ({
          routeId: `boundary:${boundary.id}`,
          size: boundary.size,
          gzipSize: boundary.gzipSize,
        })),
      ],
    );
    return { success: errors.length === 0, outputs, errors, manifest: existingManifest, stats };
  }

  // 3-4. Runtime, Router, Vendor, DevTools 번들 병렬 빌드 (서로 독립적)
  const isDev = env === "development";
  const runtimePromise = buildRuntime(outDir, options);
  const routerPromise = buildRouterRuntime(outDir, options);
  // Phase 7.2.S2 — `rootDir` is now threaded through so buildVendorShims can
  // consult `.mandu/vendor-cache/` for warm-boot shim reuse.
  const vendorPromise = buildVendorShims(rootDir, outDir, options);
  const devtoolsPromise = isDev ? buildDevtoolsBundle(outDir, options) : null;

  const [runtimeResult, routerResult, vendorResult, devtoolsResult] = await Promise.all([
    runtimePromise,
    routerPromise,
    vendorPromise,
    devtoolsPromise,
  ]);

  if (!runtimeResult.success) {
    errors.push(...runtimeResult.errors.map((e: string) => `[Runtime] ${e}`));
  }
  if (!routerResult.success) {
    errors.push(...routerResult.errors.map((e: string) => `[Router] ${e}`));
  }
  if (!vendorResult.success) {
    errors.push(...vendorResult.errors);
  }
  if (devtoolsResult && !devtoolsResult.success) {
    // DevTools 빌드 실패는 경고만 (개발 중단시키지 않음)
    console.warn("[Mandu] DevTools bundle build failed:", devtoolsResult.errors.join(", "));
  }

  // 4.5. Pre-build validation: detect wrong import paths in island files
  for (const route of hydratedRoutes) {
    if (route.clientModule) {
      const clientModulePath = path.join(rootDir, route.clientModule);
      try {
        const source = await fs.readFile(clientModulePath, "utf-8");
        // Match imports from "@mandujs/core" but NOT "@mandujs/core/client" or other subpaths
        const wrongImportPattern = /(?:import|from)\s+['"]@mandujs\/core['"]|require\s*\(\s*['"]@mandujs\/core['"]\s*\)/;
        if (wrongImportPattern.test(source)) {
          const errMsg =
            `[${route.id}] Island file "${route.clientModule}" imports from "@mandujs/core" which is a server-side module.\n` +
            `  Fix: Change the import to "@mandujs/core/client".\n` +
            `  Client islands cannot use server-side modules.`;
          console.error(`\n\x1b[31mERROR: ${errMsg}\x1b[0m\n`);
          errors.push(errMsg);
        }
      } catch {
        // File read failure will be caught later during build
      }
    }
  }

  // 5. 각 Island 번들 병렬 빌드 (#185: L1631의 per-island와 일관성 확보)
  const fullIslandResults = await Promise.all(
    hydratedRoutes.filter((route) => !!route.clientModule).map(async (route) => {
      try {
        return { ok: true as const, result: await buildIsland(route, rootDir, outDir, options) };
      } catch (error) {
        return { ok: false as const, route, error: formatBundlerException(error) };
      }
    }),
  );
  for (const r of fullIslandResults) {
    if (r.ok) {
      outputs.push(r.result);
    } else {
      const errorStr = r.error;
      if (errorStr.includes("AggregateError") || errorStr.includes("Could not resolve")) {
        const clientModule = r.route.clientModule || "";
        errors.push(
          `[${r.route.id}] ${errorStr}\n` +
          `  Hint: Check import paths and browser-compatible exports for this island. File: ${clientModule}`,
        );
      } else {
        errors.push(`[${r.route.id}] ${errorStr}`);
      }
    }
  }

  // 5.5. Per-island code splitting: scan and build individual island bundles
  const islandFiles = await scanIslandFiles(hydratedRoutes, rootDir);
  const islandBundles: Array<{ name: string; js: string; route: string; priority: IslandFileEntry["priority"] }> = [];

  if (islandFiles.length > 0) {
    const islandResults = await Promise.all(
      islandFiles.map(async (entry) => {
        try {
          return await buildPerIslandBundle(entry, outDir, options);
        } catch (error) {
          errors.push(`[island:${entry.name}] ${String(error)}`);
          return null;
        }
      })
    );
    for (const result of islandResults) {
      if (result) islandBundles.push(result);
    }
  }

  const boundaryRecords = hydratedRoutes.flatMap((route) => route.boundaries ?? []);
  const boundaryBundles: BoundaryBundleBuild[] = [];
  if (boundaryRecords.length > 0 && !pushDuplicateBoundaryIdErrors(boundaryRecords, errors)) {
    const boundaryResults = await Promise.all(
      boundaryRecords.map(async (boundary) => {
        try {
          return await buildBoundaryBundle(boundary, rootDir, outDir, options);
        } catch (error) {
          errors.push(`[boundary:${boundary.id}] ${String(error)}`);
          return null;
        }
      }),
    );
    for (const result of boundaryResults) {
      if (result) boundaryBundles.push(result);
    }
  }

  const partialBundles: PartialBundleBuild[] = [];
  if (partialFiles.length > 0) {
    const partialResults = await Promise.all(
      partialFiles.map(async (entry) => {
        try {
          return await buildPartialBundle(entry, outDir, options);
        } catch (error) {
          errors.push(`[partial:${entry.name}] ${String(error)}`);
          return null;
        }
      }),
    );
    for (const result of partialResults) {
      if (result) partialBundles.push(result);
    }
  }

  // 6. 번들 매니페스트 생성
  const bundleManifest = createBundleManifest(
    outputs,
    hydratedRoutes,
    runtimeResult.outputPath,
    vendorResult,
    routerResult.outputPath,
    env,
    islandBundles,
    partialBundles,
    boundaryBundles,
  );

  await fs.writeFile(
    path.join(rootDir, ".mandu/manifest.json"),
    JSON.stringify(bundleManifest, null, 2)
  );

  // 7. 통계 계산
  const stats = calculateStats(
    outputs,
    startTime,
    [
      ...partialBundles.map((partial) => ({
        routeId: `partial:${partial.name}`,
        size: partial.size,
        gzipSize: partial.gzipSize,
      })),
      ...boundaryBundles.map((boundary) => ({
        routeId: `boundary:${boundary.id}`,
        size: boundary.size,
        gzipSize: boundary.gzipSize,
      })),
    ],
  );

  // Phase 18.τ — fire onBundleComplete(stats) before return.
  await fireOnBundleComplete(stats);

  measure("bundler:full", "bundler:full");
  return {
    success: errors.length === 0,
    outputs,
    errors,
    manifest: bundleManifest,
    stats,
  };
}

/**
 * 번들 사이즈 포맷팅
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * 번들 결과 요약 출력
 */
export function printBundleStats(result: BundleResult): void {
  console.log("\n📦 Mandu Client Bundles");
  console.log("=".repeat(50));

  const partialCount = Object.keys(result.manifest.partials ?? {}).length;
  const boundaryCount = Object.keys(result.manifest.boundaries ?? {}).length;
  if (result.outputs.length === 0 && partialCount === 0 && boundaryCount === 0) {
    console.log("No islands, partials, or boundaries to bundle (hydration: none or no client entry)");
    if (result.errors.length > 0) {
      console.log("\n⚠️ Errors:");
      for (const error of result.errors) {
        console.log(`  ${error}`);
      }
    }
    return;
  }

  console.log(`Environment: ${result.manifest.env}`);
  console.log(`Bundles: ${result.stats.bundleCount}`);
  console.log(`Total Size: ${formatSize(result.stats.totalSize)}`);
  console.log(`Total Gzip: ${formatSize(result.stats.totalGzipSize)}`);
  console.log(`Build Time: ${result.stats.buildTime.toFixed(0)}ms`);
  console.log("");

  // 각 번들 정보
  for (const output of result.outputs) {
    console.log(
      `  ${output.routeId}: ${formatSize(output.size)} (gzip: ${formatSize(output.gzipSize)})`
    );
  }
  if (partialCount > 0) {
    console.log(`  Partials: ${partialCount}`);
  }
  if (boundaryCount > 0) {
    console.log(`  Boundaries: ${boundaryCount}`);
  }

  if (result.errors.length > 0) {
    console.log("\n⚠️ Errors:");
    for (const error of result.errors) {
      console.log(`  ${error}`);
    }
  }

  console.log("");
}

function formatBundlerException(error: unknown): string {
  if (error instanceof AggregateError) {
    const parts = [String(error)];
    for (const nested of error.errors) {
      parts.push(`  - ${formatBundlerException(nested).replace(/\n/g, "\n    ")}`);
    }
    return parts.join("\n");
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}
