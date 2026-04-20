/**
 * Phase 18.α — Dev Error Overlay injector.
 *
 * Provides two surfaces:
 *
 *   1. `buildOverlayHeadTag(config)` — returns the `<style>` + `<script>`
 *      block to splice into the SSR `<head>`. Returns `""` in production
 *      mode, when the user opts out via `ManduConfig.dev.errorOverlay:
 *      false`, or when the environment signals a non-dev build. This is
 *      the canonical entry point called from `runtime/ssr.ts`.
 *
 *   2. `buildOverlayErrorEmbed(payload)` — serialises a
 *      `DevErrorPayload` into two tags (a `<script type="application/json">`
 *      the IIFE reads on DOMContentLoaded, plus a fire-and-forget event
 *      dispatch for late-mounted pages). Used by the 500-response path
 *      in `runtime/server.ts` so SSR crashes still render the overlay
 *      even when the React tree never produced output.
 *
 * Security posture:
 *   - Prod NEVER renders the overlay — triple-gated by env, explicit
 *     opt-in, and the injector's early-return.
 *   - The payload is escaped with the existing `escapeJsonForInlineScript`
 *     so `</script>` sequences cannot break out.
 *   - Stack traces contain absolute paths. Acceptable in dev; the
 *     injector refuses to emit when NODE_ENV=production regardless of
 *     any other flag.
 */
import { escapeJsonForInlineScript } from "../runtime/escape";
import { OVERLAY_CLIENT_SCRIPT } from "./overlay-client";
import { OVERLAY_STYLES } from "./overlay-styles";
import type { DevErrorPayload, DevErrorStackFrame } from "./types";
import {
  OVERLAY_CUSTOM_EVENT,
  OVERLAY_PAYLOAD_ELEMENT_ID,
} from "./types";

/**
 * Config consumed by the injector. Mirrors `ManduConfig.dev.errorOverlay`
 * plus an `isDev` escape hatch for callers that already know the runtime
 * mode (e.g. the SSR pipeline computes this from `settings.isDev`).
 */
export interface DevOverlayInjectorConfig {
  /** Explicit dev-mode signal. When `false`, the injector ALWAYS returns "". */
  isDev: boolean;
  /**
   * User-level opt-out from `ManduConfig.dev.errorOverlay`. `undefined`
   * means "default" (enabled in dev). `false` disables; `true` is a
   * no-op (dev is always enabled).
   */
  enabled?: boolean;
}

/**
 * The absolute guard: production NEVER renders. Triple-checks:
 *   - `config.isDev === true` (caller authoritative)
 *   - `NODE_ENV !== "production"` (env authoritative; `isDev` can't lie)
 *   - user did not set `dev.errorOverlay: false`
 *
 * All three must pass. If any check fails we return `false` and the
 * injector emits an empty string.
 */
export function shouldInjectOverlay(config: DevOverlayInjectorConfig): boolean {
  if (config.enabled === false) return false;
  if (!config.isDev) return false;
  try {
    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "production") {
      return false;
    }
  } catch {
    // edge runtimes that sandbox `process` — fall through; isDev already
    // passed and the caller asserted dev mode.
  }
  return true;
}

/**
 * Build the `<style>` + `<script>` block to inject into the SSR `<head>`.
 * Returns `""` in production or when the user opts out.
 *
 * The returned string is expected to be spliced AS-IS into the
 * `renderToHTML` head template — `escapeJsonForInlineScript` is NOT
 * applied at this layer because the content is already safe (a verbatim
 * IIFE string and a verbatim CSS string, both authored in this repo).
 */
export function buildOverlayHeadTag(config: DevOverlayInjectorConfig): string {
  if (!shouldInjectOverlay(config)) return "";
  // `id` attributes let tests + HMR locate the tags. The IIFE guards
  // against double-mount via `OVERLAY_MOUNTED_FLAG`, so even if two
  // copies somehow slip in the user-visible behaviour is still correct.
  return (
    `<style id="__mandu-dev-overlay-style">${OVERLAY_STYLES}</style>` +
    `<script id="__mandu-dev-overlay-client">${OVERLAY_CLIENT_SCRIPT}</script>`
  );
}

/**
 * Thin wrapper called from `runtime/ssr.ts`. The function name matches
 * the spec ("maybeInjectDevOverlay"). Returning a string keeps ssr.ts'
 * template-literal interpolation ergonomic.
 */
export function maybeInjectDevOverlay(config: DevOverlayInjectorConfig): string {
  return buildOverlayHeadTag(config);
}

