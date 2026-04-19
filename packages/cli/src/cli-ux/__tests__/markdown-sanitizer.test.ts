/**
 * Markdown sanitizer regression tests — Phase 11.B (L-04).
 *
 * Guards the control-char pre-filter and the OSC 8 URL allowlist that
 * `renderMarkdown` layers on top of `Bun.markdown.ansi`. The underlying
 * engine happily passes raw `\x1b` (ESC) sequences and `javascript:`
 * URLs through unsanitized — see `docs/security/phase-9-audit.md` §L-04
 * for the threat model and proof-of-concept inputs.
 *
 * Each test pair follows the standard "before = vulnerable, after =
 * defended" structure so a future regression is obvious from the failure
 * message alone.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  plainFallback,
  renderMarkdown,
  sanitizeControl,
  sanitizeOsc8,
} from "../markdown";

// Raw ESC (0x1B) — the most dangerous C0 byte because it introduces
// every ANSI control sequence (CSI, OSC, etc.). Defined inline rather
// than as a TS constant so the literal is unambiguous when reading the
// tests.
const ESC = "\x1b";
const OSC_ST = "\x1b\\"; // OSC String Terminator
const OSC_BEL = "\x07";  // OSC Bell Terminator (legacy)

describe("sanitizeControl", () => {
  it("strips ESC (0x1B) while preserving the surrounding text", () => {
    const input = `before${ESC}[2Jafter`;
    const out = sanitizeControl(input);
    expect(out).toBe("before[2Jafter");
    expect(out).not.toContain(ESC);
  });

  it("strips all C0 control bytes except TAB and LF", () => {
    // Build a string with every C0 code point + DEL.
    const codes: number[] = [];
    for (let i = 0; i <= 0x1f; i += 1) codes.push(i);
    codes.push(0x7f);
    const input = `X${codes.map((c) => String.fromCharCode(c)).join("")}Y`;
    const out = sanitizeControl(input);
    // Only TAB (0x09) and LF (0x0A) survive between X and Y.
    expect(out).toBe(`X\t\nY`);
  });

  it("strips DEL (0x7F) and C1 (0x80-0x9F) control bytes", () => {
    const input = `a${String.fromCharCode(0x7f)}b${String.fromCharCode(0x85)}c${String.fromCharCode(0x9f)}d`;
    expect(sanitizeControl(input)).toBe("abcd");
  });

  it("leaves printable ASCII, unicode letters, and emoji intact", () => {
    const input = "Hello, 세계! 🚀 café — naïve";
    expect(sanitizeControl(input)).toBe(input);
  });

  it("returns empty string for non-string input", () => {
    // @ts-expect-error — intentional misuse
    expect(sanitizeControl(undefined)).toBe("");
    // @ts-expect-error — intentional misuse
    expect(sanitizeControl(null)).toBe("");
    // @ts-expect-error — intentional misuse
    expect(sanitizeControl(42)).toBe("");
  });
});

describe("sanitizeOsc8 URL allowlist", () => {
  it("preserves https:// hyperlinks", () => {
    const rendered = `${ESC}]8;;https://mandu.dev/docs${OSC_ST}label${ESC}]8;;${OSC_ST}`;
    const out = sanitizeOsc8(rendered);
    expect(out).toContain("https://mandu.dev/docs");
    expect(out).toContain("label");
  });

  it("preserves http:// hyperlinks", () => {
    const rendered = `${ESC}]8;;http://example.com/${OSC_ST}label${ESC}]8;;${OSC_ST}`;
    const out = sanitizeOsc8(rendered);
    expect(out).toContain("http://example.com/");
  });

  it("preserves file:// hyperlinks only when explicitly opted-in (Wave R3 M-03)", () => {
    const rendered = `${ESC}]8;;file:///home/user/readme.md${OSC_ST}Readme${ESC}]8;;${OSC_ST}`;
    // Default behavior: file:// is dropped (AI-chat safety).
    const defaultOut = sanitizeOsc8(rendered);
    expect(defaultOut).not.toContain("file:///home/user/readme.md");
    expect(defaultOut).toContain("Readme");
    // Opt-in: file:// is preserved for local-doc renderers.
    const optedIn = sanitizeOsc8(rendered, { allowFileScheme: true });
    expect(optedIn).toContain("file:///home/user/readme.md");
  });

  it("strips javascript: URL but keeps the label visible", () => {
    const rendered = `${ESC}]8;;javascript:alert(1)${OSC_ST}click me${ESC}]8;;${OSC_ST}`;
    const out = sanitizeOsc8(rendered);
    expect(out).not.toContain("javascript:alert(1)");
    expect(out).toContain("click me");
    // The open-hyperlink marker should have its URL dropped.
    expect(out).not.toMatch(/\x1b\]8;;javascript:/);
  });

  it("strips data: URL (arbitrary payload)", () => {
    const rendered = `${ESC}]8;;data:text/html,<script>alert(1)</script>${OSC_ST}oops${ESC}]8;;${OSC_ST}`;
    const out = sanitizeOsc8(rendered);
    expect(out).not.toContain("data:text/html");
    expect(out).toContain("oops");
  });

  it("strips vbscript: and other exotic schemes", () => {
    const rendered = `${ESC}]8;;vbscript:msgbox(1)${OSC_ST}link${ESC}]8;;${OSC_ST}`;
    const out = sanitizeOsc8(rendered);
    expect(out).not.toContain("vbscript:");
  });

  it("rejects relative URLs (no scheme)", () => {
    const rendered = `${ESC}]8;;../etc/passwd${OSC_ST}path${ESC}]8;;${OSC_ST}`;
    const out = sanitizeOsc8(rendered);
    expect(out).not.toContain("../etc/passwd");
    expect(out).toContain("path");
  });

  it("handles BEL-terminated OSC 8 (legacy terminal variant)", () => {
    const rendered = `${ESC}]8;;javascript:evil${OSC_BEL}label${ESC}]8;;${OSC_BEL}`;
    const out = sanitizeOsc8(rendered);
    expect(out).not.toContain("javascript:evil");
    expect(out).toContain("label");
  });

  it("is a no-op on rendered text without OSC 8", () => {
    const rendered = `${ESC}[1mbold${ESC}[22m text`;
    expect(sanitizeOsc8(rendered)).toBe(rendered);
  });

  it("upper-case schemes are normalized (JAVASCRIPT: still rejected)", () => {
    const rendered = `${ESC}]8;;JavaScript:alert(1)${OSC_ST}x${ESC}]8;;${OSC_ST}`;
    const out = sanitizeOsc8(rendered);
    expect(out).not.toContain("JavaScript:alert(1)");
  });
});

describe("renderMarkdown end-to-end sanitization", () => {
  const envSnapshot = {
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
    CI: process.env.CI,
    TERM: process.env.TERM,
  };

  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    delete process.env.CI;
    process.env.TERM = "xterm-256color";
    (process.stdout as { isTTY?: boolean }).isTTY = true;
  });

  afterEach(() => {
    for (const key of ["NO_COLOR", "FORCE_COLOR", "CI", "TERM"] as const) {
      const prev = envSnapshot[key];
      if (prev === undefined) delete process.env[key];
      else process.env[key] = prev;
    }
    (process.stdout as { isTTY?: boolean }).isTTY = originalIsTTY;
  });

  it("blocks ESC-injected screen-clear (CWE-20)", () => {
    // Simulates an attacker-supplied project name smuggled into a landing
    // template: `\x1b[2J\x1b[H` = clear screen + home cursor.
    const malicious = `# Welcome ${ESC}[2J${ESC}[HYou have been hacked`;
    const out = renderMarkdown(malicious);
    expect(out).not.toContain(`${ESC}[2J`);
    expect(out).not.toContain(`${ESC}[H`);
    // The textual content still renders — we only strip the injection.
    expect(out).toContain("Welcome");
    expect(out).toContain("You have been hacked");
  });

  it("renders legitimate Markdown ANSI (headings, bold) unaffected", () => {
    const out = renderMarkdown("# Hello\n**bold** text");
    // Real ANSI from Bun.markdown — at least one CSI color sequence.
    expect(out).toMatch(/\x1b\[/);
    expect(out).toContain("Hello");
    expect(out).toContain("bold");
  });

  it("neutralizes malicious OSC 8 links in rendered output", () => {
    const out = renderMarkdown("[click](javascript:alert(1))");
    // The rendered text preserves the label.
    expect(out).toContain("click");
    // The URL is gone.
    expect(out).not.toContain("javascript:alert(1)");
  });

  it("preserves allowed OSC 8 links (https://)", () => {
    const out = renderMarkdown("[docs](https://mandu.dev/docs)");
    expect(out).toContain("docs");
    expect(out).toContain("https://mandu.dev/docs");
  });

  it("plain fallback also sanitizes control chars", () => {
    // Force plain mode — sanitization should still run.
    const malicious = `before ${ESC}[2J after`;
    const out = renderMarkdown(malicious, { plain: true });
    expect(out).not.toContain(ESC);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("plainFallback (direct) leaves control chars untouched (sanitize lives one layer up)", () => {
    // The direct plainFallback() is purely for Markdown syntax stripping;
    // it does NOT run sanitizeControl. This test documents that split of
    // responsibility so renderMarkdown remains the only safe entry point.
    const input = `before${ESC}[2Jafter`;
    const out = plainFallback(input);
    expect(out).toContain(ESC); // raw fallback passes ESC through
  });
});
