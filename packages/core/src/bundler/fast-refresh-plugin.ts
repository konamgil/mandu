/**
 * Phase 7.1 B-4 — Fast Refresh boundary injection plugin.
 *
 * This Bun.build plugin runs in the `onLoad` phase for every file whose
 * path matches `.client.tsx?` / `.island.tsx?`. It reads the source,
 * appends a boundary-registration epilogue that calls
 * `window.__MANDU_HMR__.acceptFile(<module url>)`, and hands the
 * augmented source back to Bun for transformation. No AST traversal is
 * required: the appended code is syntactically isolated (semicolon-
 * terminated inside a guard) and always parses regardless of the source
 * it's being concatenated to.
 *
 * Why `onLoad` and not a define/transform hook?
 * ─────────────────────────────────────────────
 * Bun's plugin API (`onResolve`, `onLoad`, `onStart`) does not expose a
 * post-transform AST pass. The `onLoad` hook is the only point where we
 * can affect the source before `reactFastRefresh` runs; it receives the
 * raw file bytes and returns `{ contents, loader }`. Vite does this via
 * a Rollup `transform` hook for the same reason.
 *
 * The emitted epilogue is intentionally defensive:
 *
 *   if (typeof window !== "undefined" && window.__MANDU_HMR__) {
 *     window.__MANDU_HMR__.acceptFile(<url>);
 *   }
 *
 * This survives three edge cases:
 *   1. Module evaluated during SSR (no window)   → guard short-circuits.
 *   2. Preamble not yet loaded                    → `__MANDU_HMR__` absent,
 *                                                    no throw.
 *   3. Same module re-evaluated after hot swap    → `acceptFile` is
 *                                                    idempotent by design.
 *
 * Skipping mechanics:
 *   - In production (`disabled: true`) the plugin short-circuits so we
 *     don't ship refresh code to users.
 *   - Files whose path includes `node_modules` are never eligible.
 *   - A file that already contains a literal `window.__MANDU_HMR__` call
 *     is trusted — we don't append a second one (idempotent even across
 *     multiple `Bun.build` passes that bundle a pre-bundled module).
 *   - URLs exceeding `MAX_ACCEPT_FILE_URL_LEN` (2 KB) or containing
 *     characters that could escape the inline script context (`</`,
 *     newline, nul) are rejected with a warning — no boundary emitted.
 *     See `docs/security/phase-7-1-audit.md` §3 L-01.
 *
 * References:
 *   docs/bun/phase-7-1-diagnostics/fast-refresh-strategy.md §4 (4 phase breakdown)
 *   docs/bun/phase-7-1-team-plan.md §4 Agent B
 *   docs/bun/phase-7-2-team-plan.md §3 Agent C H3 (URL length cap)
 *   docs/security/phase-7-1-audit.md §3 L-01
 *   https://bun.com/docs/runtime/plugins
 *   packages/core/src/runtime/fast-refresh-types.ts
 */

import fs from "fs/promises";
import type { BunPlugin } from "bun";

import type {
  BoundaryDecision,
  FastRefreshPluginOptions,
} from "../runtime/fast-refresh-types";

// ============================================
// Exported constants (shared with tests)
// ============================================

/**
 * Default include filter. Matches `foo.client.tsx`, `foo.client.ts`,
 * `foo.island.tsx`, `foo.island.ts`. Deliberately strict — we do NOT
 * default to every `.tsx` to stay aligned with Mandu's component model
 * (only explicit client / island files are HMR boundaries; pages and
 * layouts full-reload to re-run their SSR slot).
 */
export const DEFAULT_INCLUDE = /\.(client|island)\.tsx?$/;

/**
 * Guard regex that detects whether a file already contains an
 * `acceptFile` call, so multi-pass bundling (e.g. pre-bundled demo
 * packages) doesn't stack registrations.
 */
