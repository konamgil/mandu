/**
 * Mandu Dev Bundler 🔥
 * 개발 모드 번들링 + HMR (Hot Module Replacement)
 */

import type { RoutesManifest, RouteSpec } from "../spec/schema";
import { buildClientBundles } from "./build";
import type { BundleResult } from "./types";
import { PORTS, TIMEOUTS } from "../constants";
import { mark, measure, withPerf } from "../perf";
import { HMR_PERF } from "../perf/hmr-markers";
import type {
  CoalescedChange,
  ViteHMRPayload,
  HMRReplayEnvelope,
} from "./hmr-types";
import { MAX_REPLAY_BUFFER, REPLAY_MAX_AGE_MS } from "./hmr-types";
import path from "path";
import fs from "fs";

/**
 * #184: 공통 디렉토리 변경 시 사용하는 sentinel.
 * `onSSRChange`에 특정 파일 경로 대신 이 상수를 전달하면 "전체 SSR 레지스트리 invalidate" 의미.
 */
export const SSR_CHANGE_WILDCARD = "*";

export interface DevBundlerOptions {
  /** 프로젝트 루트 */
  rootDir: string;
  /** 라우트 매니페스트 */
  manifest: RoutesManifest;
  /** 재빌드 콜백 */
  onRebuild?: (result: RebuildResult) => void;
  /** 에러 콜백 */
  onError?: (error: Error, routeId?: string) => void;
  /**
   * SSR 파일 변경 콜백 (page.tsx, layout.tsx 등)
   * 클라이언트 번들 리빌드 없이 서버 핸들러 재등록이 필요한 경우 호출.
   * `SSR_CHANGE_WILDCARD` ("*")를 받으면 전체 레지스트리 invalidate 의미 (#184).
   * Promise 반환 시 await 되므로 레지스트리 clear가 완료된 후 HMR reload broadcast 가능.
   */
  onSSRChange?: (filePath: string) => void | Promise<void>;
  /**
   * API route 파일 변경 콜백 (route.ts 등)
   * API 핸들러 재등록이 필요한 경우 호출
   */
  onAPIChange?: (filePath: string) => void | Promise<void>;
  /**
   * Phase 7.0 R2 Agent D — Config/env change callback.
   *
   * Fires when `mandu.config.ts` or any `.env*` file at the project root
   * changes. The CLI's `dev.ts` wires this to `restartDevServer()` so the
   * new config values take effect (Node caches `process.env.KEY` per-
   * process, so an auto-restart is the only reliable reload path).
   *
   * Multiple rapid changes in one debounce window fire this ONCE (per-file
   * debounce + `pendingBuildSet` coalescing in `classifyBatch`).
   */
  onConfigReload?: (filePath: string) => void | Promise<void>;
  /**
   * Phase 7.0 R2 Agent D — Contract / Resource change callback.
   *
   * Fires when a contract (`spec/contracts/foo.contract.ts` — nested
   * directories allowed) or resource schema
   * (`spec/resources/user.resource.ts`) file changes. Consumers typically:
   *   - Re-run `generateResourceArtifacts` for `.resource.ts` changes
   *     (so derived `.mandu/generated/server/contracts`,
   *     `types`, `client`, and `spec/slots` stay in sync).
   *   - For `.contract.ts`, re-register the route handler that consumed
   *     the contract (usually via `onSSRChange(SSR_CHANGE_WILDCARD)`).
   *
   * When both fire in the same batch, `classifyBatch` returns
   * `"resource-regen"` exactly once.
   */
  onResourceChange?: (filePath: string) => void | Promise<void>;
  /**
   * Phase 7.0 R2 Agent D — package.json change notification.
   *
   * We intentionally do NOT auto-restart on `package.json` — dependency
   * installs often write the file multiple times in quick succession, and
   * a restart loop mid-install would be destructive. The callback exists
   * so the CLI can print a "manual restart required" hint to the user.
   */
  onPackageJsonChange?: (filePath: string) => void;
  /**
   * 추가 watch 디렉토리 (공통 컴포넌트 등)
   * 상대 경로 또는 절대 경로 모두 지원
   * 기본값: ["src/components", "components", "src/shared", "shared", "src/lib", "lib", "src/hooks", "hooks", "src/utils", "utils"]
   */
  watchDirs?: string[];
  /**
   * 기본 watch 디렉토리 비활성화
   * true로 설정하면 watchDirs만 감시
   */
  disableDefaultWatchDirs?: boolean;
}

export interface RebuildResult {
  routeId: string;
  success: boolean;
  buildTime: number;
  error?: string;
}

export interface DevBundler {
  /** 초기 빌드 결과 */
  initialBuild: BundleResult;
  /** 파일 감시 중지 */
  close: () => void;
}

/**
 * #180: 파일 경로 비교를 위한 정규화.
 * - 절대 경로로 변환 (path.resolve)
 * - 백슬래시 → 포워드슬래시
 * - Windows에서는 case-insensitive 매칭 (소문자화)
 *
 * 동적 라우트 폴더(`[lang]` 등) 변경 감지가 누락되던 문제는 watcher가 보고하는
 * `path.join(dir, filename)`과 `serverModuleSet` 등록 시의 `path.resolve(rootDir, ...)`
 * 가 드라이브 문자 대소문자/슬래시 표기 차이로 어긋나서 발생했음.
 */
