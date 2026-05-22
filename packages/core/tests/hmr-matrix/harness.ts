/**
 * Phase 7.0 R2 Agent E — Shared test harness for the 36-scenario matrix.
 *
 * Design notes
 * ────────────
 * The matrix exercises every combination of (project form × change kind) and
 * asserts the expected HMR behavior. Rather than spawning the full `mandu dev`
 * CLI — which pulls in lockfile validation, guard, env loading, plugin hooks,
 * and Architecture Guard — this harness drives `startDevBundler` directly and
 * observes its callbacks. That keeps per-test wall time to seconds instead
 * of minutes, avoids cross-process port races on Windows, and still exercises
 * the code paths (watcher, debounce, `pendingBuildSet`, `classifyBatch`,
 * rebuild dispatch) that the matrix is actually validating.
 *
 * For behaviors that require the CLI layer (prerender regen, CSS watcher,
 * config auto-restart), the harness captures the callback firings and
 * verifies the bundler correctly *signals* those events — the downstream
 * wiring (CLI handler) is covered by its own unit tests (see
 * `dev-reliability.test.ts` and `extended-watch.test.ts`).
 *
 * Windows quirks: fs.watch(recursive) has a short arming delay and can emit
 * duplicate events. We add 300 ms settle time after `startDevBundler` and
 * a `touchUntilSeen` retry loop (borrowed from `dev-reliability.test.ts`).
 */

