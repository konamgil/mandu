import { getRenderToString } from "./react-renderer";
import { serializeProps } from "../client/serialize";
import { createRequire } from "module";
import type { ReactElement } from "react";
import type { BundleManifest } from "../bundler/types";
import { isSafeManduUrl } from "../bundler/manifest-schema";
import type { HydrationConfig, HydrationPriority } from "../spec/schema";
import { PORTS, TIMEOUTS } from "../constants";
import { escapeHtmlAttr, escapeHtmlText, escapeJsonForInlineScript } from "./escape";
import { REACT_INTERNALS_SHIM_SCRIPT } from "./shims";
import { generateFastRefreshPreamble } from "../bundler/dev";
import { PREFETCH_HELPER_SCRIPT } from "../client/prefetch-helper";

/**
 * Issue #192 — `@view-transition` at-rule block.
 * Inert in browsers without CSS View Transitions (Firefox, Safari < 18.0):
 * the at-rule is simply ignored, so there is no regression. Supporting
 * browsers (Chrome/Edge ≥ 111, Safari 18.2+) play the default crossfade
 * between cross-document navigations.
 *
 * `navigation: auto` is the only value we need — selective transitions
 * are a per-route concern reserved for a future `transitions` config
 * sub-block.
 */
const VIEW_TRANSITION_STYLE_TAG =
  "<style>@view-transition{navigation:auto}</style>";

// Re-export streaming SSR utilities
export {
  renderToStream,
  renderStreamingResponse,
  renderWithDeferredData,
  SuspenseIsland,
  DeferredData,
  createStreamingLoader,
  defer,
  type StreamingSSROptions,
  type StreamingLoaderResult,
  type StreamingError,
  type StreamingMetrics,
} from "./streaming-ssr";

export interface SSROptions {
  title?: string;
  lang?: string;
  /** 서버에서 로드한 데이터 (클라이언트로 전달) */
  serverData?: Record<string, unknown>;
  /** Hydration 설정 */
  hydration?: HydrationConfig;
  /** 번들 매니페스트 */
  bundleManifest?: BundleManifest;
  /** 라우트 ID (island 식별용) */
  routeId?: string;
  /** 추가 head 태그 */
  headTags?: string;
  /** 추가 body 끝 태그 */
  bodyEndTags?: string;
  /** 개발 모드 여부 */
  isDev?: boolean;
  /** HMR 포트 (개발 모드에서 사용) */
  hmrPort?: number;
  /** Client-side Routing 활성화 여부 */
  enableClientRouter?: boolean;
  /** 라우트 패턴 (Client-side Routing용) */
  routePattern?: string;
  /** CSS 파일 경로 (자동 주입, 기본: /.mandu/client/globals.css) */
  cssPath?: string | false;
  /** Island 래핑이 이미 React 엘리먼트 레벨에서 완료됨 (중복 래핑 방지) */
  islandPreWrapped?: boolean;
  /**
   * Phase 7.2 R1 Agent C (H1) — Content-Security-Policy nonce for the
   * Fast Refresh inline preamble. Three accepted shapes:
   *   - `true`            → auto-generate a fresh 128-bit base64 nonce
   *                         per-render and insert it as the `nonce`
   *                         attribute on the preamble `<script>` tag.
   *   - non-empty string  → use the caller-provided nonce verbatim
   *                         (e.g. one already produced by the
   *                         `secure()` middleware and stashed on
   *                         `ctx.get('csp-nonce')`).
   *   - `false` / unset   → legacy behavior; no nonce attribute, no
   *                         CSP header emitted. Also the effective
   *                         behavior when env `MANDU_CSP_NONCE=0`.
   * Only takes effect in dev mode with a populated `shared.fastRefresh`
   * manifest entry — prod builds never emit the preamble at all.
   */
  cspNonce?: string | boolean;
  /**
   * Issue #192 — emit `<style>@view-transition{navigation:auto}</style>`
   * into `<head>`. Supported browsers (Chrome/Edge ≥ 111, Safari 18.2+)
   * show a default crossfade between cross-document navigations; others
   * ignore the at-rule (no regression).
   *
   * Default: `true`. Pass `false` to suppress the injection — typically
   * wired from `ManduConfig.transitions`.
   */
  transitions?: boolean;
  /**
   * Issue #192 — emit the ~500-byte hover prefetch helper (`<script>`)
   * into `<head>`. Listens for `mouseover` on same-origin `<a href="/...">`
   * anchors and issues `<link rel="prefetch" as="document">` once per
   * unique target. Individual links can opt out via `data-no-prefetch`.
   *
   * Default: `true`. Pass `false` to suppress — typically wired from
   * `ManduConfig.prefetch`.
   */
  prefetch?: boolean;
  /**
   * Issue #191 — control dev-mode injection of the `_devtools.js` bundle
   * (~1.15 MB React dev runtime + Mandu Kitchen panel).
   *
   * Three states:
   *   - `true`  → force inject regardless of islands (explicit opt-in —
   *              use this for SSR-only projects that still want the
   *              Kitchen panel for local debugging).
   *   - `false` → force skip regardless of islands (explicit opt-out —
   *              disables Kitchen even for island projects).
   *   - unset   → default. Inject iff the page renders at least one
   *              hydratable island. Pure-SSR pages (no islands) download
   *              zero devtools bytes.
   *
   * Wired from `ManduConfig.dev.devtools`. Only takes effect in dev mode
   * (production builds omit the `_devtools.js` output entirely, so this
   * flag is a no-op in prod regardless of value).
   */
  devtools?: boolean;
}