/**
 * Parse a raw `error.stack` string into frames on the server, mirroring
 * the client-side parser. Server-side preparation means the overlay
 * renders the structured list immediately — no regex cost on the main
 * thread at page load.
 *
 * Deliberately simple: handles Chrome / V8 (`    at fn (file:line:col)`)
 * and Firefox (`fn@file:line:col`). Anything else becomes an
 * `<anonymous>` frame carrying the raw line text, so information is
 * never lost.
 */
export function parseStackFrames(stack: string | undefined | null): DevErrorStackFrame[] {
  if (!stack) return [];
  const lines = stack.split("\n");
  const out: DevErrorStackFrame[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    // Skip the first line if it's just "Error: message" (the header).
    if (/^[A-Z][a-zA-Z]*(?:Error)?:/.test(t) && out.length === 0) continue;
    let m = t.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
    if (m) {
      out.push({
        fn: m[1],
        file: m[2],
        line: Number.parseInt(m[3], 10),
        column: Number.parseInt(m[4], 10),
        raw,
      });
      continue;
    }
    m = t.match(/^at\s+(.+):(\d+):(\d+)$/);
    if (m) {
      out.push({
        fn: "<anonymous>",
        file: m[1],
        line: Number.parseInt(m[2], 10),
        column: Number.parseInt(m[3], 10),
        raw,
      });
      continue;
    }
    m = t.match(/^(.*?)@(.+):(\d+):(\d+)$/);
    if (m) {
      out.push({
        fn: m[1] || "<anonymous>",
        file: m[2],
        line: Number.parseInt(m[3], 10),
        column: Number.parseInt(m[4], 10),
        raw,
      });
      continue;
    }
    out.push({ fn: "<anonymous>", file: t, line: null, column: null, raw });
  }
  return out;
}

/**
 * Build a `DevErrorPayload` from a caught `Error`-like value. Safe
 * against non-Error throws (strings, plain objects, undefined).
 */
export function buildPayloadFromError(
  err: unknown,
  extra: { kind?: DevErrorPayload["kind"]; routeId?: string; url?: string } = {},
): DevErrorPayload {
  let name = "Error";
  let message = "";
  let stack = "";
  if (err && typeof err === "object") {
    const rec = err as { name?: unknown; message?: unknown; stack?: unknown };
    name = typeof rec.name === "string" ? rec.name : "Error";
    message = typeof rec.message === "string" ? rec.message : "";
    stack = typeof rec.stack === "string" ? rec.stack : "";
  } else if (typeof err === "string") {
    message = err;
  } else if (err !== null && err !== undefined) {
    try { message = String(err); } catch { message = "<unserializable>"; }
  }
  return {
    name,
    message,
    frames: parseStackFrames(stack),
    stack,
    kind: extra.kind ?? "ssr",
    timestamp: Date.now(),
    routeId: extra.routeId,
    url: extra.url,
  };
}

/**
 * Build the body-end embed tags for an SSR 500 response. The first tag
 * carries the payload as JSON (the IIFE picks it up on
 * DOMContentLoaded); the second tag is a defensive re-dispatch for
 * pages that already fired DOMContentLoaded by the time the overlay
 * mounts (possible when HMR re-runs the client bundle).
 *
 * Both tags are safe to splice verbatim — `escapeJsonForInlineScript`
 * neutralises any `</script>` in the payload.
 */
export function buildOverlayErrorEmbed(payload: DevErrorPayload): string {
  const json = escapeJsonForInlineScript(JSON.stringify(payload));
  const dispatch = `(function(){try{var d=${json};window.dispatchEvent(new CustomEvent(${JSON.stringify(
    OVERLAY_CUSTOM_EVENT,
  )},{detail:d}));}catch(_){}})();`;
  return (
    `<script id="${OVERLAY_PAYLOAD_ELEMENT_ID}" type="application/json">${json}</script>` +
    `<script>${dispatch}</script>`
  );
}

/**
 * Produce a minimal HTML document for the SSR 500 surface in dev. The
 * overlay client IIFE is inlined so the overlay renders even when the
 * React tree never emitted a root — which is exactly when `createSSRErrorResponse`
 * fires. Returns a complete `<!doctype html>` string; the server wraps
 * it in a 500 `Response`.
 */
export function buildOverlayErrorHtml(payload: DevErrorPayload): string {
  return (
    `<!doctype html><html lang="en"><head><meta charset="UTF-8">` +
    `<title>Mandu — ${escapeTitle(payload.name)}</title>` +
    buildOverlayHeadTag({ isDev: true }) +
    `</head><body><div id="root"></div>` +
    buildOverlayErrorEmbed(payload) +
    `</body></html>`
  );
}

function escapeTitle(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;"
      : c === ">" ? "&gt;"
      : c === "&" ? "&amp;"
      : c === "\"" ? "&quot;"
      : "&#39;",
  );
}