function normalizeFsPath(p: string): string {
  const resolved = path.resolve(p).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * 기본 공통 컴포넌트 디렉토리 목록 (B1 fix — Phase 7.0 R1 Agent A).
 *
 * Historical (pre-B1) behavior: only `src/components`, `src/shared`, etc. were
 * watched, which silently ignored `src/foo.ts` (top-level files) — a real
 * regression hit in `demo/starter/src/playground-shell.tsx`. B1 widens the
 * default to include **`src/` itself** (recursive, node_modules-excluded) plus
 * the legacy unprefixed roots so existing projects without an `src/` dir
 * continue to work.
 */
const DEFAULT_COMMON_DIRS = [
  "src",                // B1 fix — top-level files under `src/` (was missing)
  "components",
  "shared",
  "lib",
  "hooks",
  "utils",
  "client",
  "islands",
];

/**
 * Path segments excluded from `isInCommonDir` / watcher dispatch.
 *
 * We intentionally use **absolute path segment prefixes** (join-style) so a
 * project file named `dist-nice.ts` is NOT treated as excluded. The check is
 * "contains `/<segment>/`" against the normalized forward-slash path.
 *
 * `pagefile.sys` / `hiberfil.sys` / `DumpStack.log.tmp` are Windows system
 * files that can bubble up into `fs.watch` on the drive root under pathological
 * setups — belt-and-suspenders.
 */
const WATCH_EXCLUDE_SEGMENTS: readonly string[] = [
  "node_modules",
  ".mandu",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".cache",
  ".turbo",
];

/**
 * Filenames explicitly ignored (Windows system files + editor artifacts).
 *
 * Stored lowercase so the check compares apples-to-apples with
 * `normalizeFsPath`'s win32 lowercasing. On posix the comparison is still
 * lowercase — intentional, since the Windows system files these target
 * never legitimately appear on Linux/mac anyway.
 */
const WATCH_EXCLUDE_FILENAMES: ReadonlySet<string> = new Set([
  "pagefile.sys",
  "hiberfil.sys",
  "dumpstack.log",
  "dumpstack.log.tmp",
  "swapfile.sys",
]);

/**
 * Returns true if the given **normalized (forward-slash, lowercase on win32)**
 * path is inside a directory we should ignore (e.g. `node_modules`).
 *
 * Callers must pass paths already through `normalizeFsPath`.
 */
export function isExcludedPath(normalizedPath: string): boolean {
  // Filename-level ignores. We lowercase the basename BEFORE comparing so the
  // check behaves identically whether the caller ran `normalizeFsPath` (which
  // lowercases only on win32) or not — Windows system files like
  // `DumpStack.log` have no valid posix counterpart, so lowercasing is safe
  // on linux too.
  const basename = (normalizedPath.split("/").pop() ?? "").toLowerCase();
  if (WATCH_EXCLUDE_FILENAMES.has(basename)) return true;

  // Directory-segment ignores. Wrap with slashes to avoid partial-name matches
  // (e.g. `dist-ribution.ts` must not be excluded by `dist`).
  for (const segment of WATCH_EXCLUDE_SEGMENTS) {
    if (normalizedPath.includes(`/${segment}/`)) return true;
  }
  return false;
}

/**
 * Phase 7.0 R2 Agent D — Config-file predicate.
 *
 * Matches `mandu.config.ts` / `mandu.config.js` / `.env` / `.env.local` /
 * `.env.development` / `.env.production` (and similar `.env.*` variants)
 * at the **project root**. The argument must already be normalized —
 * callers should run `normalizeFsPath` first.
 *
 * We look at the basename (not a full path prefix) so the check is cheap
 * and cross-platform. The caller is responsible for restricting the
 * watch set to the project root — that's where a genuine config lives.
 * An `.env` deep inside `node_modules` (pathological) is already
 * excluded by `isExcludedPath`.
 */
export function isConfigOrEnvFile(normalizedPath: string): boolean {
  const basename = (normalizedPath.split("/").pop() ?? "").toLowerCase();
  // `mandu.config.ts|js|mjs|cjs` — accept .ts|.js for JS-only projects.
  if (
    basename === "mandu.config.ts" ||
    basename === "mandu.config.js" ||
    basename === "mandu.config.mjs" ||
    basename === "mandu.config.cjs"
  ) {
    return true;
  }
  // `.env` family. `.env` alone is valid; `.env.local`, `.env.development`,
  // `.env.production`, `.env.staging`, `.env.test` etc. all match.
  if (basename === ".env" || basename.startsWith(".env.")) {
    return true;
  }
  return false;
}

/**
 * Phase 7.0 R2 Agent D — Resource/Contract file predicate.
 *
 * Matches `*.resource.ts` (and `*.resource.tsx` for the rare JSX-in-
 * schema case) and `*.contract.ts|tsx`. These are user-authored schema
 * files that drive code-gen (`generateResourceArtifacts`) and Zod-based
 * route handlers.
 *
 * Intentionally NOT restricted to `spec/contracts` / `spec/resources` —
 * some projects keep contracts colocated with the route
 * (`app/api/users/users.contract.ts`). The `classifyBatch` caller
 * already ensures the path is inside the watched tree.
 */
export function isResourceOrContractFile(normalizedPath: string): boolean {
  return (
    normalizedPath.endsWith(".contract.ts") ||
    normalizedPath.endsWith(".contract.tsx") ||
    normalizedPath.endsWith(".resource.ts") ||
    normalizedPath.endsWith(".resource.tsx")
  );
}

/**
 * Phase 7.0 R2 Agent D — per-route `middleware.ts` predicate.
 *
 * Matches files whose basename is `middleware.ts` / `middleware.tsx`
 * (nested under any `app` subdirectory). Layout-level `middleware.ts`
 * at the project root is handled separately through the existing
 * runtime loader — those changes require a restart because the server
 * loads them at boot, not per-request. Per-route middleware is
 * re-scanned when the route graph is re-registered, so we funnel these
 * through the existing `api-only` rebuild path which already calls
 * `registerHandlers(manifest, true)`.
 */
export function isRouteMiddlewareFile(normalizedPath: string): boolean {
  return (
    normalizedPath.endsWith("/middleware.ts") ||
    normalizedPath.endsWith("/middleware.tsx")
  );
}

/**
 * Phase 7.0 R2 Agent D — `package.json` predicate.
 *
 * Matches the project-root `package.json`. Restricted to basename only —
 * nested `package.json` files (inside `node_modules`, workspace sub-
 * packages) are caught by `isExcludedPath` in `node_modules` /
 * `.mandu` trees, and workspace changes are outside the dev-time loop.
 */
export function isPackageJsonFile(normalizedPath: string): boolean {
  return (normalizedPath.split("/").pop() ?? "").toLowerCase() === "package.json";
}

/**
 * Test-only helper: invoke the internal `normalizeFsPath` implementation.
 * Exported so `dev-reliability.test.ts` can assert forward-slash / lower-case
 * normalization without duplicating the logic.
 *
 * Not part of the public API surface — prefixed with `_testOnly_` to signal
 * "do not consume in production code". If you need this elsewhere, lift
 * `normalizeFsPath` to a dedicated module.
 */
export function _testOnly_normalizeFsPath(p: string): string {
  return normalizeFsPath(p);
}

/** Test-only accessor for the default common-dir list (B1 coverage). */
export const _testOnly_DEFAULT_COMMON_DIRS = DEFAULT_COMMON_DIRS;

/** Test-only accessor for the watch exclude segments (B1 coverage). */
export const _testOnly_WATCH_EXCLUDE_SEGMENTS = WATCH_EXCLUDE_SEGMENTS;

/**
 * Phase 7.0 R2 Agent D — classification helper mirroring the in-bundler
 * `classifyBatch` priority rules WITHOUT the project-specific maps
 * (serverModuleSet / apiModuleSet / clientModuleToRoute / commonWatchDirs).
 *
 * Why a separate export: the in-bundler classifier is a closure over
 * live state (manifest-derived maps). Tests that want to prove the
 * **static** parts of the rule table — "a `.contract.ts` path is
 * resource-regen", "a `.env` path is config-reload", "middleware is
 * api-only" — would otherwise have to spin up a real `startDevBundler`
 * with a tempdir manifest, which slows every assertion to tens of ms.
 *
 * Signature and return type match the live classifier so a future
 * consolidation can swap them without a migration.
 */
export function _testOnly_classifyFileKind(
  file: string,
  options: { commonDirs?: readonly string[] } = {},
): "config-reload" | "resource-regen" | "api-only" | "common-dir" | "mixed" {
  const normalized = (function normalize(p: string): string {
    const resolved = path.resolve(p).replace(/\\/g, "/");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  })(file);

  if (isConfigOrEnvFile(normalized)) return "config-reload";
  if (isResourceOrContractFile(normalized)) return "resource-regen";
  if (isRouteMiddlewareFile(normalized)) return "api-only";
  if (options.commonDirs) {
    for (const d of options.commonDirs) {
      const nd = (function n(p: string): string {
        const r = path.resolve(p).replace(/\\/g, "/");
        return process.platform === "win32" ? r.toLowerCase() : r;
      })(d);
      if (normalized === nd || normalized.startsWith(nd + "/")) return "common-dir";
    }
  }
  return "mixed";
}

/**
 * 개발 모드 번들러 시작
 * 파일 변경 감시 및 자동 재빌드
 */
export async function startDevBundler(options: DevBundlerOptions): Promise<DevBundler> {
  const {
    rootDir,
    manifest,
    onRebuild,
    onError,
    onSSRChange,
    onAPIChange,
    onConfigReload,
    onResourceChange,
    onPackageJsonChange,
    watchDirs: customWatchDirs = [],
    disableDefaultWatchDirs = false,
  } = options;

  // 초기 빌드
  console.log("🔨 Initial client bundle build...");
  const initialBuild = await buildClientBundles(manifest, rootDir, {
    minify: false,
    sourcemap: true,
  });

  if (initialBuild.success) {
    console.log(`✅ Built ${initialBuild.stats.bundleCount} islands`);
  } else {
    console.error("⚠️  Initial build had errors:", initialBuild.errors);
  }

  // clientModule 경로에서 routeId 매핑 생성
  const clientModuleToRoute = new Map<string, string>();
  const serverModuleSet = new Set<string>(); // SSR 모듈 (page.tsx, layout.tsx)
  const apiModuleSet = new Set<string>(); // API 모듈 (route.ts)
  const watchDirs = new Set<string>();
  const commonWatchDirs = new Set<string>(); // 공통 디렉토리 (전체 재빌드 트리거)

  for (const route of manifest.routes) {
    if (route.clientModule) {
      const absPath = path.resolve(rootDir, route.clientModule);
      const normalizedPath = normalizeFsPath(absPath);
      clientModuleToRoute.set(normalizedPath, route.id);

      // Also register *.client.tsx/ts files in the same directory (#140)
      // e.g. if clientModule is app/page.island.tsx, also map app/page.client.tsx → same routeId
      const dir = path.dirname(absPath);
      const baseStem = path.basename(absPath).replace(/\.(island|client)\.(tsx?|jsx?)$/, "");
      for (const ext of [".client.tsx", ".client.ts", ".client.jsx", ".client.js"]) {
        const clientPath = normalizeFsPath(path.join(dir, baseStem + ext));
        if (clientPath !== normalizedPath) {
          clientModuleToRoute.set(clientPath, route.id);
        }
      }

      // 감시할 디렉토리 추가
      watchDirs.add(dir);
    }

    // SSR 모듈 등록 (page.tsx, layout.tsx) — #151
    if (route.componentModule) {
      const absPath = path.resolve(rootDir, route.componentModule);
      serverModuleSet.add(normalizeFsPath(absPath));
      watchDirs.add(path.dirname(absPath));
    }
    if (route.layoutChain) {
      for (const layoutPath of route.layoutChain) {
        const absPath = path.resolve(rootDir, layoutPath);
        serverModuleSet.add(normalizeFsPath(absPath));
        watchDirs.add(path.dirname(absPath));
      }
    }

    // Phase 7.1 R1 Agent A — slot dispatch integration (Option B).
    //
    // Prior to Phase 7.1 the bundler ignored `.slot.ts(x)` edits: they
    // hit no classification bucket and silently fell through to a
    // no-op in `_doBuild`. The CLI's chokidar-backed `watchFSRoutes`
    // worked around the gap by re-scanning the manifest, but that
    // path sits OUTSIDE `startDevBundler` and is not exercised by the
    // HMR matrix (see `packages/core/tests/hmr-matrix/matrix.spec.ts`
    // `KNOWN_BUNDLER_GAPS`).
    //
    // Option B — register the slot path into the existing
    // `serverModuleSet`. Semantically a slot IS an SSR-side data
    // loader (it runs before `componentModule` on the server to
    // populate typed props), so co-locating the dispatch with page /
    // layout is consistent. The existing `onSSRChange(filePath)` path
    // downstream in `_doBuild` already delivers the right signal —
    // the CLI's `handleSSRChange` will re-register the route handler
    // and broadcast a full-reload.
    //
    // We also add the slot's directory to `watchDirs` so fs.watch
    // actually delivers the event. For spec/slots/*.slot.ts the
    // `slotsDir` block below already covers this, but user-authored
    // colocated slots (e.g. `app/page.slot.ts`) live in app/ which is
    // picked up via the page's `watchDirs.add(path.dirname(absPath))`
    // line above — still, making the slot add explicit here keeps
    // the dispatch path honest against future manifest topologies.
    // Phase 7.2 R1 Agent C (H3 / L-03 audit): validate slotModule
    // path BEFORE it contributes to serverModuleSet / watchDirs.
    //
    // Before 7.2 the code trusted `route.slotModule` verbatim and a
    // tampered manifest with `slotModule: "../../../etc/passwd"` would
    // pollute `watchDirs` with directories outside the project root.
    // Downstream code (`bundledImport`, `registerHandlers`) already
    // ignored the raw path, but the defense-in-depth cost is tiny so
    // we reject obviously unsafe shapes here and keep the fs.watch
    // surface inside the project tree.
    //
    // Allowed shapes (matches the bundler's own output conventions):
    //   - `spec/slots/<id>.slot.ts(x)`          (auto-linked, fs-routes)
    //   - `app/**/<name>.slot.ts(x)`            (colocated user slots)
    //   - `[param]` brackets for dynamic routes are preserved
    //
    // Rejected shapes:
    //   - absolute paths (leading `/` or Windows `C:\`)
    //   - `..` anywhere in the path (traversal)
    //   - backslashes (fs-routes emits forward-slash only)
    //   - any char outside a conservative allowlist
    //
    // See `docs/security/phase-7-1-audit.md` §L-03.
    if (route.slotModule) {
      const SLOT_PATH_REGEX = /^(?:spec\/slots|app)\/[A-Za-z0-9_\-./\[\]]+\.slots?\.tsx?$/;
      const raw = route.slotModule;
      let accepted = false;
      if (
        typeof raw === "string" &&
        raw.length > 0 &&
        raw.length <= 512 &&
        !raw.includes("..") &&
        !raw.includes("\\") &&
        !raw.startsWith("/") &&
        !/^[A-Za-z]:/.test(raw) &&
        SLOT_PATH_REGEX.test(raw)
      ) {
        const absPath = path.resolve(rootDir, raw);
        // Belt-and-suspenders: canonicalized path must remain inside rootDir.
        const rootWithSep = path.resolve(rootDir) + path.sep;
        if (absPath.startsWith(rootWithSep) || absPath === path.resolve(rootDir)) {
          serverModuleSet.add(normalizeFsPath(absPath));
          watchDirs.add(path.dirname(absPath));
          accepted = true;
        }
      }
      if (!accepted) {
        // eslint-disable-next-line no-console
        console.warn(
          `[Mandu] slotModule rejected for route "${route.id}": ${raw}. ` +
            `Expected (spec/slots|app)/.../<name>.slot.ts(x) with no '..' or absolute prefix.`,
        );
      }
    }

    // Track API route modules for hot-reload
    if (route.kind === "api" && route.module) {
      const absPath = path.resolve(rootDir, route.module);
      apiModuleSet.add(normalizeFsPath(absPath));
      watchDirs.add(path.dirname(absPath));
    }
  }

  // spec/slots 디렉토리도 추가
  const slotsDir = path.join(rootDir, "spec", "slots");
  try {
    await fs.promises.access(slotsDir);
    watchDirs.add(slotsDir);
  } catch {
    // slots 디렉토리 없으면 무시
  }

  // Phase 7.0 R2 Agent D — spec/contracts and spec/resources directories.
  //
  // Pre-R2 behavior: these directories were NOT watched. Editing a Zod
  // schema (`spec/contracts/foo.contract.ts`) or resource definition
  // (`spec/resources/user.resource.ts`) required a manual dev-server
  // restart, because `classifyBatch` had no category for them and
  // `onSSRChange`/`onAPIChange` didn't fire. We add the directories to
  // the main watch set so the existing fs.watch dispatcher delivers
  // events; `classifyBatch` then routes them to `resource-regen`.
  const contractsDir = path.join(rootDir, "spec", "contracts");
  try {
    await fs.promises.access(contractsDir);
    watchDirs.add(contractsDir);
  } catch {
    // Contracts directory is optional — not all projects use Zod contracts.
  }
  const resourcesDir = path.join(rootDir, "spec", "resources");
  try {
    await fs.promises.access(resourcesDir);
    watchDirs.add(resourcesDir);
  } catch {
    // Resources directory is optional — projects without Resource-Centric
    // layer simply never hit this path.
  }

  // 공통 컴포넌트 디렉토리 추가 (기본 + 커스텀)
  const commonDirsToCheck = disableDefaultWatchDirs
    ? customWatchDirs
    : [...DEFAULT_COMMON_DIRS, ...customWatchDirs];

  const addCommonDir = async (dir: string): Promise<void> => {
    const absPath = path.isAbsolute(dir) ? dir : path.join(rootDir, dir);
    try {
      const stat = await fs.promises.stat(absPath);
      const watchPath = stat.isDirectory() ? absPath : path.dirname(absPath);
      await fs.promises.access(watchPath);
      commonWatchDirs.add(watchPath);
      watchDirs.add(watchPath);
    } catch {
      // 디렉토리 없으면 무시
    }
  };

  for (const dir of commonDirsToCheck) {
    await addCommonDir(dir);
  }

  // 파일 감시 설정
  const watchers: fs.FSWatcher[] = [];

  /**
   * B6 fix — per-file debounce Map (Phase 7.0 R1 Agent A).
   *
   * Pre-B6 behavior: a single module-scope `debounceTimer` was cleared on EVERY
   * fs event. Two rapid events on different files within `WATCHER_DEBOUNCE`
   * (100 ms) therefore dropped the earlier one. B6 gives each file its own
   * timer so an edit to file A does not cancel a pending edit to file B.
   *
   * Lifecycle: timers are created by `scheduleFileChange`, cleared on flush or
   * on `close()`. We call `.delete(key)` on flush to keep the Map bounded —
   * no leak from editing a single file repeatedly.
   */
  const perFileTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * B2 fix — multi-file pending build queue (Phase 7.0 R1 Agent A).
   *
   * Pre-B2 behavior: `pendingBuildFile: string | null` — the second and third
   * rapid-fire changes overwrote each other and were silently dropped. B2 uses
   * a Set so EVERY changed file during an in-flight build is retained and
   * flushed together after completion. Coalesce by `kind` to issue at most one
   * `buildClientBundles` call per batch when possible.
   */
  const pendingBuildSet = new Set<string>();

  // 동시 빌드 방지 (#121): 빌드 중에 변경 발생 시 다음 빌드 대기
  let isBuilding = false;

  /**
   * Paths already known to be inside a common directory, cached to avoid
   * repeating prefix checks for noisy watchers (IDE autosave bursts).
   */
  const isInCommonDir = (filePath: string): boolean => {
    const normalizedFile = normalizeFsPath(filePath);
    for (const commonDir of commonWatchDirs) {
      const normalizedCommon = normalizeFsPath(commonDir);
      if (
        normalizedFile === normalizedCommon ||
        normalizedFile.startsWith(normalizedCommon + "/")
      ) {
        return true;
      }
    }
    return false;
  };

  /**
   * Classify a batched `Set` of changed files for B2 coalescing.
   *
   * Kept simple on purpose — `_doBuild` downstream re-checks fine-grained
   * routing (clientModule / serverModule / API), so we only need the coarse
   * category used by the hmr-types contract.
   */
  const classifyBatch = (files: readonly string[]): CoalescedChange["kind"] => {
    let hasCommon = false;
    let hasSsr = false;
    let hasApi = false;
    let hasIsland = false;
    let hasCss = false;
    // Phase 7.0 R2 Agent D — new classification bits. These are tracked
    // alongside the existing categories so a batch that mixes a config
    // save with an island edit still surfaces the high-priority signal
    // (config-reload always wins — a restart invalidates everything
    // anyway).
    let hasConfigReload = false;
    let hasResourceRegen = false;

    for (const file of files) {
      const normalized = normalizeFsPath(file);

      // D — config/env files trump everything else. A restart subsumes
      // any other pending work so we can flag and continue.
      if (isConfigOrEnvFile(normalized)) {
        hasConfigReload = true;
        continue;
      }

      // D — contract/resource schema files are code-gen inputs. A
      // `.resource.ts` edit must re-run the generator; a `.contract.ts`
      // edit reshapes the Zod validator in SSR handlers. Both are
      // routed through `resource-regen`.
      if (isResourceOrContractFile(normalized)) {
        hasResourceRegen = true;
        continue;
      }

      if (normalized.endsWith(".css")) {
        hasCss = true;
        continue;
      }
      if (isInCommonDir(file)) {
        hasCommon = true;
        continue;
      }

      // D — per-route `middleware.ts` is treated as an API-level change
      // (the api-only rebuild path re-registers handlers, which is
      // exactly what a middleware change needs). We fall THROUGH to
      // the existing api category so coalescing logic is unchanged.
      if (isRouteMiddlewareFile(normalized)) {
        hasApi = true;
        continue;
      }

      if (apiModuleSet.has(normalized)) {
        hasApi = true;
        continue;
      }
      if (serverModuleSet.has(normalized)) {
        hasSsr = true;
        continue;
      }
      if (clientModuleToRoute.has(normalized)) {
        hasIsland = true;
        continue;
      }
      if (
        file.endsWith(".client.ts") ||
        file.endsWith(".client.tsx") ||
        file.endsWith(".island.tsx") ||
        file.endsWith(".island.ts")
      ) {
        hasIsland = true;
      }
    }

    // Phase 7.0 R2 Agent D — priority gates.
    //
    //   1. `config-reload` beats everything. A process restart will pick
    //      up all other changes on the next boot; there's no value in
    //      rebuilding before we throw the process away.
    //   2. `resource-regen` beats common-dir because code-gen artifacts
    //      feed into common-dir files — running them in reverse order
    //      would cause a stale rebuild.
    if (hasConfigReload) return "config-reload";
    if (hasResourceRegen) return "resource-regen";

    // Common-dir dominates — it already fans out to every island + SSR
    // registry. No point in double-classifying "mixed" when a fan-out fix
    // obsoletes the individual changes.
    if (hasCommon) return "common-dir";

    const categories = [hasSsr, hasApi, hasIsland, hasCss].filter(Boolean).length;
    if (categories === 0) return "mixed";
    if (categories > 1) return "mixed";
    if (hasSsr) return "ssr-only";
    if (hasApi) return "api-only";
    if (hasIsland) return "islands-only";
    if (hasCss) return "css-only";
    return "mixed";
  };

  /**
   * Flush the pending build queue as a single coalesced batch. Prefers a
   * common-dir path when any file in the batch triggers one — that already
   * fans out to every island + SSR registry invalidation, so processing the
   * other files individually would be wasted work.
   *
   * Called by `handleFileChange`'s retry loop when `pendingBuildSet` is
   * non-empty; also safe to call directly from watchers if the queue contract
   * evolves.
   */
  const flushPendingBatch = async (): Promise<void> => {
    if (pendingBuildSet.size === 0) return;
    const files = Array.from(pendingBuildSet);
    pendingBuildSet.clear();

    const kind = classifyBatch(files);

    // Phase 7.0 R2 Agent D — config-reload: fire ONCE and return. Once a
    // restart has been requested the rest of the batch is moot.
    if (kind === "config-reload") {
      const configFile =
        files.find((f) => isConfigOrEnvFile(normalizeFsPath(f))) ?? files[0];
      await handleConfigReload(configFile);
      return;
    }

    // Phase 7.0 R2 Agent D — resource-regen: coalesce to ONE generator
    // invocation. If 5 `*.resource.ts` saves arrive in one debounce
    // window we only want `generateResourceArtifacts` run per distinct
    // schema; the coalesce helper dedupes by normalized path.
    if (kind === "resource-regen") {
      const resourceFiles = files.filter((f) =>
        isResourceOrContractFile(normalizeFsPath(f)),
      );
      await handleResourceRegenBatch(resourceFiles);
      return;
    }

    // Common-dir dominates: one full-reload-adjacent rebuild covers everyone.
    if (kind === "common-dir") {
      await handleFileChange(files.find((f) => isInCommonDir(f)) ?? files[0]);
      return;
    }

    // Otherwise fan out. Each individual handleFileChange is idempotent —
    // if someone edits 4 siblings the build semaphore serializes them, but
    // none is dropped.
    for (const file of files) {
      try {
        await handleFileChange(file);
      } catch (retryError) {
        console.error(
          "[Mandu HMR] batch flush error:",
          retryError instanceof Error ? retryError.message : String(retryError),
        );
      }
    }
  };

  /**
   * Phase 7.0 R2 Agent D — dispatch a single config/env change.
   *
   * Fires `onConfigReload` exactly once per batch. The CLI wires this to
   * `restartDevServer()` (`packages/cli/src/commands/dev.ts`) — we don't
   * perform the restart here because the bundler doesn't own the HTTP
   * server lifecycle.
   *
   * Wrapped in `withPerf(HMR_PERF.FILE_DETECT)` so `MANDU_PERF=1` can
   * attribute config-save latency — but the end-to-end "saw save →
   * server ready" marker is owned by the CLI (it knows the restart
   * walltime). No REBUILD_TOTAL marker here — the usual rebuild is
   * replaced by a full restart.
   */
  const handleConfigReload = async (filePath: string): Promise<void> => {
    if (!onConfigReload) {
      console.log(
        `[Mandu HMR] ${path.basename(filePath)} changed — restart required`,
      );
      return;
    }
    mark(HMR_PERF.FILE_DETECT);
    measure(HMR_PERF.FILE_DETECT, HMR_PERF.FILE_DETECT);
    try {
      await Promise.resolve(onConfigReload(filePath));
    } catch (err) {
      console.error(
        `[Mandu HMR] config-reload callback threw:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  /**
   * Phase 7.0 R2 Agent D — batch-dispatch resource/contract changes.
   *
   * Each distinct file fires `onResourceChange` once. We intentionally
   * call the callback per-file (not once per batch) because the consumer
   * typically needs to:
   *   1. `parseResourceSchema(filePath)` — file-scoped
   *   2. `generateResourceArtifacts(parsed, opts)` — file-scoped
   *   3. re-register the route handlers that depend on the artifacts
   *
   * After all callbacks complete we fire the existing
   * `onSSRChange(SSR_CHANGE_WILDCARD)` once so the SSR registry picks up
   * the regenerated artifacts. This mirrors how common-dir changes
   * already drive the SSR reload path.
   */
  const handleResourceRegenBatch = async (files: readonly string[]): Promise<void> => {
    if (files.length === 0) return;
    const callback = onResourceChange;
    if (callback) {
      await withPerf(HMR_PERF.SSR_HANDLER_RELOAD, async () => {
        // Process sequentially — multiple concurrent `generateResourceArtifacts`
        // racing on the same `.mandu/generated/` tree is a known foot-gun
        // (Bun.write is atomic per file, but the generator writes 4-5
        // sibling files per resource and we don't want partial updates
        // visible to a concurrent SSR handler re-register).
        for (const file of files) {
          try {
            await Promise.resolve(callback(file));
          } catch (err) {
            console.error(
              `[Mandu HMR] resource-change callback threw for ${path.basename(file)}:`,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
      });
    } else {
      console.log(
        `[Mandu HMR] ${files.length} resource/contract file(s) changed — no handler registered`,
      );
    }
    // Fire an SSR invalidation so the routes that consume the regenerated
    // contracts pick up the new Zod schemas. Same signal as common-dir —
    // `ssrChangeQueue` in the CLI serializes this against the resource-
    // change callback above.
    if (onSSRChange) {
      try {
        await Promise.resolve(onSSRChange(SSR_CHANGE_WILDCARD));
      } catch (err) {
        console.error(
          `[Mandu HMR] SSR invalidation after resource regen threw:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  };

  const handleFileChange = async (changedFile: string): Promise<void> => {
    // 동시 빌드 방지 (#121) — B2 강화: 빌드 중이면 Set에 추가 (drop 방지).
    if (isBuilding) {
      pendingBuildSet.add(changedFile);
      return;
    }

    // Phase 7.0 R2 Agent D — pre-dispatch for config/resource/package.json.
    //
    // These go through the SAME per-file debounce (scheduleFileChange →
    // handleFileChange) but bypass `_doBuild` because they don't produce
    // a client bundle. We route them BEFORE setting `isBuilding` so the
    // resource-regen callback is free to enqueue subsequent island edits
    // while it runs — the callback may itself trigger a generator that
    // touches files, and we do not want a recursive isBuilding deadlock.
    const normalized = normalizeFsPath(changedFile);
    if (isConfigOrEnvFile(normalized)) {
      await handleConfigReload(changedFile);
      return;
    }
    if (isResourceOrContractFile(normalized)) {
      await handleResourceRegenBatch([changedFile]);
      return;
    }
    if (isPackageJsonFile(normalized)) {
      // Advisory notification only — a `package.json` save on npm install
      // fires multiple times in <100 ms, so auto-restart would loop. The
      // callback prints a hint but takes no action.
      if (onPackageJsonChange) {
        try {
          onPackageJsonChange(changedFile);
        } catch (err) {
          console.error(
            `[Mandu HMR] package-json callback threw:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      } else {
        console.log(
          `[Mandu HMR] package.json changed — run 'r' to restart when dependencies settle`,
        );
      }
      return;
    }

    isBuilding = true;
    mark("dev:rebuild");
    mark(HMR_PERF.REBUILD_TOTAL);
    try {
      await _doBuild(changedFile);
    } finally {
      measure("dev:rebuild", "dev:rebuild");
      measure(HMR_PERF.REBUILD_TOTAL, HMR_PERF.REBUILD_TOTAL);
      isBuilding = false;
      // B2: 대기 중인 모든 파일을 batch로 flush.
      if (pendingBuildSet.size > 0) {
        try {
          await flushPendingBatch();
        } catch (retryError) {
          console.error(
            `❌ Retry build error:`,
            retryError instanceof Error ? retryError.message : String(retryError),
          );
          console.log(`   ⏳ Waiting for next file change to retry...`);
        }
      }
    }
  };

  /**
   * Per-file debounce scheduler (B6 fix).
   *
   * Creates or restarts ONE timer keyed by the normalized path. The timer
   * fires `handleFileChange` after `WATCHER_DEBOUNCE` quiet time. If the same
   * file fires again within the window, we reset only that file's timer — a
   * second file keeps its own timeline.
   *
   * Errors from the scheduled handler are caught here to prevent an
   * unhandled promise rejection from killing the watcher loop (#10).
   */
  const scheduleFileChange = (fullPath: string): void => {
    const key = normalizeFsPath(fullPath);
    const existing = perFileTimers.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      perFileTimers.delete(key);
      mark(HMR_PERF.DEBOUNCE_FLUSH);
      measure(HMR_PERF.DEBOUNCE_FLUSH, HMR_PERF.DEBOUNCE_FLUSH);
      handleFileChange(fullPath).catch((err) => {
        console.error(
          "[Mandu HMR] file-change handler error:",
          err instanceof Error ? err.message : String(err),
        );
      });
    }, TIMEOUTS.WATCHER_DEBOUNCE);

    perFileTimers.set(key, timer);
  };

  const _doBuild = async (changedFile: string) => {
    const normalizedPath = normalizeFsPath(changedFile);

    // 공통 컴포넌트 디렉토리 변경 → Island만 재빌드 + SSR 레지스트리 invalidate (#184, #185)
    if (isInCommonDir(changedFile)) {
      console.log(`\n🔄 Common file changed: ${path.basename(changedFile)}`);
      console.log(`   Rebuilding islands (framework bundles skipped)...`);
      const startTime = performance.now();

      try {
        // #185: framework 번들 (runtime/router/vendor/devtools) 스킵 — 사용자 코드 변경 시 불필요
        const result = await buildClientBundles(manifest, rootDir, {
          minify: false,
          sourcemap: true,
          skipFrameworkBundles: true,
        });

        const buildTime = performance.now() - startTime;

        if (result.success) {
          // #184: common dir 변경은 SSR 모듈 캐시 invalidation이 필요 — wildcard 시그널
          // 빌드 성공한 경우에만 SSR 레지스트리를 clear (실패 시 마지막 good state 유지)
          // 주의: Bun의 transitive ESM 캐시는 프로세스 레벨이라 이 시그널만으로는
          //      `src/shared/**`을 transitive하게 import하는 SSR 모듈까지 완전히 갱신되지 않음.
          //      진짜 해결은 subprocess/worker 기반 SSR eval이 필요 (follow-up 이슈).
          if (onSSRChange) {
            try {
              await Promise.resolve(onSSRChange(SSR_CHANGE_WILDCARD));
            } catch (ssrError) {
              console.warn(`⚠️  SSR invalidation failed:`, ssrError instanceof Error ? ssrError.message : ssrError);
            }
          }

          console.log(`✅ Rebuilt ${result.stats.bundleCount} islands in ${buildTime.toFixed(0)}ms`);
          onRebuild?.({
            routeId: "*", // 전체 재빌드 표시
            success: true,
            buildTime,
          });
        } else {
          console.error(`❌ Build failed:`, result.errors);
          console.log(`   ⏳ SSR registry not invalidated (keeping last good state)`);
          onRebuild?.({
            routeId: "*",
            success: false,
            buildTime,
            error: result.errors.join(", "),
          });
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`❌ Build error:`, err.message);
        console.log(`   ⏳ Waiting for next file change to retry...`);
        onError?.(err, "*");
      }
      return;
    }

    // clientModule 매핑에서 routeId 찾기
    let routeId = clientModuleToRoute.get(normalizedPath);

    // Fallback for *.client.tsx/ts: find route whose clientModule is in the same directory (#140)
    // basename matching (e.g. "page" !== "index") is unreliable — use directory-based matching instead
    if (!routeId && (changedFile.endsWith(".client.ts") || changedFile.endsWith(".client.tsx"))) {
      const changedDir = normalizeFsPath(path.dirname(path.resolve(rootDir, changedFile)));
      const matchedRoute = manifest.routes.find((r) => {
        if (!r.clientModule) return false;
        const routeDir = normalizeFsPath(path.dirname(path.resolve(rootDir, r.clientModule)));
        return routeDir === changedDir;
      });
      if (matchedRoute) {
        routeId = matchedRoute.id;
      }
    }

    if (!routeId) {
      // SSR 모듈 변경 감지 (page.tsx, layout.tsx) — #151
      if (onSSRChange && serverModuleSet.has(normalizedPath)) {
        console.log(`\n🔄 SSR file changed: ${path.basename(changedFile)}`);
        onSSRChange(normalizedPath);
        return;
      }
      // API 모듈 변경 감지 (route.ts)
      if (onAPIChange && apiModuleSet.has(normalizedPath)) {
        console.log(`\n🔄 API route changed: ${path.basename(changedFile)}`);
        onAPIChange(normalizedPath);
        return;
      }
      // Phase 7.0 R2 Agent D — route middleware change.
      // `app/**/middleware.ts` isn't in apiModuleSet (not registered as a
      // route handler) but reuses the API reload path: the underlying
      // `registerManifestHandlers` re-imports middleware via the bundled
      // import chain. Falls through to `onAPIChange` so the CLI can
      // reuse its existing `handleAPIChange` plumbing.
      if (onAPIChange && isRouteMiddlewareFile(normalizedPath)) {
        console.log(`\n🔄 Middleware changed: ${path.basename(changedFile)}`);
        onAPIChange(normalizedPath);
      }
      return;
    }

    const route = manifest.routes.find((r) => r.id === routeId);
    if (!route || !route.clientModule) return;

    console.log(`\n🔄 Rebuilding island: ${routeId}`);
    const startTime = performance.now();

    try {
      // 단일 island만 재빌드 (Runtime/Router/Vendor 스킵, #122)
      const result = await buildClientBundles(manifest, rootDir, {
        minify: false,
        sourcemap: true,
        targetRouteIds: [routeId],
      });

      const buildTime = performance.now() - startTime;

      if (result.success) {
        console.log(`✅ Rebuilt in ${buildTime.toFixed(0)}ms`);
        onRebuild?.({
          routeId,
          success: true,
          buildTime,
        });
      } else {
        console.error(`❌ Build failed:`, result.errors);
        console.log(`   ⏳ Previous bundle preserved. Waiting for next file change to retry...`);
        onRebuild?.({
          routeId,
          success: false,
          buildTime,
          error: result.errors.join(", "),
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`❌ Build error:`, err.message);
      console.log(`   ⏳ Previous bundle preserved. Waiting for next file change to retry...`);
      onError?.(err, routeId);
    }
  };

  /**
   * Phase 7.0 R2 Agent D — filter predicate for the main recursive
   * watchers. Centralized so the config-root watcher (below) and the
   * directory watchers share the same "is this worth dispatching?"
   * check. Files that match one of the Agent D kinds are accepted even
   * though they don't end in `.ts`/`.tsx` — e.g. `.env`.
   */
  const shouldDispatch = (normalizedFull: string, filename: string): boolean => {
    // OS / build-artifact exclusions come first — we never want a
    // `node_modules` event to even hit the perf marker.
    if (isExcludedPath(normalizedFull)) return false;

    // Existing contract: TS/TSX files in user source are always eligible.
    // Agent D kinds extend the accept list to non-TS files so `.env` and
    // `package.json` can surface.
    if (filename.endsWith(".ts") || filename.endsWith(".tsx")) return true;

    // Agent D new file kinds.
    if (
      isConfigOrEnvFile(normalizedFull) ||
      isPackageJsonFile(normalizedFull)
    ) {
      return true;
    }
    return false;
  };

  // 각 디렉토리에 watcher 설정 — B1/B6 fix
  for (const dir of watchDirs) {
    try {
      const watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename) return;

        const fullPath = path.join(dir, filename);
        const normalizedFull = normalizeFsPath(fullPath);

        // B1 fix — exclude `node_modules`, `.mandu`, `dist`, `build`, OS files.
        // Must run on the FULL path (filename alone loses directory context when
        // `recursive:true` reports a deep subpath).
        if (!shouldDispatch(normalizedFull, filename)) return;

        mark(HMR_PERF.FILE_DETECT);
        measure(HMR_PERF.FILE_DETECT, HMR_PERF.FILE_DETECT);

        // B6 fix — per-file debounce (replaces global single timer).
        scheduleFileChange(fullPath);
      });

      watchers.push(watcher);
    } catch {
      console.warn(`⚠️  Cannot watch directory: ${dir}`);
    }
  }

  /**
   * Phase 7.0 R2 Agent D — project-root watcher for config/env/package.json.
   *
   * Why a SEPARATE watcher:
   *   - `fs.watch(rootDir, { recursive: true })` would fire for every file
   *     in the entire tree — we only want the root-level config files.
   *     The main per-directory watchers already cover `src/`, `app/`,
   *     `spec/`, etc.
   *   - Non-recursive `fs.watch(rootDir)` fires ONLY for direct children,
   *     which is exactly what `mandu.config.ts`, `.env`, `package.json`
   *     need.
   *
   * This watcher lives alongside the others in the `watchers` array so
   * `close()` tears everything down in one pass.
   */
  try {
    const rootWatcher = fs.watch(rootDir, { recursive: false }, (event, filename) => {
      if (!filename) return;

      const fullPath = path.join(rootDir, filename);
      const normalizedFull = normalizeFsPath(fullPath);

      // Shared exclusions — even if someone crafts a bizarre `.mandu`
      // symlink at the project root, the `isExcludedPath` guard catches it.
      if (isExcludedPath(normalizedFull)) return;

      // Only the three kinds this watcher owns. A random `.md` or
      // `tsconfig.json` save at the root must NOT be picked up here
      // (tsconfig is interesting but needs a separate opt-in — outside
      // this phase's scope).
      const isConfig = isConfigOrEnvFile(normalizedFull);
      const isPkg = isPackageJsonFile(normalizedFull);
      if (!isConfig && !isPkg) return;

      mark(HMR_PERF.FILE_DETECT);
      measure(HMR_PERF.FILE_DETECT, HMR_PERF.FILE_DETECT);
      scheduleFileChange(fullPath);
    });
    watchers.push(rootWatcher);
  } catch {
    console.warn(`⚠️  Cannot watch project root for config/env changes: ${rootDir}`);
  }

  if (watchers.length > 0) {
    console.log(`👀 Watching ${watchers.length} directories for changes...`);
    if (commonWatchDirs.size > 0) {
      const commonDirNames = Array.from(commonWatchDirs)
        .map(d => (path.relative(rootDir, d) || ".").replace(/\\/g, "/"))
        .join(", ");
      console.log(`📦 Common dirs (full rebuild): ${commonDirNames}`);
    }
  }

  return {
    initialBuild,
    close: () => {
      // B6: clear all per-file timers to release event-loop refs.
      for (const timer of perFileTimers.values()) {
        clearTimeout(timer);
      }
      perFileTimers.clear();
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}

/**
 * HMR WebSocket 서버
 *
 * Phase 7.0 R1 Agent C: added replay buffer (B8), Vite-compat wire format
 * broadcast, and `?since=<id>` reconnect handshake. The classic
 * `broadcast(HMRMessage)` API is kept for existing callers; a second
 * `broadcastVite(ViteHMRPayload)` channel serves external devtools that
 * speak the Vite HMR WebSocket protocol.
 */
export interface HMRServer {
  /** 연결된 클라이언트 수 */
  clientCount: number;
  /** 모든 클라이언트에게 메시지 전송 — 내부 Mandu 포맷. */
  broadcast: (message: HMRMessage) => void;
  /**
   * Broadcast a Vite-compat HMR payload. The payload is queued in the
   * replay buffer so reconnecting clients can resume with `?since=<id>`
   * and does not need a Mandu-side wrapper shape. External devtools
   * that speak the Vite HMR protocol consume this directly.
   */
  broadcastVite: (payload: ViteHMRPayload) => HMRReplayEnvelope;
  /** 서버 중지 */
  close: () => void;
  /** 재시작 핸들러 등록 */
  setRestartHandler: (handler: () => Promise<void>) => void;
  /**
   * Diagnostics accessor — current replay-buffer length and the last
   * broadcast envelope id. Exposed for unit tests; production code
   * should use `broadcast` / `broadcastVite`.
   */
  _inspectReplayBuffer: () => { size: number; lastId: number; oldestId: number | null };
}

export interface HMRMessage {
  type:
    | "connected"
    | "reload"
    | "full-reload"              // Phase 7.0 — Vite-compat escalation path
    | "update"                   // Phase 7.0 — granular update (js / css)
    | "invalidate"               // Phase 7.0 — module requested full reload
    | "island-update"
    | "layout-update"
    | "css-update"
    | "error"
    | "ping"
    | "guard-violation"
    | "kitchen:file-change"
    | "kitchen:guard-decision";
  data?: {
    routeId?: string;
    layoutPath?: string;
    cssPath?: string;
    message?: string;
    timestamp?: number;
    file?: string;
    violations?: Array<{ line: number; message: string }>;
    changeType?: "add" | "change" | "delete";
    action?: "approve" | "reject";
    ruleId?: string;
    /** Vite-compat updates array — populated when `type === "update"`. */
    updates?: Array<{ type: "js-update" | "css-update"; path: string; acceptedPath: string; timestamp: number }>;
    /** `full-reload` / `invalidate` optional path hint. */
    path?: string;
    /** Last rebuild id assigned by the replay buffer (if any). */
    id?: number;
  };
}

/**
 * HMR WebSocket 서버 생성
 *
 * Phase 7.0 R1 Agent C additions:
 *   - **Replay buffer (B8)**: every `broadcastVite` payload is enqueued with
 *     a monotonic `id`. Clients reconnect with `?since=<id>` and the server
 *     re-sends anything they missed. Buffer is bounded by
 *     `MAX_REPLAY_BUFFER` entries and `REPLAY_MAX_AGE_MS` age — older
 *     envelopes are pruned, and too-old `since` values trigger a
 *     `full-reload` as the safe fallback.
 *   - **Vite-compat wire format**: `broadcastVite(ViteHMRPayload)` sends
 *     the byte-equivalent of what Vite would emit, so external devtools
 *     / editor plugins that speak Vite's HMR protocol work unchanged.
 *   - **layout-update**: callers (Agent A's `onSSRChange` path) invoke
 *     `broadcast({ type: "layout-update", ... })` when a `layout.tsx`
 *     changes; the client handler forces a full reload.
 *
 * The classic `broadcast(HMRMessage)` API is preserved as the internal
 * Mandu format; both broadcast channels share the same WebSocket.
 */

/**
 * Phase 7.0.S — HMR security options (C-01 / C-03 / C-04 defense).
 *
 * The dev HMR WebSocket + `/restart` endpoint bind to loopback by default
 * and reject cross-origin connections. Remote-dev scenarios (container,
 * VM, tunnel) go through the Phase 7.1+ explicit-token path.
 */
export interface HMRServerOptions {
  /**
   * Network interface to bind. Defaults to "localhost" (loopback only).
   * Override to "0.0.0.0" ONLY for remote-dev scenarios paired with
   * explicit `allowedOrigins`.
   */
  hostname?: string;
  /**
   * Additional origins (beyond `http://localhost:${port}` and
   * `http://127.0.0.1:${port}`) that may establish WebSocket connections
   * or POST /restart. Required when binding to non-loopback.
   */
  allowedOrigins?: readonly string[];
}

export function createHMRServer(
  port: number,
  options: HMRServerOptions = {},
): HMRServer {
  const clients = new Set<{ send: (data: string) => void; close: () => void }>();
  const hmrPort = port + PORTS.HMR_OFFSET;
  const hostname = options.hostname ?? "localhost";
  // Build Origin allowlist. Same-origin (main dev server) is always allowed.
  // Both `localhost` and `127.0.0.1` forms are included because browsers
  // resolve `localhost` ambiguously (IPv4 vs IPv6) and some OS stacks
  // return one vs the other.
  const allowedOrigins = new Set<string>([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...(options.allowedOrigins ?? []),
  ]);
  let restartHandler: (() => Promise<void>) | null = null;

  // ─── Replay buffer (B8) ────────────────────────────────────────────────
  //
  // Monotonic counter; resets to 0 on server boot (restart is a full
  // reload anyway so clients can't meaningfully resume across it).
  let lastRebuildId = 0;
  const replayBuffer: HMRReplayEnvelope[] = [];

  /** Drop envelopes older than `REPLAY_MAX_AGE_MS`. Called opportunistically. */
  const pruneOldReplays = (): void => {
    const cutoff = Date.now() - REPLAY_MAX_AGE_MS;
    // Buffer is chronological (push-only, shift-from-front), so one-pass prune.
    while (replayBuffer.length > 0 && replayBuffer[0]!.timestamp < cutoff) {
      replayBuffer.shift();
    }
  };

  /**
   * Append a Vite payload to the replay buffer. Returns the envelope
   * that was queued so the caller can inspect its id (used in tests and
   * by the `broadcast` path to echo the id into the internal message).
   */
  const enqueueReplay = (payload: ViteHMRPayload): HMRReplayEnvelope => {
    mark(HMR_PERF.HMR_REPLAY_ENQUEUE);
    lastRebuildId += 1;
    const envelope: HMRReplayEnvelope = {
      id: lastRebuildId,
      timestamp: Date.now(),
      payload,
    };
    replayBuffer.push(envelope);
    // Bound by size first (cheap), then by age (slightly more work but
    // still O(n) amortized across inserts).
    while (replayBuffer.length > MAX_REPLAY_BUFFER) {
      replayBuffer.shift();
    }
    pruneOldReplays();
    measure(HMR_PERF.HMR_REPLAY_ENQUEUE, HMR_PERF.HMR_REPLAY_ENQUEUE);
    return envelope;
  };

  /**
   * Parse `?since=<id>` from the upgrade URL. Returns `null` for missing
   * or malformed values (negative / non-numeric / NaN). Treating a
   * malformed value as `null` is the safe choice — the client simply
   * gets the default `connected` handshake.
   */
  const parseSince = (url: URL): number | null => {
    const raw = url.searchParams.get("since");
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  };

  /**
   * Handle the post-upgrade replay flush. The three branches:
   *
   *   1. `since === null` → new client, send `connected` only.
   *   2. `since >= lastRebuildId` → client is already current, send
   *      `connected` and nothing else.
   *   3. `since < oldestId` → client missed more than the buffer holds,
   *      force a `full-reload`.
   *   4. otherwise → re-send every envelope with `id > since`.
   *
   * The caller (WS `open` handler) only knows the raw `since`; we do
   * the dispatch here so the logic stays co-located with the buffer.
   */
  const flushReplayToClient = (
    ws: { send: (data: string) => void },
    since: number | null,
  ): void => {
    if (since === null) {
      ws.send(
        JSON.stringify({ type: "connected", data: { timestamp: Date.now(), id: lastRebuildId } }),
      );
      return;
    }
    // Already caught up — nothing to replay but still greet.
    if (since >= lastRebuildId) {
      ws.send(
        JSON.stringify({ type: "connected", data: { timestamp: Date.now(), id: lastRebuildId } }),
      );
      return;
    }
    pruneOldReplays();
    const oldestId = replayBuffer.length > 0 ? replayBuffer[0]!.id : null;
    if (oldestId === null || since < oldestId) {
      // Missed too much — force a full reload.
      mark(HMR_PERF.HMR_REPLAY_FLUSH);
      ws.send(
        JSON.stringify({
          type: "full-reload",
          data: { timestamp: Date.now(), message: "replay-buffer-exhausted" },
        }),
      );
      measure(HMR_PERF.HMR_REPLAY_FLUSH, HMR_PERF.HMR_REPLAY_FLUSH);
      return;
    }
    // Replay every envelope strictly newer than `since`.
    mark(HMR_PERF.HMR_REPLAY_FLUSH);
    ws.send(
      JSON.stringify({ type: "connected", data: { timestamp: Date.now(), id: lastRebuildId } }),
    );
    for (const env of replayBuffer) {
      if (env.id <= since) continue;
      // Wrap in a thin envelope so the client can see the id; keep the
      // Vite payload verbatim for external consumers.
      ws.send(
        JSON.stringify({
          type: "vite-replay",
          data: { id: env.id, timestamp: env.timestamp },
          payload: env.payload,
        }),
      );
    }
    measure(HMR_PERF.HMR_REPLAY_FLUSH, HMR_PERF.HMR_REPLAY_FLUSH);
  };

  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": `http://localhost:${port}`,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Type parameter carries the `?since=<id>` value from the upgrade
  // request to the WebSocket `open` handler via Bun's per-connection
  // data slot. Without the generic, `server.upgrade(req, { data })`
  // types `data` as `undefined` — Bun.serve has no runtime inference.
  interface WSData {
    since: number | null;
  }

  // Phase 7.0.S — per-connection `invalidate` rate limit state.
  // WeakMap keyed by the WS object so entries are GC'd when the socket
  // closes; no manual cleanup needed. Per-connection (not global) so one
  // abusive client cannot DoS the rate limit for legitimate ones.
  const invalidateCounters = new WeakMap<object, { count: number; windowStart: number }>();

  const server = Bun.serve<WSData, never>({
    port: hmrPort,
    hostname,  // Phase 7.0.S C-03 fix: bind to loopback by default.
    async fetch(req, server) {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Phase 7.0.S Origin allowlist check (C-01 / C-04 defense).
      //
      // CSWSH (Cross-Site WebSocket Hijacking) defense: browsers DO NOT
      // enforce same-origin for WebSocket connections. Any cross-origin
      // page that reaches this port (C-03 fix narrows that to loopback)
      // could open a WS and exfiltrate HMR events or trigger reloads
      // without this check.
      //
      // We accept missing Origin (null / absent) — native clients (curl,
      // test WebSocket connections, CLI devtools) legitimately omit it and
      // the loopback binding (C-03) is the primary defense for them.
      const origin = req.headers.get("origin");
      if (origin !== null && !allowedOrigins.has(origin)) {
        return new Response(
          JSON.stringify({ error: "origin not allowed" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // POST /restart → 재시작 핸들러 호출
      if (req.method === "POST" && url.pathname === "/restart") {
        if (!restartHandler) {
          return new Response(
            JSON.stringify({ error: "No restart handler registered" }),
            { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        try {
          console.log("🔄 Full restart requested from DevTools");
          await restartHandler();
          return new Response(
            JSON.stringify({ status: "restarted" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("❌ Restart failed:", message);
          return new Response(
            JSON.stringify({ error: message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // WebSocket 업그레이드 — stash `since` in per-connection data so the
      // `open` handler has access to it.
      const since = parseSince(url);
      if (server.upgrade(req, { data: { since } })) {
        return;
      }

      // 일반 HTTP 요청은 상태 반환
      return new Response(
        JSON.stringify({
          status: "ok",
          clients: clients.size,
          port: hmrPort,
          lastRebuildId,
          replayBufferSize: replayBuffer.length,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        // `since` is attached by the upgrade handler (typed via WSData).
        // It's `null` when the client didn't supply `?since=` (new tab).
        const since = ws.data?.since ?? null;
        flushReplayToClient(ws, since);
      },
      close(ws) {
        clients.delete(ws);
      },
      message(ws, message) {
        // 클라이언트로부터의 ping 처리 + invalidate 수신.
        try {
          const data = JSON.parse(String(message));
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong", data: { timestamp: Date.now() } }));
            return;
          }
          if (data.type === "invalidate") {
            // Phase 7.0.S — per-connection rate limit (C-02 / H-01 defense).
            // A malicious same-machine process (even with C-01 + C-03 in
            // place) could flood `invalidate` messages to DoS connected
            // browsers via broadcast. 10 invalidates per 10-second window
            // is >100× what legitimate HMR usage produces.
            const now = Date.now();
            let counter = invalidateCounters.get(ws as object);
            if (!counter || now - counter.windowStart > 10_000) {
              counter = { count: 0, windowStart: now };
              invalidateCounters.set(ws as object, counter);
            }
            counter.count += 1;
            if (counter.count > 10) {
              // Silent drop — do not reply to abusive clients.
              return;
            }
            // Reject oversized fields. 10 KB message / 2 KB moduleUrl is
            // plenty for diagnostics; anything larger is amplification abuse.
            if (
              (typeof data.message === "string" && data.message.length > 10_000) ||
              (typeof data.moduleUrl === "string" && data.moduleUrl.length > 2_000)
            ) {
              return;
            }
            // A module called `import.meta.hot.invalidate()` in the
            // browser. Phase 7.0 v0.1 response: escalate to full reload
            // on the module that invalidated. Broadcasting through
            // `broadcastVite` puts it in the replay buffer too so other
            // tabs observe the same reload.
            const path =
              typeof data.moduleUrl === "string" ? data.moduleUrl : undefined;
            const payload: ViteHMRPayload = { type: "full-reload", path };
            const envelope = enqueueReplay(payload);
            const wire = JSON.stringify({
              type: "full-reload",
              data: {
                timestamp: envelope.timestamp,
                id: envelope.id,
                path,
                message:
                  typeof data.message === "string" ? data.message : undefined,
              },
            });
            for (const client of clients) {
              try {
                client.send(wire);
              } catch {
                clients.delete(client);
              }
            }
          }
        } catch {
          // 무시 — malformed JSON from the client is never fatal.
        }
      },
    },
  });

  console.log(`🔥 HMR server running on ws://${hostname}:${hmrPort}`);

  /**
   * Send a payload string to every connected client, pruning dead
   * sockets as a side effect. Factored out so `broadcast` and
   * `broadcastVite` share the fan-out loop exactly.
   */
  const fanout = (payload: string): void => {
    for (const client of clients) {
      try {
        client.send(payload);
      } catch {
        clients.delete(client);
      }
    }
  };

  return {
    get clientCount() {
      return clients.size;
    },
    broadcast: (message: HMRMessage) => {
      mark(HMR_PERF.HMR_BROADCAST);
      // For message types that map to a Vite payload, enqueue a replay
      // envelope so reconnecting clients also see the event. The mapping
      // is conservative — only canonical cases get queued; devtools and
      // guard-violation events are ephemeral.
      let envelopeId: number | undefined;
      if (message.type === "reload" || message.type === "full-reload") {
        const envelope = enqueueReplay({ type: "full-reload", path: message.data?.path });
        envelopeId = envelope.id;
      } else if (message.type === "island-update" || message.type === "layout-update") {
        // These are Mandu-internal shapes; record a generic `update`
        // envelope so reconnecting clients at least know something
        // changed. Full-fidelity replay of Mandu messages is intentional
        // future work — we'd need a second buffer per payload shape.
        const envelope = enqueueReplay({
          type: "update",
          updates: [
            {
              type: "js-update",
              path: message.data?.layoutPath ?? message.data?.routeId ?? "?",
              acceptedPath: message.data?.layoutPath ?? message.data?.routeId ?? "?",
              timestamp: Date.now(),
            },
          ],
        });
        envelopeId = envelope.id;
      } else if (message.type === "css-update") {
        const envelope = enqueueReplay({
          type: "update",
          updates: [
            {
              type: "css-update",
              path: message.data?.cssPath ?? "/.mandu/client/globals.css",
              acceptedPath: message.data?.cssPath ?? "/.mandu/client/globals.css",
              timestamp: Date.now(),
            },
          ],
        });
        envelopeId = envelope.id;
      }

      const outgoing: HMRMessage =
        envelopeId !== undefined
          ? { ...message, data: { ...(message.data ?? {}), id: envelopeId } }
          : message;
      const payload = JSON.stringify(outgoing);
      fanout(payload);
      measure(HMR_PERF.HMR_BROADCAST, HMR_PERF.HMR_BROADCAST);
    },
    broadcastVite: (payload: ViteHMRPayload): HMRReplayEnvelope => {
      mark(HMR_PERF.HMR_BROADCAST);
      const envelope = enqueueReplay(payload);
      // Wire format: wrap with the envelope id so replayed and live
      // messages are indistinguishable on the client side. External
      // devtools that only care about the raw Vite payload can read
      // `payload` directly.
      const wire = JSON.stringify({
        type: "vite",
        data: { id: envelope.id, timestamp: envelope.timestamp },
        payload,
      });
      fanout(wire);
      measure(HMR_PERF.HMR_BROADCAST, HMR_PERF.HMR_BROADCAST);
      return envelope;
    },
    close: () => {
      for (const client of clients) {
        try {
          client.close();
        } catch {
          // 무시
        }
      }
      clients.clear();
      server.stop();
    },
    setRestartHandler: (handler: () => Promise<void>) => {
      restartHandler = handler;
    },
    _inspectReplayBuffer: () => ({
      size: replayBuffer.length,
      lastId: lastRebuildId,
      oldestId: replayBuffer.length > 0 ? replayBuffer[0]!.id : null,
    }),
  };
}

/**
 * Phase 7.1 B-3 — HTML preamble for React Fast Refresh.
 *
 * Emitted by the SSR renderer in dev mode, **before** any island JS
 * evaluates. Two concerns, one <script>:
 *
 *   1. Install inert stubs for `$RefreshReg$` / `$RefreshSig$` on
 *      `window`. Bun's `reactFastRefresh: true` transform inserts calls
 *      to these at the top of every transformed module; if they are
 *      undefined when the module body runs, we get a runtime error and
 *      the island never hydrates. Vite's preamble does the same inline
 *      stub install for the same reason.
 *
 *   2. Fire a dynamic `import()` of the bundled glue (`_fast-refresh-
 *      runtime.js`), which in turn `await`s the real `react-refresh/
 *      runtime`, installs `window.__MANDU_HMR__`, and upgrades the
 *      stubs to live wrappers that forward to the refresh runtime. The
 *      race between "module evaluates and calls `$RefreshReg$`" and
 *      "glue has upgraded the stubs" is benign — registrations that
 *      land on the stub are simply no-ops, which at worst means the
 *      very first mount isn't tracked. Subsequent hot swaps land on
 *      the live wrappers and work normally.
 *
 * The emitted script is **inline** (no `type="module"`, no external
 * src). This is deliberate: the stubs must exist before *any* module
 * script runs, and inline execution blocks the parser. The dynamic
 * import inside the inline script is non-blocking so we don't stall
 * First Contentful Paint.
 *
 * CSP note: the inline <script> uses no `eval` or `new Function`; it
 * only calls `Object.assign`, defines functions, and initiates an
 * `import()`. All of these are permitted under `script-src 'self'
 * 'unsafe-inline'` which is Mandu's default dev CSP (production CSP
 * forbids `unsafe-inline`, but this preamble is dev-only).
 *
 * `glueUrl` and `runtimeUrl` come from the build manifest's
 * `shared.fastRefresh` block (populated only in dev). Both must be
 * absolute URLs served from the same origin as the HTML, which our
 * bundler always guarantees (`/.mandu/client/...`).
 */
export function generateFastRefreshPreamble(
  glueUrl: string,
  runtimeUrl: string,
): string {
  // Both URLs must be non-empty. If either is missing (e.g. vendor
  // shim build failed), the caller (ssr.ts) should skip this preamble
  // entirely — defensive guard here keeps the output valid regardless.
  if (!glueUrl || !runtimeUrl) {
    return `<script>/* Mandu Fast Refresh: missing runtime assets, preamble skipped */</script>`;
  }
  // JSON.stringify escapes the URLs safely for inline `<script>`:
  //   - quotes produce a valid JS string literal
  //   - forward-slashes / backslashes are handled
  // We also `split('</')` to avoid a stray `</script>` sequence in the
  // URL bytes breaking the enclosing tag. This is the same defense
  // Vite uses in its own preamble emitter.
  const glueLit = JSON.stringify(glueUrl).split("</").join('<"+"/');
  const runtimeLit = JSON.stringify(runtimeUrl).split("</").join('<"+"/');
  return `<script>
// Phase 7.1 B-3 React Fast Refresh preamble (Mandu dev-only)
(function () {
  if (typeof window === "undefined") return;
  // Install inert stubs so transformed modules that run BEFORE the
  // async runtime upgrade don't hit ReferenceError on $RefreshReg$.
  if (!window.$RefreshReg$) window.$RefreshReg$ = function () {};
  if (!window.$RefreshSig$) window.$RefreshSig$ = function () { return function (t) { return t; }; };
  // Async-load the glue; failures are reported but never throw out of
  // the preamble — a missing runtime degrades to full-reload HMR.
  import(${glueLit})
    .then(function (mod) {
      var runtimeImport = function () { return import(${runtimeLit}); };
      if (mod && typeof mod.installGlobal === "function") {
        return mod.installGlobal({ runtimeImport: runtimeImport });
      }
    })
    .catch(function (err) {
      console.error("[Mandu Fast Refresh] preamble failed:", err);
    });
})();
</script>`;
}

/**
 * HMR 클라이언트 스크립트 생성
 * 브라우저에서 실행되어 HMR 서버와 연결.
 *
 * Phase 7.0 R1 Agent C additions:
 *   - **`?since=<lastSeenId>` on reconnect**: the client tracks the id of
 *     the last envelope it processed (from `data.id`). On reconnect it
 *     appends `?since=<id>` to the WS URL so the server can replay
 *     anything missed while the socket was down.
 *   - **Vite-compat payload handling**: messages of shape
 *     `{type:"vite", payload:<ViteHMRPayload>}` and `{type:"vite-replay", payload:<...>}`
 *     are dispatched through the same code path — both deliver a Vite
 *     update wrapped with an envelope id.
 *   - **`full-reload` type**: emitted when a module invalidates or the
 *     replay buffer is exhausted; force a full page reload.
 *   - **`layout-update`**: unchanged behavior (full reload) — the server
 *     now actually broadcasts this (A's `onSSRChange` path).
 *   - **`import.meta.hot.invalidate()` upstream channel**: the runtime
 *     calls into `window.__MANDU_HMR_SEND__({type:"invalidate", moduleUrl})`
 *     which we forward on the socket. This is the only place the client
 *     sends non-ping frames.
 *   - **Vite event dispatch**: `vite:beforeUpdate` fires before an
 *     `update` or `vite` payload is applied; `vite:afterUpdate` after;
 *     `vite:beforeFullReload` before `full-reload`; `vite:error` for
 *     errors. Listeners are registered in `ManduHot.on()` (runtime).
 *
 * Phase 7.2 Agent B additions (HDR — Hot Data Revalidation):
 *   - **`slot-refetch` message type**: when a `.slot.ts` file changes, the
 *     CLI side broadcasts `{ type: "slot-refetch", data: { routeId,
 *     slotPath, id, timestamp } }`. The client script checks whether the
 *     current browser location belongs to that `routeId`; if so it fetches
 *     the current URL with `X-Mandu-HDR: 1`, receives JSON loader data,
 *     then calls `window.__MANDU_ROUTER_REVALIDATE__(routeId, loaderData)`
 *     wrapped in `React.startTransition`. Form inputs / scroll / focus
 *     survive because the React tree never unmounts.
 *   - **Fallback semantics**: if the route doesn't match, the router
 *     revalidate hook is missing, the fetch fails, `MANDU_HDR=0` is set,
 *     or any other failure path — the client falls back to
 *     `location.reload()`. This preserves the Phase 7.1 "always-safe"
 *     invariant: a broken HDR path never leaves the user on a stale page.
 *   - **`hdr:refetch` perf marker**: fires on successful HDR apply for
 *     Agent F's bench script to aggregate. P95 target ≤150 ms.
 */
export function generateHMRClientScript(port: number): string {
  const hmrPort = port + PORTS.HMR_OFFSET;

  return `
(function() {
  window.__MANDU_HMR_PORT__ = ${hmrPort};
  const HMR_PORT = ${hmrPort};
  let ws = null;
  let reconnectAttempts = 0;
  // Last envelope id we successfully applied. Used in the ?since= query
  // on reconnect. Starts at 0 (means "no envelopes seen"); the server
  // interprets 0 as "replay everything that's still in the buffer".
  let lastSeenId = 0;
  const maxReconnectAttempts = ${TIMEOUTS.HMR_MAX_RECONNECT};
  const reconnectDelay = ${TIMEOUTS.HMR_RECONNECT_DELAY};
  const staleIslands = new Set();

  // Vite-compat event listeners. Registered by the runtime hmr-client.ts
  // via \`window.__MANDU_HMR_EVENT__(event, cb)\`; we fan out here because
  // dispatchEvent() in the runtime walks every module's listener set,
  // which the client script cannot directly import.
  const viteListeners = Object.create(null);
  window.__MANDU_HMR_EVENT__ = function(event, cb) {
    if (!viteListeners[event]) viteListeners[event] = new Set();
    viteListeners[event].add(cb);
    return function off() {
      if (viteListeners[event]) viteListeners[event].delete(cb);
    };
  };
  function fireViteEvent(event, payload) {
    var set = viteListeners[event];
    if (!set) return;
    set.forEach(function(cb) {
      try { cb(payload); } catch (e) { console.error('[Mandu HMR]', event, 'listener threw:', e); }
    });
  }

  // Upstream channel: user code calls invalidate() in the runtime, which
  // asks the client script to push a message back to the server.
  window.__MANDU_HMR_SEND__ = function(payload) {
    if (ws && ws.readyState === 1 /* OPEN */) {
      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        console.error('[Mandu HMR] send failed:', e);
      }
    }
  };

  function connect() {
    try {
      var qs = lastSeenId > 0 ? '?since=' + lastSeenId : '';
      ws = new WebSocket('ws://' + window.location.hostname + ':' + HMR_PORT + '/' + qs);

      ws.onopen = function() {
        console.log('[Mandu HMR] Connected' + (lastSeenId > 0 ? ' (since ' + lastSeenId + ')' : ''));
        reconnectAttempts = 0;
      };

      ws.onmessage = function(event) {
        try {
          const message = JSON.parse(event.data);
          handleMessage(message);
        } catch (e) {
          console.error('[Mandu HMR] Invalid message:', e);
        }
      };

      ws.onclose = function() {
        console.log('[Mandu HMR] Disconnected');
        scheduleReconnect();
      };

      ws.onerror = function(error) {
        console.error('[Mandu HMR] Error:', error);
      };
    } catch (error) {
      console.error('[Mandu HMR] Connection failed:', error);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      var delay = Math.min(reconnectDelay * Math.pow(2, reconnectAttempts - 1), 30000);
      console.log('[Mandu HMR] Reconnecting in ' + delay + 'ms (' + reconnectAttempts + '/' + maxReconnectAttempts + ')');
      setTimeout(connect, delay);
    }
  }

  /**
   * Update lastSeenId from a message's envelope id. Only accept
   * monotonically increasing values so out-of-order replay (shouldn't
   * happen, but be defensive) can't move us backwards.
   */
  function recordEnvelopeId(message) {
    var id = message && message.data && message.data.id;
    if (typeof id === 'number' && id > lastSeenId) lastSeenId = id;
  }

  function applyViteUpdate(payload) {
    // payload is a ViteHMRPayload shape. Phase 7.0 v0.1 handles 'update'
    // as a CSS swap for the css-update sub-type and falls back to a
    // full reload for js-update (until Fast Refresh lands). 'full-reload'
    // / 'error' / 'connected' are handled inline.
    if (!payload || !payload.type) return;
    switch (payload.type) {
      case 'connected':
        // Already greeted inline; nothing else to do.
        return;
      case 'update':
        fireViteEvent('vite:beforeUpdate', payload);
        if (Array.isArray(payload.updates)) {
          for (var i = 0; i < payload.updates.length; i++) {
            var u = payload.updates[i];
            if (u.type === 'css-update') {
              // Re-timestamp any matching <link>.
              var links = document.querySelectorAll('link[rel="stylesheet"]');
              links.forEach(function(link) {
                var href = link.getAttribute('href') || '';
                var baseHref = href.split('?')[0];
                if (baseHref === u.path || href.includes('.mandu/client')) {
                  link.setAttribute('href', baseHref + '?t=' + Date.now());
                }
              });
            }
          }
        }
        fireViteEvent('vite:afterUpdate', payload);
        return;
      case 'full-reload':
        fireViteEvent('vite:beforeFullReload', payload);
        location.reload();
        return;
      case 'prune':
        // Phase 7.1+ — ignore for now.
        return;
      case 'error':
        fireViteEvent('vite:error', payload);
        if (payload.err) showErrorOverlay(payload.err.message || 'Build error');
        return;
      case 'custom':
        // Plugin custom events — route known events to their handlers.
        // Phase 7.2 HDR: slot-refetch rides this channel so we don't
        // have to extend HMRMessage (which lives outside this section
        // of the file).
        if (payload.event === 'mandu:slot-refetch') {
          handleSlotRefetch(payload.data || {});
          return;
        }
        // Unknown custom events are dropped silently — Vite's own
        // plugin ecosystem may emit anything.
        return;
    }
  }

  // ─── Phase 7.2 HDR (Hot Data Revalidation) ──────────────────────────
  //
  // When a .slot.ts file changes the server broadcasts
  //   { type: 'slot-refetch', data: { routeId, slotPath, id, timestamp } }
  // instead of the legacy 'reload'. We refetch the current URL with
  // X-Mandu-HDR: 1 to get JSON loader data, then hand it to a
  // framework revalidate hook that wraps the props update in
  // React.startTransition so form state / scroll / focus survive.
  //
  // The hook path:
  //   1. window.__MANDU_ROUTER_REVALIDATE__(routeId, loaderData) — the
  //      framework router installs this at boot. If absent we fall back
  //      to full reload (minimum-viable-HDR path).
  //   2. window.__MANDU_HDR__.perfMark(name) — optional perf hook.
  //      Bench script reads HMR_PERF.HDR_REFETCH ('hdr:refetch').
  function getCurrentRouteId() {
    // SSR injects __MANDU_ROUTE__ on the window. Router state (if
    // client-side navigation happened) lives under __MANDU_ROUTER_STATE__.
    // Prefer the router's state when both are present.
    var routerState = window.__MANDU_ROUTER_STATE__;
    if (routerState && routerState.currentRoute && routerState.currentRoute.id) {
      return String(routerState.currentRoute.id);
    }
    var route = window.__MANDU_ROUTE__;
    if (route && route.id) return String(route.id);
    return null;
  }

  function hdrDisabled() {
    // Opt-out: projects with unusual CSP / environments may disable HDR
    // via a global flag. The bundler sets this from MANDU_HDR=0 (see
    // the bootScript path in SSR rendering).
    return window.__MANDU_HDR_DISABLED__ === true;
  }

  function hdrFallbackFullReload(reason) {
    console.log('[Mandu HDR] Fallback full reload' + (reason ? ' (' + reason + ')' : ''));
    location.reload();
  }

  function hdrMark(name, data) {
    try {
      if (window.__MANDU_HDR__ && typeof window.__MANDU_HDR__.perfMark === 'function') {
        window.__MANDU_HDR__.perfMark(name, data);
      }
    } catch (_) {}
  }

  function handleSlotRefetch(data) {
    var routeId = data && typeof data.routeId === 'string' ? data.routeId : null;
    if (!routeId) {
      hdrFallbackFullReload('no-routeId');
      return;
    }
    if (hdrDisabled()) {
      hdrFallbackFullReload('disabled');
      return;
    }
    var currentId = getCurrentRouteId();
    if (currentId !== routeId) {
      // Not on the affected route — nothing to revalidate, no reload
      // either. The next navigation will pick up the fresh loader.
      console.log('[Mandu HDR] slot-refetch for ' + routeId + ' ignored (current route: ' + currentId + ')');
      return;
    }
    var started = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    hdrMark('hdr:refetch-start', { routeId: routeId, slotPath: data.slotPath });
    // Build the data URL: current pathname + query + _data=1 marker,
    // with X-Mandu-HDR header so the server can log + treat it as an
    // HDR request. _data=1 is the existing SPA navigation contract so
    // we reuse it here — the server returns
    //   { routeId, pattern, params, loaderData, timestamp }.
    var url = window.location.pathname + window.location.search;
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    var dataUrl = url + sep + '_data=1';
    fetch(dataUrl, {
      credentials: 'same-origin',
      headers: { 'X-Mandu-HDR': '1' },
    })
      .then(function (res) {
        if (!res.ok) {
          hdrFallbackFullReload('status-' + res.status);
          return null;
        }
        return res.json();
      })
      .then(function (payload) {
        if (!payload) return;
        // Revalidate hook. The router installs this from island glue.
        var revalidate = window.__MANDU_ROUTER_REVALIDATE__;
        if (typeof revalidate !== 'function') {
          // Minimum-viable-HDR fallback: the framework router isn't
          // installed on this page (e.g. pure-SSR with no client
          // router). Full reload is the honest degrade.
          hdrFallbackFullReload('no-router');
          return;
        }
        // Apply inside React.startTransition so the prop update
        // doesn't tear down focus / form inputs / scroll position.
        // The router hook is responsible for wrapping; we just call it.
        try {
          revalidate(routeId, payload.loaderData);
          var elapsed = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - started;
          console.log('[Mandu HDR] Applied loader data for ' + routeId + ' in ' + elapsed.toFixed(0) + 'ms');
          hdrMark('hdr:refetch', { routeId: routeId, slotPath: data.slotPath, elapsed: elapsed });
        } catch (err) {
          console.error('[Mandu HDR] Revalidate threw:', err);
          hdrFallbackFullReload('revalidate-throw');
        }
      })
      .catch(function (err) {
        console.error('[Mandu HDR] Fetch failed:', err);
        hdrFallbackFullReload('fetch-failed');
      });
  }

  function handleMessage(message) {
    // Vite-compat envelope. Two shapes: live broadcast ('vite') and
    // replayed-after-reconnect ('vite-replay'). They differ only in the
    // type tag — behavior is identical.
    if (message.type === 'vite' || message.type === 'vite-replay') {
      recordEnvelopeId(message);
      applyViteUpdate(message.payload);
      return;
    }

    switch (message.type) {
      case 'connected':
        recordEnvelopeId(message);
        console.log('[Mandu HMR] Ready');
        break;

      case 'reload':
      case 'full-reload':
        recordEnvelopeId(message);
        fireViteEvent('vite:beforeFullReload', message);
        console.log('[Mandu HMR] Full reload requested');
        location.reload();
        break;

      case 'invalidate':
        // Server echoed an invalidate — same outcome as full reload.
        recordEnvelopeId(message);
        fireViteEvent('vite:beforeFullReload', message);
        location.reload();
        break;

      case 'update':
        // Mandu-internal 'update' mirrors the Vite payload shape.
        recordEnvelopeId(message);
        applyViteUpdate({ type: 'update', updates: (message.data && message.data.updates) || [] });
        break;

      case 'island-update':
        recordEnvelopeId(message);
        const routeId = message.data?.routeId;
        console.log('[Mandu HMR] Island updated:', routeId);
        staleIslands.add(routeId);

        // 현재 페이지의 island인지 확인
        const island = document.querySelector('[data-mandu-island="' + routeId + '"]');
        if (island) {
          fireViteEvent('vite:beforeFullReload', message);
          console.log('[Mandu HMR] Reloading page for island update');
          location.reload();
        }
        break;

      case 'layout-update':
        recordEnvelopeId(message);
        const layoutPath = message.data?.layoutPath;
        console.log('[Mandu HMR] Layout updated:', layoutPath);
        fireViteEvent('vite:beforeFullReload', message);
        // Layout 변경은 항상 전체 리로드
        location.reload();
        break;

      case 'slot-refetch':
        // Phase 7.2 HDR — slot (.slot.ts) changed. Try to refetch loader
        // data without remounting the React tree. Falls back to a full
        // reload on any failure so the user is never stranded on stale
        // state. Fire-and-forget (no return from handleMessage itself).
        recordEnvelopeId(message);
        handleSlotRefetch(message.data || {});
        break;

      case 'css-update':
        recordEnvelopeId(message);
        console.log('[Mandu HMR] CSS updated');
        fireViteEvent('vite:beforeUpdate', message);
        // CSS 핫 리로드 (페이지 새로고침 없이 스타일시트만 교체)
        var targetCssPath = message.data?.cssPath || '/.mandu/client/globals.css';
        var links = document.querySelectorAll('link[rel="stylesheet"]');
        links.forEach(function(link) {
          var href = link.getAttribute('href') || '';
          var baseHref = href.split('?')[0];
          // 정확한 경로 매칭 우선, fallback으로 기존 패턴 매칭
          if (baseHref === targetCssPath || href.includes('globals.css') || href.includes('.mandu/client')) {
            link.setAttribute('href', baseHref + '?t=' + Date.now());
          }
        });
        fireViteEvent('vite:afterUpdate', message);
        break;

      case 'error':
        console.error('[Mandu HMR] Build error:', message.data?.message);
        fireViteEvent('vite:error', message);
        showErrorOverlay(message.data?.message);
        break;

      case 'guard-violation':
        console.warn('[Mandu HMR] Guard violation:', message.data?.file);
        if (window.__MANDU_DEVTOOLS_HOOK__) {
          window.__MANDU_DEVTOOLS_HOOK__.emit({
            type: 'guard:violation',
            timestamp: Date.now(),
            data: message.data
          });
        }
        break;

      case 'kitchen:file-change':
        if (window.__MANDU_DEVTOOLS_HOOK__) {
          window.__MANDU_DEVTOOLS_HOOK__.emit({
            type: 'kitchen:file-change',
            timestamp: Date.now(),
            data: message.data
          });
        }
        break;

      case 'kitchen:guard-decision':
        if (window.__MANDU_DEVTOOLS_HOOK__) {
          window.__MANDU_DEVTOOLS_HOOK__.emit({
            type: 'kitchen:guard-decision',
            timestamp: Date.now(),
            data: message.data
          });
        }
        break;

      case 'pong':
        // 연결 확인
        break;
    }
  }

  function showErrorOverlay(message) {
    // 기존 오버레이 제거
    const existing = document.getElementById('mandu-hmr-error');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'mandu-hmr-error';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);color:#ff6b6b;font-family:monospace;padding:40px;z-index:99999;overflow:auto;';
    const h2 = document.createElement('h2');
    h2.style.cssText = 'color:#ff6b6b;margin:0 0 20px;';
    h2.textContent = '🔥 Build Error';
    const pre = document.createElement('pre');
    pre.style.cssText = 'white-space:pre-wrap;word-break:break-all;';
    pre.textContent = message || 'Unknown error';
    const btn = document.createElement('button');
    btn.style.cssText = 'position:fixed;top:20px;right:20px;background:#333;color:#fff;border:none;padding:10px 20px;cursor:pointer;';
    btn.textContent = 'Close';
    btn.onclick = function() { overlay.remove(); };
    overlay.appendChild(h2);
    overlay.appendChild(pre);
    overlay.appendChild(btn);
    document.body.appendChild(overlay);
  }

  // 페이지 로드 시 연결
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', connect);
  } else {
    connect();
  }

  // 페이지 이탈 시 정리
  window.addEventListener('beforeunload', function() {
    if (ws) ws.close();
  });

  // 페이지 이동 시 stale island 감지 후 리로드 (#115)
  function checkStaleIslandsOnNavigation() {
    if (staleIslands.size === 0) return;
    for (const id of staleIslands) {
      if (document.querySelector('[data-mandu-island="' + id + '"]')) {
        console.log('[Mandu HMR] Stale island detected after navigation, reloading...');
        location.reload();
        return;
      }
    }
  }
  window.addEventListener('popstate', checkStaleIslandsOnNavigation);
  window.addEventListener('pageshow', function(e) {
    if (e.persisted) checkStaleIslandsOnNavigation();
  });

  // Ping 전송 (연결 유지)
  setInterval(function() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
})();
`;
}
