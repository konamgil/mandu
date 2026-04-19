/**
 * Phase 7.2 R1 Agent C (H3, L-01 + L-03) — URL length cap + slot path
 * regex tests.
 *
 * Two independent hardenings, each with its own section:
 *
 *   A — `fast-refresh-plugin#appendBoundary` — reject URLs that are
 *       over 2 KB long or contain characters that could escape an
 *       inline `<script>` context. The rejected file falls back to
 *       full-reload HMR with a console warning.
 *
 *   B — `bundler/dev.ts` slot dispatch (line ~454) — reject
 *       `route.slotModule` paths that look like traversal, absolute
 *       paths, or otherwise violate the bundler's `.slot.ts(x)`
 *       convention. This is a `startDevBundler`-time check; we assert
 *       the behavior end-to-end via a real tempdir + valid manifest.
 *
 * References:
 *   docs/security/phase-7-1-audit.md §3 L-01 + L-03
 *   docs/bun/phase-7-2-team-plan.md §3 Agent C H3
 */

import { describe, expect, test, afterAll, beforeAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { RoutesManifest } from "../../spec/schema";
import {
  appendBoundary,
  validateAcceptFileUrl,
  MAX_ACCEPT_FILE_URL_LEN,
  _testOnly_ALREADY_INJECTED,
} from "../fast-refresh-plugin";
import { startDevBundler, _testOnly_normalizeFsPath } from "../dev";

// ═══════════════════════════════════════════════════════════════════
// Section A — URL length cap on appendBoundary / validateAcceptFileUrl
// ═══════════════════════════════════════════════════════════════════

describe("appendBoundary — URL length cap + escape defense", () => {
  test("[URL1] URL exactly at cap length is accepted", () => {
    const url = "/" + "a".repeat(MAX_ACCEPT_FILE_URL_LEN - 1);
    const v = validateAcceptFileUrl(url);
    expect(v.ok).toBe(true);
    const out = appendBoundary("export const x = 1;\n", url);
    expect(out).toContain("window.__MANDU_HMR__");
  });

  test("[URL2] URL one byte over cap is rejected with a reason", () => {
    const url = "/" + "a".repeat(MAX_ACCEPT_FILE_URL_LEN);
    const v = validateAcceptFileUrl(url);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toMatch(/exceeds cap/);
    }
  });

  test("[URL3] URL with `</` substring is rejected (would break inline script context)", () => {
    const url = "/app/evil</script>.client.tsx";
    const v = validateAcceptFileUrl(url);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/unsafe substring/);
  });

  test("[URL4] URL with newline is rejected", () => {
    const url = "/app/path\nwith-newline.client.tsx";
    const v = validateAcceptFileUrl(url);
    expect(v.ok).toBe(false);
  });

  test("[URL5] URL with <script substring is rejected", () => {
    const url = "/app/<scripty>.client.tsx";
    const v = validateAcceptFileUrl(url);
    expect(v.ok).toBe(false);
  });

  test("[URL6] appendBoundary on rejected URL returns source unchanged + no boundary", () => {
    // Silence the console.warn during this expectation so test output stays clean.
    const origWarn = console.warn;
    let warnCalls = 0;
    console.warn = (...args: unknown[]) => {
      warnCalls += 1;
      void args;
    };
    try {
      const src = "export const x = 1;\n";
      const out = appendBoundary(src, "/app/" + "a".repeat(MAX_ACCEPT_FILE_URL_LEN + 100) + ".client.tsx");
      expect(out).toBe(src);
      expect(out).not.toContain("__MANDU_HMR__");
      expect(warnCalls).toBe(1);
    } finally {
      console.warn = origWarn;
    }
  });

  test("[URL7] short normal URL still accepted and emits acceptFile", () => {
    const url = "/app/counter.client.tsx";
    expect(validateAcceptFileUrl(url).ok).toBe(true);
    const out = appendBoundary("export default function C() { return null; }\n", url);
    expect(out).toContain('.acceptFile("/app/counter.client.tsx")');
    // The idempotency guard survives: re-running appendBoundary is a no-op
    const out2 = appendBoundary(out, url);
    expect(out2).toBe(out);
    expect(_testOnly_ALREADY_INJECTED.test(out)).toBe(true);
  });

  test("[URL8] empty string URL rejected", () => {
    expect(validateAcceptFileUrl("").ok).toBe(false);
  });

  test("[URL9] non-string URL rejected (defense against buggy callsite)", () => {
    // TS types forbid it, but appendBoundary is a pure fn — anyone could
    // call it with a bad arg. Make sure validateAcceptFileUrl guards.
    const v = validateAcceptFileUrl(123 as unknown as string);
    expect(v.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Section B — slotModule regex + traversal defense in startDevBundler
// ═══════════════════════════════════════════════════════════════════

// These tests call into `startDevBundler` (which does an initial
// Bun.build). Skip under the bundler-flaky CI flag.
describe.skipIf(process.env.MANDU_SKIP_BUNDLER_TESTS === "1")(
  "startDevBundler — slotModule path validation",
  () => {
    let rootDir = "";

    beforeAll(async () => {
      rootDir = await mkdtemp(path.join(tmpdir(), "mandu-slotmod-"));
      // Minimal project so `buildClientBundles` does not explode.
      await mkdir(path.join(rootDir, "app"), { recursive: true });
      await mkdir(path.join(rootDir, "spec", "slots"), { recursive: true });
      await writeFile(
        path.join(rootDir, "app", "page.tsx"),
        `export default function Page(){return null;}\n`,
        "utf-8",
      );
      await writeFile(
        path.join(rootDir, "spec", "slots", "home.slot.ts"),
        `export async function load() { return {}; }\n`,
        "utf-8",
      );
    });

    afterAll(async () => {
      if (rootDir) await rm(rootDir, { recursive: true, force: true });
    });

    test("[SLOT1] valid slotModule path (spec/slots/*.slot.ts) is accepted — no warning", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
      try {
        const manifest: RoutesManifest = {
          version: 1,
          routes: [
            {
              id: "home",
              kind: "page",
              pattern: "/",
              module: "app/page.tsx",
              componentModule: "app/page.tsx",
              slotModule: "spec/slots/home.slot.ts",
            },
          ],
        };
        const bundler = await startDevBundler({ rootDir, manifest });
        bundler.close();
        const slotWarnings = warnings.filter((w) => w.includes("slotModule rejected"));
        expect(slotWarnings).toEqual([]);
      } finally {
        console.warn = origWarn;
      }
    });

    test("[SLOT2] path traversal slotModule (`../../etc/passwd`) is rejected with warning", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
      try {
        const manifest: RoutesManifest = {
          version: 1,
          routes: [
            {
              id: "home",
              kind: "page",
              pattern: "/",
              module: "app/page.tsx",
              componentModule: "app/page.tsx",
              slotModule: "../../../etc/passwd",
            },
          ],
        };
        const bundler = await startDevBundler({ rootDir, manifest });
        bundler.close();
        const slotWarnings = warnings.filter((w) => w.includes("slotModule rejected"));
        expect(slotWarnings.length).toBeGreaterThan(0);
      } finally {
        console.warn = origWarn;
      }
    });

    test("[SLOT3] absolute path slotModule is rejected", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
      try {
        const manifest: RoutesManifest = {
          version: 1,
          routes: [
            {
              id: "home",
              kind: "page",
              pattern: "/",
              module: "app/page.tsx",
              componentModule: "app/page.tsx",
              slotModule: "/etc/passwd",
            },
          ],
        };
        const bundler = await startDevBundler({ rootDir, manifest });
        bundler.close();
        const slotWarnings = warnings.filter((w) => w.includes("slotModule rejected"));
        expect(slotWarnings.length).toBeGreaterThan(0);
      } finally {
        console.warn = origWarn;
      }
    });

    test("[SLOT4] Windows absolute path slotModule (C:\\...) is rejected", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
      try {
        const manifest: RoutesManifest = {
          version: 1,
          routes: [
            {
              id: "home",
              kind: "page",
              pattern: "/",
              module: "app/page.tsx",
              componentModule: "app/page.tsx",
              slotModule: "C:\\Windows\\System32\\drivers\\etc\\hosts",
            },
          ],
        };
        const bundler = await startDevBundler({ rootDir, manifest });
        bundler.close();
        const slotWarnings = warnings.filter((w) => w.includes("slotModule rejected"));
        expect(slotWarnings.length).toBeGreaterThan(0);
      } finally {
        console.warn = origWarn;
      }
    });

    test("[SLOT5] wrong-extension slotModule (plain .ts not .slot.ts) is rejected", async () => {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
      try {
        const manifest: RoutesManifest = {
          version: 1,
          routes: [
            {
              id: "home",
              kind: "page",
              pattern: "/",
              module: "app/page.tsx",
              componentModule: "app/page.tsx",
              slotModule: "app/utils.ts",
            },
          ],
        };
        const bundler = await startDevBundler({ rootDir, manifest });
        bundler.close();
        const slotWarnings = warnings.filter((w) => w.includes("slotModule rejected"));
        expect(slotWarnings.length).toBeGreaterThan(0);
      } finally {
        console.warn = origWarn;
      }
    });
  },
);
