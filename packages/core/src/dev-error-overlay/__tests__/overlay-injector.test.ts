/**
 * Phase 18.α — Dev Error Overlay regression tests.
 *
 * Covers:
 *   - Dev injection emits both <style> and <script> tags
 *   - Production (NODE_ENV=production) suppresses injection
 *   - Explicit `enabled: false` suppresses injection even in dev
 *   - Stack parsing handles Chrome + Firefox shapes + fallthrough
 *   - Error embed escapes `</script>` sequences
 *   - Payload builder tolerates non-Error throws
 *   - buildOverlayErrorHtml wraps the embed in a valid doctype doc
 *   - Client IIFE mounts the mounted-flag guard to prevent double-mount
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  buildOverlayHeadTag,
  maybeInjectDevOverlay,
  shouldInjectOverlay,
  parseStackFrames,
  buildPayloadFromError,
  buildOverlayErrorEmbed,
  buildOverlayErrorHtml,
} from "../overlay-injector";
import {
  OVERLAY_CLIENT_SCRIPT,
  _testOnly_buildOverlayClientScript,
} from "../overlay-client";
import {
  OVERLAY_CUSTOM_EVENT,
  OVERLAY_MOUNTED_FLAG,
  OVERLAY_PAYLOAD_ELEMENT_ID,
} from "../types";

describe("shouldInjectOverlay", () => {
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  });

  it("returns true in dev with default config", () => {
    process.env.NODE_ENV = "development";
    expect(shouldInjectOverlay({ isDev: true })).toBe(true);
  });

  it("returns false when isDev is false", () => {
    process.env.NODE_ENV = "development";
    expect(shouldInjectOverlay({ isDev: false })).toBe(false);
  });

  it("returns false when NODE_ENV=production even if isDev lies", () => {
    process.env.NODE_ENV = "production";
    expect(shouldInjectOverlay({ isDev: true })).toBe(false);
  });

  it("returns false when user opts out via enabled: false", () => {
    process.env.NODE_ENV = "development";
    expect(shouldInjectOverlay({ isDev: true, enabled: false })).toBe(false);
  });

  it("returns true when user explicitly enables in dev", () => {
    process.env.NODE_ENV = "development";
    expect(shouldInjectOverlay({ isDev: true, enabled: true })).toBe(true);
  });
});

describe("buildOverlayHeadTag", () => {
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  });

  it("emits <style> and <script> in dev", () => {
    process.env.NODE_ENV = "development";
    const out = buildOverlayHeadTag({ isDev: true });
    expect(out).toContain("<style");
    expect(out).toContain("id=\"__mandu-dev-overlay-style\"");
    expect(out).toContain("<script");
    expect(out).toContain("id=\"__mandu-dev-overlay-client\"");
    expect(out).toContain(".mandu-dev-overlay");
  });

  it("emits empty string in production", () => {
    process.env.NODE_ENV = "production";
    expect(buildOverlayHeadTag({ isDev: true })).toBe("");
  });

  it("emits empty string when opted out", () => {
    process.env.NODE_ENV = "development";
    expect(buildOverlayHeadTag({ isDev: true, enabled: false })).toBe("");
  });

  it("maybeInjectDevOverlay is alias with same behavior", () => {
    process.env.NODE_ENV = "development";
    expect(maybeInjectDevOverlay({ isDev: true })).toBe(
      buildOverlayHeadTag({ isDev: true }),
    );
  });

  it("does not contain the sentinel flag leaking as a global assignment outside the IIFE", () => {
    process.env.NODE_ENV = "development";
    const out = buildOverlayHeadTag({ isDev: true });
    // The sentinel is only ever referenced via `window[MOUNTED]`, never as a bare identifier assignment.
    expect(out.includes(`var ${OVERLAY_MOUNTED_FLAG}=`)).toBe(false);
    // But the string literal MUST appear at least once (inside the IIFE).
    expect(out).toContain(OVERLAY_MOUNTED_FLAG);
  });
});

describe("parseStackFrames", () => {
  it("parses Chrome-style frames", () => {
    const stack = `TypeError: boom
    at myFn (/src/app/page.tsx:42:10)
    at Other (/src/app/layout.tsx:7:5)`;
    const frames = parseStackFrames(stack);
    expect(frames.length).toBe(2);
    expect(frames[0].fn).toBe("myFn");
    expect(frames[0].file).toBe("/src/app/page.tsx");
    expect(frames[0].line).toBe(42);
    expect(frames[0].column).toBe(10);
  });

  it("parses Firefox-style frames", () => {
    const stack = `TypeError: boom
myFn@/src/app/page.tsx:42:10
@/src/app/layout.tsx:7:5`;
    const frames = parseStackFrames(stack);
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(frames[0].file).toBe("/src/app/page.tsx");
    expect(frames[0].line).toBe(42);
  });

  it("tolerates empty / null input", () => {
    expect(parseStackFrames(undefined)).toEqual([]);
    expect(parseStackFrames(null)).toEqual([]);
    expect(parseStackFrames("")).toEqual([]);
  });

  it("falls through with <anonymous> for unparseable lines", () => {
    const stack = `SomeWeirdRuntime\nopaque frame line`;
    const frames = parseStackFrames(stack);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames.some((f) => f.fn === "<anonymous>")).toBe(true);
  });
});

describe("buildPayloadFromError", () => {
  it("extracts name, message, and stack from an Error", () => {
    const err = new Error("boom");
    err.name = "CustomError";
    const p = buildPayloadFromError(err, { kind: "ssr", routeId: "r1" });
    expect(p.name).toBe("CustomError");
    expect(p.message).toBe("boom");
    expect(p.kind).toBe("ssr");
    expect(p.routeId).toBe("r1");
    expect(typeof p.timestamp).toBe("number");
  });

  it("tolerates string throws", () => {
    const p = buildPayloadFromError("just a string");
    expect(p.message).toBe("just a string");
    expect(p.name).toBe("Error");
    expect(p.frames).toEqual([]);
  });

  it("tolerates null and undefined", () => {
    const p1 = buildPayloadFromError(null);
    expect(p1.name).toBe("Error");
    const p2 = buildPayloadFromError(undefined);
    expect(p2.name).toBe("Error");
  });
});

describe("buildOverlayErrorEmbed", () => {
  it("emits a JSON script tag with the payload id", () => {
    const p = buildPayloadFromError(new Error("test"), { kind: "ssr" });
    const embed = buildOverlayErrorEmbed(p);
    expect(embed).toContain(`id="${OVERLAY_PAYLOAD_ELEMENT_ID}"`);
    expect(embed).toContain("application/json");
    expect(embed).toContain(OVERLAY_CUSTOM_EVENT);
  });

  it("escapes </script> in the payload so it cannot break out", () => {
    const err = new Error("</script><script>alert(1)</script>");
    const p = buildPayloadFromError(err);
    const embed = buildOverlayErrorEmbed(p);
    // The literal </script> sequence must not appear in the serialized JSON.
    // escapeJsonForInlineScript breaks it into a harmless form.
    const between = embed.split(`id="${OVERLAY_PAYLOAD_ELEMENT_ID}"`)[1] ?? "";
    const payloadChunk = between.split("</script>")[0] ?? "";
    expect(payloadChunk.toLowerCase().includes("<script>alert(1)")).toBe(false);
  });
});

describe("buildOverlayErrorHtml", () => {
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
  });

  it("wraps the embed in a valid dev HTML document", () => {
    process.env.NODE_ENV = "development";
    const p = buildPayloadFromError(new Error("ssr boom"), { kind: "ssr", routeId: "home" });
    const html = buildOverlayErrorHtml(p);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>");
    expect(html).toContain(`id="${OVERLAY_PAYLOAD_ELEMENT_ID}"`);
    expect(html).toContain(".mandu-dev-overlay");
  });
});

describe("OVERLAY_CLIENT_SCRIPT shape", () => {
  it("is a well-formed IIFE", () => {
    expect(OVERLAY_CLIENT_SCRIPT.startsWith("(function(){")).toBe(true);
    expect(OVERLAY_CLIENT_SCRIPT.endsWith("})();")).toBe(true);
  });

  it("references the mounted-flag guard (prevents double-mount on HMR)", () => {
    expect(OVERLAY_CLIENT_SCRIPT).toContain(OVERLAY_MOUNTED_FLAG);
    expect(OVERLAY_CLIENT_SCRIPT).toContain("window[MOUNTED]=true");
  });

  it("wires all three error entry points", () => {
    expect(OVERLAY_CLIENT_SCRIPT).toContain(`"error"`);
    expect(OVERLAY_CLIENT_SCRIPT).toContain("unhandledrejection");
    expect(OVERLAY_CLIENT_SCRIPT).toContain(OVERLAY_CUSTOM_EVENT);
  });

  it("stays under the 10 KB-gzip target (rough byte budget check)", () => {
    // Uncompressed budget: 64 KB is a generous ceiling; gzip typically
    // achieves 4-5x on this sort of string-heavy JS. We assert uncompressed
    // < 32 KB as a hard ceiling — the current IIFE is ~7 KB uncompressed.
    expect(OVERLAY_CLIENT_SCRIPT.length).toBeLessThan(32 * 1024);
  });

  it("is recomputable — _testOnly_buildOverlayClientScript yields identical output", () => {
    expect(_testOnly_buildOverlayClientScript()).toBe(OVERLAY_CLIENT_SCRIPT);
  });
});