let projectRenderToString: ((element: ReactElement) => string) | null | undefined;

function loadProjectRenderToString(): ((element: ReactElement) => string) | null {
  if (projectRenderToString !== undefined) {
    return projectRenderToString;
  }

  try {
    const projectRequire = createRequire(`${process.cwd()}/package.json`);
    const module = projectRequire("react-dom/server") as {
      renderToString?: (element: ReactElement) => string;
      default?: { renderToString?: (element: ReactElement) => string };
    };
    const renderToString = module.renderToString ?? module.default?.renderToString;
    if (typeof renderToString === "function") {
      projectRenderToString = renderToString;
      return projectRenderToString;
    }
  } catch {
    // fallback below
  }

  projectRenderToString = null;
  return null;
}

/**
 * SSR 데이터를 안전하게 직렬화 (Fresh 스타일 고급 직렬화)
 * Date, Map, Set, URL, RegExp, BigInt, 순환참조 지원
 */
function serializeServerData(data: Record<string, unknown>): string {
  // serializeProps로 고급 직렬화 (Date, Map, Set 등 지원)
  const json = escapeJsonForInlineScript(serializeProps(data));

  return `<script id="__MANDU_DATA__" type="application/json">${json}</script>
<script>window.__MANDU_DATA_RAW__ = document.getElementById('__MANDU_DATA__').textContent;</script>`;
}

/**
 * Import map 생성 (bare specifier 해결용)
 */
function generateImportMap(manifest: BundleManifest): string {
  if (!manifest.importMap || Object.keys(manifest.importMap.imports).length === 0) {
    return "";
  }

  const importMapJson = escapeJsonForInlineScript(JSON.stringify(manifest.importMap, null, 2));
  return `<script type="importmap">${importMapJson}</script>`;
}

/**
 * Hydration 스크립트 태그 생성
 * v0.9.0: vendor, runtime 모두 modulepreload로 성능 최적화
 */
function generateHydrationScripts(
  routeId: string,
  manifest: BundleManifest
): string {
  const scripts: string[] = [];

  // Import map 먼저 (반드시 module scripts 전에 위치해야 함)
  const importMap = generateImportMap(manifest);
  if (importMap) {
    scripts.push(importMap);
  }

  // Vendor modulepreload (React, ReactDOM 등 - 캐시 효율 극대화)
  if (manifest.shared.vendor) {
    scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(manifest.shared.vendor)}">`);
  }
  if (manifest.importMap?.imports) {
    const imports = manifest.importMap.imports;
    // react-dom, react-dom/client 등 추가 preload
    if (imports["react-dom"] && imports["react-dom"] !== manifest.shared.vendor) {
      scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(imports["react-dom"])}">`);
    }
    if (imports["react-dom/client"]) {
      scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(imports["react-dom/client"])}">`);
    }
  }

  // Runtime modulepreload (hydration 실행 전 미리 로드)
  if (manifest.shared.runtime) {
    scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(manifest.shared.runtime)}">`);
  }

  // Island 번들 modulepreload (성능 최적화 - prefetch only)
  // Per-island bundles take precedence when available
  const routeIslands = manifest.islands
    ? Object.values(manifest.islands).filter((ib) => ib.route === routeId)
    : [];

  if (routeIslands.length > 0) {
    for (const ib of routeIslands) {
      const cacheBust = `${ib.js}${ib.js.includes('?') ? '&' : '?'}v=${Date.now()}`;
      scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(cacheBust)}">`);
    }
  } else {
    // Fallback: route-level bundle (backward compat)
    const bundle = manifest.bundles[routeId];
    if (bundle) {
      const cacheBust = `${bundle.js}${bundle.js.includes('?') ? '&' : '?'}v=${Date.now()}`;
      scripts.push(`<link rel="modulepreload" href="${escapeHtmlAttr(cacheBust)}">`);
    }
  }

  // Runtime 로드 (hydrateIslands 실행 - dynamic import 사용)
  if (manifest.shared.runtime) {
    scripts.push(`<script type="module" src="${escapeHtmlAttr(manifest.shared.runtime)}"></script>`);
  }

  return scripts.join("\n");
}

/**
 * Island 래퍼로 컨텐츠 감싸기
 * v0.8.0: data-mandu-src 속성 추가 (Runtime이 dynamic import로 로드)
 */