import { writeFileSync, mkdirSync, rmSync, mkdtempSync, existsSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { startDevBundler, type DevBundler } from "../../src/bundler/dev";
import type { RoutesManifest } from "../../src/spec/schema";
import type { ProjectForm, ScenarioCell } from "../../src/bundler/scenario-matrix";

ensureWorkspaceNodePathForFixtureBuilds();

function ensureWorkspaceNodePathForFixtureBuilds(): void {
  const repoNodeModules = path.resolve(import.meta.dir, "../../../..", "node_modules");
  if (!existsSync(repoNodeModules)) return;

  const entries = (process.env.NODE_PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const normalizedEntries = new Set(entries.map((entry) => path.resolve(entry)));
  if (normalizedEntries.has(repoNodeModules)) return;

  process.env.NODE_PATH = [...entries, repoNodeModules].join(path.delimiter);
}

// ═══════════════════════════════════════════════════════════════════════════
// Timing constants (tuned for Windows fs.watch flakiness)
// ═══════════════════════════════════════════════════════════════════════════

/** Time to wait after `startDevBundler` before emitting fs events. Windows
 *  ReadDirectoryChangesW arms asynchronously and misses the first ~100ms of
 *  events. 300ms is conservative but reliable. */
export const WATCHER_ARM_MS = 300;

/** Time to wait after writeFile for debounce (100ms) + fs.watch dispatch.
 *  450ms gives slack for Windows polling latency. */
export const WATCH_SETTLE_MS = 450;

/** Default timeout for any single matrix test. Island/SSR rebuilds typically
 *  finish in 50-500 ms, but fixture creation + dev server startup takes the
 *  bulk of the time. 45s accommodates worst-case Windows cold starts PLUS
 *  the touchUntilSeen retry loop (up to 4 × WATCH_SETTLE_MS = 1.8s). */
export const CELL_TIMEOUT_MS = 45_000;

// ═══════════════════════════════════════════════════════════════════════════
// Fixture context
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A created fixture ready for a matrix cell. The caller invokes `modify(cell)`
 * to edit the target file, then consults `observations` to assert on the
 * expected behavior. `cleanup()` tears down the dev bundler and removes the
 * tmpdir.
 */
export interface FixtureContext {
  rootDir: string;
  form: ProjectForm;
  manifest: RoutesManifest;
  bundler: DevBundler;
  observations: Observations;
  /** Best-effort cleanup. Windows sometimes holds locks on newly-built
   *  `.mandu/client/` — we swallow the resulting EBUSY. */
  cleanup: () => Promise<void>;
}

/**
 * Event recorder wired to every `startDevBundler` callback so the matrix
 * tests can make assertions without racing against the real broadcast path.
 *
 * Design: the dev bundler is callback-driven, not event-emitter, so the
 * harness synthesizes an observable view by pushing into these arrays. We
 * keep them plain `readonly string[]` (and small structs) so `JSON.stringify`
 * gives readable failure messages.
 */
export interface Observations {
  rebuilds: Array<{ routeId: string; success: boolean; buildTime: number; file?: string }>;
  ssrChanges: string[];
  apiChanges: string[];
  resourceChanges: string[];
  configReloads: string[];
  packageJsonChanges: string[];
  errors: Array<{ routeId?: string; message: string }>;
}

function makeObservations(): Observations {
  return {
    rebuilds: [],
    ssrChanges: [],
    apiChanges: [],
    resourceChanges: [],
    configReloads: [],
    packageJsonChanges: [],
    errors: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared project skeleton
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Common `.mandu/` + `package.json` setup used by all three fixture forms.
 * Creating the manifest up front lets the bundler's `skipFrameworkBundles`
 * fast path fire instead of a cold full build on every test.
 */
export function initProjectSkeleton(root: string): void {
  linkWorkspaceNodeModules(root);

  mkdirSync(path.join(root, ".mandu"), { recursive: true });
  mkdirSync(path.join(root, ".mandu/client"), { recursive: true });
  writeFileSync(
    path.join(root, ".mandu/manifest.json"),
    JSON.stringify(
      {
        version: 1,
        buildTime: new Date().toISOString(),
        env: "development",
        bundles: {},
        shared: {
          runtime: "/.mandu/client/runtime.js",
          vendor: "/.mandu/client/vendor.js",
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "hmr-matrix-fixture",
        version: "0.0.0",
        type: "module",
        private: true,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: false,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ["app/**/*", "src/**/*", "spec/**/*"],
      },
      null,
      2,
    ),
  );

  // .env — referenced by the `.env` change kind.
  writeFileSync(path.join(root, ".env"), "FIXTURE_MARKER=initial\n");

  // mandu.config.ts — referenced by the `mandu.config.ts` change kind. Keep
  // it minimal so loading it never fails.
  writeFileSync(
    path.join(root, "mandu.config.ts"),
    "export default { server: { port: 0 } };\n",
  );

  // Shared source tree — every fixture has at least `src/shared/util.ts`
  // (for the `src/shared/**` change kind) and `src/top-level.ts` (B1).
  mkdirSync(path.join(root, "src/shared"), { recursive: true });
  writeFileSync(
    path.join(root, "src/shared/util.ts"),
    'export const SHARED = "v0";\n',
  );
  writeFileSync(
    path.join(root, "src/top-level.ts"),
    'export const TOP = "v0";\n',
  );

  // globals.css — referenced by the `css` change kind. Each fixture decides
  // whether to link it; the file existence is cheap to stub out.
  writeFileSync(
    path.join(root, "app-styles.css"),
    "/* v0 */ body { color: red; }\n",
  );
}

function linkWorkspaceNodeModules(root: string): void {
  const repoNodeModules = path.resolve(import.meta.dir, "../../../..", "node_modules");
  const fixtureNodeModules = path.join(root, "node_modules");
  if (!existsSync(repoNodeModules) || existsSync(fixtureNodeModules)) return;

  try {
    symlinkSync(repoNodeModules, fixtureNodeModules, process.platform === "win32" ? "junction" : "dir");
  } catch {
    // Best effort: the NODE_PATH fallback below still helps when the test
    // process was launched with resolver support for it.
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Bundler boot
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Start the dev bundler with every callback wired to `observations`. The
 * manifest is passed verbatim so the fixture builder controls the route
 * topology.
 *
 * We do NOT pass the exotic callbacks (`onConfigReload`, `onResourceChange`,
 * `onPackageJsonChange`) unless the caller's fixture actually has files
 * that would trigger them — the bundler already skips the watcher setup
 * when no callback is registered (defensive, since Agent D's additions are
 * still opt-in).
 */
export async function bootBundler(
  rootDir: string,
  manifest: RoutesManifest,
): Promise<{ bundler: DevBundler; observations: Observations }> {
  const observations = makeObservations();
  const bundler = await startDevBundler({
    rootDir,
    manifest,
    onRebuild: (r) => {
      observations.rebuilds.push({
        routeId: r.routeId,
        success: r.success,
        buildTime: r.buildTime,
      });
    },
    onSSRChange: (filePath) => {
      observations.ssrChanges.push(filePath);
    },
    onAPIChange: (filePath) => {
      observations.apiChanges.push(filePath);
    },
    onConfigReload: (filePath) => {
      observations.configReloads.push(filePath);
    },
    onResourceChange: (filePath) => {
      observations.resourceChanges.push(filePath);
    },
    onPackageJsonChange: (filePath) => {
      observations.packageJsonChanges.push(filePath);
    },
    onError: (error, routeId) => {
      observations.errors.push({ routeId, message: error.message });
    },
  });
  return { bundler, observations };
}

// ═══════════════════════════════════════════════════════════════════════════
// File touch helpers
// ═══════════════════════════════════════════════════════════════════════════

/** A tiny retry wrapper around `writeFileSync` that ensures the content has
 *  actually changed between attempts (so Bun's ESM cache doesn't dedupe).
 *
 *  Writes the full `finalContent` on every attempt, but appends a unique
 *  timestamp comment on retries so fs.watch sees a distinct mtime + size
 *  (some Windows filesystems coalesce writes with identical content to
 *  the same mtime bucket). */
export async function touchUntilSeen(
  filePath: string,
  finalContent: string,
  observedCount: () => number,
  maxAttempts = 4,
): Promise<void> {
  const before = observedCount();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const suffix = attempt === 0 ? "" : `\n// retry-${Date.now()}-${attempt}\n`;
    writeFileSync(filePath, finalContent + suffix);
    await sleep(WATCH_SETTLE_MS);
    if (observedCount() > before) return;
  }
}

/** Create a fresh tmpdir for a single test. Caller owns cleanup. */
export function makeTempRoot(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), `mandu-hmr-${prefix}-`));
}

/** Remove a tmpdir, swallowing EBUSY on Windows (locked dll cache etc). */
export function rmTempRoot(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* Best effort on Windows. */
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait until `predicate()` is true or `timeoutMs` elapses. Polls every
 *  50 ms. Returns the last predicate result — caller asserts `true`. */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(50);
  }
  return predicate();
}

// ═══════════════════════════════════════════════════════════════════════════
// Change-kind file mapping
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve the on-disk path that corresponds to a given `ChangeKind` inside a
 * fixture. Returns `null` for combinations that don't exist in the given
 * project form (e.g. `island.client.tsx` in `pure-ssg`) — the caller should
 * skip the test rather than trying to modify.
 */
export function resolveChangeFile(
  rootDir: string,
  form: ProjectForm,
  changeKind: ScenarioCell["changeKind"],
): string | null {
  switch (changeKind) {
    case "app/page.tsx":
      return path.join(rootDir, "app/page.tsx");
    case "app/slot.ts":
      return path.join(rootDir, "app/page.slot.ts");
    case "app/layout.tsx":
      return path.join(rootDir, "app/layout.tsx");
    case "app/contract.ts":
      return path.join(rootDir, "spec/contracts/sample.contract.ts");
    case "spec/resource.ts":
      return path.join(rootDir, "spec/resources/sample.resource.ts");
    case "app/middleware.ts":
      return path.join(rootDir, "app/middleware.ts");
    case "island.client.tsx":
      // Pure-SSG projects have no island. Caller filters these via
      // `expectedBehavior === "n/a"`.
      return form === "pure-ssg"
        ? null
        : path.join(rootDir, "app/widget.client.tsx");
    case "src/shared/**":
      return path.join(rootDir, "src/shared/util.ts");
    case "src/top-level.ts":
      return path.join(rootDir, "src/top-level.ts");
    case "css":
      return path.join(rootDir, "app-styles.css");
    case "mandu.config.ts":
      return path.join(rootDir, "mandu.config.ts");
    case ".env":
      return path.join(rootDir, ".env");
  }
}

/**
 * Build the edit content for a given change kind. Always returns a NEW string
 * containing a fresh timestamp-based marker so each invocation produces a
 * different byte sequence — a defense against fs watchers that deduplicate
 * writes with identical content.
 *
 * Returned as `{ content, marker }` so callers can both (a) persist the
 * content and (b) grep / assert on the marker downstream.
 */
export function buildEditContent(
  changeKind: ScenarioCell["changeKind"],
): { content: string; marker: string } {
  const marker = `HMR_MATRIX_EDIT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { content: renderEditContent(changeKind, marker), marker };
}

/**
 * Apply a "meaningful" edit to the file backing `changeKind` and wait for the
 * watcher to surface it through `observedCount`. Retries up to 4 times with
 * content perturbation on each attempt — this is the Windows fs.watch fix
 * that `dev-reliability.test.ts`'s `touchUntilSeen` also applies.
 *
 * If no signal is observed after 4 attempts, returns without throwing — the
 * caller's `waitFor` will surface the actual assertion failure with useful
 * diagnostics. Swallowing here avoids doubling the failure report.
 */
export async function applyEditAndAwait(
  filePath: string,
  changeKind: ScenarioCell["changeKind"],
  observedCount: () => number,
): Promise<string> {
  const { content, marker } = buildEditContent(changeKind);
  await touchUntilSeen(filePath, content, observedCount);
  return marker;
}

/**
 * One-shot version of `applyEditAndAwait` for callers that don't have an
 * observation counter (e.g. negative-path tests where "no event" is the
 * expected outcome). Just writes the file once.
 */
export function applyEdit(
  filePath: string,
  changeKind: ScenarioCell["changeKind"],
): string {
  const { content, marker } = buildEditContent(changeKind);
  writeFileSync(filePath, content);
  return marker;
}

function renderEditContent(
  changeKind: ScenarioCell["changeKind"],
  marker: string,
): string {
  switch (changeKind) {
    case "app/page.tsx":
      return `export default function HomePage() { return <div data-marker="${marker}">updated home</div>; }\n`;
    case "app/slot.ts":
      return `export async function load() { return { marker: "${marker}" }; }\n`;
    case "app/layout.tsx":
      return `export default function Layout({ children }) { return <div data-layout="${marker}">{children}</div>; }\n`;
    case "app/contract.ts":
      return `import { z } from "zod";\nexport const contract = { request: z.object({ marker: z.literal("${marker}") }) };\n`;
    case "spec/resource.ts":
      return `export const resource = { name: "${marker}", fields: [] };\n`;
    case "app/middleware.ts":
      return `export function middleware() { return { marker: "${marker}" }; }\n`;
    case "island.client.tsx":
      return `import React from "react";\nexport default function Widget() { return <button data-marker="${marker}">click</button>; }\n`;
    case "src/shared/**":
      return `export const SHARED = "${marker}";\n`;
    case "src/top-level.ts":
      return `export const TOP = "${marker}";\n`;
    case "css":
      return `/* ${marker} */ body { color: blue; }\n`;
    case "mandu.config.ts":
      return `export default { server: { port: 0 }, _marker: "${marker}" };\n`;
    case ".env":
      return `FIXTURE_MARKER=${marker}\n`;
  }
}
