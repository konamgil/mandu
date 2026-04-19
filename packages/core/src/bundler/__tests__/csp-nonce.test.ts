/**
 * Phase 7.2 R1 Agent C (H1) — CSP nonce tests for Fast Refresh preamble.
 *
 * Three code paths covered:
 *
 *   A — nonce resolver (env opt-out, explicit string, auto-generate, off)
 *   B — preamble tag emitter (nonce attribute injection, opt-out)
 *   C — response header (renderSSR / renderStreamingResponse emit the
 *       right `Content-Security-Policy` value when a nonce is in play)
 *
 * Dependencies: none that touch fs.watch / bun:build — tests use
 * in-memory manifests only, so they run in any environment.
 *
 * References:
 *   docs/security/phase-7-1-audit.md §2 M-01
 *   docs/bun/phase-7-2-team-plan.md §3 Agent C H1
 */

import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import React from "react";
import type { BundleManifest } from "../types";
import {
  renderSSR,
  renderToHTML,
  _testOnly_buildFastRefreshCspHeader,
  _testOnly_generateCspNonce,
  _testOnly_generateFastRefreshPreambleTag,
  _testOnly_getAttachedCspNonce,
  _testOnly_resolveFastRefreshCspNonce,
} from "../../runtime/ssr";

/**
 * Minimal dev-mode manifest carrying the same Fast Refresh URLs the
 * bundler emits. We deliberately keep this a literal so unit tests
 * never invoke `Bun.build` — the plumbing under test is purely string
 * manipulation + header emission.
 */
const DEV_MANIFEST: BundleManifest = {
  version: 1,
  buildTime: "2026-04-19T00:00:00.000Z",
  env: "development",
  bundles: {
    page: {
      js: "/.mandu/client/page.js",
      dependencies: [],
      priority: "visible",
    },
  },
  shared: {
    runtime: "/.mandu/client/_runtime.js",
    vendor: "/.mandu/client/_vendor-react.js",
    fastRefresh: {
      runtime: "/.mandu/client/_fast-refresh-runtime.js",
      glue: "/.mandu/client/_vendor-react-refresh.js",
    },
  },
};

// Preserve env across tests so MANDU_CSP_NONCE toggling doesn't leak.
let prevEnv: string | undefined;
beforeEach(() => {
  prevEnv = process.env.MANDU_CSP_NONCE;
});
afterEach(() => {
  if (prevEnv === undefined) {
    delete process.env.MANDU_CSP_NONCE;
  } else {
    process.env.MANDU_CSP_NONCE = prevEnv;
  }
});

// ═══════════════════════════════════════════════════════════════════
// Section A — resolveFastRefreshCspNonce
// ═══════════════════════════════════════════════════════════════════