export function wrapWithIsland(
  content: string,
  routeId: string,
  priority: HydrationPriority = "visible",
  bundleSrc?: string
): string {
  const cacheBustedSrc = bundleSrc ? `${bundleSrc}?t=${Date.now()}` : undefined;
  const srcAttr = cacheBustedSrc ? ` data-mandu-src="${escapeHtmlAttr(cacheBustedSrc)}"` : "";
  return `<div data-mandu-island="${escapeHtmlAttr(routeId)}"${srcAttr} data-mandu-priority="${escapeHtmlAttr(priority)}" style="display:contents">${content}</div>`;
}

/**
 * Phase 7.1 R2 Agent D — Fast Refresh preamble emission helper.
 * Phase 7.2 R1 Agent C (H1) — optional CSP nonce injection.
 *
 * Emits the `<script>` block returned by `generateFastRefreshPreamble`
 * ONLY when all three preconditions hold:
 *
 *   1. `isDev === true` — the preamble and its glue import rely on the
 *      `_fast-refresh-runtime.js` / `_vendor-react-refresh.js` assets
 *      which are only emitted by the dev bundler path.
 *   2. `manifest.shared.fastRefresh` is populated — which happens only
 *      in dev mode (see `build.ts:1548`). Missing here implies either a
 *      prod manifest, a failed vendor shim build, or a unit test that
 *      stubbed the manifest. All three short-circuit to empty output.
 *   3. Both the `glue` and `runtime` fields are non-empty strings —
 *      `generateFastRefreshPreamble` itself re-checks and emits a
 *      defensive stub comment if either is missing.
 *
 * Returned as a string so the caller can position it inside `<head>`
 * BEFORE any `<script type="module">` runs. This matters because
 * `reactFastRefresh: true`-transformed islands call `$RefreshReg$` at
 * the top of the module; the stubs installed inside the preamble must
 * exist before those calls execute, otherwise the island throws a
 * `ReferenceError` during evaluation and never hydrates.
 *
 * Production builds see `fastRefresh` as `undefined` on the manifest
 * (build.ts omits it), so this function returns `""` and the HTML
 * remains byte-identical to pre-7.1 prod output.
 *
 * When `nonce` is a non-empty string, the returned `<script>` opening
 * tag is rewritten to `<script nonce="...">`. This is the single
 * modification point for CSP compliance — the inner body comes verbatim
 * from `generateFastRefreshPreamble` (owned by dev.ts) so the bundler
 * and SSR sides stay decoupled.
 */
function generateFastRefreshPreambleTag(
  isDev: boolean,
  manifest: BundleManifest | undefined,
  nonce?: string,
): string {
  if (!isDev) return "";
  const fr = manifest?.shared?.fastRefresh;
  if (!fr) return "";
  if (!fr.glue || !fr.runtime) return "";
  // Phase 7.2.R3 M-01 — manifest wire-up. `isSafeManduUrl` rejects
  // tampered entries (protocol, traversal, non-/.mandu paths, >2KB).
  // Fail closed: if either URL is suspect, skip the preamble entirely
  // — dev refresh breaks loudly instead of injecting an attacker-
  // controlled <script src> via a tampered manifest.
  if (!isSafeManduUrl(fr.glue) || !isSafeManduUrl(fr.runtime)) return "";
  const raw = generateFastRefreshPreamble(fr.glue, fr.runtime);
  if (!nonce) return raw;
  // Inject nonce attribute onto the first <script> tag ONLY. Matches
  // exactly `<script>` (the shape emitted by `generateFastRefreshPreamble`)
  // to avoid accidentally nonce-ing a `<script src=...>` or malformed
  // variant. If the upstream function changes shape, the regex still
  // fails closed (returns raw) — unit-tested.
  const nonceEscaped = escapeHtmlAttr(nonce);
  return raw.replace(/<script>/, `<script nonce="${nonceEscaped}">`);
}

/**
 * Phase 7.2 R1 Agent C (H1) — Resolve the CSP nonce to use for the Fast
 * Refresh preamble. Three layered precedences (highest first):
 *
 *   1. `MANDU_CSP_NONCE=0` env var forces off (opt-out escape hatch for
 *      projects with an existing Content-Security-Policy pipeline that
 *      would collide with ours).
 *   2. Explicit `options.cspNonce`:
 *        - string  → use verbatim
 *        - true    → auto-generate
 *        - false   → off
 *   3. No option → off (preserves legacy behavior byte-identical).
 *
 * Auto-generation uses `crypto.getRandomValues` with 16 bytes → 128 bits
 * of entropy, matching OWASP guidance and the existing
 * `@mandujs/core/middleware/secure` CSP nonce generator.
 *
 * Only invoked when we actually intend to emit a preamble (i.e. dev mode
 * + `needsHydration` + populated `shared.fastRefresh`). Returns
 * `undefined` when CSP nonce emission is disabled; the caller short-
 * circuits the `nonce=` attribute and skips the response CSP header.
 */