const ALREADY_INJECTED = /__MANDU_HMR__\s*(?:\?\.)?\s*\.acceptFile\s*\(/;

/**
 * Phase 7.2 H3 (L-01 audit): cap the length of a URL we will accept into
 * an `acceptFile()` call. 2 KB is ~8× larger than any realistic Mandu
 * tmpdir fixture and matches `MAX_BOUNDARY_URL_LEN` suggested by the
 * audit. Beyond this we refuse to append the boundary — the file simply
 * falls back to full-reload HMR, which is the safe degradation path.
 */
export const MAX_ACCEPT_FILE_URL_LEN = 2048;

/**
 * Phase 7.2 H3 (L-01 audit): characters or substrings that, if present
 * inside the URL string, could break out of the emitted inline `<script>`
 * context. `</` is the classic HTML-in-JS escape; `\n` / `\r` / `\u2028`
 * / `\u2029` are JS literal terminators; `\x00`-`\x1f` are control chars
 * the parser will complain about anyway. We reject outright rather than
 * try to re-escape — these paths are filesystem-authored so the
 * legitimate case never produces them.
 */
const UNSAFE_URL_SEQUENCES = ["</", "\u2028", "\u2029", "<script", "<!--"] as const;
const UNSAFE_URL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\r\n]/;

/**
 * Comment-neutral detector for `node_modules`. Using a forward-slashed
 * string match is sufficient because Mandu normalizes paths to posix
 * internally (see `bundler/dev.ts` `normalizeFsPath`).
 */
function isInNodeModules(filePath: string): boolean {
  return (
    filePath.includes("/node_modules/") || filePath.includes("\\node_modules\\")
  );
}

/**
 * Runtime predicate that decides whether `moduleUrl` is safe to bake
 * into the inline `<script>` that the plugin emits. Exported so tests
 * and diagnostic callers can share the exact rule.
 *
 * The checks are ordered cheapest-first (length before char-regex before
 * substring scan) so a successful path short-circuits early. Returns
 * `{ ok: true }` for accepted URLs and `{ ok: false, reason }` for
 * rejections — the reason string feeds into the warning printed at
 * injection time so developers see exactly why their file went
 * full-reload.
 */
export function validateAcceptFileUrl(
  moduleUrl: string,
): { ok: true } | { ok: false; reason: string } {
  if (typeof moduleUrl !== "string") {
    return { ok: false, reason: "moduleUrl is not a string" };
  }
  if (moduleUrl.length === 0) {
    return { ok: false, reason: "moduleUrl is empty" };
  }
  if (moduleUrl.length > MAX_ACCEPT_FILE_URL_LEN) {
    return {
      ok: false,
      reason: `moduleUrl length ${moduleUrl.length} exceeds cap ${MAX_ACCEPT_FILE_URL_LEN}`,
    };
  }
  if (UNSAFE_URL_CHARS.test(moduleUrl)) {
    return { ok: false, reason: "moduleUrl contains control / newline chars" };
  }
  for (const seq of UNSAFE_URL_SEQUENCES) {
    if (moduleUrl.includes(seq)) {
      return {
        ok: false,
        reason: `moduleUrl contains unsafe substring "${seq}"`,
      };
    }
  }
  return { ok: true };
}

// ============================================
// Pure transform — exported for direct unit tests
// ============================================

/**
 * Append the boundary epilogue to `source` unless a prior pass already
 * did so. Pure function; no file I/O, no side effects. Takes a
 * `moduleUrl` string the plugin has already resolved (usually a
 * normalized form of the on-disk path).
 *
 * Phase 7.2 H3: hardened with `validateAcceptFileUrl`. When the URL
 * fails validation we emit the source unchanged and log a single
 * `console.warn`. The warning path is intentionally non-fatal — a
 * pathological URL that somehow leaks through is a DX concern
 * (full-reload HMR still works) not a correctness one.
 *
 * The returned string is always safe to pass to Bun's `tsx` loader —
 * the epilogue is wrapped in a `typeof window` guard, so a single pass
 * of semicolon insertion at the end of the user's source never produces
 * an unclosed JSX expression or a dangling string.
 */