describe("csp-nonce — resolveFastRefreshCspNonce", () => {
  test("[A1] generates a fresh 128-bit base64 nonce on each call (entropy > 120 unique of 200)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      seen.add(_testOnly_generateCspNonce());
    }
    // 200 draws from 2^128 should produce 200 distinct values; accept
    // ≥120 unique to survive any pathological RNG quirks.
    expect(seen.size).toBeGreaterThan(120);
    const sample = [...seen][0];
    // 16 bytes → 24 base64 chars incl. `=` padding
    expect(sample.length).toBeGreaterThanOrEqual(20);
    expect(sample.length).toBeLessThanOrEqual(32);
    // base64 alphabet only (no slashes / plus are allowed but not typical
    // for nonces; we accept standard base64)
    expect(/^[A-Za-z0-9+/=]+$/.test(sample)).toBe(true);
  });

  test("[A2] opt-out via MANDU_CSP_NONCE=0 forces undefined even when cspNonce=true", () => {
    process.env.MANDU_CSP_NONCE = "0";
    expect(_testOnly_resolveFastRefreshCspNonce(true)).toBeUndefined();
    expect(_testOnly_resolveFastRefreshCspNonce("fixed")).toBeUndefined();
    expect(_testOnly_resolveFastRefreshCspNonce(false)).toBeUndefined();
  });

  test("[A3] explicit string value is passed through verbatim", () => {
    delete process.env.MANDU_CSP_NONCE;
    expect(_testOnly_resolveFastRefreshCspNonce("abc123")).toBe("abc123");
  });

  test("[A4] undefined / false produce undefined (legacy byte-identical path)", () => {
    delete process.env.MANDU_CSP_NONCE;
    expect(_testOnly_resolveFastRefreshCspNonce(undefined)).toBeUndefined();
    expect(_testOnly_resolveFastRefreshCspNonce(false)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section B — generateFastRefreshPreambleTag
// ═══════════════════════════════════════════════════════════════════

describe("csp-nonce — generateFastRefreshPreambleTag", () => {
  test("[B1] injects nonce attribute onto <script> tag when nonce supplied", () => {
    const out = _testOnly_generateFastRefreshPreambleTag(true, DEV_MANIFEST, "xyz456");
    expect(out).toContain('<script nonce="xyz456">');
    // The original preamble body must still be present (sanity)
    expect(out).toContain("React Fast Refresh preamble");
    // No bare `<script>` remains before the nonced one
    const firstOpen = out.indexOf("<script");
    expect(out.slice(firstOpen, firstOpen + 20)).toBe('<script nonce="xyz45');
  });

  test("[B2] returns empty string in prod (isDev=false) regardless of nonce", () => {
    expect(_testOnly_generateFastRefreshPreambleTag(false, DEV_MANIFEST, "x")).toBe("");
    expect(_testOnly_generateFastRefreshPreambleTag(false, DEV_MANIFEST, undefined)).toBe("");
  });

  test("[B3] returns empty string when manifest has no fastRefresh block (prod manifest)", () => {
    const prodManifest: BundleManifest = {
      ...DEV_MANIFEST,
      env: "production",
      shared: { ...DEV_MANIFEST.shared, fastRefresh: undefined },
    };
    expect(_testOnly_generateFastRefreshPreambleTag(true, prodManifest, "x")).toBe("");
  });

  test("[B4] without nonce, emits bare <script> (backward compat)", () => {
    const out = _testOnly_generateFastRefreshPreambleTag(true, DEV_MANIFEST, undefined);
    expect(out).toContain("<script>");
    expect(out).not.toContain("<script nonce");
  });

  test("[B5] nonce attribute value is HTML-escaped (defense in depth)", () => {
    // A pathological nonce containing a `"` must not break out of the
    // attribute. `escapeHtmlAttr` turns it into `&quot;`.
    const out = _testOnly_generateFastRefreshPreambleTag(true, DEV_MANIFEST, 'a"b');
    expect(out).toContain("<script nonce=");
    expect(out).not.toContain('nonce="a"b"'); // would break attribute
    // The &quot; entity is present somewhere in the opening tag
    expect(out).toMatch(/<script nonce="a(?:&quot;|&#34;)b"/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section C — buildFastRefreshCspHeader
// ═══════════════════════════════════════════════════════════════════

describe("csp-nonce — buildFastRefreshCspHeader", () => {
  test("[C1] header contains script-src with nonce and strict-dynamic", () => {
    const h = _testOnly_buildFastRefreshCspHeader("abc123");
    expect(h).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  test("[C2] strips quotes / CR / LF from nonce (defense in depth)", () => {
    const h = _testOnly_buildFastRefreshCspHeader('a"b\nc\rd');
    // All unsafe chars removed — header is a single line
    expect(h).not.toContain("\n");
    expect(h).not.toContain("\r");
    expect(h).not.toContain('"');
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section D — renderSSR response header integration
// ═══════════════════════════════════════════════════════════════════

describe("csp-nonce — renderSSR integration", () => {
  test("[D1] when cspNonce=true, Response includes Content-Security-Policy header with the same nonce used in preamble", () => {
    delete process.env.MANDU_CSP_NONCE;
    const options = {
      isDev: true,
      routeId: "page",
      serverData: {},
      hydration: { strategy: "island" as const, priority: "visible" as const, preload: false },
      bundleManifest: DEV_MANIFEST,
      cspNonce: true,
    };
    const response = renderSSR(React.createElement("div", null, "hi"), options);
    const header = response.headers.get("Content-Security-Policy");
    expect(header).not.toBeNull();
    expect(header).toMatch(/^script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'$/);
    // The nonce in the header must match the one attached to options
    const attachedNonce = _testOnly_getAttachedCspNonce(options);
    expect(attachedNonce).not.toBeUndefined();
    expect(header).toContain(`'nonce-${attachedNonce}'`);
  });

  test("[D2] when cspNonce=false (default), NO CSP header is emitted — legacy byte-identical", () => {
    const options = {
      isDev: true,
      routeId: "page",
      serverData: {},
      hydration: { strategy: "island" as const, priority: "visible" as const, preload: false },
      bundleManifest: DEV_MANIFEST,
    };
    const response = renderSSR(React.createElement("div", null, "hi"), options);
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  test("[D3] MANDU_CSP_NONCE=0 forces no header even with cspNonce=true", () => {
    process.env.MANDU_CSP_NONCE = "0";
    const options = {
      isDev: true,
      routeId: "page",
      serverData: {},
      hydration: { strategy: "island" as const, priority: "visible" as const, preload: false },
      bundleManifest: DEV_MANIFEST,
      cspNonce: true,
    };
    const response = renderSSR(React.createElement("div", null, "hi"), options);
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });

  test("[D4] when cspNonce is a caller-supplied string, that exact string ends up in header AND preamble", () => {
    delete process.env.MANDU_CSP_NONCE;
    const options = {
      isDev: true,
      routeId: "page",
      serverData: {},
      hydration: { strategy: "island" as const, priority: "visible" as const, preload: false },
      bundleManifest: DEV_MANIFEST,
      cspNonce: "fixed-nonce-value",
    };
    const response = renderSSR(React.createElement("div", null, "hi"), options);
    const header = response.headers.get("Content-Security-Policy");
    expect(header).toBe("script-src 'self' 'nonce-fixed-nonce-value' 'strict-dynamic'");
  });

  test("[D5] renderToHTML embeds nonce into the preamble script tag end-to-end", () => {
    delete process.env.MANDU_CSP_NONCE;
    const options = {
      isDev: true,
      routeId: "page",
      serverData: {},
      hydration: { strategy: "island" as const, priority: "visible" as const, preload: false },
      bundleManifest: DEV_MANIFEST,
      cspNonce: "e2e-token",
    };
    const html = renderToHTML(React.createElement("div", null, "hi"), options);
    expect(html).toContain('<script nonce="e2e-token">');
    // The preamble URLs must still be present (we didn't mangle the body)
    expect(html).toContain("/.mandu/client/_vendor-react-refresh.js");
  });

  test("[D6] prod manifest (no shared.fastRefresh) produces no CSP header even with cspNonce=true", () => {
    delete process.env.MANDU_CSP_NONCE;
    const prodManifest: BundleManifest = {
      ...DEV_MANIFEST,
      env: "production",
      shared: { ...DEV_MANIFEST.shared, fastRefresh: undefined },
    };
    const options = {
      isDev: false,
      routeId: "page",
      serverData: {},
      hydration: { strategy: "island" as const, priority: "visible" as const, preload: false },
      bundleManifest: prodManifest,
      cspNonce: true,
    };
    const response = renderSSR(React.createElement("div", null, "hi"), options);
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
  });
});