function resolveFastRefreshCspNonce(
  opt: SSROptions["cspNonce"],
): string | undefined {
  // Opt-out: env var takes absolute precedence. Read lazily because
  // process is not available in some edge runtimes.
  try {
    if (typeof process !== "undefined" && process.env && process.env.MANDU_CSP_NONCE === "0") {
      return undefined;
    }
  } catch {
    /* some runtimes lock down `process` access — treat as unset */
  }
  if (opt === false || opt === undefined) return undefined;
  if (typeof opt === "string" && opt.length > 0) return opt;
  if (opt === true) return generateCspNonce();
  return undefined;
}

/**
 * Phase 7.2 R1 Agent C (H1) — Generate a fresh CSP nonce.
 *
 * 16 bytes (128 bits) of cryptographic entropy, base64-encoded. Matches
 * `packages/core/src/middleware/secure/csp.ts#resolveNonce`. The same
 * encoding keeps the nonce attribute short (≤24 base64 chars) and
 * compatible with OWASP CSP3 guidance.
 *
 * Exported as `_testOnly_generateCspNonce` below for tests to verify
 * entropy and encoding without depending on the specific platform.
 */
function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Bun / Node 20+ both expose btoa + String.fromCharCode; avoid the
  // Buffer dependency for portability. Node has `btoa` since v16.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Phase 7.2 R1 Agent C (H1) — Build the `Content-Security-Policy`
 * header value to pair with a nonce-bearing preamble.
 *
 * Minimal and permissive by design — we are specifically writing a
 * DEV-mode header that lets the Fast Refresh preamble + dynamic
 * imports execute. We deliberately do NOT emit a blanket CSP for the
 * entire page; that is the job of `@mandujs/core/middleware/secure` or
 * the project's edge. Our sole concern here is: the inline preamble
 * MUST be authorized without forcing the user to hand-write
 * `'unsafe-inline'` in their policy.
 *
 * Header shape:
 *   `script-src 'self' 'nonce-<n>' 'strict-dynamic'`
 *
 * Why `'strict-dynamic'`: once the nonced preamble runs, it loads the
 * Fast Refresh runtime via `import('/.mandu/client/...')`. Without
 * `'strict-dynamic'` the module graph would need to be nonce-tagged
 * end-to-end, which Bun.build does not support today.
 */