export function appendBoundary(source: string, moduleUrl: string): string {
  if (ALREADY_INJECTED.test(source)) return source;

  // Phase 7.2 H3: URL length + escape cap. Rejected URLs fall through
  // to full-reload HMR without a boundary, preserving correctness.
  const check = validateAcceptFileUrl(moduleUrl);
  if (!check.ok) {
    // eslint-disable-next-line no-console
    console.warn(
      `[Mandu Fast Refresh] acceptFile URL rejected (${check.reason}); ` +
        `falling back to full-reload for this module.`,
    );
    return source;
  }

  // JSON.stringify here does double duty: (1) it escapes any
  // backslashes / quotes in the URL path (important on Windows), and
  // (2) it produces a valid JS string literal even for pathological
  // inputs (unicode, newline, etc.). We explicitly do NOT accept
  // moduleUrls from user input — the plugin controls what gets passed.
  const urlLiteral = JSON.stringify(moduleUrl);

  // The newline before our block is required: if `source` ends with a
  // `//` line comment, concatenation without `\n` would comment out
  // our guard. Trailing newline after ensures well-formed EOF.
  return (
    source +
    `\n;if (typeof window !== "undefined" && window.__MANDU_HMR__) {` +
    ` window.__MANDU_HMR__.acceptFile(${urlLiteral}); }\n`
  );
}

/**
 * Classify a file against the plugin's include filter without touching
 * the filesystem. Surfaced so tests and dev-mode diagnostics can answer
 * "would this file have been transformed?" without invoking Bun.build.
 */
export function classifyBoundary(
  filePath: string,
  options: FastRefreshPluginOptions = {},
): BoundaryDecision {
  if (options.disabled === true) {
    return { accepted: false, reason: "disabled" };
  }
  if (isInNodeModules(filePath)) {
    return { accepted: false, reason: "non-react" };
  }
  const include = options.include ?? DEFAULT_INCLUDE;
  if (!include.test(filePath)) {
    return { accepted: false, reason: "excluded-by-include" };
  }
  return {
    accepted: true,
    reason: "matched-include",
    source: filePath,
  };
}

// ============================================
// Bun plugin factory
// ============================================

/**
 * Build a `BunPlugin` that implements Fast Refresh boundary injection.
 * Consumed by `bundler/build.ts`'s `buildIsland` / `buildPerIslandBundle`
 * calls — those pass it in through `plugins: [...]` alongside whatever
 * else the build configures.
 *
 * When `options.disabled` is true, a no-op plugin is returned; this is
 * the production path, where we never want refresh injection on the
 * wire.
 */
export function fastRefreshPlugin(
  options: FastRefreshPluginOptions = {},
): BunPlugin {
  const include = options.include ?? DEFAULT_INCLUDE;
  const disabled = options.disabled === true;

  return {
    name: "mandu:fast-refresh-boundary",
    setup(build) {
      if (disabled) {
        // Register a no-op onLoad so the plugin still appears in Bun's
        // internal diagnostics, but it never matches anything.
        return;
      }

      build.onLoad({ filter: include }, async (args) => {
        // Skip anything under node_modules even if the filter would
        // have caught it. Pre-bundled packages aren't our concern.
        if (isInNodeModules(args.path)) {
          return undefined;
        }

        let source: string;
        try {
          source = await fs.readFile(args.path, "utf-8");
        } catch (err) {
          // Bubble up — Bun will surface the read failure as a build
          // error, which is the correct behavior (a file we matched
          // but can't read is a genuine fault).
          throw err;
        }

        // Normalize to forward slashes so the registered URL is
        // consistent regardless of platform. `dispatchReplacement`
        // uses the same normalization shape — this is load-bearing.
        const normalizedUrl = args.path.replace(/\\/g, "/");

        return {
          contents: appendBoundary(source, normalizedUrl),
          loader: (args.path.endsWith(".tsx") ? "tsx" : "ts") as
            | "tsx"
            | "ts",
        };
      });
    },
  };
}

// ============================================
// Test helpers
// ============================================

/**
 * Expose the `ALREADY_INJECTED` regex so tests can assert that
 * idempotency is governed by a single source of truth rather than
 * re-deriving the pattern.
 * @internal
 */
export const _testOnly_ALREADY_INJECTED = ALREADY_INJECTED;