function buildFastRefreshCspHeader(nonce: string): string {
  // Nonces are already URL-safe / base64 but we defensively strip any
  // stray quotes — should be impossible given the generator, but this
  // closes the door on a caller-supplied nonce that slipped a quote in.
  const safe = nonce.replace(/["\\\r\n]/g, "");
  return `script-src 'self' 'nonce-${safe}' 'strict-dynamic'`;
}

/** @internal test helper — exposed only so unit tests can inspect the generator. */
export const _testOnly_generateCspNonce = generateCspNonce;
/** @internal test helper — exposed only so unit tests can inspect the resolver. */
export const _testOnly_resolveFastRefreshCspNonce = resolveFastRefreshCspNonce;
/** @internal test helper — exposed only so unit tests can inspect the header builder. */
export const _testOnly_buildFastRefreshCspHeader = buildFastRefreshCspHeader;
/** @internal test helper — exposed only so unit tests can inspect the preamble tag emitter. */
export const _testOnly_generateFastRefreshPreambleTag = generateFastRefreshPreambleTag;

/**
 * Phase 7.2 R1 Agent C (H1) — Internal WeakMap that ferries the
 * CSP nonce chosen during a `renderToHTML` call back to the caller
 * (`renderSSR` / `renderWithHydration`) so they can emit the matching
 * `Content-Security-Policy` response header.
 *
 * Keyed by the `options` object identity — the only caller that cares
 * reuses the same options instance it handed in. External consumers
 * of `renderToHTML` (tests, advanced users) are unaffected: they
 * simply never look up the map and no memory accumulates because
 * WeakMap entries collect when their key reference dies.
 */
const OPTIONS_TO_NONCE = new WeakMap<object, string>();

/** @internal surface for unit tests — do not use in application code. */
export function _testOnly_getAttachedCspNonce(options: SSROptions): string | undefined {
  return OPTIONS_TO_NONCE.get(options as object);
}

export function renderToHTML(element: ReactElement, options: SSROptions = {}): string {
  const {
    title = "Mandu App",
    lang = "ko",
    serverData,
    hydration,
    bundleManifest,
    routeId,
    headTags = "",
    bodyEndTags = "",
    isDev = false,
    hmrPort,
    enableClientRouter = false,
    routePattern,
    cssPath,
    islandPreWrapped,
    transitions = true,
    prefetch = true,
    devtools,
  } = options;

  // CSS 링크 태그 생성
  // - cssPath가 string이면 해당 경로 사용
  // - cssPath가 false 또는 undefined이면 링크 미삽입 (404 방지)
  const cssLinkTag = cssPath
    ? `<link rel="stylesheet" href="${escapeHtmlAttr(`${cssPath}${isDev ? `?t=${Date.now()}` : ""}`)}">`
    : "";

  // Issue #192 — Smooth navigation primitives.
  // `transitions`: CSS `@view-transition { navigation: auto }` — inert in
  //   non-supporting browsers (Firefox, older Safari), crossfade in
  //   Chrome/Edge ≥ 111 and Safari 18.2+. Zero layout impact, ~70 bytes.
  // `prefetch`: ~500-byte IIFE that listens for `mouseover` on internal
  //   `<a href="/...">` anchors and issues `<link rel="prefetch">`. Honors
  //   per-link `data-no-prefetch` opt-out.
  // Position: immediately after `cssLinkTag` so that (a) the at-rule
  //   parses alongside the user stylesheet, and (b) both blocks precede
  //   user-owned `headTags` / `collectedHeadTags`, letting users override
  //   or cancel with a later inline style. False disables each independently.
  const viewTransitionTag = transitions !== false ? VIEW_TRANSITION_STYLE_TAG : "";
  const prefetchScriptTag = prefetch !== false ? PREFETCH_HELPER_SCRIPT : "";

  // useHead/useSeoMeta SSR 수집
  let collectedHeadTags = "";
  let headReset: (() => void) | undefined;
  let headGet: (() => string) | undefined;
  try {
    const mod = require("../client/use-head");
    headReset = mod.resetSSRHead;
    headGet = mod.getSSRHeadTags;
    headReset?.();
  } catch { /* client 모듈 로드 실패 시 무시 */ }

  const renderToString = getRenderToString();
  let content = renderToString(element);

  // 렌더링 중 수집된 head 태그
  collectedHeadTags = headGet?.() ?? "";

  // Island 래퍼 적용 (hydration 필요 시)
  // islandPreWrapped가 true이면 React 엘리먼트 레벨에서 이미 래핑됨 → HTML 래핑 건너뜀
  const needsHydration =
    hydration && hydration.strategy !== "none" && routeId && bundleManifest;

  if (needsHydration && !islandPreWrapped) {
    // v0.8.0: bundleSrc를 data-mandu-src 속성으로 전달 (Runtime이 dynamic import로 로드)
    const bundle = bundleManifest.bundles[routeId];
    const bundleSrc = bundle?.js;
    content = wrapWithIsland(content, routeId, hydration.priority, bundleSrc);
  }

  // Zero-JS 모드: island이 없는 페이지에서는 클라이언트 JS 번들을 전송하지 않음
  // HMR/DevTools는 dev 환경에서만 유지 (CSS 핫리로드 등)
  let dataScript = "";
  let routeScript = "";
  let hydrationScripts = "";
  let routerScript = "";

  if (needsHydration) {
    // 서버 데이터 스크립트 (클라이언트 hydration에서 사용)
    if (serverData && routeId) {
      const wrappedData = {
        [routeId]: {
          serverData,
          timestamp: Date.now(),
        },
      };
      dataScript = serializeServerData(wrappedData);
    }

    // Client-side Routing: 라우트 정보 주입
    if (enableClientRouter && routeId) {
      routeScript = generateRouteScript(routeId, routePattern || "", serverData);
    }

    // Hydration 스크립트 (vendor/runtime/island preloads)
    if (bundleManifest) {
      hydrationScripts = generateHydrationScripts(routeId, bundleManifest);
    }

    // Client-side Router 스크립트
    if (enableClientRouter && bundleManifest) {
      routerScript = generateClientRouterScript(bundleManifest);
    }
  }

  // HMR 스크립트 (개발 모드 — island 유무와 무관하게 CSS 핫리로드 지원)
  let hmrScript = "";
  if (isDev && hmrPort) {
    hmrScript = generateHMRScript(hmrPort);
  }

  // Phase 7.1 R2 Agent D: Fast Refresh preamble. Must land in <head>
  // BEFORE any island `<script type="module">` evaluates — the stubs it
  // installs for `$RefreshReg$` / `$RefreshSig$` are required by every
  // module the bundler transformed with `reactFastRefresh: true`. Dev
  // mode only; prod manifests omit `shared.fastRefresh` so the helper
  // returns "".
  // Phase 7.2 R1 Agent C (H1): resolve nonce up-front so the same
  // value is reused for the <script> tag AND surfaced to the caller
  // (via `renderToHTMLWithMeta`) for the response CSP header.
  const resolvedCspNonce = needsHydration && isDev
    ? resolveFastRefreshCspNonce(options.cspNonce)
    : undefined;
  if (resolvedCspNonce) {
    OPTIONS_TO_NONCE.set(options as object, resolvedCspNonce);
  }
  const fastRefreshPreamble = needsHydration
    ? generateFastRefreshPreambleTag(isDev, bundleManifest, resolvedCspNonce)
    : "";

  // Issue #191 — DevTools 번들 (~1.15 MB) 주입 결정.
  //   - 기본: island 이 하나라도 있을 때만 주입. Pure-SSR 페이지는 0 bytes 다운로드.
  //   - `devtools === true`  → 강제 주입 (SSR-only 프로젝트에서 Kitchen panel 원할 때)
  //   - `devtools === false` → 강제 스킵 (island 프로젝트에서도 Kitchen 비활성화)
  // Cache-bust 은 `manifest.buildTime` 우선, 없으면 `Date.now()`.
  let devtoolsScript = "";
  if (isDev && shouldInjectDevtools(devtools, bundleManifest)) {
    devtoolsScript = generateDevtoolsScript(bundleManifest);
  }

  // #179: body 내 <link> 태그를 <head>로 호이스팅
  // React 컴포넌트(layout.tsx 등)에서 <link>를 렌더링하면 body 안에 위치하게 되는데,
  // 폰트/스타일시트는 <head>에 있어야 FOUT 없이 로드됨
  const linkTagPattern = /<link\s[^>]*(?:rel=["'](?:stylesheet|preconnect|preload|icon|dns-prefetch)["'][^>]*|href=["'][^"']+["'][^>]*)\/?\s*>/gi;
  const hoistedLinks: string[] = [];
  const bodyContent = content.replace(linkTagPattern, (match) => {
    hoistedLinks.push(match);
    return "";
  });
  const hoistedLinkTags = hoistedLinks.join("\n  ");

  return `<!doctype html>
<html lang="${escapeHtmlAttr(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtmlText(title)}</title>
  ${cssLinkTag}
  ${viewTransitionTag}
  ${prefetchScriptTag}
  ${hoistedLinkTags}
  ${headTags}
  ${collectedHeadTags}
  ${fastRefreshPreamble}
</head>
<body>
  <div id="root">${bodyContent}</div>
  ${dataScript}
  ${routeScript}
  ${hydrationScripts}
  ${needsHydration ? REACT_INTERNALS_SHIM_SCRIPT : ""}
  ${routerScript}
  ${hmrScript}
  ${devtoolsScript}
  ${bodyEndTags}
</body>
</html>`;
}

/**
 * Client-side Routing: 현재 라우트 정보 스크립트 생성
 */
function generateRouteScript(
  routeId: string,
  pattern: string,
  serverData?: Record<string, unknown>
): string {
  const routeInfo = {
    id: routeId,
    pattern,
    params: extractParamsFromUrl(pattern),
  };

  const json = escapeJsonForInlineScript(JSON.stringify(routeInfo));

  return `<script>window.__MANDU_ROUTE__ = ${json};</script>`;
}

/**
 * URL 패턴에서 파라미터 추출 (클라이언트에서 사용)
 */
function extractParamsFromUrl(pattern: string): Record<string, string> {
  // 서버에서는 실제 params를 전달받으므로 빈 객체 반환
  // 실제 params는 serverData나 별도 전달
  return {};
}

/**
 * Client-side Router 스크립트 로드
 */
function generateClientRouterScript(manifest: BundleManifest): string {
  // Import map 먼저 (이미 hydration에서 추가되었을 수 있음)
  const scripts: string[] = [];

  // 라우터 번들이 있으면 로드
  if (manifest.shared?.router) {
    scripts.push(`<script type="module" src="${escapeHtmlAttr(manifest.shared.router)}"></script>`);
  }

  return scripts.join("\n");
}

/**
 * HMR 스크립트 생성
 *
 * Phase 7.2 Agent B — HDR (Hot Data Revalidation) extension.
 * When the CLI broadcasts `{type: "vite", payload: {type: "custom",
 * event: "mandu:slot-refetch", data: {routeId, slotPath, ...}}}` (via
 * `hmrServer.broadcastVite`) we handle it here without remounting
 * the React tree: fetch the current URL with `X-Mandu-HDR: 1`,
 * receive JSON loader data, and hand it to the router's
 * `applyHDRUpdate` hook (installed by `initializeRouter`). If the
 * route doesn't match, the router hook is missing, or the fetch
 * fails — we fall back to `location.reload()`. See the detailed
 * design notes in `bundler/dev.ts:generateHMRClientScript` docstring.
 */
function generateHMRScript(port: number): string {
  const hmrPort = port + PORTS.HMR_OFFSET;
  return `<script>
window.__MANDU_HMR_PORT__ = ${hmrPort};
(function() {
  var ws = null;
  var reconnectAttempts = 0;
  var maxReconnectAttempts = ${TIMEOUTS.HMR_MAX_RECONNECT};
  var baseDelay = ${TIMEOUTS.HMR_RECONNECT_DELAY};

  function scheduleReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++;
      var delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), 30000);
      setTimeout(connect, delay);
    }
  }

  function hdrCurrentRouteId() {
    var rs = window.__MANDU_ROUTER_STATE__;
    if (rs && rs.currentRoute && rs.currentRoute.id) return String(rs.currentRoute.id);
    var r = window.__MANDU_ROUTE__;
    if (r && r.id) return String(r.id);
    return null;
  }

  function hdrFallback(reason) {
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
    if (!routeId) { hdrFallback('no-routeId'); return; }
    if (window.__MANDU_HDR_DISABLED__ === true) { hdrFallback('disabled'); return; }
    var currentId = hdrCurrentRouteId();
    if (currentId !== routeId) {
      console.log('[Mandu HDR] slot-refetch for ' + routeId + ' ignored (current route: ' + currentId + ')');
      return;
    }
    var started = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    hdrMark('hdr:refetch-start', { routeId: routeId, slotPath: data.slotPath });
    var url = window.location.pathname + window.location.search;
    var sep = url.indexOf('?') >= 0 ? '&' : '?';
    var dataUrl = url + sep + '_data=1';
    fetch(dataUrl, { credentials: 'same-origin', headers: { 'X-Mandu-HDR': '1' } })
      .then(function (res) {
        if (!res.ok) { hdrFallback('status-' + res.status); return null; }
        return res.json();
      })
      .then(function (payload) {
        if (!payload) return;
        var revalidate = window.__MANDU_ROUTER_REVALIDATE__;
        if (typeof revalidate !== 'function') { hdrFallback('no-router'); return; }
        try {
          revalidate(routeId, payload.loaderData);
          var elapsed = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - started;
          console.log('[Mandu HDR] Applied loader data for ' + routeId + ' in ' + elapsed.toFixed(0) + 'ms');
          hdrMark('hdr:refetch', { routeId: routeId, slotPath: data.slotPath, elapsed: elapsed });
        } catch (err) {
          console.error('[Mandu HDR] Revalidate threw:', err);
          hdrFallback('revalidate-throw');
        }
      })
      .catch(function (err) {
        console.error('[Mandu HDR] Fetch failed:', err);
        hdrFallback('fetch-failed');
      });
  }

  function connect() {
    try {
      ws = new WebSocket('ws://' + window.location.hostname + ':${hmrPort}');
      ws.onopen = function() {
        console.log('[Mandu HMR] Connected');
        reconnectAttempts = 0;
      };
      ws.onmessage = function(e) {
        try {
          var msg = JSON.parse(e.data);
          // Vite-compat envelope: custom event for HDR.
          if ((msg.type === 'vite' || msg.type === 'vite-replay') && msg.payload) {
            if (msg.payload.type === 'custom' && msg.payload.event === 'mandu:slot-refetch') {
              handleSlotRefetch(msg.payload.data || {});
              return;
            }
            // Other Vite payloads fall through to the legacy branches
            // when possible.
            if (msg.payload.type === 'full-reload') {
              location.reload();
              return;
            }
          }
          if (msg.type === 'reload' || msg.type === 'island-update' || msg.type === 'full-reload' || msg.type === 'layout-update' || msg.type === 'invalidate') {
            console.log('[Mandu HMR] Reloading...');
            location.reload();
          } else if (msg.type === 'slot-refetch') {
            // Legacy Mandu-internal path (not yet used by the server — kept
            // for forward-compat).
            handleSlotRefetch(msg.data || {});
          } else if (msg.type === 'css-update') {
            var cssPath = (msg.data && msg.data.cssPath) || '/.mandu/client/globals.css';
            var links = document.querySelectorAll('link[rel="stylesheet"]');
            var updated = false;
            for (var i = 0; i < links.length; i++) {
              var href = links[i].getAttribute('href') || '';
              var base = href.split('?')[0];
              if (base === cssPath || href.includes('globals.css') || href.includes('.mandu/client')) {
                links[i].setAttribute('href', base + '?t=' + Date.now());
                updated = true;
              }
            }
            if (!updated) location.reload();
          } else if (msg.type === 'error') {
            console.error('[Mandu HMR] Build error:', msg.data && msg.data.message);
          }
        } catch(err) {}
      };
      ws.onclose = function() { scheduleReconnect(); };
    } catch(err) {
      scheduleReconnect();
    }
  }
  connect();
})();
</script>`;
}

/**
 * Issue #191 — Determine whether the dev-only `_devtools.js` bundle
 * (~1.15 MB React dev runtime + Kitchen panel) should be injected
 * into the HTML response.
 *
 * Decision table (`devtools` option × manifest shape):
 *
 *   | `devtools`  | hasIslands | inject? | rationale                   |
 *   |-------------|------------|---------|-----------------------------|
 *   | `true`      | any        | YES     | explicit opt-in             |
 *   | `false`     | any        | NO      | explicit opt-out            |
 *   | `undefined` | true       | YES     | default, hydration runtime  |
 *   | `undefined` | false      | NO      | pure-SSR — save 1.15 MB     |
 *   | `undefined` | no manifest| NO      | nothing to hydrate anyway   |
 *
 * `hasIslands` is derived from the existing manifest shape rather than
 * a new field, so no bundler-side change is required:
 *   - `manifest.islands` is populated only when per-island code
 *     splitting produced at least one bundle (build.ts:1654).
 *   - `manifest.bundles` entries exist only for routes where
 *     `needsHydration()` is true (build.ts:70 filter).
 * Either non-empty ⇒ some route on this server hydrates ⇒ devtools useful.
 *
 * @internal Exported via `_testOnly_shouldInjectDevtools` below so
 * `tests/runtime/devtools-inject.test.ts` can table-test the matrix
 * without mounting React.
 */
function shouldInjectDevtools(
  devtools: boolean | undefined,
  manifest: BundleManifest | undefined,
): boolean {
  // Explicit overrides take absolute precedence.
  if (devtools === true) return true;
  if (devtools === false) return false;

  // Default behavior: inject only when there is at least one island.
  if (!manifest) return false;
  const hasIslandsMap =
    manifest.islands && Object.keys(manifest.islands).length > 0;
  const hasBundles =
    manifest.bundles && Object.keys(manifest.bundles).length > 0;
  return Boolean(hasIslandsMap || hasBundles);
}

/**
 * Issue #191 — DevTools 번들 로드 스크립트 생성 (개발 모드 전용).
 *
 * `_devtools.js` 번들이 자체적으로 `initManduKitchen()` 을 호출한다.
 *
 * Cache-bust: `?v=${manifest.buildTime}` 을 우선 사용하고, manifest 가 없으면
 * `?t=${Date.now()}` 로 fallback. `buildTime` 은 빌드별로 고정이라 브라우저
 * 캐시 효율이 좋지만, 동일 빌드 안에서 HMR 이 발생하더라도 devtools 번들은
 * dev 서버의 static 응답이 `Cache-Control: no-cache, no-store, must-revalidate`
 * (server.ts:1104) 를 보내므로 stale 위험이 없다.
 *
 * @internal Exported via `_testOnly_generateDevtoolsScript` below so tests
 * can verify the URL shape without needing a full render.
 */
function generateDevtoolsScript(manifest?: BundleManifest): string {
  const cacheBust = manifest?.buildTime
    ? `?v=${encodeURIComponent(manifest.buildTime)}`
    : `?t=${Date.now()}`;
  return `<script type="module" src="/.mandu/client/_devtools.js${cacheBust}"></script>`;
}

/** @internal test helper — exposed only so unit tests can inspect the decision. */
export const _testOnly_shouldInjectDevtools = shouldInjectDevtools;
/** @internal test helper — exposed only so unit tests can inspect the script tag. */
export const _testOnly_generateDevtoolsScript = generateDevtoolsScript;

export function createHTMLResponse(
  html: string,
  status: number = 200,
  /**
   * Phase 7.2 R1 Agent C (H1) — extra headers to merge in alongside
   * the default `Content-Type`. Used for the Fast Refresh CSP header
   * when a nonce was produced; can be repurposed for future
   * per-response metadata without changing callsites.
   */
  extraHeaders?: Record<string, string>,
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=utf-8",
  };
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers[k] = v;
    }
  }
  return new Response(html, { status, headers });
}

export function renderSSR(element: ReactElement, options: SSROptions = {}): Response {
  const html = renderToHTML(element, options);
  // Phase 7.2 R1 Agent C (H1): if a CSP nonce was produced during
  // rendering (dev + fast-refresh path), emit the matching header so
  // the inline preamble is authorized under strict CSP.
  const nonce = _testOnly_getAttachedCspNonce(options);
  const extra = nonce
    ? { "Content-Security-Policy": buildFastRefreshCspHeader(nonce) }
    : undefined;
  return createHTMLResponse(html, 200, extra);
}

/**
 * Hydration이 포함된 SSR 렌더링
 *
 * @example
 * ```typescript
 * const response = await renderWithHydration(
 *   <TodoList todos={todos} />,
 *   {
 *     title: "할일 목록",
 *     routeId: "todos",
 *     serverData: { todos },
 *     hydration: { strategy: "island", priority: "visible" },
 *     bundleManifest,
 *   }
 * );
 * ```
 */
export async function renderWithHydration(
  element: ReactElement,
  options: SSROptions & {
    routeId: string;
    serverData: Record<string, unknown>;
    hydration: HydrationConfig;
    bundleManifest: BundleManifest;
  }
): Promise<Response> {
  const html = renderToHTML(element, options);
  // Phase 7.2 R1 Agent C (H1) — same CSP header logic as renderSSR.
  const nonce = _testOnly_getAttachedCspNonce(options);
  const extra = nonce
    ? { "Content-Security-Policy": buildFastRefreshCspHeader(nonce) }
    : undefined;
  return createHTMLResponse(html, 200, extra);
}
